/**
 * Paiement direct manuel — le contrat commercial du 11 octobre 2026.
 *
 * Ce que rien d'autre ne prouve, et que ce fichier met sous test :
 *
 *  - aucune commande nouvelle ne peut repasser par l'agrégateur : `initiate`
 *    répond `PAYMENT_NOT_AGGREGATOR` ;
 *  - l'instruction de paiement affiche le numéro configuré par AGRIM, le
 *    montant attendu et la référence unique — jamais un numéro inventé ;
 *  - « J'ai payé » n'est PAS « c'est payé » : après déclaration, la commande
 *    reste en attente et le paiement n'est jamais `SUCCEEDED` sans revue
 *    humaine ;
 *  - une référence de transaction ne sert qu'UNE fois ;
 *  - un écart de montant ouvre une vérification manuelle, pas un ajustement ;
 *  - seul le personnel habilité confirme, la bascule est conditionnelle (pas
 *    de double validation), et le journal porte qui a validé quoi, quand.
 *
 * Le numéro de réception utilisé ici est une DONNÉE DE TEST : il est créé par
 * la suite, supprimé à la fin, et n'existe dans aucun fichier de configuration.
 */
import 'dotenv/config';

import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { AppModule } from '../app.module';
import { configureApp } from '../bootstrap';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { CatalogSyncService } from '../catalog-sync/catalog-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { prisma as prismaClient } from '../prisma/prisma.client';
import {
  createSiteIntegrationDouble,
  referenceDeTest,
} from '../testing/site-integration.double';

