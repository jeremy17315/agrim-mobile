/**
 * Tests d'intégration de l'authentification et du RBAC.
 * Ils tournent contre la vraie base PostgreSQL de développement.
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

describe('Authentification (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prefix = '/api/v1';
  let corruptedUserId: string | null = null;

  beforeAll(async () => {
    // Le rate limiting est couvert par throttling.e2e.spec.ts ; ici il
    // fausserait les assertions car la suite enchaîne les connexions.
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
  });

  afterAll(async () => {
    if (corruptedUserId) {
      await prisma.db.user.delete({ where: { id: corruptedUserId } });
    }
    await app.close();
    delete process.env.THROTTLE_DISABLED;
  });

  const login = (phone: string, password = 'Agrim2026!') =>
    request(app.getHttpServer())
      .post(`${prefix}/auth/login`)
      .send({ phone, password });

  it('expose la santé de l\u2019API sans authentification', async () => {
    const res = await request(app.getHttpServer()).get(`${prefix}/health`);
    expect(res.status).toBe(200);
    expect(res.body.database).toBe('up');
  });

  it('expose le catalogue publiquement', async () => {
    const res = await request(app.getHttpServer()).get(`${prefix}/products`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    // Les prix doivent être des entiers XOF.
    for (const v of res.body.data[0].variants) {
      expect(Number.isInteger(v.price)).toBe(true);
    }
  });

  it('connecte un client existant', async () => {
    const res = await login('0700000001');
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('CLIENT');
    expect(res.body.accessToken).toBeDefined();
  });

  it('accepte le numéro au format +225', async () => {
    const res = await login('+2250700000001');
    expect(res.status).toBe(200);
  });

  it('accepte un numéro saisi avec des espaces', async () => {
    // Forme spontanée sur mobile. La rejeter en 400 serait une faute
    // d'ergonomie : la normalisation doit précéder la validation.
    const res = await login('07 00 00 00 01');
    expect(res.status).toBe(200);
    expect(res.body.user.phone).toBe('0700000001');
  });

  it('refuse un mot de passe incorrect sans révéler si le compte existe', async () => {
    const res = await login('0700000001', 'MauvaisMotDePasse1');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('renvoie le même message pour un compte inexistant', async () => {
    const res = await login('0799999999');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('répond 401, pas 500, si l’empreinte stockée est illisible', async () => {
    // Compte hérité ou donnée corrompue : argon2.verify lève. La réponse
    // correcte reste « identifiants invalides » — jamais une erreur technique.
    const user = await prisma.db.user.create({
      data: {
        firstName: 'Empreinte',
        lastName: 'Corrompue',
        phone: '0709998877',
        passwordHash: 'pas-un-hash-argon2',
        role: 'CLIENT',
      },
      select: { id: true },
    });
    corruptedUserId = user.id;

    const res = await login('0709998877');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('valide le format du numéro', async () => {
    const res = await login('123');
    expect(res.status).toBe(400);
  });

  it('rejette les champs non déclarés (whitelist stricte)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/auth/login`)
      .send({ phone: '0700000001', password: 'Agrim2026!', role: 'ADMIN' });
    expect(res.status).toBe(400);
  });

  it('protège /auth/me sans token', async () => {
    const res = await request(app.getHttpServer()).get(`${prefix}/auth/me`);
    expect(res.status).toBe(401);
  });

  it('refuse un token forgé', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/auth/me`)
      .set('Authorization', 'Bearer faux.token.invalide');
    expect(res.status).toBe(401);
  });

  it('effectue la rotation du refresh token et détecte la réutilisation', async () => {
    const first = await login('0700000002'); // livreur
    const oldRefresh = first.body.refreshToken as string;

    const rotated = await request(app.getHttpServer())
      .post(`${prefix}/auth/refresh`)
      .send({ refreshToken: oldRefresh });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).not.toBe(oldRefresh);

    // Rejouer l'ancien token doit être traité comme un vol de session.
    const reused = await request(app.getHttpServer())
      .post(`${prefix}/auth/refresh`)
      .send({ refreshToken: oldRefresh });
    expect(reused.status).toBe(401);
    expect(reused.body.code).toBe('REFRESH_TOKEN_REUSED');
  });

  it('ne renvoie jamais le hash du mot de passe', async () => {
    const res = await login('0700000001');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(res.body.user.passwordHash).toBeUndefined();
  });
});
