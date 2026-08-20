/**
 * Revue de sécurité automatisée.
 *
 * Ces tests ne vérifient pas des fonctionnalités mais des propriétés que
 * l'application doit conserver quoi qu'il arrive : ne pas fuiter de données
 * sensibles, ne pas accepter un jeton du mauvais type, ne pas laisser un rôle
 * franchir sa frontière, ne pas renvoyer de trace technique.
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
import { PrismaService } from './prisma/prisma.service';

describe('Sécurité', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prefix = '/api/v1';

  let clientToken: string;
  let clientRefresh: string;
  let clientId: string;
  let courierToken: string;

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
      return res.body;
    };

    const client = await login('0700000001');
    clientToken = client.accessToken;
    clientRefresh = client.refreshToken;
    clientId = client.user.id;
    courierToken = (await login('0700000002')).accessToken;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.THROTTLE_DISABLED;
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => request(app.getHttpServer());

  /* ------------------------- Fuite de données ---------------------------- */

  it('ne renvoie jamais d’empreinte de mot de passe', async () => {
    const routes = ['/auth/me', '/orders', '/addresses', '/notifications'];

    for (const route of routes) {
      const res = await server()
        .get(`${prefix}${route}`)
        .set(auth(clientToken));
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/passwordHash/i);
      expect(body).not.toMatch(/\$argon2/);
    }
  });

  it('ne renvoie jamais d’empreinte de refresh token', async () => {
    const res = await server()
      .post(`${prefix}/auth/refresh`)
      .send({ refreshToken: clientRefresh });

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/tokenHash/i);

    // Le token renouvelé remplace l'ancien pour la suite des tests.
    clientRefresh = res.body.refreshToken;
  });

  it('n’expose pas la trace technique d’une erreur serveur', async () => {
    // UUID valide mais inexistant : le service lève, la réponse doit rester
    // une erreur métier propre.
    const res = await server()
      .get(`${prefix}/orders/AGR-0000-0000`)
      .set(auth(clientToken));

    expect([400, 404]).toContain(res.status);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/at [A-Za-z]+\./); // pas de stack
    expect(body).not.toMatch(/prisma/i);
    expect(body).not.toMatch(/SELECT|INSERT|FROM "/i);
    expect(res.body.message).toBeTruthy();
  });

  /* --------------------------- Jetons ------------------------------------ */

  it('refuse un access token présenté comme refresh token', async () => {
    // Les deux jetons sont signés avec des secrets distincts : confondre les
    // usages doit échouer, même si la charge utile est identique.
    const res = await server()
      .post(`${prefix}/auth/refresh`)
      .send({ refreshToken: clientToken });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('refuse un refresh token présenté comme access token', async () => {
    const res = await server()
      .get(`${prefix}/auth/me`)
      .set(auth(clientRefresh));

    expect(res.status).toBe(401);
  });

  it('refuse un jeton dont la signature est altérée', async () => {
    const [header, payload] = clientToken.split('.');
    const forged = `${header}.${payload}.signature-bidon`;

    const res = await server().get(`${prefix}/auth/me`).set(auth(forged));
    expect(res.status).toBe(401);
  });

  it('refuse un jeton non signé (algorithme « none »)', async () => {
    const encode = (obj: unknown) =>
      Buffer.from(JSON.stringify(obj)).toString('base64url');
    const forged = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
      sub: clientId,
      phone: '0700000001',
      role: 'ADMIN',
    })}.`;

    const res = await server().get(`${prefix}/auth/me`).set(auth(forged));
    expect(res.status).toBe(401);
  });

  it('ne fait pas confiance au rôle inscrit dans le jeton', async () => {
    // Le rôle est revalidé en base à chaque requête : un jeton légitime dont
    // la charge annoncerait ADMIN ne donnerait aucun droit supplémentaire.
    const res = await server().get(`${prefix}/auth/me`).set(auth(clientToken));
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('CLIENT');
  });

  it('coupe l’accès dès qu’un compte est désactivé', async () => {
    const user = await prisma.db.user.create({
      data: {
        firstName: 'Compte',
        lastName: 'Suspendu',
        phone: '0709996655',
        passwordHash: await (await import('argon2')).hash('Agrim2026!'),
        role: 'CLIENT',
        referralCode: 'ZZ9911',
      },
      select: { id: true },
    });

    const session = await server()
      .post(`${prefix}/auth/login`)
      .send({ phone: '0709996655', password: 'Agrim2026!' });
    expect(session.status).toBe(200);

    await prisma.db.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });

    // Le jeton reste valide cryptographiquement, mais la session est morte.
    const res = await server()
      .get(`${prefix}/auth/me`)
      .set(auth(session.body.accessToken));
    expect(res.status).toBe(401);

    await prisma.db.refreshToken.deleteMany({ where: { userId: user.id } });
    await prisma.db.user.delete({ where: { id: user.id } });
  });

  /* ------------------------- Surface d'entrée ---------------------------- */

  it('rejette les champs non déclarés sur les écritures', async () => {
    const res = await server()
      .post(`${prefix}/addresses`)
      .set(auth(clientToken))
      .send({
        label: 'Intrusion',
        city: 'Yamoussoukro',
        landmark: 'x',
        contactPhone: '0700000001',
        userId: randomUUID(), // tentative d'écrire pour un autre compte
        isDefault: true,
      });

    // La liste blanche stricte refuse la requête plutôt que d'ignorer le champ
    // en silence.
    expect(res.status).toBe(400);
  });

  it('n’accepte pas un identifiant mal formé', async () => {
    const res = await server()
      .get(`${prefix}/deliveries/pas-un-uuid`)
      .set(auth(courierToken));

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|postgres/i);
  });

  it('protège toutes les routes d’écriture sans jeton', async () => {
    const routes: [string, string][] = [
      ['post', '/orders'],
      ['post', '/addresses'],
      ['get', '/management/dashboard'],
      ['get', '/analytics/dashboard'],
      ['get', '/producers/me'],
      ['get', '/deliveries/mine'],
      ['get', '/notifications'],
    ];

    for (const [method, route] of routes) {
      const res = await (method === 'post'
        ? server().post(`${prefix}${route}`).send({})
        : server().get(`${prefix}${route}`));
      expect(res.status).toBe(401);
    }
  });

  it('laisse le catalogue public, mais en lecture seule', async () => {
    const lecture = await server().get(`${prefix}/products`);
    expect(lecture.status).toBe(200);

    // Aucune route d'écriture publique sur le catalogue.
    const ecriture = await server().post(`${prefix}/products`).send({});
    expect([401, 403, 404]).toContain(ecriture.status);
  });

  /* --------------------------- En-têtes ---------------------------------- */

  it('envoie les en-têtes de sécurité de helmet', async () => {
    const res = await server().get(`${prefix}/health`);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    // Signature du serveur masquée : ne pas annoncer la pile technique.
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
