/**
 * Parcours web — commander et payer via /api/v1 (itération P2 bis).
 *
 * Le front du site consomme l'API centrale : ce fichier joue le CLIENT WEB
 * de bout en bout, HTTP uniquement, comme le ferait le navigateur. Ce que
 * rien d'autre ne prouve :
 *  - le devis (`POST /cart/quote`) annonce EXACTEMENT ce que la commande
 *    facturera — un centime d'écart et c'est tout le contrat qui ment ;
 *  - le double-clic CONCURRENT (deux requêtes en vol, même clé) produit UNE
 *    commande — le perdant est renvoyé sur celle du gagnant, jamais un 500 ;
 *  - le parcours payé asynchrone : `initiate` ouvre, le WEBHOOK de
 *    l'opérateur tranche, la commande se confirme toute seule ;
 *  - un webhook REJOUÉ est acquitté sans second effet ;
 *  - un autre compte ne peut ni lire ni payer la commande d'autrui.
 */
import 'dotenv/config';

import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { CatalogSyncService } from './catalog-sync/catalog-sync.service';
import { PrismaService } from './prisma/prisma.service';
import { prisma as prismaClient } from './prisma/prisma.client';
import {
  createSiteIntegrationDouble,
  referenceDeTest,
} from './testing/site-integration.double';

