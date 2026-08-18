/**
 * Suivi GPS.
 *
 * Points sensibles vérifiés ici :
 *  - aucune position collectée hors livraison active (minimisation) ;
 *  - les rejeux hors ligne ne dupliquent pas le trajet ;
 *  - un client ne voit que sa propre livraison, sans le trajet complet ni le
 *    numéro personnel du livreur ;
 *  - une position périmée est annoncée comme telle plutôt qu'affichée.
 */
import 'dotenv/config';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { TRACKING_CONFIG } from '@agrim/contracts';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { haversineMeters } from './tracking.service';

describe('Suivi GPS (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prefix = '/api/v1';

  let clientToken: string;
  let courierToken: string;
  let courierId: string;
  let managerToken: string;
  let addressId: string;
  let variantId: string;

  const orderIds: string[] = [];
  const addressIds: string[] = [];

  // Yamoussoukro : la destination de test.
  const DEST = { latitude: 6.8276, longitude: -5.2893 };

  beforeAll(async () => {
    process.env.THROTTLE_DISABLED = '1';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const login = async (phone: string) => {
      const res = await request(app.getHttpServer())
        .post(`${prefix}/auth/login`)
        .send({ phone, password: 'Agrim2026!' });
      return res.body as { accessToken: string; user: { id: string } };
    };

    clientToken = (await login('0700000001')).accessToken;
    // 0700000004 = GESTIONNAIRE. 0700000005 est ADMIN : l'utiliser ici
    // laisserait le rôle de gestion sans aucune couverture.
    managerToken = (await login('0700000004')).accessToken;
    const courier = await login('0700000002');
    courierToken = courier.accessToken;
    courierId = courier.user.id;

    const address = await request(app.getHttpServer())
      .post(`${prefix}/addresses`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        label: 'Verif GPS',
        city: 'Yamoussoukro',
        landmark: 'Près du marché',
        contactPhone: '0700000001',
      });
    addressId = address.body.id;
    addressIds.push(addressId);

    // Coordonnées posées directement : l'API d'adresses ne les expose pas encore.
    await prisma.db.address.update({
      where: { id: addressId },
      data: { latitude: DEST.latitude, longitude: DEST.longitude },
    });

    const variant = await prisma.db.productVariant.findFirstOrThrow({
      where: { isAvailable: true },
      select: { id: true },
    });
    variantId = variant.id;
    await prisma.db.productVariant.update({
      where: { id: variantId },
      data: { stock: 500 },
    });
  });

  afterAll(async () => {
    if (orderIds.length > 0) {
      await prisma.db.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (addressIds.length > 0) {
      await prisma.db.address.deleteMany({ where: { id: { in: addressIds } } });
    }
    await app.close();
    delete process.env.THROTTLE_DISABLED;
  });

  const createOrder = async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/orders`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        addressId,
        items: [{ variantId, quantity: 1 }],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: randomUUID(),
      });
    orderIds.push(res.body.id);
    return res.body.reference as string;
  };

  /**
   * Fait avancer la course et VÉRIFIE que la transition a été acceptée : un
   * helper qui échoue en silence rend le test suivant incompréhensible.
   */
  const setStatus = async (
    id: string,
    status: string,
    extra: Record<string, unknown> = {},
  ) => {
    const res = await request(app.getHttpServer())
      .patch(`${prefix}/deliveries/${id}/status`)
      .set('Authorization', `Bearer ${courierToken}`)
      .send({ status, ...extra });
    if (res.status !== 200) {
      throw new Error(
        `Transition ${status} refusée (${res.status}) : ${JSON.stringify(res.body)}`,
      );
    }
    return res;
  };

  /** Course amenée jusqu'à IN_TRANSIT : le suivi y est actif. */
  const startedDelivery = async () => {
    const reference = await createOrder();
    const assigned = await request(app.getHttpServer())
      .post(`${prefix}/deliveries/orders/${reference}/assign`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ courierId });
    const id = assigned.body.id as string;
    await setStatus(id, 'ACCEPTED');
    await setStatus(id, 'PICKED_UP');
    return { id, reference };
  };

  const push = (deliveryId: string, points: unknown[], token = courierToken) =>
    request(app.getHttpServer())
      .post(`${prefix}/deliveries/locations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ deliveryId, points });

  /** Point à ~1 km au nord de la destination. */
  const pointNear = (recordedAt: string) => ({
    latitude: DEST.latitude + 0.009,
    longitude: DEST.longitude,
    accuracy: 12,
    heading: 180,
    speed: 6,
    recordedAt,
  });

  /* ------------------------------ Émission ------------------------------ */

  it('accepte un lot de positions pendant une course engagée', async () => {
    const { id } = await startedDelivery();

    const res = await push(id, [
      pointNear(new Date().toISOString()),
      pointNear(new Date(Date.now() + 1000).toISOString()),
    ]);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ accepted: 2, received: 2 });
  });

  it('refuse toute position hors livraison active', async () => {
    const reference = await createOrder();
    const assigned = await request(app.getHttpServer())
      .post(`${prefix}/deliveries/orders/${reference}/assign`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ courierId });

    // Course seulement affectée : rien ne doit être collecté.
    const res = await push(assigned.body.id, [
      pointNear(new Date().toISOString()),
    ]);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TRACKING_NOT_ACTIVE');
  });

  it('ignore les rejeux hors ligne sans dupliquer le trajet', async () => {
    const { id } = await startedDelivery();
    const at = new Date().toISOString();

    const first = await push(id, [pointNear(at)]);
    expect(first.body.accepted).toBe(1);

    // Le mobile rejoue sa file après une coupure réseau.
    const replay = await push(id, [pointNear(at)]);
    expect(replay.body).toEqual({ accepted: 0, received: 1 });

    const stored = await prisma.db.deliveryLocation.count({
      where: { deliveryId: id },
    });
    expect(stored).toBe(1);
  });

  it('empêche un livreur d’alimenter la course d’un autre', async () => {
    const { id } = await startedDelivery();
    const other = await prisma.db.user.findFirstOrThrow({
      where: { role: 'LIVREUR', id: { not: courierId } },
      select: { phone: true },
    });
    const otherLogin = await request(app.getHttpServer())
      .post(`${prefix}/auth/login`)
      .send({ phone: other.phone, password: 'Agrim2026!' });

    if (!otherLogin.body.accessToken) return; // second livreur sans mot de passe utilisable

    const res = await push(
      id,
      [pointNear(new Date().toISOString())],
      otherLogin.body.accessToken,
    );
    expect(res.status).toBe(404);
  });

  it('rejette une coordonnée hors bornes', async () => {
    const { id } = await startedDelivery();

    const res = await push(id, [
      { ...pointNear(new Date().toISOString()), latitude: 120 },
    ]);
    expect(res.status).toBe(400);
  });

  it('refuse l’émission à un client', async () => {
    const { id } = await startedDelivery();
    const res = await push(
      id,
      [pointNear(new Date().toISOString())],
      clientToken,
    );
    expect(res.status).toBe(403);
  });

  /* ------------------------------- Lecture ------------------------------ */

  it('expose au client la position, la distance et une heure d’arrivée', async () => {
    const { id, reference } = await startedDelivery();
    await push(id, [pointNear(new Date().toISOString())]);

    const res = await request(app.getHttpServer())
      .get(`${prefix}/orders/${reference}/tracking`)
      .set('Authorization', `Bearer ${clientToken}`);

    expect(res.status).toBe(200);
    expect(res.body.isLive).toBe(true);
    expect(res.body.currentPosition.latitude).toBeCloseTo(
      DEST.latitude + 0.009,
      4,
    );
    // ~1 km à vol d'oiseau.
    expect(res.body.remainingMeters).toBeGreaterThan(800);
    expect(res.body.remainingMeters).toBeLessThan(1200);
    expect(res.body.etaSeconds).toBeGreaterThan(0);
    expect(res.body.estimatedArrivalAt).not.toBeNull();
  });

  it('annonce une position périmée comme indisponible', async () => {
    const { id, reference } = await startedDelivery();
    const stale = new Date(
      Date.now() - (TRACKING_CONFIG.stalePositionSeconds + 60) * 1000,
    ).toISOString();
    await push(id, [pointNear(stale)]);

    const res = await request(app.getHttpServer())
      .get(`${prefix}/orders/${reference}/tracking`)
      .set('Authorization', `Bearer ${clientToken}`);

    // Mieux vaut « indisponible » qu'un marqueur figé qui ment.
    expect(res.body.isLive).toBe(false);
    expect(res.body.remainingMeters).toBeNull();
    expect(res.body.etaSeconds).toBeNull();
  });

  it('n’expose ni le trajet complet ni le numéro personnel du livreur', async () => {
    const { id, reference } = await startedDelivery();
    await push(id, [
      pointNear(new Date(Date.now() - 3000).toISOString()),
      pointNear(new Date().toISOString()),
    ]);

    const res = await request(app.getHttpServer())
      .get(`${prefix}/orders/${reference}/tracking`)
      .set('Authorization', `Bearer ${clientToken}`);

    expect(res.body.points).toBeUndefined();
    expect(res.body.courier.contactPhone).toBeNull();
    expect(res.body.courier.lastName).toBeUndefined();
    expect(res.body.courier.firstName).toEqual(expect.any(String));
  });

  it('refuse le suivi de la commande d’autrui', async () => {
    const { reference } = await startedDelivery();

    const res = await request(app.getHttpServer())
      .get(`${prefix}/orders/${reference}/tracking`)
      .set('Authorization', `Bearer ${courierToken}`);

    // Le livreur n'est pas le propriétaire de la commande.
    expect(res.status).toBe(404);
  });

  it('cesse d’exposer une position une fois la course terminée', async () => {
    const { id, reference } = await startedDelivery();
    await setStatus(id, 'IN_TRANSIT');
    await push(id, [pointNear(new Date().toISOString())]);
    await setStatus(id, 'FAILED', { failureReason: 'Client injoignable' });

    const res = await request(app.getHttpServer())
      .get(`${prefix}/orders/${reference}/tracking`)
      .set('Authorization', `Bearer ${clientToken}`);

    expect(res.body.currentPosition).toBeNull();
    expect(res.body.isLive).toBe(false);
  });

  it('rend au livreur le trajet de sa course, dans l’ordre', async () => {
    const { id } = await startedDelivery();
    const t0 = new Date(Date.now() - 5000).toISOString();
    const t1 = new Date().toISOString();
    await push(id, [pointNear(t1), pointNear(t0)]);

    const res = await request(app.getHttpServer())
      .get(`${prefix}/deliveries/${id}/route`)
      .set('Authorization', `Bearer ${courierToken}`);

    expect(res.status).toBe(200);
    expect(res.body.points).toHaveLength(2);
    expect(new Date(res.body.points[0].recordedAt).getTime()).toBeLessThan(
      new Date(res.body.points[1].recordedAt).getTime(),
    );
  });
});

describe('Distance à vol d’oiseau', () => {
  it('calcule une distance connue avec une marge acceptable', () => {
    // Yamoussoukro → Abidjan : ~220 km à vol d'oiseau.
    const d = haversineMeters(
      { latitude: 6.8276, longitude: -5.2893 },
      { latitude: 5.3599, longitude: -4.0083 },
    );
    expect(d).toBeGreaterThan(200_000);
    expect(d).toBeLessThan(240_000);
  });

  it('renvoie zéro pour deux points identiques', () => {
    const p = { latitude: 6.8276, longitude: -5.2893 };
    expect(haversineMeters(p, p)).toBe(0);
  });
});
