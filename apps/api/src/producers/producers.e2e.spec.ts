/**
 * Tests d'intégration de l'espace producteur.
 *
 * Enjeux vérifiés ici :
 *  - un producteur ne voit ni ne modifie l'exploitation d'un autre ;
 *  - une déclaration examinée devient intouchable par son auteur ;
 *  - un producteur ne valide jamais sa propre déclaration ;
 *  - une parcelle porteuse d'historique n'est jamais détruite.
 */
import 'dotenv/config';

import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { configureApp } from '../bootstrap';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';

describe('Espace producteur (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prefix = '/api/v1';

  let producerToken: string;
  let otherProducerToken: string;
  let managerToken: string;
  let clientToken: string;

  let otherProducerUserId: string;
  let otherFarmId: string;
  let otherProductionId: string;

  const farmIds: string[] = [];

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

    producerToken = (await login('0700000003')).accessToken;
    // 0700000004 = GESTIONNAIRE. 0700000005 est ADMIN : l'utiliser ici
    // laisserait le rôle de gestion sans aucune couverture.
    managerToken = (await login('0700000004')).accessToken;
    clientToken = (await login('0700000001')).accessToken;

    // Second producteur : sans lui, l'isolation n'est pas démontrable.
    const argon = await import('argon2');
    const passwordHash = await argon.hash('Agrim2026!');
    const otherUser = await prisma.db.user.upsert({
      where: { phone: '0700008888' },
      create: {
        firstName: 'Autre',
        lastName: 'Producteur',
        phone: '0700008888',
        passwordHash,
        role: 'PRODUCTEUR',
      },
      update: { passwordHash, role: 'PRODUCTEUR' },
      select: { id: true },
    });
    otherProducerUserId = otherUser.id;

    const otherProducer = await prisma.db.producer.upsert({
      where: { userId: otherProducerUserId },
      create: {
        userId: otherProducerUserId,
        displayName: 'Ferme témoin',
        region: 'Bélier',
      },
      update: {},
      select: { id: true },
    });

    const otherFarm = await prisma.db.farm.create({
      data: {
        producerId: otherProducer.id,
        name: 'Parcelle témoin',
        location: 'Yamoussoukro',
        areaHectares: 4,
      },
      select: { id: true },
    });
    otherFarmId = otherFarm.id;

    const otherProduction = await prisma.db.production.create({
      data: {
        farmId: otherFarmId,
        season: 'Saison témoin',
        cropVariety: 'Riz témoin',
        quantityKg: 1000,
      },
      select: { id: true },
    });
    otherProductionId = otherProduction.id;

    otherProducerToken = (await login('0700008888')).accessToken;
  });

  afterAll(async () => {
    if (farmIds.length > 0) {
      await prisma.db.farm.deleteMany({ where: { id: { in: farmIds } } });
    }
    await prisma.db.producer.deleteMany({
      where: { userId: otherProducerUserId },
    });
    await prisma.db.user.deleteMany({ where: { id: otherProducerUserId } });
    await app.close();
    delete process.env.THROTTLE_DISABLED;
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /* ------------------------------ Accès --------------------------------- */

  it('refuse l’espace producteur à un client', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/producers/me`)
      .set(auth(clientToken));

    expect(res.status).toBe(403);
  });

  it('exige une authentification', async () => {
    const res = await request(app.getHttpServer()).get(
      `${prefix}/producers/me`,
    );
    expect(res.status).toBe(401);
  });

  /* ----------------------------- Synthèse -------------------------------- */

  it('renvoie une synthèse cohérente avec les données du producteur', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/producers/me`)
      .set(auth(producerToken));

    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('Coopérative Salif Traoré');
    expect(res.body.farmCount).toBeGreaterThan(0);
    // Seules les récoltes réceptionnées sont cumulées (seed : 15 400 kg).
    expect(res.body.receivedKg).toBe(15400);
    expect(res.body.pendingCount).toBeGreaterThan(0);
  });

  /* ----------------------------- Parcelles ------------------------------- */

  it('ne liste que ses propres parcelles', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/producers/me/farms`)
      .set(auth(producerToken));

    expect(res.status).toBe(200);
    expect(res.body.some((f: { id: string }) => f.id === otherFarmId)).toBe(
      false,
    );
  });

  it('crée puis modifie une parcelle', async () => {
    const created = await request(app.getHttpServer())
      .post(`${prefix}/producers/me/farms`)
      .set(auth(producerToken))
      .send({
        name: 'Parcelle e2e',
        location: 'Bouaké',
        areaHectares: 3.5,
        latitude: 7.69,
        longitude: -5.03,
      });

    expect(created.status).toBe(201);
    expect(created.body.isActive).toBe(true);
    farmIds.push(created.body.id);

    const updated = await request(app.getHttpServer())
      .put(`${prefix}/producers/me/farms/${created.body.id}`)
      .set(auth(producerToken))
      .send({ areaHectares: 4.2 });

    expect(updated.status).toBe(200);
    expect(updated.body.areaHectares).toBe(4.2);
    // La mise à jour partielle ne doit pas effacer les champs absents.
    expect(updated.body.name).toBe('Parcelle e2e');
  });

  it('refuse de modifier la parcelle d’un autre producteur', async () => {
    const res = await request(app.getHttpServer())
      .put(`${prefix}/producers/me/farms/${otherFarmId}`)
      .set(auth(producerToken))
      .send({ name: 'Tentative' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('FARM_NOT_FOUND');
  });

  it('supprime une parcelle vierge, désactive celle qui porte un historique', async () => {
    const vierge = await request(app.getHttpServer())
      .post(`${prefix}/producers/me/farms`)
      .set(auth(producerToken))
      .send({ name: 'Parcelle jetable' });
    farmIds.push(vierge.body.id);

    const removed = await request(app.getHttpServer())
      .delete(`${prefix}/producers/me/farms/${vierge.body.id}`)
      .set(auth(producerToken));

    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ deleted: true, deactivated: false });

    // Celle du seed porte des productions : elle doit survivre.
    const farms = await request(app.getHttpServer())
      .get(`${prefix}/producers/me/farms`)
      .set(auth(producerToken));
    const withHistory = farms.body.find(
      (f: { productionCount: number }) => f.productionCount > 0,
    );

    const kept = await request(app.getHttpServer())
      .delete(`${prefix}/producers/me/farms/${withHistory.id}`)
      .set(auth(producerToken));

    expect(kept.status).toBe(200);
    expect(kept.body).toEqual({ deleted: false, deactivated: true });

    const still = await prisma.db.farm.findUnique({
      where: { id: withHistory.id },
      select: { isActive: true },
    });
    expect(still?.isActive).toBe(false);

    // Remettre en service pour ne pas fausser les tests suivants.
    await prisma.db.farm.update({
      where: { id: withHistory.id },
      data: { isActive: true },
    });
  });

  /* ---------------------------- Productions ------------------------------ */

  it('ne liste que ses propres déclarations', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/producers/me/productions`)
      .set(auth(producerToken));

    expect(res.status).toBe(200);
    expect(
      res.body.some((p: { id: string }) => p.id === otherProductionId),
    ).toBe(false);
    expect(res.body[0].farmName).toBeTruthy();
  });

  it('déclare une production sur sa parcelle', async () => {
    const farms = await request(app.getHttpServer())
      .get(`${prefix}/producers/me/farms`)
      .set(auth(producerToken));
    const farmId = farms.body[0].id;

    const res = await request(app.getHttpServer())
      .post(`${prefix}/producers/me/productions`)
      .set(auth(producerToken))
      .send({
        farmId,
        season: 'Saison e2e',
        cropVariety: 'Riz e2e',
        quantityKg: 4200,
        targetKg: 5000,
      });

    expect(res.status).toBe(201);
    // Une déclaration naît toujours en attente de vérification.
    expect(res.body.status).toBe('DECLARED');
    expect(res.body.reviewedAt).toBeNull();

    await prisma.db.production.delete({ where: { id: res.body.id } });
  });

  it('refuse de déclarer sur la parcelle d’un autre', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/producers/me/productions`)
      .set(auth(producerToken))
      .send({
        farmId: otherFarmId,
        season: 'Saison intruse',
        cropVariety: 'Riz',
        quantityKg: 100,
      });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('FARM_NOT_FOUND');
  });

  it('refuse une quantité aberrante', async () => {
    const farms = await request(app.getHttpServer())
      .get(`${prefix}/producers/me/farms`)
      .set(auth(producerToken));

    const res = await request(app.getHttpServer())
      .post(`${prefix}/producers/me/productions`)
      .set(auth(producerToken))
      .send({
        farmId: farms.body[0].id,
        season: 'Saison',
        cropVariety: 'Riz',
        quantityKg: 0,
      });

    expect(res.status).toBe(400);
  });

  it('refuse de déclarer sur une parcelle inactive', async () => {
    const farm = await request(app.getHttpServer())
      .post(`${prefix}/producers/me/farms`)
      .set(auth(producerToken))
      .send({ name: 'Parcelle en jachère' });
    farmIds.push(farm.body.id);

    await request(app.getHttpServer())
      .put(`${prefix}/producers/me/farms/${farm.body.id}`)
      .set(auth(producerToken))
      .send({ isActive: false });

    const res = await request(app.getHttpServer())
      .post(`${prefix}/producers/me/productions`)
      .set(auth(producerToken))
      .send({
        farmId: farm.body.id,
        season: 'Saison',
        cropVariety: 'Riz',
        quantityKg: 500,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FARM_INACTIVE');
  });

  /* ------------------------------- Revue --------------------------------- */

  it('interdit au producteur de valider sa propre déclaration', async () => {
    const list = await request(app.getHttpServer())
      .get(`${prefix}/producers/me/productions?status=DECLARED`)
      .set(auth(producerToken));
    const declared = list.body[0];

    const res = await request(app.getHttpServer())
      .patch(`${prefix}/producers/productions/${declared.id}/review`)
      .set(auth(producerToken))
      .send({ status: 'CONFIRMED' });

    expect(res.status).toBe(403);
  });

  it('permet à la coopérative de confirmer, puis fige la déclaration', async () => {
    const farms = await request(app.getHttpServer())
      .get(`${prefix}/producers/me/farms`)
      .set(auth(producerToken));

    const created = await request(app.getHttpServer())
      .post(`${prefix}/producers/me/productions`)
      .set(auth(producerToken))
      .send({
        farmId: farms.body[0].id,
        season: 'Saison revue',
        cropVariety: 'Riz',
        quantityKg: 900,
      });
    const id = created.body.id;

    const confirmed = await request(app.getHttpServer())
      .patch(`${prefix}/producers/productions/${id}/review`)
      .set(auth(managerToken))
      .send({ status: 'CONFIRMED' });

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('CONFIRMED');
    expect(confirmed.body.reviewedAt).not.toBeNull();

    // Une fois examinée, le producteur ne peut plus la retoucher.
    const edit = await request(app.getHttpServer())
      .put(`${prefix}/producers/me/productions/${id}`)
      .set(auth(producerToken))
      .send({ quantityKg: 5000 });
    expect(edit.status).toBe(403);
    expect(edit.body.code).toBe('PRODUCTION_NOT_EDITABLE');

    const remove = await request(app.getHttpServer())
      .delete(`${prefix}/producers/me/productions/${id}`)
      .set(auth(producerToken));
    expect(remove.status).toBe(403);

    // RECEIVED est atteignable depuis CONFIRMED, mais pas l'inverse.
    const back = await request(app.getHttpServer())
      .patch(`${prefix}/producers/productions/${id}/review`)
      .set(auth(managerToken))
      .send({ status: 'DECLARED' });
    expect(back.status).toBe(400);
    expect(back.body.code).toBe('INVALID_PRODUCTION_TRANSITION');

    const received = await request(app.getHttpServer())
      .patch(`${prefix}/producers/productions/${id}/review`)
      .set(auth(managerToken))
      .send({ status: 'RECEIVED' });
    expect(received.status).toBe(200);

    // État terminal : plus aucune décision possible.
    const after = await request(app.getHttpServer())
      .patch(`${prefix}/producers/productions/${id}/review`)
      .set(auth(managerToken))
      .send({ status: 'REJECTED', reviewNote: 'Trop tard' });
    expect(after.status).toBe(400);

    await prisma.db.production.delete({ where: { id } });
  });

  it('exige un motif pour rejeter', async () => {
    const farms = await request(app.getHttpServer())
      .get(`${prefix}/producers/me/farms`)
      .set(auth(producerToken));

    const created = await request(app.getHttpServer())
      .post(`${prefix}/producers/me/productions`)
      .set(auth(producerToken))
      .send({
        farmId: farms.body[0].id,
        season: 'Saison rejet',
        cropVariety: 'Riz',
        quantityKg: 700,
      });

    const sansMotif = await request(app.getHttpServer())
      .patch(`${prefix}/producers/productions/${created.body.id}/review`)
      .set(auth(managerToken))
      .send({ status: 'REJECTED' });
    expect(sansMotif.status).toBe(400);
    expect(sansMotif.body.code).toBe('REVIEW_NOTE_REQUIRED');

    const avecMotif = await request(app.getHttpServer())
      .patch(`${prefix}/producers/productions/${created.body.id}/review`)
      .set(auth(managerToken))
      .send({ status: 'REJECTED', reviewNote: 'Quantité incohérente.' });
    expect(avecMotif.status).toBe(200);
    expect(avecMotif.body.reviewNote).toBe('Quantité incohérente.');

    await prisma.db.production.delete({ where: { id: created.body.id } });
  });

  it('corrige puis supprime une déclaration non examinée', async () => {
    const farms = await request(app.getHttpServer())
      .get(`${prefix}/producers/me/farms`)
      .set(auth(producerToken));

    const created = await request(app.getHttpServer())
      .post(`${prefix}/producers/me/productions`)
      .set(auth(producerToken))
      .send({
        farmId: farms.body[0].id,
        season: 'Saison brouillon',
        cropVariety: 'Riz',
        quantityKg: 300,
      });

    const edited = await request(app.getHttpServer())
      .put(`${prefix}/producers/me/productions/${created.body.id}`)
      .set(auth(producerToken))
      .send({ quantityKg: 350 });
    expect(edited.status).toBe(200);
    expect(edited.body.quantityKg).toBe(350);

    const removed = await request(app.getHttpServer())
      .delete(`${prefix}/producers/me/productions/${created.body.id}`)
      .set(auth(producerToken));
    expect(removed.status).toBe(200);
  });

  it('empêche un producteur de toucher à la déclaration d’un autre', async () => {
    const res = await request(app.getHttpServer())
      .put(`${prefix}/producers/me/productions/${otherProductionId}`)
      .set(auth(otherProducerToken))
      .send({ quantityKg: 1100 });
    // Le propriétaire légitime, lui, peut la corriger.
    expect(res.status).toBe(200);

    const intrus = await request(app.getHttpServer())
      .put(`${prefix}/producers/me/productions/${otherProductionId}`)
      .set(auth(producerToken))
      .send({ quantityKg: 9999 });
    expect(intrus.status).toBe(404);
    expect(intrus.body.code).toBe('PRODUCTION_NOT_FOUND');
  });
  /* --------------------------- File de revue ----------------------------- */

  it('liste les déclarations à examiner, tous producteurs confondus', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/producers/productions/review`)
      .set(auth(managerToken));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    // La déclaration semée pour l'autre producteur doit y figurer, avec de quoi
    // identifier et joindre l'exploitant.
    const cible = res.body.find(
      (row: { id: string }) => row.id === otherProductionId,
    );
    expect(cible).toBeDefined();
    expect(cible.producerName).toBeTruthy();
    expect(cible.producerPhone).toBeTruthy();
    expect(cible.farmName).toBeTruthy();
  });

  it('n’expose que les déclarations en attente d’arbitrage par défaut', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/producers/productions/review`)
      .set(auth(managerToken));

    const statuts = new Set(
      res.body.map((row: { status: string }) => row.status),
    );
    expect(statuts.has('RECEIVED')).toBe(false);
    expect(statuts.has('REJECTED')).toBe(false);
  });

  it('trie les plus anciennes en premier', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/producers/productions/review`)
      .set(auth(managerToken));

    const dates = res.body.map((row: { createdAt: string }) =>
      new Date(row.createdAt).getTime(),
    );
    const trie = [...dates].sort((a, b) => a - b);
    expect(dates).toEqual(trie);
  });

  it('filtre par statut', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/producers/productions/review?status=CONFIRMED`)
      .set(auth(managerToken));

    expect(res.status).toBe(200);
    for (const row of res.body) {
      expect(row.status).toBe('CONFIRMED');
    }
  });

  it('refuse la file de revue au producteur et au client', async () => {
    const parProducteur = await request(app.getHttpServer())
      .get(`${prefix}/producers/productions/review`)
      .set(auth(producerToken));
    expect(parProducteur.status).toBe(403);

    const parClient = await request(app.getHttpServer())
      .get(`${prefix}/producers/productions/review`)
      .set(auth(clientToken));
    expect(parClient.status).toBe(403);

    const sansJeton = await request(app.getHttpServer()).get(
      `${prefix}/producers/productions/review`,
    );
    expect(sansJeton.status).toBe(401);
  });

  it('retire une déclaration de la file une fois réceptionnée', async () => {
    const farms = await request(app.getHttpServer())
      .get(`${prefix}/producers/me/farms`)
      .set(auth(producerToken));

    const created = await request(app.getHttpServer())
      .post(`${prefix}/producers/me/productions`)
      .set(auth(producerToken))
      .send({
        farmId: farms.body[0].id,
        season: 'Saison file',
        cropVariety: 'Riz',
        quantityKg: 420,
      });

    const avant = await request(app.getHttpServer())
      .get(`${prefix}/producers/productions/review`)
      .set(auth(managerToken));
    expect(
      avant.body.some((row: { id: string }) => row.id === created.body.id),
    ).toBe(true);

    await request(app.getHttpServer())
      .patch(`${prefix}/producers/productions/${created.body.id}/review`)
      .set(auth(managerToken))
      .send({ status: 'CONFIRMED' });
    await request(app.getHttpServer())
      .patch(`${prefix}/producers/productions/${created.body.id}/review`)
      .set(auth(managerToken))
      .send({ status: 'RECEIVED' });

    const apres = await request(app.getHttpServer())
      .get(`${prefix}/producers/productions/review`)
      .set(auth(managerToken));
    expect(
      apres.body.some((row: { id: string }) => row.id === created.body.id),
    ).toBe(false);

    await prisma.db.production.delete({ where: { id: created.body.id } });
  });
});