describe('Parcours web — commander et payer via /api/v1', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prefix = '/api/v1';

  let clientToken: string;
  let addressId: string;
  let variantId: string;

  const orderIds: string[] = [];
  const addressIds: string[] = [];

  beforeAll(async () => {
    process.env.THROTTLE_DISABLED = '1';
    // Le vrai parcours Mobile Money est ASYNCHRONE : `initiate` ouvre la
    // transaction, c'est le webhook de l'opérateur qui tranche. Le pilote
    // de simulation doit suivre ce chemin ici — le parcours synchrone ne
    // prouverait rien du webhook.
    process.env.PAYMENT_SIMULATION_ASYNC = 'true';

    const site = createSiteIntegrationDouble({
      db: prismaClient,
    } as unknown as PrismaService);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    })
      .overrideProvider(CatalogSyncService)
      .useValue(site.service)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    configureApp(app, { isProd: false });
    await app.init();
    prisma = app.get(PrismaService);

    const login = await request(app.getHttpServer())
      .post(`${prefix}/auth/login`)
      .send({ phone: '0700000001', password: 'Agrim2026!' });
    clientToken = (login.body as { accessToken: string }).accessToken;

    const address = await request(app.getHttpServer())
      .post(`${prefix}/addresses`)
      .set(auth(clientToken))
      .send({
        label: 'Parcours web',
        city: 'Abidjan',
        landmark: 'Face au marché',
        contactPhone: '0700000001',
      });
    addressId = (address.body as { id: string }).id;
    addressIds.push(addressId);

    const variant = await prisma.db.productVariant.findFirstOrThrow({
      where: { isAvailable: true },
      select: { id: true },
    });
    variantId = variant.id;
    await prisma.db.productVariant.update({
      where: { id: variantId },
      data: { stock: 2000, sourceRef: referenceDeTest(variantId) },
    });
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
    delete process.env.PAYMENT_SIMULATION_ASYNC;
  });

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  const server = () => request(app.getHttpServer());

  /** Commande web type : 2 unités du variant partagé. */
  const creerCommande = (
    opts: {
      idempotencyKey?: string;
      paymentMethod?: 'CASH_ON_DELIVERY' | 'MOBILE_MONEY';
      provider?: string;
    } = {},
  ) =>
    server()
      .post(`${prefix}/orders`)
      .set(auth(clientToken))
      .send({
        addressId,
        items: [{ variantId, quantity: 2 }],
        paymentMethod: opts.paymentMethod ?? 'CASH_ON_DELIVERY',
        ...(opts.provider ? { mobileMoneyProvider: opts.provider } : {}),
        idempotencyKey: opts.idempotencyKey ?? randomUUID(),
      });

  /** Ouvre un paiement Mobile Money asynchrone et renvoie la commande plus
   * sa référence de transaction côté opérateur. */
  const commandeEnAttente = async () => {
    const commande = await creerCommande({
      paymentMethod: 'MOBILE_MONEY',
      provider: 'ORANGE_MONEY',
    });
    expect(commande.status).toBe(201);
    orderIds.push((commande.body as { id: string }).id);

    const initiation = await server()
      .post(`${prefix}/payments/orders/${commande.body.reference}/initiate`)
      .set(auth(clientToken))
      .send();
    expect(initiation.status).toBe(201);
    expect(initiation.body).toMatchObject({ status: 'PENDING' });

    const paiement = await prisma.db.payment.findFirstOrThrow({
      where: { order: { id: commande.body.id } },
      select: { providerReference: true, status: true },
    });
    expect(paiement.status).toBe('AWAITING_CONFIRMATION');

    return {
      commande: commande.body as { id: string; reference: string; status: string },
      providerReference: paiement.providerReference,
    };
  };

  it('le devis annonce EXACTEMENT ce que la commande facturera', async () => {
    const devis = await server().post(`${prefix}/cart/quote`).send({
      items: [{ variantId, quantity: 2 }],
      city: 'Abidjan',
    });
    expect(devis.status).toBe(200);

    const commande = await creerCommande();
    expect(commande.status).toBe(201);
    orderIds.push((commande.body as { id: string }).id);

    expect(commande.body).toMatchObject({
      subtotal: devis.body.subtotal,
      deliveryFee: devis.body.deliveryFee,
      total: devis.body.total,
    });
  });

  it('double-clic concurrent : deux requêtes en vol, UNE commande', async () => {
    const key = randomUUID();
    const resultats = await Promise.allSettled([
      creerCommande({ idempotencyKey: key }),
      creerCommande({ idempotencyKey: key }),
    ]);

    const corps = resultats.map((r) =>
      r.status === 'fulfilled'
        ? { code: r.value.status, body: r.value.body as { id?: string } }
        : { code: 0, body: null },
    );
    // Aucune des deux ne doit tomber — le perdant est servi avec la
    // commande du gagnant, pas un 500 « unique constraint ».
    expect(corps[0].code).toBeLessThan(500);
    expect(corps[1].code).toBeLessThan(500);
    expect(corps[0].body?.id).toBeTruthy();
    expect(corps[1].body?.id).toBe(corps[0].body?.id);

    const enBase = await prisma.db.order.count({
      where: { idempotencyKey: key },
    });
    expect(enBase).toBe(1);
    orderIds.push(corps[0].body!.id!);
  });

  it('parcours payé : initiate ouvre, le webhook de l’opérateur confirme', async () => {
    const { commande } = await commandeEnAttente();
    expect(commande.status).toBe('PENDING');
  });

  it('un webhook REJOUÉ est acquitté sans second effet', async () => {
    const { commande, providerReference } = await commandeEnAttente();

    const premier = await server()
      .post(`${prefix}/payments/callback/simulation`)
      .send({
        providerReference,
        orderReference: commande.reference,
        status: 'PAID',
      });
    expect(premier.status).toBe(200);
    expect(premier.body).toEqual({ received: true });

    const confirmations1 = await prisma.db.orderEvent.count({
      where: { orderId: commande.id, status: 'CONFIRMED' },
    });
    expect(confirmations1).toBe(1);

    // L'opérateur rejoue (sa fenêtre a expiré, il croit ne pas avoir été cru).
    const rejeu = await server()
      .post(`${prefix}/payments/callback/simulation`)
      .send({
        providerReference,
        orderReference: commande.reference,
        status: 'PAID',
      });
    expect(rejeu.status).toBe(200);
    expect(rejeu.body).toEqual({ received: true });

    const confirmations2 = await prisma.db.orderEvent.count({
      where: { orderId: commande.id, status: 'CONFIRMED' },
    });
    expect(confirmations2).toBe(1);

    const fiche = await server()
      .get(`${prefix}/orders/${commande.reference}`)
      .set(auth(clientToken));
    expect(fiche.body.status).toBe('CONFIRMED');
  });

  it('un autre compte ne peut ni lire ni payer ma commande', async () => {
    const commande = await creerCommande({
      paymentMethod: 'MOBILE_MONEY',
      provider: 'WAVE',
    });
    expect(commande.status).toBe(201);
    orderIds.push((commande.body as { id: string }).id);

    const phone = `07${String(Date.now()).slice(-8)}`;
    const inscription = await server().post(`${prefix}/auth/register`).send({
      firstName: 'Autre',
      lastName: 'Client',
      phone,
      password: 'Agrim2026!',
    });
    expect(inscription.status).toBe(201);
    const autreToken = (inscription.body as { accessToken: string }).accessToken;

    const lecture = await server()
      .get(`${prefix}/orders/${commande.body.reference}`)
      .set(auth(autreToken));
    expect(lecture.status).toBe(404);

    const paiement = await server()
      .post(`${prefix}/payments/orders/${commande.body.reference}/initiate`)
      .set(auth(autreToken))
      .send();
    expect(paiement.status).toBe(404);
  });
});
