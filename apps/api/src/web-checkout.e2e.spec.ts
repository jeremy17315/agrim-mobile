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
 *  - la bascule du 11 octobre 2026 : une commande NOUVELLE naît en transfert
 *    direct, et l'agrégateur lui est fermé — un ancien client qui envoie
 *    encore `MOBILE_MONEY` est servi sans commission ;
 *  - le régime HISTORIQUE reste prouvé : un webhook rejoué pour une commande
 *    antérieure est acquitté sans second effet ;
 *  - un autre compte ne peut ni lire ni payer la commande d'autrui.
 */
import 'dotenv/config';
// AVANT l'import d'AppModule : ConfigModule fige l'environnement validé au
// chargement — posé après, le mode asynchrone ne serait jamais vu.
import './testing/simulation-asynchrone';

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
  let clientUserId: string;
  let addressId: string;
  let variantId: string;
  let configMethodId: string;

  const orderIds: string[] = [];
  const addressIds: string[] = [];

  beforeAll(async () => {
    process.env.THROTTLE_DISABLED = '1';

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

    const clientUser = await prisma.db.user.findUniqueOrThrow({
      where: { phone: '0700000001' },
      select: { id: true },
    });
    clientUserId = clientUser.id;

    // Moyen de paiement ACTIF, données de test : un numéro réel est un
    // paramètre AGRIM, jamais une valeur du dépôt.
    const methode = await prisma.db.paymentMethodConfig.create({
      data: {
        code: 'ORANGE_MONEY',
        operatorName: 'Orange Money (test)',
        receivingNumber: '0700000000',
        beneficiaryName: 'AGRIM SARL (test)',
        isActive: true,
        sortOrder: 1,
      },
      select: { id: true },
    });
    configMethodId = methode.id;

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
    if (configMethodId) {
      await prisma.db.paymentMethodConfig.delete({
        where: { id: configMethodId },
      });
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
      provider?: 'ORANGE_MONEY' | 'MTN_MOMO' | 'MOOV_MONEY' | 'WAVE';
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

  /**
   * Commande ANTÉRIEURE à la bascule du 11 octobre 2026, posée directement en
   * base. Le webhook de l'agrégateur reste en service pour CES commandes : leur
   * argent a été encaissé par ce chemin, et c'est l'idempotence de ce
   * traitement-là que le test protège. Une commande nouvelle ne peut plus
   * emprunter cette voie (voir le test de fermeture plus bas).
   */
  const commandeLegacy = async () => {
    const providerReference = `TX-LEGACY-${randomUUID().slice(0, 8)}`;
    const commande = await prisma.db.order.create({
      data: {
        reference: `AGR-LEG-${randomUUID().slice(0, 6)}`,
        userId: clientUserId,
        addressId,
        status: 'PENDING',
        subtotal: 18_500,
        deliveryFee: 0,
        total: 18_500,
        idempotencyKey: randomUUID(),
        items: {
          create: {
            variantId,
            productName: 'Produit hérité',
            variantLabel: 'Format de test',
            unitPrice: 9_250,
            quantity: 2,
            lineTotal: 18_500,
          },
        },
        payment: {
          create: {
            method: 'MOBILE_MONEY',
            provider: 'ORANGE_MONEY',
            amount: 18_500,
            status: 'AWAITING_CONFIRMATION',
            providerReference,
          },
        },
      },
      select: { id: true, reference: true, status: true },
    });
    orderIds.push(commande.id);
    return { commande, providerReference };
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

  it('bascule : une commande NOUVELLE ne passe plus par l’agrégateur', async () => {
    const commande = await creerCommande({
      paymentMethod: 'MOBILE_MONEY',
      provider: 'ORANGE_MONEY',
    });
    expect(commande.status).toBe(201);
    orderIds.push((commande.body as { id: string }).id);

    // Un ancien client envoie encore `MOBILE_MONEY` : sa commande est HONORÉE,
    // mais elle naît en transfert direct — jamais sous le régime commissionné.
    const paiement = await prisma.db.payment.findFirstOrThrow({
      where: { order: { id: (commande.body as { id: string }).id } },
      select: { method: true, methodCode: true, receivingNumber: true },
    });
    expect(paiement).toMatchObject({
      method: 'DIRECT_MOBILE_MONEY',
      methodCode: 'ORANGE_MONEY',
      receivingNumber: '0700000000',
    });

    // Et la porte de l'agrégateur est fermée : aucune transaction n'est ouverte.
    const initiation = await server()
      .post(
        `${prefix}/payments/orders/${
          (commande.body as { reference: string }).reference
        }/initiate`,
      )
      .set(auth(clientToken))
      .send();
    expect(initiation.status).toBe(409);
    expect((initiation.body as { code: string }).code).toBe(
      'PAYMENT_NOT_AGGREGATOR',
    );
  });

  it('un webhook REJOUÉ est acquitté sans second effet', async () => {
    const { commande, providerReference } = await commandeLegacy();

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
      paymentMethod: 'CASH_ON_DELIVERY',
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
