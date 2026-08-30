/**
 * Tests d'intégration du tunnel de commande, contre la vraie base PostgreSQL.
 *
 * Ce qui est vérifié ici ne peut pas l'être en test unitaire : atomicité des
 * transactions, contrainte d'unicité de l'idempotence, décrément concurrent du
 * stock et isolation entre deux clients.
 */
import 'dotenv/config';

import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { AppModule } from '../app.module';
import { configureApp } from '../bootstrap';
import { CatalogSyncService } from '../catalog-sync/catalog-sync.service';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { prisma as prismaClient } from '../prisma/prisma.client';
import {
  createSiteIntegrationDouble,
  referenceDeTest,
  type SiteIntegrationDouble,
} from '../testing/site-integration.double';

describe('Commandes (e2e)', () => {
  jest.setTimeout(60000);
  let app: INestApplication;
  let prisma: PrismaService;
  const prefix = '/api/v1';

  let token: string;
  let otherToken: string;
  let addressId: string;
  let variantId: string;
  let variantPrice: number;
  let variantWeightGrams: number;
  let site: SiteIntegrationDouble;

  const createdOrderIds: string[] = [];
  const createdAddressIds: string[] = [];

  beforeAll(async () => {
    process.env.THROTTLE_DISABLED = '1';

    // Le SITE est un système externe : catalogue, prix, grille de livraison et
    // stock lui appartiennent depuis le 29 août 2026. Le laisser en jeu ici
    // ferait dépendre la suite de sa disponibilité — `POST /orders` répond
    // 503 dès qu'il dort, ce qui est juste en production et inexploitable en
    // test. Le double applique le MÊME contrat, décrément conditionnel
    // compris, si bien que les assertions de stock gardent leur sens.
    const double = createSiteIntegrationDouble({
      db: prismaClient,
    } as unknown as PrismaService);
    site = double.observe;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    })
      .overrideProvider(CatalogSyncService)
      .useValue(double.service)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    configureApp(app, { isProd: false });
    await app.init();
    prisma = app.get(PrismaService);

    const login = async (phone: string) => {
      const res = await request(app.getHttpServer())
        .post(`${prefix}/auth/login`)
        .send({ phone, password: 'Agrim2026!' });
      return res.body.accessToken as string;
    };

    token = await login('0700000001');
    otherToken = await login('0700000002');

    const address = await request(app.getHttpServer())
      .post(`${prefix}/addresses`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'Test commande',
        city: 'Yamoussoukro',
        commune: 'Habitat',
        landmark: 'En face de la pharmacie',
        contactPhone: '0700000001',
      });
    addressId = address.body.id;
    createdAddressIds.push(addressId);

    // On travaille sur une variante réelle du catalogue, dont on garantit le
    // stock pour ne pas dépendre de l'ordre des tests.
    const variant = await prisma.db.productVariant.findFirstOrThrow({
      where: { isAvailable: true },
      select: { id: true, price: true, weightGrams: true },
    });
    variantId = variant.id;
    variantPrice = variant.price;
    variantWeightGrams = variant.weightGrams;

    // Le seed écrit le catalogue d'AMORÇAGE, sans `sourceRef` : une variante
    // que le site n'a jamais confirmée. `OrdersService.create` refuse de la
    // vendre (`VARIANT_NOT_SYNCED`), et c'est la bonne règle — on ne vend pas
    // un stock dont personne n'est propriétaire.
    //
    // La suite fait donc ce que la synchronisation ferait : elle rattache la
    // variante à une référence de site. Sans cela, le test n'exercerait rien
    // du tunnel de commande, il buterait sur sa précondition.
    await prisma.db.productVariant.update({
      where: { id: variantId },
      data: { stock: 500, sourceRef: referenceDeTest(variantId) },
    });
  });

  afterAll(async () => {
    // Nettoyage : la base de dev est partagée avec les autres suites.
    if (createdOrderIds.length > 0) {
      await prisma.db.order.deleteMany({
        where: { id: { in: createdOrderIds } },
      });
    }
    if (createdAddressIds.length > 0) {
      await prisma.db.address.deleteMany({
        where: { id: { in: createdAddressIds } },
      });
    }
    await app.close();
    delete process.env.THROTTLE_DISABLED;
  });

  const postOrder = (body: Record<string, unknown>, bearer = token) =>
    request(app.getHttpServer())
      .post(`${prefix}/orders`)
      .set('Authorization', `Bearer ${bearer}`)
      .send(body);

  const orderBody = (overrides: Record<string, unknown> = {}) => ({
    addressId,
    items: [{ variantId, quantity: 2 }],
    paymentMethod: 'CASH_ON_DELIVERY',
    idempotencyKey: randomUUID(),
    ...overrides,
  });

  it('refuse une commande sans authentification', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/orders`)
      .send(orderBody());
    expect(res.status).toBe(401);
  });

  it('crée une commande et calcule les totaux côté serveur', async () => {
    const res = await postOrder(orderBody());
    expect(res.status).toBe(201);
    createdOrderIds.push(res.body.id);

    expect(res.body.reference).toMatch(/^AGR-\d{4}-\d{4,}$/);
    expect(res.body.status).toBe('PENDING');

    // Le PRIX vient du catalogue, jamais du client : le sous-total doit être
    // exactement celui de la base.
    const expectedSubtotal = variantPrice * 2;
    expect(res.body.subtotal).toBe(expectedSubtotal);

    // Les FRAIS viennent de la grille du site (décision du 29 août 2026), plus
    // d'un forfait local. L'adresse est à Yamoussoukro, et deux exemplaires
    // d'un format quelconque du catalogue pèsent moins que le seuil de
    // gratuité : le tarif de la zone s'applique.
    const poidsKg = (variantWeightGrams * 2) / 1000;
    expect(poidsKg).toBeLessThan(75);
    expect(res.body.deliveryFee).toBe(1000);

    expect(res.body.total).toBe(res.body.subtotal + res.body.deliveryFee);
    expect(Number.isInteger(res.body.total)).toBe(true);

    // Le stock a bien été réservé auprès du site — c'est lui qui en décide
    // désormais, et sans cette réservation la commande n'existerait pas.
    expect(site.reservations.size + site.confirmees.length).toBeGreaterThan(0);
  });

  it('ignore tout prix envoyé par le client', async () => {
    // Le DTO rejette les champs inconnus : impossible de glisser un prix.
    const res = await postOrder(
      orderBody({
        items: [{ variantId, quantity: 1, unitPrice: 1 }],
      }),
    );
    expect(res.status).toBe(400);
  });

  it('renvoie la même commande quand la requête est rejouée', async () => {
    const body = orderBody();

    const first = await postOrder(body);
    expect(first.status).toBe(201);
    createdOrderIds.push(first.body.id);

    const replay = await postOrder(body);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.reference).toBe(first.body.reference);

    const count = await prisma.db.order.count({
      where: { idempotencyKey: body.idempotencyKey },
    });
    expect(count).toBe(1);
  });

  it('empêche un autre client de rejouer une clé d’idempotence', async () => {
    const body = orderBody();
    const first = await postOrder(body);
    createdOrderIds.push(first.body.id);

    const res = await postOrder(body, otherToken);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });

  it('décrémente le stock du montant commandé', async () => {
    const before = await prisma.db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });

    const res = await postOrder(
      orderBody({ items: [{ variantId, quantity: 3 }] }),
    );
    createdOrderIds.push(res.body.id);

    const after = await prisma.db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(after.stock).toBe(before.stock - 3);
  });

  it('rejette une quantité hors bornes avant tout traitement métier', async () => {
    // 999 est le plafond du DTO : au-delà, la validation répond 400 sans
    // jamais toucher à la base.
    const res = await postOrder(
      orderBody({ items: [{ variantId, quantity: 100_000 }] }),
    );
    expect(res.status).toBe(400);
  });

  it('refuse une quantité supérieure au stock', async () => {
    await prisma.db.productVariant.update({
      where: { id: variantId },
      data: { stock: 4 },
    });

    const res = await postOrder(
      orderBody({ items: [{ variantId, quantity: 10 }] }),
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');

    // Le refus ne doit pas avoir entamé le stock.
    const after = await prisma.db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(after.stock).toBe(4);

    await prisma.db.productVariant.update({
      where: { id: variantId },
      data: { stock: 500 },
    });
  });

  it('ne survend pas le stock sous commandes simultanées', async () => {
    // Stock volontairement serré : 5 unités pour 5 commandes de 2.
    await prisma.db.productVariant.update({
      where: { id: variantId },
      data: { stock: 5 },
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        postOrder(orderBody({ items: [{ variantId, quantity: 2 }] })),
      ),
    );

    for (const r of results) {
      if (r.status === 201) createdOrderIds.push(r.body.id);
    }

    const accepted = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 409);

    // 5 unités, 2 par commande : deux commandes au maximum peuvent passer.
    expect(accepted.length).toBe(2);
    expect(rejected.length).toBe(3);

    const after = await prisma.db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    // Jamais négatif : c'est tout l'enjeu du décrément conditionnel.
    expect(after.stock).toBe(1);
    expect(after.stock).toBeGreaterThanOrEqual(0);

    await prisma.db.productVariant.update({
      where: { id: variantId },
      data: { stock: 500 },
    });
  });

  it('fusionne deux lignes portant la même variante', async () => {
    const res = await postOrder(
      orderBody({
        items: [
          { variantId, quantity: 2 },
          { variantId, quantity: 3 },
        ],
      }),
    );
    expect(res.status).toBe(201);
    createdOrderIds.push(res.body.id);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].quantity).toBe(5);
    expect(res.body.subtotal).toBe(variantPrice * 5);
  });

  it('exige un opérateur pour un paiement Mobile Money', async () => {
    const res = await postOrder(orderBody({ paymentMethod: 'MOBILE_MONEY' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PAYMENT_PROVIDER_REQUIRED');
  });

  it('refuse une adresse qui n’appartient pas au client', async () => {
    const res = await postOrder(orderBody(), otherToken);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ADDRESS_NOT_FOUND');
  });

  it('refuse un panier vide', async () => {
    const res = await postOrder(orderBody({ items: [] }));
    expect(res.status).toBe(400);
  });

  it('n’expose pas les commandes d’un autre client', async () => {
    const created = await postOrder(orderBody());
    createdOrderIds.push(created.body.id);
    const reference = created.body.reference;

    const mine = await request(app.getHttpServer())
      .get(`${prefix}/orders/${reference}`)
      .set('Authorization', `Bearer ${token}`);
    expect(mine.status).toBe(200);

    const theirs = await request(app.getHttpServer())
      .get(`${prefix}/orders/${reference}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(theirs.status).toBe(404);
  });

  it('liste mes commandes avec le nombre d’articles', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/orders`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.pagination).toMatchObject({ page: 1 });
    expect(typeof res.body.data[0].itemCount).toBe('number');
  });

  it('annule une commande et restitue le stock', async () => {
    const created = await postOrder(
      orderBody({ items: [{ variantId, quantity: 4 }] }),
    );
    createdOrderIds.push(created.body.id);

    const during = await prisma.db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });

    const res = await request(app.getHttpServer())
      .post(`${prefix}/orders/${created.body.reference}/cancel`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('CANCELLED');

    const after = await prisma.db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(after.stock).toBe(during.stock + 4);
  });

  it('refuse d’annuler deux fois', async () => {
    const created = await postOrder(orderBody());
    createdOrderIds.push(created.body.id);
    const reference = created.body.reference;

    const cancel = () =>
      request(app.getHttpServer())
        .post(`${prefix}/orders/${reference}/cancel`)
        .set('Authorization', `Bearer ${token}`);

    expect((await cancel()).status).toBe(201);

    const second = await cancel();
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('ORDER_NOT_CANCELLABLE');
  });

  it('journalise un événement à la création', async () => {
    const created = await postOrder(orderBody());
    createdOrderIds.push(created.body.id);

    const events = await prisma.db.orderEvent.findMany({
      where: { orderId: created.body.id },
      select: { status: true },
    });
    expect(events).toEqual([{ status: 'PENDING' }]);
  });
});
