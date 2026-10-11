/**
 * Configuration commerciale servie à l'application.
 *
 * Ce que ce fichier protège, et qui n'était pas vrai avant :
 *
 *  - un numéro de contact ou une adresse de boutique se corrigent dans
 *    l'administration, SANS nouvelle version sur le Play Store ;
 *  - la lecture est PUBLIQUE (le client doit pouvoir appeler sans compte) ;
 *  - l'écriture est réservée à ADMIN et DG — publier une adresse ou changer le
 *    numéro officiel engage la société ;
 *  - un point de vente créé reste INACTIF : il n'apparaît aux clients qu'après
 *    publication explicite ;
 *  - la distinction « retrait possible » / « information seulement » est
 *    respectée : promettre un retrait inexistant ferait déplacer un client.
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
import { PrismaService } from '../prisma/prisma.service';

describe('Configuration commerciale (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prefix = '/api/v1';

  let adminToken: string;
  let clientToken: string;
  const posIds: string[] = [];

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

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
      const res = await server()
        .post(`${prefix}/auth/login`)
        .send({ phone, password: 'Agrim2026!' });
      return (res.body as { accessToken: string }).accessToken;
    };
    clientToken = await login('0700000001');
    adminToken = await login('0700000005');
  });

  afterAll(async () => {
    if (posIds.length > 0) {
      await prisma.db.pointOfSale.deleteMany({ where: { id: { in: posIds } } });
    }
    await app.close();
    delete process.env.THROTTLE_DISABLED;
  });

  it('sert les coordonnées publiquement, sans compte', async () => {
    const res = await server().get(`${prefix}/config/app`);
    expect(res.status).toBe(200);

    const body = res.body as {
      support: { phone: string | null; landlinePhone: string | null };
      delivery: { feeNotice: string };
      pointsOfSale: unknown[];
      faq: unknown[];
    };

    // Repli sur la configuration AGRIM du contrat : l'écran ne reste jamais
    // sans numéro.
    expect(body.support.phone).toBeTruthy();
    expect(body.delivery.feeNotice).toMatch(/aucun frais/i);
    expect(Array.isArray(body.pointsOfSale)).toBe(true);
  });

  it('refuse à un client de modifier la configuration commerciale', async () => {
    const res = await server()
      .put(`${prefix}/management/config/support`)
      .set(auth(clientToken))
      .send({ phone: '+225 07 00 00 00 00' });
    expect(res.status).toBe(403);
  });

  it('publie un point de vente après relecture, et l’expose aux clients', async () => {
    const creation = await server()
      .post(`${prefix}/management/config/points-of-sale`)
      .set(auth(adminToken))
      .send({
        name: `Boutique de test ${randomUUID().slice(0, 4)}`,
        address: '227 Logement, avenue principale',
        city: 'Yamoussoukro',
        landmark: 'En face de la pharmacie',
        openingHours: 'Lun–Sam 8h–18h',
        supportsPickup: true,
      });
    expect(creation.status).toBe(201);

    const cree = (
      creation.body as {
        id: string;
        address: string;
        isActive: boolean;
        supportsPickup: boolean;
      }[]
    ).find((p) => p.address.startsWith('227 Logement'))!;
    posIds.push(cree.id);

    // NON PUBLIÉ par défaut : rien n'apparaît chez le client.
    expect(cree.isActive).toBe(false);
    const avant = await server().get(`${prefix}/config/app`);
    expect(
      (avant.body as { pointsOfSale: { id: string }[] }).pointsOfSale.some(
        (p) => p.id === cree.id,
      ),
    ).toBe(false);

    // Publication explicite.
    const publication = await server()
      .patch(`${prefix}/management/config/points-of-sale/${cree.id}`)
      .set(auth(adminToken))
      .send({
        name: 'Boutique de test',
        address: '227 Logement, avenue principale',
        city: 'Yamoussoukro',
        supportsPickup: true,
        isActive: true,
      });
    expect(publication.status).toBe(200);

    const apres = await server().get(`${prefix}/config/app`);
    const publie = (
      apres.body as {
        pointsOfSale: { id: string; supportsPickup: boolean }[];
      }
    ).pointsOfSale.find((p) => p.id === cree.id);
    expect(publie).toBeDefined();
    expect(publie?.supportsPickup).toBe(true);
  });

  it('un point « information seulement » ne promet pas le retrait', async () => {
    const creation = await server()
      .post(`${prefix}/management/config/points-of-sale`)
      .set(auth(adminToken))
      .send({
        name: 'Usine Aboukro',
        address: 'Aboukro Extension',
        city: 'Yamoussoukro',
        supportsPickup: false,
        isActive: true,
      });
    const cree = (
      creation.body as { id: string; name: string; supportsPickup: boolean }[]
    ).find((p) => p.name === 'Usine Aboukro')!;
    posIds.push(cree.id);

    const public_ = await server().get(`${prefix}/config/app`);
    const expose = (
      public_.body as {
        pointsOfSale: { id: string; supportsPickup: boolean }[];
      }
    ).pointsOfSale.find((p) => p.id === cree.id);

    expect(expose).toBeDefined();
    expect(expose?.supportsPickup).toBe(false);
  });

  it('les coordonnées publiées remplacent celles du bundle', async () => {
    const nouveau = '+225 07 11 22 33 44';
    const miseAJour = await server()
      .put(`${prefix}/management/config/support`)
      .set(auth(adminToken))
      .send({ phone: nouveau });
    expect(miseAJour.status).toBe(200);

    const res = await server().get(`${prefix}/config/app`);
    expect((res.body as { support: { phone: string } }).support.phone).toBe(
      nouveau,
    );
  });

  it('accepte un numéro WhatsApp au format international, refuse un format douteux', async () => {
    const ok = await server()
      .put(`${prefix}/management/config/support`)
      .set(auth(adminToken))
      .send({ whatsapp: '2250700050452' });
    expect(ok.status).toBe(200);

    const ko = await server()
      .put(`${prefix}/management/config/support`)
      .set(auth(adminToken))
      .send({ whatsapp: '+225 07 00 05 04 52' });
    expect(ko.status).toBe(400);
  });

  it('valide les coordonnées géographiques d’un point de vente', async () => {
    const ko = await server()
      .post(`${prefix}/management/config/points-of-sale`)
      .set(auth(adminToken))
      .send({
        name: 'Point invalide',
        address: 'Nulle part',
        city: 'Yamoussoukro',
        latitude: 999,
      });
    expect(ko.status).toBe(400);
    expect((ko.body as { code: string }).code).toBe('COORDINATES_INVALID');
  });
});
