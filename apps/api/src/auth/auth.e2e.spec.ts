/**
 * Tests d'intégration de l'authentification et du RBAC.
 * Ils tournent contre la vraie base PostgreSQL de développement.
 */
import 'dotenv/config';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';

describe('Authentification (e2e)', () => {
  let app: INestApplication;
  const prefix = '/api/v1';

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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
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
