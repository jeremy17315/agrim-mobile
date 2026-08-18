/**
 * Flux de bout en bout, inter-espaces.
 *
 * Les suites par module prouvent que chaque endpoint respecte sa règle. Elles
 * ne prouvent pas que les espaces s'enchaînent correctement : c'est l'objet de
 * ce fichier.
 *
 * Chaque test suit une commande à travers plusieurs rôles et vérifie qu'un
 * geste posé dans un espace se répercute là où un autre acteur le lit — file
 * du gestionnaire, tournée du livreur, suivi du client, indicateurs de la
 * direction. Une régression d'intégration passe entre les mailles des tests
 * unitaires et se voit ici.
 */
import 'dotenv/config';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PrismaService } from './prisma/prisma.service';

describe('Flux de bout en bout', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prefix = '/api/v1';

  let clientToken: string;
  let courierToken: string;
  let courierId: string;
  let managerToken: string;
  let producerToken: string;
  let dgToken: string;

  let addressId: string;
  let variantId: string;

  const orderIds: string[] = [];
  const addressIds: string[] = [];
  const fileIds: string[] = [];
  const productionIds: string[] = [];

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
    const courier = await login('0700000002');
    courierToken = courier.accessToken;
    courierId = courier.user.id;
    producerToken = (await login('0700000003')).accessToken;
    managerToken = (await login('0700000004')).accessToken;
    dgToken = (await login('0700000006')).accessToken;

    const address = await request(app.getHttpServer())
      .post(`${prefix}/addresses`)
      .set(auth(clientToken))
      .send({
        label: 'Test flux',
        city: 'Yamoussoukro',
        landmark: 'Face à la pharmacie',
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
      data: { stock: 2000 },
    });
  });

  afterAll(async () => {
    if (orderIds.length > 0) {
      await prisma.db.notification.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await prisma.db.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (productionIds.length > 0) {
      await prisma.db.production.deleteMany({
        where: { id: { in: productionIds } },
      });
    }
    if (fileIds.length > 0) {
      await prisma.db.fileAsset.deleteMany({ where: { id: { in: fileIds } } });
    }
    if (addressIds.length > 0) {
      await prisma.db.address.deleteMany({ where: { id: { in: addressIds } } });
    }
    await app.close();
    delete process.env.THROTTLE_DISABLED;
  });

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  const server = () => request(app.getHttpServer());

  /* ------------------------------ Raccourcis ----------------------------- */

  const placeOrder = async (quantity = 1) => {
    const res = await server()
      .post(`${prefix}/orders`)
      .set(auth(clientToken))
      .send({
        addressId,
        items: [{ variantId, quantity }],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: randomUUID(),
      });
    expect(res.status).toBe(201);
    orderIds.push(res.body.id);
    return res.body as { id: string; reference: string; total: number };
  };

  const managerSets = (reference: string, status: string) =>
    server()
      .patch(`${prefix}/management/orders/${reference}/status`)
      .set(auth(managerToken))
      .send({ status });

  const courierSets = (deliveryId: string, status: string) =>
    server()
      .patch(`${prefix}/deliveries/${deliveryId}/status`)
      .set(auth(courierToken))
      .send({ status });

  const createFile = async () => {
    const file = await prisma.db.fileAsset.create({
      data: {
        key: `proof/${randomUUID()}.png`,
        url: `https://files.local/${randomUUID()}.png`,
        mimeType: 'image/png',
        sizeBytes: 2048,
      },
      select: { id: true },
    });
    fileIds.push(file.id);
    return file.id;
  };

  /** Amène une commande jusqu'à la remise au livreur. */
  const prepareAndAssign = async (quantity = 1) => {
    const order = await placeOrder(quantity);
    await managerSets(order.reference, 'CONFIRMED');
    await managerSets(order.reference, 'PREPARING');
    await managerSets(order.reference, 'READY');

    const assigned = await server()
      .post(`${prefix}/deliveries/orders/${order.reference}/assign`)
      .set(auth(managerToken))
      .send({ courierId });
    expect(assigned.status).toBe(201);

    return { order, deliveryId: assigned.body.id as string };
  };

  /* ==================================================================== */
  /* Flux 1 — commande client jusqu'à la livraison signée                 */
  /* ==================================================================== */

  it('conduit une commande du panier à la livraison signée', async () => {
    const stockAvant = await prisma.db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });

    // 1. Le client commande. Le stock est réservé immédiatement.
    const order = await placeOrder(3);
    const stockApres = await prisma.db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(stockApres.stock).toBe(stockAvant.stock - 3);

    // 2. La commande apparaît dans la file du gestionnaire.
    const file = await server()
      .get(`${prefix}/management/orders`)
      .set(auth(managerToken));
    expect(
      file.body.some(
        (row: { reference: string }) => row.reference === order.reference,
      ),
    ).toBe(true);

    // 3. Le gestionnaire la fait avancer jusqu'à prête.
    for (const status of ['CONFIRMED', 'PREPARING', 'READY']) {
      const res = await managerSets(order.reference, status);
      expect(res.status).toBe(200);
    }

    // 4. Prête sans livreur : le back-office le signale explicitement.
    const avantAssignation = await server()
      .get(`${prefix}/management/orders/${order.reference}`)
      .set(auth(managerToken));
    expect(avantAssignation.body.hasCourier).toBe(false);

    // 5. Assignation : la course entre dans la tournée du livreur.
    const assigned = await server()
      .post(`${prefix}/deliveries/orders/${order.reference}/assign`)
      .set(auth(managerToken))
      .send({ courierId });
    expect(assigned.status).toBe(201);
    const deliveryId = assigned.body.id as string;

    const tournee = await server()
      .get(`${prefix}/deliveries/mine`)
      .set(auth(courierToken));
    expect(
      tournee.body.some((row: { id: string }) => row.id === deliveryId),
    ).toBe(true);

    // 6. Le livreur exécute la course.
    for (const status of ['ACCEPTED', 'PICKED_UP', 'IN_TRANSIT']) {
      const res = await courierSets(deliveryId, status);
      expect(res.status).toBe(200);
    }

    // 7. Départ du livreur : le client voit sa commande en route.
    const suivi = await server()
      .get(`${prefix}/orders/${order.reference}/tracking`)
      .set(auth(clientToken));
    expect(suivi.status).toBe(200);
    expect(suivi.body.status).toBe('IN_TRANSIT');

    // Et côté client, la commande elle-même bascule en cours de livraison.
    const enRoute = await server()
      .get(`${prefix}/orders/${order.reference}`)
      .set(auth(clientToken));
    expect(enRoute.body.status).toBe('OUT_FOR_DELIVERY');

    // 8. Livraison avec signature.
    const signatureFileId = await createFile();
    const proof = await server()
      .post(`${prefix}/deliveries/${deliveryId}/proof`)
      .set(auth(courierToken))
      .send({
        methods: ['SIGNATURE'],
        signatureFileId,
        receivedBy: 'Awa Koné',
        position: { latitude: 6.8276, longitude: -5.2893 },
      });
    expect(proof.status).toBe(201);

    // 9. La preuve enregistrée, le livreur clôt la course. Deux temps
    // volontaires : la preuve doit exister AVANT la validation, jamais après.
    const delivered = await courierSets(deliveryId, 'DELIVERED');
    expect(delivered.status).toBe(200);

    // 10. La commande est livrée côté client.
    const final = await server()
      .get(`${prefix}/orders/${order.reference}`)
      .set(auth(clientToken));
    expect(final.body.status).toBe('DELIVERED');
  });

  /* ==================================================================== */
  /* Flux 2 — annulation et restitution du stock                          */
  /* ==================================================================== */

  it('restitue le stock quand le client annule avant préparation', async () => {
    const avant = await prisma.db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });

    const order = await placeOrder(4);
    const cancelled = await server()
      .post(`${prefix}/orders/${order.reference}/cancel`)
      .set(auth(clientToken))
      .send({});
    expect(cancelled.status).toBe(201);

    const apres = await prisma.db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    // Le stock revient à son niveau initial : ni perdu, ni compté deux fois.
    expect(apres.stock).toBe(avant.stock);

    // La commande annulée quitte la file de travail du gestionnaire.
    const file = await server()
      .get(`${prefix}/management/orders`)
      .set(auth(managerToken));
    expect(
      file.body.some(
        (row: { reference: string }) => row.reference === order.reference,
      ),
    ).toBe(false);
  });

  it('empêche le client d’annuler une commande déjà partie', async () => {
    const { order, deliveryId } = await prepareAndAssign();
    await courierSets(deliveryId, 'ACCEPTED');
    await courierSets(deliveryId, 'PICKED_UP');
    await courierSets(deliveryId, 'IN_TRANSIT');

    const stockAvant = await prisma.db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });

    const res = await server()
      .post(`${prefix}/orders/${order.reference}/cancel`)
      .set(auth(clientToken))
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ORDER_NOT_CANCELLABLE');

    // Le gestionnaire non plus : la marchandise est dans la nature.
    const parGestionnaire = await managerSets(order.reference, 'CANCELLED');
    expect(parGestionnaire.status).toBe(409);

    // Surtout : aucun stock n'a été recrédité pour une marchandise qui n'est
    // pas revenue en entrepôt.
    const stockApres = await prisma.db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(stockApres.stock).toBe(stockAvant.stock);

    // Et la course reste dans la tournée du livreur, qui doit la clore.
    const tournee = await server()
      .get(`${prefix}/deliveries/mine`)
      .set(auth(courierToken));
    expect(
      tournee.body.some((row: { id: string }) => row.id === deliveryId),
    ).toBe(true);
  });

  /* ==================================================================== */
  /* Flux 3 — cloisonnement entre espaces                                 */
  /* ==================================================================== */

  it('cloisonne chaque espace, quel que soit le point d’entrée', async () => {
    const { order, deliveryId } = await prepareAndAssign();

    // Le client ne pilote pas la préparation.
    const clientVeutPreparer = await server()
      .patch(`${prefix}/management/orders/${order.reference}/status`)
      .set(auth(clientToken))
      .send({ status: 'PREPARING' });
    expect(clientVeutPreparer.status).toBe(403);

    // Le livreur ne voit pas le back-office.
    const livreurVeutLaFile = await server()
      .get(`${prefix}/management/orders`)
      .set(auth(courierToken));
    expect(livreurVeutLaFile.status).toBe(403);

    // Le gestionnaire ne conduit pas la course à la place du livreur.
    const gestionnaireVeutRouler = await server()
      .patch(`${prefix}/deliveries/${deliveryId}/status`)
      .set(auth(managerToken))
      .send({ status: 'ACCEPTED' });
    expect(gestionnaireVeutRouler.status).toBe(403);

    // Ni depuis le back-office : la course étant déjà partie, la transition
    // est refusée. Sur une commande encore au bureau, c'est la frontière
    // bureau/terrain qui s'applique — vérifiée juste après.
    const gestionnaireVeutLivrer = await managerSets(
      order.reference,
      'DELIVERED',
    );
    expect(gestionnaireVeutLivrer.status).toBe(409);

    // Depuis READY, la transition vers OUT_FOR_DELIVERY est valide au sens du
    // cycle de vie : seule la frontière bureau/terrain l'interdit.
    const auBureau = await placeOrder();
    await managerSets(auBureau.reference, 'CONFIRMED');
    await managerSets(auBureau.reference, 'PREPARING');
    await managerSets(auBureau.reference, 'READY');
    const sautTerrain = await managerSets(
      auBureau.reference,
      'OUT_FOR_DELIVERY',
    );
    expect(sautTerrain.status).toBe(409);
    expect(sautTerrain.body.code).toBe('MANAGER_ACTION_NOT_ALLOWED');

    // Le producteur n'a rien à faire dans les commandes.
    const producteurVeutLaFile = await server()
      .get(`${prefix}/management/orders`)
      .set(auth(producerToken));
    expect(producteurVeutLaFile.status).toBe(403);

    // Le gestionnaire ne consulte pas les indicateurs de la direction.
    const gestionnaireVeutLesChiffres = await server()
      .get(`${prefix}/analytics/dashboard`)
      .set(auth(managerToken));
    expect(gestionnaireVeutLesChiffres.status).toBe(403);
  });

  it('ne laisse pas un client lire la commande d’un autre', async () => {
    const order = await placeOrder();

    // Un autre client authentifié ne doit rien voir de cette commande.
    const autre = await server()
      .post(`${prefix}/auth/login`)
      .send({ phone: '0700000003', password: 'Agrim2026!' });

    const res = await server()
      .get(`${prefix}/orders/${order.reference}`)
      .set(auth(autre.body.accessToken));
    expect([403, 404]).toContain(res.status);
  });

  /* ==================================================================== */
  /* Flux 4 — producteur, gestionnaire et direction                       */
  /* ==================================================================== */

  it('fait remonter une récolte du producteur jusqu’aux indicateurs', async () => {
    const farms = await server()
      .get(`${prefix}/producers/me/farms`)
      .set(auth(producerToken));
    const farmId = farms.body[0].id as string;

    // 1. Le producteur déclare une récolte.
    const declared = await server()
      .post(`${prefix}/producers/me/productions`)
      .set(auth(producerToken))
      .send({
        farmId,
        season: 'Saison flux 2026',
        cropVariety: 'Riz long grain',
        quantityKg: 7_500,
      });
    expect(declared.status).toBe(201);
    const productionId = declared.body.id as string;
    productionIds.push(productionId);

    // 2. Elle apparaît dans la file de revue de la coopérative.
    const fileRevue = await server()
      .get(`${prefix}/producers/productions/review`)
      .set(auth(managerToken));
    expect(
      fileRevue.body.some((row: { id: string }) => row.id === productionId),
    ).toBe(true);

    // 3. La direction la compte parmi les dossiers en attente.
    const avant = await server()
      .get(`${prefix}/analytics/dashboard`)
      .set(auth(dgToken));

    // 4. La coopérative vérifie puis réceptionne.
    for (const status of ['CONFIRMED', 'RECEIVED']) {
      const res = await server()
        .patch(`${prefix}/producers/productions/${productionId}/review`)
        .set(auth(managerToken))
        .send({ status });
      expect(res.status).toBe(200);
    }

    // 5. Le dossier quitte la file et le tonnage entre dans les indicateurs.
    const apres = await server()
      .get(`${prefix}/analytics/dashboard`)
      .set(auth(dgToken));
    expect(apres.body.pendingProductionReviews).toBe(
      avant.body.pendingProductionReviews - 1,
    );
    expect(apres.body.productionReceivedKg).toBe(
      avant.body.productionReceivedKg + 7_500,
    );

    // 6. Le producteur voit la décision sur sa propre déclaration.
    const sienne = await server()
      .get(`${prefix}/producers/me/productions`)
      .set(auth(producerToken));
    const ligne = sienne.body.find(
      (row: { id: string }) => row.id === productionId,
    );
    expect(ligne.status).toBe('RECEIVED');
  });

  it('rend le motif de rejet visible par le producteur', async () => {
    const farms = await server()
      .get(`${prefix}/producers/me/farms`)
      .set(auth(producerToken));

    const declared = await server()
      .post(`${prefix}/producers/me/productions`)
      .set(auth(producerToken))
      .send({
        farmId: farms.body[0].id,
        season: 'Saison rejet 2026',
        cropVariety: 'Riz',
        quantityKg: 200,
      });
    productionIds.push(declared.body.id);

    // Un rejet sans motif est refusé : le producteur resterait sans recours.
    const sansMotif = await server()
      .patch(`${prefix}/producers/productions/${declared.body.id}/review`)
      .set(auth(managerToken))
      .send({ status: 'REJECTED' });
    expect(sansMotif.status).toBe(400);

    await server()
      .patch(`${prefix}/producers/productions/${declared.body.id}/review`)
      .set(auth(managerToken))
      .send({ status: 'REJECTED', reviewNote: 'Quantité incohérente.' });

    const sienne = await server()
      .get(`${prefix}/producers/me/productions`)
      .set(auth(producerToken));
    const ligne = sienne.body.find(
      (row: { id: string }) => row.id === declared.body.id,
    );
    expect(ligne.status).toBe('REJECTED');
    expect(ligne.reviewNote).toBe('Quantité incohérente.');
  });

  /* ==================================================================== */
  /* Flux 5 — cohérence des chiffres entre espaces                        */
  /* ==================================================================== */

  it('fait converger le back-office et la direction sur les mêmes faits', async () => {
    const avantDg = await server()
      .get(`${prefix}/analytics/dashboard`)
      .set(auth(dgToken));
    const avantGestion = await server()
      .get(`${prefix}/management/dashboard`)
      .set(auth(managerToken));

    const order = await placeOrder(2);

    const apresDg = await server()
      .get(`${prefix}/analytics/dashboard`)
      .set(auth(dgToken));
    const apresGestion = await server()
      .get(`${prefix}/management/dashboard`)
      .set(auth(managerToken));

    // Les deux espaces enregistrent la même recette pour la même commande.
    expect(apresDg.body.revenueMonth).toBe(
      avantDg.body.revenueMonth + order.total,
    );
    expect(apresGestion.body.revenueToday).toBe(
      avantGestion.body.revenueToday + order.total,
    );

    // Annulation : les deux la retirent, aucun ne conserve un montant fantôme.
    await server()
      .post(`${prefix}/orders/${order.reference}/cancel`)
      .set(auth(clientToken))
      .send({});

    const finalDg = await server()
      .get(`${prefix}/analytics/dashboard`)
      .set(auth(dgToken));
    const finalGestion = await server()
      .get(`${prefix}/management/dashboard`)
      .set(auth(managerToken));

    expect(finalDg.body.revenueMonth).toBe(avantDg.body.revenueMonth);
    expect(finalGestion.body.revenueToday).toBe(avantGestion.body.revenueToday);
  });

  it('répercute un réapprovisionnement sur les alertes de la direction', async () => {
    // Variante volontairement mise sous son seuil.
    const variant = await prisma.db.productVariant.findFirstOrThrow({
      where: { isAvailable: true, id: { not: variantId } },
      select: { id: true, lowStockThreshold: true, stock: true },
    });
    await prisma.db.productVariant.update({
      where: { id: variant.id },
      data: { stock: 1 },
    });

    const enAlerte = await server()
      .get(`${prefix}/analytics/dashboard`)
      .set(auth(dgToken));

    // Le gestionnaire réapprovisionne.
    const apport = variant.lowStockThreshold * 4;
    const adjusted = await server()
      .patch(`${prefix}/management/stock/${variant.id}`)
      .set(auth(managerToken))
      .send({ delta: apport });
    expect(adjusted.status).toBe(200);

    const apres = await server()
      .get(`${prefix}/analytics/dashboard`)
      .set(auth(dgToken));
    expect(apres.body.lowStockCount).toBe(enAlerte.body.lowStockCount - 1);

    await prisma.db.productVariant.update({
      where: { id: variant.id },
      data: { stock: variant.stock },
    });
  });

  /* ==================================================================== */
  /* Flux 6 — notifications reçues par le client                          */
  /* ==================================================================== */

  it('informe le client à chaque étape franchie', async () => {
    const order = await placeOrder();

    await managerSets(order.reference, 'CONFIRMED');
    await managerSets(order.reference, 'PREPARING');
    await managerSets(order.reference, 'READY');

    const notifications = await server()
      .get(`${prefix}/notifications`)
      .set(auth(clientToken));
    expect(notifications.status).toBe(200);

    const liees = notifications.body.data.filter(
      (row: { orderId: string | null }) => row.orderId === order.id,
    );
    // Le client est tenu informé sans avoir à rouvrir l'application.
    expect(liees.length).toBeGreaterThan(0);
  });
});