describe('Paiement direct manuel (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prefix = '/api/v1';

  let clientToken: string;
  let adminToken: string;
  let gestionToken: string;
  let addressId: string;
  let variantId: string;
  let methodId: string;

  const orderIds: string[] = [];
  const addressIds: string[] = [];

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  /** Crée une commande compte connecté, en transfert direct. */
  const creerCommandeDirecte = async (options: { code?: string } = {}) => {
    const res = await server()
      .post(`${prefix}/orders`)
      .set(auth(clientToken))
      .send({
        addressId,
        items: [{ variantId, quantity: 2 }],
        paymentMethod: 'DIRECT_MOBILE_MONEY',
        paymentMethodCode: options.code ?? 'ORANGE_MONEY',
        idempotencyKey: randomUUID(),
      });
    if (res.status === 201) {
      orderIds.push((res.body as { id: string }).id);
    }
    return res;
  };

  /** Solde les commandes créées et la configuration de test. */
  const declarationIds: string[] = [];

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

    const client = await server()
      .post(`${prefix}/auth/login`)
      .send({ phone: '0700000001', password: 'Agrim2026!' });
    clientToken = (client.body as { accessToken: string }).accessToken;

    const admin = await server()
      .post(`${prefix}/auth/login`)
      .send({ phone: '0700000005', password: 'Agrim2026!' });
    adminToken = (admin.body as { accessToken: string }).accessToken;

    const gestion = await server()
      .post(`${prefix}/auth/login`)
      .send({ phone: '0700000004', password: 'Agrim2026!' });
    gestionToken = (gestion.body as { accessToken: string }).accessToken;

    const address = await server()
      .post(`${prefix}/addresses`)
      .set(auth(clientToken))
      .send({
        label: 'Paiement direct',
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

    // Moyen de paiement de TEST — le numéro n'a aucune valeur commerciale.
    const method = await prisma.db.paymentMethodConfig.create({
      data: {
        code: 'ORANGE_MONEY',
        operatorName: 'Orange Money (test)',
        receivingNumber: '0700000000',
        beneficiaryName: 'AGRIM SARL (test)',
        instructions: 'Test : choisissez « Transfert », puis ce numéro.',
        isActive: true,
        sortOrder: 1,
      },
      select: { id: true },
    });
    methodId = method.id;
  });

  afterAll(async () => {
    if (declarationIds.length > 0) {
      await prisma.db.paymentDeclaration.deleteMany({
        where: { id: { in: declarationIds } },
      });
    }
    if (orderIds.length > 0) {
      await prisma.db.notification.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await prisma.db.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (addressIds.length > 0) {
      await prisma.db.address.deleteMany({ where: { id: { in: addressIds } } });
    }
    if (methodId) {
      await prisma.db.paymentMethodConfig.delete({ where: { id: methodId } });
    }
    await app.close();
    delete process.env.THROTTLE_DISABLED;
  });

  it('n’expose publiquement que les moyens ACTIFS configurés par AGRIM', async () => {
    const res = await server().get(`${prefix}/payments/methods`);
    expect(res.status).toBe(200);

    const methods = (res.body as { methods: { code: string }[] }).methods;
    const orange = methods.find((m) => m.code === 'ORANGE_MONEY');
    expect(orange).toBeDefined();
    expect(orange).toMatchObject({
      operatorName: 'Orange Money (test)',
      receivingNumber: '0700000000',
    });

    // Aucun moyen inventé : la liste ne contient que ce qui est en base.
    expect(methods).toHaveLength(1);
  });

  it('refuse une commande directe dont le moyen n’est pas configuré', async () => {
    const res = await creerCommandeDirecte({ code: 'OPERATEUR_INCONNU' });
    expect(res.status).toBe(400);
    expect((res.body as { code: string }).code).toBe(
      'PAYMENT_METHOD_UNAVAILABLE',
    );
  });

  it('fige le moyen et le numéro sur la commande, et sert les instructions', async () => {
    const commande = await creerCommandeDirecte();
    expect(commande.status).toBe(201);
    const reference = (commande.body as { reference: string }).reference;

    const paiement = await prisma.db.payment.findFirstOrThrow({
      where: { order: { reference } },
      select: { method: true, methodCode: true, receivingNumber: true, amount: true, status: true },
    });
    expect(paiement).toMatchObject({
      method: 'DIRECT_MOBILE_MONEY',
      methodCode: 'ORANGE_MONEY',
      receivingNumber: '0700000000',
      status: 'PENDING',
    });

    const instructions = await server()
      .get(`${prefix}/payments/orders/${reference}/instructions`)
      .set(auth(clientToken));
    expect(instructions.status).toBe(200);
    expect(instructions.body).toMatchObject({
      reference,
      amount: paiement.amount,
      paymentReference: reference,
    });
    expect(
      (instructions.body as { method: { receivingNumber: string } }).method
        .receivingNumber,
    ).toBe('0700000000');

    // Le texte à copier contient le numéro ET le montant réel.
    const texte = await server()
      .get(`${prefix}/payments/orders/${reference}/instructions/texte`)
      .set(auth(clientToken));
    expect(texte.status).toBe(200);
    expect((texte.body as { text: string }).text).toContain('0700000000');
  });

  it('ferme l’agrégateur : initiate refuse une commande directe', async () => {
    const commande = await creerCommandeDirecte();
    expect(commande.status).toBe(201);
    const reference = (commande.body as { reference: string }).reference;

    const initiation = await server()
      .post(`${prefix}/payments/orders/${reference}/initiate`)
      .set(auth(clientToken))
      .send();
    expect(initiation.status).toBe(409);
    expect((initiation.body as { code: string }).code).toBe(
      'PAYMENT_NOT_AGGREGATOR',
    );
  });

  it('« J’ai payé » n’est PAS « c’est payé » : la commande reste en attente', async () => {
    const commande = await creerCommandeDirecte();
    expect(commande.status).toBe(201);
    const reference = (commande.body as { reference: string }).reference;
    const orderId = (commande.body as { id: string }).id;

    const amount = (
      commande.body as { total: number }
    ).total;

    const declaration = await server()
      .post(`${prefix}/payments/orders/${reference}/declare`)
      .set(auth(clientToken))
      .send({
        transactionReference: 'TX-DIRECT-0001',
        declaredAmount: amount,
      });
    expect(declaration.status).toBe(201);
    expect(declaration.body).toMatchObject({
      recorded: true,
      status: 'DECLARED_BY_CUSTOMER',
      amountMatches: true,
    });

    const paiement = await prisma.db.payment.findFirstOrThrow({
      where: { orderId },
      select: { status: true },
    });
    expect(paiement.status).toBe('DECLARED_BY_CUSTOMER');
    // LA garantie : aucun chemin automatique ne mène à SUCCEEDED.
    expect(paiement.status).not.toBe('SUCCEEDED');

    const fiche = await server()
      .get(`${prefix}/orders/${reference}`)
      .set(auth(clientToken));
    expect((fiche.body as { status: string }).status).toBe('PENDING');

    const evenements = await prisma.db.orderEvent.count({
      where: { orderId, status: 'CONFIRMED' },
    });
    expect(evenements).toBe(0);
  });

  it('une référence de transaction ne peut pas servir deux fois', async () => {
    const premiere = await creerCommandeDirecte();
    const deuxieme = await creerCommandeDirecte();
    expect(premiere.status).toBe(201);
    expect(deuxieme.status).toBe(201);

    const montant = (premiere.body as { total: number }).total;
    const body = {
      transactionReference: `TX-UNIQUE-${randomUUID().slice(0, 6)}`,
      declaredAmount: montant,
    };

    const ok = await server()
      .post(
        `${prefix}/payments/orders/${
          (premiere.body as { reference: string }).reference
        }/declare`,
      )
      .set(auth(clientToken))
      .send(body);
    expect(ok.status).toBe(201);

    const rejeu = await server()
      .post(
        `${prefix}/payments/orders/${
          (deuxieme.body as { reference: string }).reference
        }/declare`,
      )
      .set(auth(clientToken))
      .send(body);
    expect(rejeu.status).toBe(409);
    expect((rejeu.body as { code: string }).code).toBe(
      'PAYMENT_REFERENCE_ALREADY_USED',
    );
  });

  it('un montant annoncé différent ouvre une vérification, sans rien ajuster', async () => {
    const commande = await creerCommandeDirecte();
    const reference = (commande.body as { reference: string }).reference;
    const total = (commande.body as { total: number }).total;

    const declaration = await server()
      .post(`${prefix}/payments/orders/${reference}/declare`)
      .set(auth(clientToken))
      .send({
        transactionReference: `TX-ECART-${randomUUID().slice(0, 6)}`,
        declaredAmount: Math.max(1, total - 500),
      });
    expect(declaration.status).toBe(201);
    expect(declaration.body).toMatchObject({
      status: 'UNDER_REVIEW',
      amountMatches: false,
    });

    const paiement = await prisma.db.payment.findFirstOrThrow({
      where: { order: { reference } },
      select: { status: true, amount: true },
    });
    expect(paiement.status).toBe('UNDER_REVIEW');
    // Le montant attendu n'a PAS bougé d'un franc.
    expect(paiement.amount).toBe(total);
  });

  it('le client n’accède pas à la file de vérification', async () => {
    const res = await server()
      .get(`${prefix}/management/payments/declarations`)
      .set(auth(clientToken));
    expect(res.status).toBe(403);
  });

  it('seul le personnel habilité confirme, une seule fois, et tout est journalisé', async () => {
    const commande = await creerCommandeDirecte();
    const reference = (commande.body as { reference: string }).reference;
    const orderId = (commande.body as { id: string }).id;
    const total = (commande.body as { total: number }).total;

    const declaration = await server()
      .post(`${prefix}/payments/orders/${reference}/declare`)
      .set(auth(clientToken))
      .send({
        transactionReference: `TX-OK-${randomUUID().slice(0, 6)}`,
        declaredAmount: total,
      });
    expect(declaration.status).toBe(201);

    // La file de vérification voit le dossier avec tout ce qu'il faut pour
    // décider : commande, client, montant attendu, montant annoncé, numéro.
    const file = await server()
      .get(`${prefix}/management/payments/declarations`)
      .set(auth(gestionToken));
    expect(file.status).toBe(200);
    const dossier = (
      file.body as {
        data: {
          declarationId: string;
          orderReference: string;
          expectedAmount: number;
          declaredAmount: number;
          receivingNumber: string;
        }[];
      }
    ).data.find((d) => d.orderReference === reference);
    expect(dossier).toBeDefined();
    expect(dossier).toMatchObject({
      expectedAmount: total,
      declaredAmount: total,
      receivingNumber: '0700000000',
    });
    declarationIds.push(dossier!.declarationId);

    // Un rejet sans motif est refusé : le client doit comprendre.
    const sansMotif = await server()
      .post(
        `${prefix}/management/payments/declarations/${dossier!.declarationId}/review`,
      )
      .set(auth(gestionToken))
      .send({ decision: 'REJECT' });
    expect(sansMotif.status).toBe(400);
    expect((sansMotif.body as { code: string }).code).toBe(
      'REJECTION_NOTE_REQUIRED',
    );

    // Confirmation par un gestionnaire habilité.
    const confirmation = await server()
      .post(
        `${prefix}/management/payments/declarations/${dossier!.declarationId}/review`,
      )
      .set(auth(gestionToken))
      .send({ decision: 'CONFIRM', note: 'Fonds reçus, référence vérifiée.' });
    expect(confirmation.status).toBe(201);
    expect(confirmation.body).toMatchObject({ status: 'SUCCEEDED' });

    const paiement = await prisma.db.payment.findFirstOrThrow({
      where: { orderId },
      select: { status: true, confirmedAt: true, paidAt: true },
    });
    expect(paiement.status).toBe('SUCCEEDED');
    expect(paiement.confirmedAt).not.toBeNull();
    expect(paiement.paidAt).not.toBeNull();

    const fiche = await server()
      .get(`${prefix}/orders/${reference}`)
      .set(auth(clientToken));
    expect((fiche.body as { status: string }).status).toBe('CONFIRMED');

    // Journal : QUI a validé, QUAND, depuis quel statut.
    const journal = await prisma.db.paymentReviewLog.findFirstOrThrow({
      where: { payment: { orderId }, action: 'CONFIRMED' },
      select: { actorId: true, actorRole: true, actorSource: true },
    });
    expect(journal.actorSource).toBe('STAFF');
    expect(journal.actorId).toBeTruthy();
    expect(journal.actorRole).toBe('GESTIONNAIRE');

    // Deuxième validation : refusée, et rien n'est appliqué deux fois.
    const seconde = await server()
      .post(
        `${prefix}/management/payments/declarations/${dossier!.declarationId}/review`,
      )
      .set(auth(adminToken))
      .send({ decision: 'CONFIRM' });
    expect(seconde.status).toBe(409);
    expect((seconde.body as { code: string }).code).toBe(
      'PAYMENT_ALREADY_SETTLED',
    );

    const confirmations = await prisma.db.orderEvent.count({
      where: { orderId, status: 'CONFIRMED' },
    });
    expect(confirmations).toBe(1);
  });

  it('un rejet motivé ne confirme rien et n’annule pas la commande', async () => {
    const commande = await creerCommandeDirecte();
    const reference = (commande.body as { reference: string }).reference;
    const orderId = (commande.body as { id: string }).id;
    const total = (commande.body as { total: number }).total;

    const declaration = await server()
      .post(`${prefix}/payments/orders/${reference}/declare`)
      .set(auth(clientToken))
      .send({
        transactionReference: `TX-KO-${randomUUID().slice(0, 6)}`,
        declaredAmount: total,
      });
    const declarationId = (
      declaration.body as { declarationId?: string }
    ).declarationId;

    let dossierId = declarationId;
    if (!dossierId) {
      const dossier = await prisma.db.paymentDeclaration.findFirstOrThrow({
        where: { payment: { orderId } },
        select: { id: true },
      });
      dossierId = dossier.id;
    }
    declarationIds.push(dossierId);

    const rejet = await server()
      .post(`${prefix}/management/payments/declarations/${dossierId}/review`)
      .set(auth(gestionToken))
      .send({
        decision: 'REJECT',
        rejectionNote: 'Référence introuvable chez l’opérateur.',
      });
    expect(rejet.status).toBe(201);
    expect(rejet.body).toMatchObject({ status: 'REJECTED' });

    const paiement = await prisma.db.payment.findFirstOrThrow({
      where: { orderId },
      select: { status: true },
    });
    expect(paiement.status).toBe('REJECTED');

    // La commande n'est PAS annulée : AGRIM garde la main pour la suite.
    const fiche = await server()
      .get(`${prefix}/orders/${reference}`)
      .set(auth(clientToken));
    expect((fiche.body as { status: string }).status).not.toBe('CANCELLED');

    // Le MOTIF est rendu au client : sans lui, il ne peut pas comprendre ni
    // corriger sa déclaration.
    const instructions = await server()
      .get(`${prefix}/payments/orders/${reference}/instructions`)
      .set(auth(clientToken));
    expect(instructions.status).toBe(200);
    expect(instructions.body).toMatchObject({
      status: 'REJECTED',
      rejectionNote: 'Référence introuvable chez l’opérateur.',
    });
  });

  it('le parcours invité : instructions et déclaration via la capacité temporaire', async () => {
    const creation = await server()
      .post(`${prefix}/orders/guest`)
      .send({
        customerName: 'Client Invité',
        phone: '0700000099',
        deliveryLocation: 'Cocody, près du carrefour',
        items: [{ variantId, quantity: 1 }],
        paymentMethod: 'DIRECT_MOBILE_MONEY',
        paymentMethodCode: 'ORANGE_MONEY',
        idempotencyKey: randomUUID(),
      });
    expect(creation.status).toBe(201);
    const body = creation.body as {
      id: string;
      reference: string;
      total: number;
      paymentAccessToken?: string;
    };
    orderIds.push(body.id);
    expect(body.paymentAccessToken).toBeTruthy();

    // Sans jeton : la capacité ne s'ouvre pas.
    const sansJeton = await server().get(
      `${prefix}/payments/guest/orders/${body.reference}/instructions`,
    );
    expect(sansJeton.status).toBe(401);

    const instructions = await server()
      .get(`${prefix}/payments/guest/orders/${body.reference}/instructions`)
      .set('x-guest-payment-token', body.paymentAccessToken!);
    expect(instructions.status).toBe(200);
    expect(instructions.body).toMatchObject({
      reference: body.reference,
      amount: body.total,
    });

    const declaration = await server()
      .post(`${prefix}/payments/guest/orders/${body.reference}/declare`)
      .set('x-guest-payment-token', body.paymentAccessToken!)
      .send({
        transactionReference: `TX-INVITE-${randomUUID().slice(0, 6)}`,
        declaredAmount: body.total,
      });
    expect(declaration.status).toBe(200);
    expect(declaration.body).toMatchObject({ status: 'DECLARED_BY_CUSTOMER' });

    const fiche = await prisma.db.payment.findFirstOrThrow({
      where: { orderId: body.id },
      select: { status: true },
    });
    expect(fiche.status).toBe('DECLARED_BY_CUSTOMER');
  });
});
