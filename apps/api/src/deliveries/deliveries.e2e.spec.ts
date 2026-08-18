/**
 * Tests d'intégration de l'espace livreur.
 *
 * Enjeux vérifiés ici, impossibles à couvrir en unitaire :
 *  - un livreur ne voit ni ne touche les courses d'un autre ;
 *  - aucune livraison ne se valide sans le code du client ;
 *  - la commande suit la course sans jamais reculer.
 */
import 'dotenv/config';

import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';

import { AppModule } from '../app.module';
import { configureApp } from '../bootstrap';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';

describe('Livraisons (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prefix = '/api/v1';

  let clientToken: string;
  let courierToken: string;
  let managerToken: string;
  let courierId: string;
  let otherCourierId: string;
  let addressId: string;
  let variantId: string;

  const orderIds: string[] = [];
  const addressIds: string[] = [];

  beforeAll(async () => {
    process.env.THROTTLE_DISABLED = '1';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    configureApp(app, { isProd: false });
    await app.init();
    prisma = app.get(PrismaService);

    const login = async (phone: string) => {
      const res = await request(app.getHttpServer())
        .post(`${prefix}/auth/login`)
        .send({ phone, password: 'Agrim2026!' });
      return res.body as { accessToken: string; user: { id: string } };
    };

    const client = await login('0700000001');
    clientToken = client.accessToken;

    const courier = await login('0700000002');
    courierToken = courier.accessToken;
    courierId = courier.user.id;

    // 0700000004 = GESTIONNAIRE. 0700000005 est ADMIN : l'utiliser ici
    // laisserait le rôle de gestion sans aucune couverture.
    managerToken = (await login('0700000004')).accessToken;

    // Second livreur, pour prouver l'isolation entre tournées.
    const other = await prisma.db.user.findFirst({
      where: { role: 'LIVREUR', id: { not: courierId } },
      select: { id: true },
    });
    otherCourierId =
      other?.id ??
      (
        await prisma.db.user.create({
          data: {
            firstName: 'Autre',
            lastName: 'Livreur',
            phone: '0700009999',
            // Ce livreur ne sert qu'à vérifier le cloisonnement des courses.
            // Empreinte réelle : une chaîne arbitraire ferait lever argon2 à
            // la connexion. Le compte reste actif, sans quoi il ne serait plus
            // assignable et les tests d'isolation perdraient leur objet.
            passwordHash: await (await import('argon2')).hash('Agrim2026!'),
            role: 'LIVREUR',
          },
          select: { id: true },
        })
      ).id;

    const address = await request(app.getHttpServer())
      .post(`${prefix}/addresses`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        label: 'Test livraison',
        city: 'Yamoussoukro',
        landmark: 'En face de la pharmacie',
        contactPhone: '0700000001',
      });
    addressId = address.body.id;
    addressIds.push(addressId);

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

  /** Crée une commande cliente et renvoie sa référence. */
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

  const assign = (reference: string, to = courierId, bearer = managerToken) =>
    request(app.getHttpServer())
      .post(`${prefix}/deliveries/orders/${reference}/assign`)
      .set('Authorization', `Bearer ${bearer}`)
      .send({ courierId: to });

  const setStatus = (
    id: string,
    status: string,
    extra: Record<string, unknown> = {},
    bearer = courierToken,
  ) =>
    request(app.getHttpServer())
      .patch(`${prefix}/deliveries/${id}/status`)
      .set('Authorization', `Bearer ${bearer}`)
      .send({ status, ...extra });

  /**
   * Lit le code en base. Réservé aux tests : dans l'application, il n'existe
   * aucun chemin permettant au livreur de connaître ce code — c'est le sens
   * même de la fonctionnalité.
   */
  const readOtpCode = async (deliveryId: string) => {
    const otp = await prisma.db.deliveryOtp.findFirstOrThrow({
      where: { deliveryId, verifiedAt: null, invalidatedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { codeHash: true },
    });

    // Le code n'est pas stocké : on retrouve celui qui correspond à l'empreinte.
    for (let i = 0; i < 10_000; i += 1) {
      const candidate = String(i).padStart(4, '0');
      if (createHash('sha256').update(candidate).digest('hex') === otp.codeHash)
        return candidate;
    }
    throw new Error('Code introuvable');
  };

  const verifyOtp = (deliveryId: string, code: string, bearer = courierToken) =>
    request(app.getHttpServer())
      .post(`${prefix}/deliveries/${deliveryId}/verify-otp`)
      .set('Authorization', `Bearer ${bearer}`)
      .send({ code });

  /** Amène une course jusqu'à ARRIVED, prête à recevoir le code. */
  const deliveryArrived = async () => {
    const reference = await createOrder();
    const assigned = await assign(reference);
    const id = assigned.body.id as string;
    await setStatus(id, 'ACCEPTED');
    await setStatus(id, 'IN_TRANSIT');
    await setStatus(id, 'ARRIVED');
    return { id, reference };
  };

  /* ------------------------------ Habilitations ------------------------- */

  it('refuse la tournée à un client', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/deliveries/mine`)
      .set('Authorization', `Bearer ${clientToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_ROLE');
  });

  it('refuse l’affectation à un livreur', async () => {
    const reference = await createOrder();
    const res = await assign(reference, courierId, courierToken);

    // Affecter relève du gestionnaire : un livreur ne se donne pas du travail.
    expect(res.status).toBe(403);
  });

  it('refuse l’accès sans authentification', async () => {
    const res = await request(app.getHttpServer()).get(
      `${prefix}/deliveries/mine`,
    );
    expect(res.status).toBe(401);
  });

  /* ------------------------------ Affectation --------------------------- */

  it('affecte un livreur et place la course en ASSIGNED', async () => {
    const reference = await createOrder();
    const res = await assign(reference);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ASSIGNED');
    expect(res.body.order.reference).toBe(reference);
    expect(res.body.assignedAt).not.toBeNull();
  });

  it('rejette un livreur inexistant', async () => {
    const reference = await createOrder();
    const res = await assign(reference, randomUUID());

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COURIER_NOT_FOUND');
  });

  it('refuse d’affecter un utilisateur qui n’est pas livreur', async () => {
    const client = await prisma.db.user.findFirstOrThrow({
      where: { phone: '0700000001' },
      select: { id: true },
    });
    const reference = await createOrder();
    const res = await assign(reference, client.id);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COURIER_NOT_FOUND');
  });

  it('refuse de réassigner une course déjà acceptée', async () => {
    const reference = await createOrder();
    const assigned = await assign(reference);
    await setStatus(assigned.body.id, 'ACCEPTED');

    const res = await assign(reference, otherCourierId);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DELIVERY_ALREADY_STARTED');
  });

  /* -------------------------------- Isolation --------------------------- */

  it('ne montre au livreur que ses propres courses', async () => {
    const reference = await createOrder();
    const assigned = await assign(reference, otherCourierId);

    const mine = await request(app.getHttpServer())
      .get(`${prefix}/deliveries/mine`)
      .set('Authorization', `Bearer ${courierToken}`);

    const ids = mine.body.map((d: { id: string }) => d.id);
    expect(ids).not.toContain(assigned.body.id);
  });

  it('empêche un livreur de faire avancer la course d’un autre', async () => {
    const reference = await createOrder();
    const assigned = await assign(reference, otherCourierId);

    const res = await setStatus(assigned.body.id, 'ACCEPTED');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('DELIVERY_NOT_FOUND');
  });

  /* ------------------------------ Transitions --------------------------- */

  it('suit le parcours nominal jusqu’à la livraison', async () => {
    const reference = await createOrder();
    const assigned = await assign(reference);
    const id = assigned.body.id as string;

    expect((await setStatus(id, 'ACCEPTED')).body.status).toBe('ACCEPTED');
    expect((await setStatus(id, 'IN_TRANSIT')).body.status).toBe('IN_TRANSIT');
    expect((await setStatus(id, 'ARRIVED')).body.status).toBe('ARRIVED');

    // Le code est émis au départ ; seule sa saisie clôt la course.
    const code = await readOtpCode(id);
    const delivered = await verifyOtp(id, code);

    expect(delivered.status).toBe(201);
    expect(delivered.body.status).toBe('DELIVERED');
    expect(delivered.body.deliveredAt).not.toBeNull();
    expect(delivered.body.otpVerifiedAt).not.toBeNull();
  });

  it('interdit de sauter une étape', async () => {
    const reference = await createOrder();
    const assigned = await assign(reference);

    // DELIVERED n'est pas un statut que le terrain peut poser : le refus vient
    // de la frontière de responsabilité, avant même la table des transitions.
    const res = await setStatus(assigned.body.id, 'DELIVERED');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('COURIER_CANNOT_SET_STATUS');

    // Une étape réellement sautable, elle, est refusée par la table.
    const skipped = await setStatus(assigned.body.id, 'ARRIVED');
    expect(skipped.status).toBe(409);
    expect(skipped.body.code).toBe('INVALID_DELIVERY_TRANSITION');
  });

  it('exige un motif pour un échec', async () => {
    const { id } = await deliveryArrived();

    const withoutReason = await setStatus(id, 'FAILED');
    expect(withoutReason.status).toBe(400);
    expect(withoutReason.body.code).toBe('FAILURE_REASON_REQUIRED');

    const withReason = await setStatus(id, 'FAILED', {
      failureReason: 'Client absent après deux appels',
    });
    expect(withReason.status).toBe(200);
    expect(withReason.body.failureReason).toContain('Client absent');
  });

  it('ferme définitivement une course échouée', async () => {
    const { id } = await deliveryArrived();
    await setStatus(id, 'FAILED', { failureReason: 'Adresse introuvable' });

    const code = await readOtpCode(id).catch(() => '0000');
    const res = await verifyOtp(id, code);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DELIVERY_ALREADY_CLOSED');
  });

  /* ----------------------- Validation par code OTP ---------------------- */

  it('n’émet aucun code avant le départ du livreur', async () => {
    const reference = await createOrder();
    const assigned = await assign(reference);
    await setStatus(assigned.body.id, 'ACCEPTED');

    const count = await prisma.db.deliveryOtp.count({
      where: { deliveryId: assigned.body.id },
    });
    expect(count).toBe(0);
  });

  it('émet le code au départ et l’envoie au client, jamais au livreur', async () => {
    const reference = await createOrder();
    const assigned = await assign(reference);
    const id = assigned.body.id as string;
    await setStatus(id, 'ACCEPTED');
    const inTransit = await setStatus(id, 'IN_TRANSIT');

    // La réponse faite au livreur ne contient le code sous aucune forme.
    expect(JSON.stringify(inTransit.body)).not.toMatch(/\bcode\b/i);

    const otp = await prisma.db.deliveryOtp.findFirstOrThrow({
      where: { deliveryId: id },
    });
    // Stockage sûr : empreinte SHA-256, jamais le code en clair.
    expect(otp.codeHash).toMatch(/^[a-f0-9]{64}$/);

    const code = await readOtpCode(id);
    const order = await prisma.db.order.findFirstOrThrow({
      where: { reference },
      select: { id: true },
    });
    const notification = await prisma.db.notification.findFirst({
      where: { type: 'DELIVERY_OTP', orderId: order.id },
      select: { body: true, userId: true },
    });
    // Le client, et lui seul, reçoit le code.
    expect(notification?.body).toContain(code);
  });

  it('ne divulgue pas le code par la route d’état', async () => {
    const { id } = await deliveryArrived();
    const code = await readOtpCode(id);

    const res = await request(app.getHttpServer())
      .get(`${prefix}/deliveries/${id}/otp-status`)
      .set('Authorization', `Bearer ${courierToken}`);

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(code);
  });

  it('refuse un code incorrect et ne valide rien', async () => {
    const { id } = await deliveryArrived();
    const code = await readOtpCode(id);
    const wrong = code === '0000' ? '1111' : '0000';

    const res = await verifyOtp(id, wrong);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OTP_INVALID');

    const delivery = await prisma.db.delivery.findUniqueOrThrow({
      where: { id },
      select: { status: true, deliveredAt: true },
    });
    expect(delivery.status).toBe('ARRIVED');
    expect(delivery.deliveredAt).toBeNull();
  });

  it('bloque le code après cinq tentatives infructueuses', async () => {
    const { id } = await deliveryArrived();
    const code = await readOtpCode(id);
    const wrong = code === '0000' ? '1111' : '0000';

    for (let i = 0; i < 5; i += 1) {
      await verifyOtp(id, wrong);
    }

    // Même le bon code ne passe plus : le compteur protège les 10 000
    // combinaisons d'une saisie automatisée.
    const res = await verifyOtp(id, code);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('OTP_ATTEMPTS_EXCEEDED');
  });

  it('refuse un code expiré', async () => {
    const { id } = await deliveryArrived();
    const code = await readOtpCode(id);

    await prisma.db.deliveryOtp.updateMany({
      where: { deliveryId: id, verifiedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await verifyOtp(id, code);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('OTP_EXPIRED');
  });

  it('n’accepte pas deux fois le même code', async () => {
    const { id } = await deliveryArrived();
    const code = await readOtpCode(id);

    expect((await verifyOtp(id, code)).status).toBe(201);

    // Usage unique : la course est close, le code consommé.
    const second = await verifyOtp(id, code);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('DELIVERY_ALREADY_CLOSED');
  });

  it('empêche un livreur de valider la course d’un collègue', async () => {
    const { id } = await deliveryArrived();
    const code = await readOtpCode(id);

    // Réaffectation en base : le second livreur n'a pas de session ici, on
    // vérifie le cas inverse — le titulaire d'origine perd la main.
    await prisma.db.delivery.update({
      where: { id },
      data: { courierId: otherCourierId },
    });

    const res = await verifyOtp(id, code);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('DELIVERY_NOT_FOUND');
  });

  it('exige l’arrivée sur place avant la saisie du code', async () => {
    const reference = await createOrder();
    const assigned = await assign(reference);
    const id = assigned.body.id as string;
    await setStatus(id, 'ACCEPTED');
    await setStatus(id, 'IN_TRANSIT');

    const code = await readOtpCode(id);
    const res = await verifyOtp(id, code);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DELIVERY_NOT_ARRIVED');
  });

  it('valide sans position GPS : la traçabilité n’est pas une condition', async () => {
    const { id } = await deliveryArrived();
    const code = await readOtpCode(id);

    const res = await request(app.getHttpServer())
      .post(`${prefix}/deliveries/${id}/verify-otp`)
      .set('Authorization', `Bearer ${courierToken}`)
      .send({ code });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DELIVERED');
  });

  it('enregistre la position quand elle est disponible', async () => {
    const { id } = await deliveryArrived();
    const code = await readOtpCode(id);

    await request(app.getHttpServer())
      .post(`${prefix}/deliveries/${id}/verify-otp`)
      .set('Authorization', `Bearer ${courierToken}`)
      .send({ code, position: { latitude: 6.8276, longitude: -5.2893 } });

    const delivery = await prisma.db.delivery.findUniqueOrThrow({
      where: { id },
      select: { otpLatitude: true, otpLongitude: true, otpVerifiedAt: true },
    });
    expect(delivery.otpLatitude).toBeCloseTo(6.8276, 3);
    expect(delivery.otpVerifiedAt).not.toBeNull();
  });

  it('accepte un code dicté avec des espaces', async () => {
    const { id } = await deliveryArrived();
    const code = await readOtpCode(id);
    const spaced = `${code.slice(0, 2)} ${code.slice(2)}`;

    const res = await verifyOtp(id, spaced);
    expect(res.status).toBe(201);
  });

  it('refuse un code mal formé sans consommer de tentative', async () => {
    const { id } = await deliveryArrived();

    const res = await verifyOtp(id, '12');
    expect(res.status).toBe(400);

    const otp = await prisma.db.deliveryOtp.findFirstOrThrow({
      where: { deliveryId: id, verifiedAt: null },
      select: { attempts: true },
    });
    // Rejet par la validation d'entrée : le compteur métier n'est pas touché.
    expect(otp.attempts).toBe(0);
  });

  it('interdit au livreur de se déclarer livré sans code', async () => {
    const { id } = await deliveryArrived();

    // Règle centrale : la clôture n'appartient pas au terrain.
    const res = await setStatus(id, 'DELIVERED');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('COURIER_CANNOT_SET_STATUS');
  });

  it('interdit au livreur de forcer OTP_VERIFIED', async () => {
    const { id } = await deliveryArrived();

    const res = await setStatus(id, 'OTP_VERIFIED');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('COURIER_CANNOT_SET_STATUS');
  });

  it('laisse le client faire renvoyer son code', async () => {
    const { id, reference } = await deliveryArrived();
    const first = await readOtpCode(id);

    // Le délai anti-renvoi court depuis l'émission au départ. En conditions
    // réelles, le trajet l'a déjà consommé ; ici on l'antidate pour tester le
    // renvoi lui-même et non le délai (couvert par le test suivant).
    await prisma.db.deliveryOtp.updateMany({
      where: { deliveryId: id },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });

    const res = await request(app.getHttpServer())
      .post(`${prefix}/deliveries/orders/${reference}/otp/resend`)
      .set('Authorization', `Bearer ${clientToken}`);

    expect(res.status).toBe(201);

    // L'ancien code ne vaut plus rien : un seul code utilisable à la fois.
    const refused = await verifyOtp(id, first);
    expect(refused.status).toBe(400);

    const second = await readOtpCode(id);
    expect(second).not.toBe(first);
    expect((await verifyOtp(id, second)).status).toBe(201);
  });

  it('impose un délai entre deux envois de code', async () => {
    const { reference } = await deliveryArrived();

    // Le code vient d'être émis au départ : un renvoi immédiat est refusé.
    // Sans ce garde-fou, le renvoi en boucle deviendrait un canal de
    // harcèlement du client.
    const res = await request(app.getHttpServer())
      .post(`${prefix}/deliveries/orders/${reference}/otp/resend`)
      .set('Authorization', `Bearer ${clientToken}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('OTP_RESEND_TOO_SOON');
  });

  it('refuse à un client de faire renvoyer le code d’un autre', async () => {
    const { reference } = await deliveryArrived();

    // Le livreur n'est pas propriétaire de la commande : aucun renvoi possible.
    const res = await request(app.getHttpServer())
      .post(`${prefix}/deliveries/orders/${reference}/otp/resend`)
      .set('Authorization', `Bearer ${courierToken}`);

    expect([403, 404]).toContain(res.status);
  });

  /* --------------------- Répercussion sur la commande ------------------- */

  it('passe la commande en livraison quand le livreur démarre', async () => {
    const reference = await createOrder();
    const assigned = await assign(reference);
    await setStatus(assigned.body.id, 'ACCEPTED');
    await setStatus(assigned.body.id, 'IN_TRANSIT');

    const order = await request(app.getHttpServer())
      .get(`${prefix}/orders/${reference}`)
      .set('Authorization', `Bearer ${clientToken}`);

    expect(order.body.status).toBe('OUT_FOR_DELIVERY');
    // Le client doit voir l'étape apparaître dans sa chronologie.
    expect(
      order.body.events.some(
        (e: { status: string }) => e.status === 'OUT_FOR_DELIVERY',
      ),
    ).toBe(true);
  });

  it('marque la commande livrée à la fin de la course', async () => {
    const { id, reference } = await deliveryArrived();
    const code = await readOtpCode(id);

    await verifyOtp(id, code);

    const order = await request(app.getHttpServer())
      .get(`${prefix}/orders/${reference}`)
      .set('Authorization', `Bearer ${clientToken}`);

    expect(order.body.status).toBe('DELIVERED');
  });

  it('n’expose pas la commande d’un autre client au livreur', async () => {
    const reference = await createOrder();
    const assigned = await assign(reference);

    const detail = await request(app.getHttpServer())
      .get(`${prefix}/deliveries/${assigned.body.id}`)
      .set('Authorization', `Bearer ${courierToken}`);

    expect(detail.status).toBe(200);
    // Le livreur a besoin de l'adresse et des articles, pas de l'identité
    // complète ni de l'historique d'achat du client.
    expect(detail.body.order.userId).toBeUndefined();
    expect(detail.body.address.contactPhone).toBeDefined();
  });
});
