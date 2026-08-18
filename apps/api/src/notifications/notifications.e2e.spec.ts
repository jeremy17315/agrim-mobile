/**
 * Tests d'intégration des notifications.
 *
 * Enjeux vérifiés ici :
 *  - les notifications naissent des événements métier, pas d'un appel manuel ;
 *  - un utilisateur ne voit ni ne modifie celles d'un autre ;
 *  - un jeton d'appareil suit le dernier compte connecté.
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

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prefix = '/api/v1';

  let clientToken: string;
  let clientId: string;
  let courierToken: string;
  let courierId: string;
  let managerToken: string;
  let addressId: string;
  let variantId: string;

  const orderIds: string[] = [];
  const addressIds: string[] = [];
  const tokens: string[] = [];

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

    const client = await login('0700000001');
    clientToken = client.accessToken;
    clientId = client.user.id;

    const courier = await login('0700000002');
    courierToken = courier.accessToken;
    courierId = courier.user.id;

    managerToken = (await login('0700000005')).accessToken;

    const address = await request(app.getHttpServer())
      .post(`${prefix}/addresses`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        label: 'Test notifications',
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
    await prisma.db.productVariant.update({
      where: { id: variantId },
      data: { stock: 500 },
    });
  });

  afterAll(async () => {
    if (orderIds.length > 0) {
      await prisma.db.notification.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await prisma.db.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (tokens.length > 0) {
      await prisma.db.pushToken.deleteMany({
        where: { token: { in: tokens } },
      });
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
    return res.body as { id: string; reference: string };
  };

  it('crée une notification à la commande, adressée au seul client', async () => {
    const order = await createOrder();

    const created = await prisma.db.notification.findFirst({
      where: { orderId: order.id, type: 'ORDER_CREATED' },
      select: { userId: true, title: true, body: true, isRead: true },
    });

    expect(created).not.toBeNull();
    expect(created!.userId).toBe(clientId);
    expect(created!.isRead).toBe(false);
    // La référence est interpolée depuis le gabarit partagé.
    expect(created!.body).toContain(order.reference);
  });

  it('ne renvoie que les notifications du demandeur', async () => {
    const order = await createOrder();

    const mine = await request(app.getHttpServer())
      .get(`${prefix}/notifications`)
      .set('Authorization', `Bearer ${clientToken}`);

    expect(mine.status).toBe(200);
    expect(
      mine.body.data.some(
        (n: { orderId: string | null }) => n.orderId === order.id,
      ),
    ).toBe(true);

    // Le livreur n'a rien à voir avec la commande d'un client.
    const others = await request(app.getHttpServer())
      .get(`${prefix}/notifications`)
      .set('Authorization', `Bearer ${courierToken}`);

    expect(others.status).toBe(200);
    expect(
      others.body.data.some(
        (n: { orderId: string | null }) => n.orderId === order.id,
      ),
    ).toBe(false);
  });

  it('notifie le livreur — et non le client — lors de l’assignation', async () => {
    const order = await createOrder();

    const assign = await request(app.getHttpServer())
      .post(`${prefix}/deliveries/orders/${order.reference}/assign`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ courierId });

    expect(assign.status).toBe(201);

    const forCourier = await prisma.db.notification.findFirst({
      where: { orderId: order.id, type: 'DELIVERY_ASSIGNED' },
      select: { userId: true },
    });
    expect(forCourier?.userId).toBe(courierId);

    const clientGotIt = await prisma.db.notification.count({
      where: { orderId: order.id, type: 'DELIVERY_ASSIGNED', userId: clientId },
    });
    expect(clientGotIt).toBe(0);
  });

  it('notifie le client quand la course fait avancer sa commande', async () => {
    const order = await createOrder();

    await request(app.getHttpServer())
      .post(`${prefix}/deliveries/orders/${order.reference}/assign`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ courierId });

    const mine = await request(app.getHttpServer())
      .get(`${prefix}/deliveries/mine`)
      .set('Authorization', `Bearer ${courierToken}`);
    const delivery = mine.body.find(
      (d: { order: { reference: string } }) =>
        d.order.reference === order.reference,
    );

    const step = (status: string) =>
      request(app.getHttpServer())
        .patch(`${prefix}/deliveries/${delivery.id}/status`)
        .set('Authorization', `Bearer ${courierToken}`)
        .send({ status });

    await step('ACCEPTED');
    await step('PICKED_UP');

    // PICKED_UP bascule la commande en OUT_FOR_DELIVERY : c'est ce mouvement,
    // compréhensible par le client, qui est notifié.
    const notif = await prisma.db.notification.findFirst({
      where: {
        orderId: order.id,
        type: 'ORDER_OUT_FOR_DELIVERY',
        userId: clientId,
      },
      select: { id: true },
    });
    expect(notif).not.toBeNull();
  });

  it('notifie l’annulation', async () => {
    const order = await createOrder();

    const res = await request(app.getHttpServer())
      .post(`${prefix}/orders/${order.reference}/cancel`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send();
    expect(res.status).toBe(201);

    const notif = await prisma.db.notification.findFirst({
      where: { orderId: order.id, type: 'ORDER_CANCELLED', userId: clientId },
      select: { id: true },
    });
    expect(notif).not.toBeNull();
  });

  it('marque comme lues sans toucher aux notifications d’autrui', async () => {
    await createOrder();

    const before = await request(app.getHttpServer())
      .get(`${prefix}/notifications`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(before.body.meta.unread).toBeGreaterThan(0);

    const marked = await request(app.getHttpServer())
      .patch(`${prefix}/notifications/read`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({});
    expect(marked.status).toBe(200);
    expect(marked.body.updated).toBeGreaterThan(0);

    const after = await request(app.getHttpServer())
      .get(`${prefix}/notifications`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(after.body.meta.unread).toBe(0);

    // Rejouer l'opération ne marque plus rien : pas de faux positif.
    const again = await request(app.getHttpServer())
      .patch(`${prefix}/notifications/read`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({});
    expect(again.body.updated).toBe(0);
  });

  it('enregistre un jeton d’appareil et le réattribue au dernier compte', async () => {
    const token = `ExponentPushToken[${randomUUID()}]`;
    tokens.push(token);

    const first = await request(app.getHttpServer())
      .post(`${prefix}/notifications/tokens`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ token, platform: 'android' });
    expect(first.status).toBe(201);

    // Même téléphone, autre utilisateur : le jeton change de propriétaire au
    // lieu de dupliquer les envois.
    await request(app.getHttpServer())
      .post(`${prefix}/notifications/tokens`)
      .set('Authorization', `Bearer ${courierToken}`)
      .send({ token, platform: 'android' });

    const rows = await prisma.db.pushToken.findMany({
      where: { token },
      select: { userId: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(courierId);
  });

  it('refuse un jeton au format inconnu', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/notifications/tokens`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ token: 'pas-un-jeton', platform: 'android' });

    expect(res.status).toBe(400);
  });

  it('retire le jeton à la déconnexion', async () => {
    const token = `ExponentPushToken[${randomUUID()}]`;
    tokens.push(token);

    await request(app.getHttpServer())
      .post(`${prefix}/notifications/tokens`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ token, platform: 'ios' });

    const res = await request(app.getHttpServer())
      .delete(`${prefix}/notifications/tokens`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ token, platform: 'ios' });
    expect(res.status).toBe(200);

    const rest = await prisma.db.pushToken.count({ where: { token } });
    expect(rest).toBe(0);
  });

  it('exige une authentification', async () => {
    const res = await request(app.getHttpServer()).get(
      `${prefix}/notifications`,
    );
    expect(res.status).toBe(401);
  });
});
