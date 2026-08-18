/**
 * Tests d'intégration du back-office.
 *
 * Enjeux vérifiés ici :
 *  - seuls les rôles de gestion accèdent à ces routes ;
 *  - le gestionnaire ne peut pas déclarer une commande livrée depuis un
 *    bureau : ces statuts appartiennent au terrain ;
 *  - une annulation restitue le stock ;
 *  - un réapprovisionnement concurrent ne perd aucun apport.
 */
import 'dotenv/config';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';

describe('Espace gestionnaire (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prefix = '/api/v1';

  let managerToken: string;
  let clientToken: string;
  let courierToken: string;
  let courierId: string;
  let addressId: string;
  let variantId: string;
  let initialStock: number;

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

    // 0700000004 = GESTIONNAIRE. 0700000005 est ADMIN : l'utiliser ici
    // laisserait le rôle de gestion sans aucune couverture.
    managerToken = (await login('0700000004')).accessToken;
    clientToken = (await login('0700000001')).accessToken;

    const courier = await login('0700000002');
    courierToken = courier.accessToken;
    courierId = courier.user.id;

    const address = await request(app.getHttpServer())
      .post(`${prefix}/addresses`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        label: 'Test gestion',
        city: 'Yamoussoukro',
        landmark: 'Près du marché',
        contactPhone: '0700000001',
      });
    addressId = address.body.id;
    addressIds.push(addressId);

    const variant = await prisma.db.productVariant.findFirstOrThrow({
      where: { isAvailable: true },
      select: { id: true },
    });
    variantId = variant.id;
    const refreshed = await prisma.db.productVariant.update({
      where: { id: variantId },
      data: { stock: 500 },
      select: { stock: true },
    });
    initialStock = refreshed.stock;
  });

  afterAll(async () => {
    if (orderIds.length > 0) {
      await prisma.db.notification.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await prisma.db.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (addressIds.length > 0) {
      await prisma.db.address.deleteMany({ where: { id: { in: addressIds } } });
    }
    await app.close();
    delete process.env.THROTTLE_DISABLED;
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const createOrder = async (quantity = 1) => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/orders`)
      .set(auth(clientToken))
      .send({
        addressId,
        items: [{ variantId, quantity }],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: randomUUID(),
      });
    orderIds.push(res.body.id);
    return res.body as { id: string; reference: string };
  };

  const setStatus = (reference: string, status: string, token = managerToken) =>
    request(app.getHttpServer())
      .patch(`${prefix}/management/orders/${reference}/status`)
      .set(auth(token))
      .send({ status });

  /* ------------------------------ Accès --------------------------------- */

  it('refuse le back-office à un client', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/management/dashboard`)
      .set(auth(clientToken));

    expect(res.status).toBe(403);
  });

  it('refuse le back-office à un livreur', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/management/orders`)
      .set(auth(courierToken));

    expect(res.status).toBe(403);
  });

  it('exige une authentification', async () => {
    const res = await request(app.getHttpServer()).get(
      `${prefix}/management/dashboard`,
    );
    expect(res.status).toBe(401);
  });

  /* ----------------------------- Tableau --------------------------------- */

  it('renvoie des indicateurs cohérents', async () => {
    await createOrder();

    const res = await request(app.getHttpServer())
      .get(`${prefix}/management/dashboard`)
      .set(auth(managerToken));

    expect(res.status).toBe(200);
    expect(res.body.ordersToday).toBeGreaterThan(0);
    expect(res.body.revenueToday).toBeGreaterThan(0);
    expect(typeof res.body.lowStockCount).toBe('number');
    expect(typeof res.body.stalePendingCount).toBe('number');
  });

  /* ----------------------------- Commandes ------------------------------- */

  it('liste la file de travail sans les commandes closes', async () => {
    const order = await createOrder();

    const res = await request(app.getHttpServer())
      .get(`${prefix}/management/orders`)
      .set(auth(managerToken));

    expect(res.status).toBe(200);
    const found = res.body.find(
      (o: { reference: string }) => o.reference === order.reference,
    );
    expect(found).toBeTruthy();
    // Le gestionnaire doit pouvoir décider sans ouvrir la commande.
    expect(found.customerName).toBeTruthy();
    expect(found.itemCount).toBeGreaterThan(0);
    expect(found.hasCourier).toBe(false);

    // Aucune commande livrée ou annulée dans la file par défaut.
    expect(
      res.body.some((o: { status: string }) =>
        ['DELIVERED', 'CANCELLED'].includes(o.status),
      ),
    ).toBe(false);
  });

  it('filtre par statut et par référence', async () => {
    const order = await createOrder();

    const byStatus = await request(app.getHttpServer())
      .get(`${prefix}/management/orders?status=PENDING`)
      .set(auth(managerToken));
    expect(
      byStatus.body.every((o: { status: string }) => o.status === 'PENDING'),
    ).toBe(true);

    const bySearch = await request(app.getHttpServer())
      .get(`${prefix}/management/orders?search=${order.reference}`)
      .set(auth(managerToken));
    expect(bySearch.body).toHaveLength(1);
    expect(bySearch.body[0].reference).toBe(order.reference);
  });

  it('expose le détail complet d’une commande', async () => {
    const order = await createOrder(2);

    const res = await request(app.getHttpServer())
      .get(`${prefix}/management/orders/${order.reference}`)
      .set(auth(managerToken));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.address.contactPhone).toBeTruthy();
    expect(res.body.events.length).toBeGreaterThan(0);
    expect(res.body.payment.method).toBe('CASH_ON_DELIVERY');
  });

  it('renvoie 404 sur une référence inconnue', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/management/orders/AGR-2026-9999`)
      .set(auth(managerToken));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ORDER_NOT_FOUND');
  });

  it('fait avancer une commande jusqu’à READY', async () => {
    const order = await createOrder();

    for (const status of ['CONFIRMED', 'PREPARING', 'READY']) {
      const res = await setStatus(order.reference, status);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(status);
    }

    // Chaque étape laisse une trace horodatée.
    const events = await prisma.db.orderEvent.count({
      where: { orderId: order.id },
    });
    expect(events).toBeGreaterThanOrEqual(3);
  });

  it('refuse de sauter une étape', async () => {
    const order = await createOrder();

    const res = await setStatus(order.reference, 'READY');

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_ORDER_TRANSITION');
  });

  it('interdit au gestionnaire de déclarer une livraison depuis le bureau', async () => {
    const order = await createOrder();
    await setStatus(order.reference, 'CONFIRMED');
    await setStatus(order.reference, 'PREPARING');
    await setStatus(order.reference, 'READY');

    // La transition existe dans la machine à états, mais elle appartient au
    // terrain : c'est le livreur qui la produit en récupérant le colis.
    const res = await setStatus(order.reference, 'OUT_FOR_DELIVERY');

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MANAGER_ACTION_NOT_ALLOWED');
  });

  it('notifie le client à chaque avancement', async () => {
    const order = await createOrder();
    await setStatus(order.reference, 'CONFIRMED');

    const notification = await prisma.db.notification.findFirst({
      where: { orderId: order.id, type: 'ORDER_CONFIRMED' },
      select: { id: true },
    });
    expect(notification).not.toBeNull();
  });

  it('annule et restitue le stock', async () => {
    const before = await prisma.db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });

    const order = await createOrder(3);

    const during = await prisma.db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(during.stock).toBe(before.stock - 3);

    const res = await setStatus(order.reference, 'CANCELLED');
    expect(res.status).toBe(200);

    const after = await prisma.db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(after.stock).toBe(before.stock);
  });

  it('refuse d’annuler une commande déjà partie', async () => {
    const order = await createOrder();
    await setStatus(order.reference, 'CONFIRMED');
    await setStatus(order.reference, 'PREPARING');
    await setStatus(order.reference, 'READY');

    await request(app.getHttpServer())
      .post(`${prefix}/deliveries/orders/${order.reference}/assign`)
      .set(auth(managerToken))
      .send({ courierId });

    const mine = await request(app.getHttpServer())
      .get(`${prefix}/deliveries/mine`)
      .set(auth(courierToken));
    const delivery = mine.body.find(
      (d: { order: { reference: string } }) =>
        d.order.reference === order.reference,
    );

    const step = (status: string) =>
      request(app.getHttpServer())
        .patch(`${prefix}/deliveries/${delivery.id}/status`)
        .set(auth(courierToken))
        .send({ status });

    await step('ACCEPTED');
    await step('PICKED_UP');

    const res = await setStatus(order.reference, 'CANCELLED');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ORDER_NOT_CANCELLABLE');
  });

  it('signale une commande déjà affectée à un livreur', async () => {
    const order = await createOrder();
    await setStatus(order.reference, 'CONFIRMED');
    await setStatus(order.reference, 'PREPARING');
    await setStatus(order.reference, 'READY');

    await request(app.getHttpServer())
      .post(`${prefix}/deliveries/orders/${order.reference}/assign`)
      .set(auth(managerToken))
      .send({ courierId });

    const res = await request(app.getHttpServer())
      .get(`${prefix}/management/orders?search=${order.reference}`)
      .set(auth(managerToken));

    expect(res.body[0].hasCourier).toBe(true);
  });

  /* ------------------------------ Stocks --------------------------------- */

  it('liste les stocks avec leur seuil', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/management/stock`)
      .set(auth(managerToken));

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].sku).toBeTruthy();
    expect(typeof res.body[0].lowStockThreshold).toBe('number');
  });

  it('filtre les variantes sous le seuil', async () => {
    await prisma.db.productVariant.update({
      where: { id: variantId },
      data: { stock: 5, lowStockThreshold: 30 },
    });

    const res = await request(app.getHttpServer())
      .get(`${prefix}/management/stock?onlyAlerts=true`)
      .set(auth(managerToken));

    expect(
      res.body.some((i: { variantId: string }) => i.variantId === variantId),
    ).toBe(true);
    expect(
      res.body.every(
        (i: { stock: number; lowStockThreshold: number }) =>
          i.stock <= i.lowStockThreshold,
      ),
    ).toBe(true);

    await prisma.db.productVariant.update({
      where: { id: variantId },
      data: { stock: initialStock },
    });
  });

  it('additionne les apports concurrents sans en perdre', async () => {
    await prisma.db.productVariant.update({
      where: { id: variantId },
      data: { stock: 100 },
    });

    // Cinq apports simultanés : une valeur absolue en écraserait quatre.
    await Promise.all(
      Array.from({ length: 5 }).map(() =>
        request(app.getHttpServer())
          .patch(`${prefix}/management/stock/${variantId}`)
          .set(auth(managerToken))
          .send({ delta: 10 }),
      ),
    );

    const after = await prisma.db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(after.stock).toBe(150);
  });

  it('refuse un retrait supérieur au stock', async () => {
    await prisma.db.productVariant.update({
      where: { id: variantId },
      data: { stock: 10 },
    });

    const res = await request(app.getHttpServer())
      .patch(`${prefix}/management/stock/${variantId}`)
      .set(auth(managerToken))
      .send({ delta: -50 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('STOCK_CANNOT_BE_NEGATIVE');

    await prisma.db.productVariant.update({
      where: { id: variantId },
      data: { stock: initialStock },
    });
  });

  it('refuse une requête sans rien à modifier', async () => {
    const res = await request(app.getHttpServer())
      .patch(`${prefix}/management/stock/${variantId}`)
      .set(auth(managerToken))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NOTHING_TO_UPDATE');
  });

  it('règle le seuil d’alerte', async () => {
    const res = await request(app.getHttpServer())
      .patch(`${prefix}/management/stock/${variantId}`)
      .set(auth(managerToken))
      .send({ lowStockThreshold: 42 });

    expect(res.status).toBe(200);
    expect(res.body.lowStockThreshold).toBe(42);
  });

  /* ------------------------------ Livreurs ------------------------------- */

  it('liste les livreurs avec leur charge', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/management/couriers`)
      .set(auth(managerToken));

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(typeof res.body[0].activeDeliveries).toBe('number');
    expect(res.body[0].phone).toBeTruthy();
  });
});
