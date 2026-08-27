/**
 * Vérifie que le rate limiting protège réellement /auth/login.
 * Suite séparée : le ThrottlerGuard y est actif, contrairement aux autres.
 */
import 'dotenv/config';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { configureApp } from '../bootstrap';
import { PrismaService } from '../prisma/prisma.service';

describe('Rate limiting de la connexion (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  // Préfixe réservé à cette suite : permet un nettoyage sans risque.
  const testPhonePrefix = '075555';

  beforeAll(async () => {
    // Cette suite exige le rate limiting actif.
    delete process.env.THROTTLE_DISABLED;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    configureApp(app, { isProd: false });
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Les tentatives d'inscription non bloquées créent de vrais comptes :
    // les laisser fausserait les suites suivantes.
    await prisma.db.user.deleteMany({
      where: { phone: { startsWith: testPhonePrefix } },
    });
    await app.close();

    // Retablit l'etat que les autres suites attendent. Cette suite est la
    // seule a SUPPRIMER la variable dans son beforeAll, pour exercer le rate
    // limiting ; la laisser absente fait porter aux suites suivantes la
    // charge de la reposer, et l'oubli d'une seule les rend toutes fragiles.
    process.env.THROTTLE_DISABLED = '1';
  });

  it('bloque le bourrinage de mots de passe (limite 5/min)', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ phone: '0700000001', password: 'MauvaisMotDePasse1' });

    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      statuses.push((await attempt()).status);
    }

    // Les premières tentatives échouent en 401, puis le throttler renvoie 429.
    expect(statuses).toContain(401);
    expect(statuses).toContain(429);
    expect(statuses.at(-1)).toBe(429);
  });

  it('borne aussi la création de comptes (limite 5 / 5 min)', async () => {
    // Sans limite, un robot inscrit des milliers de comptes.
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          firstName: 'Robot',
          lastName: 'Test',
          phone: `${testPhonePrefix}00${String(i).padStart(2, '0')}`,
          password: 'Agrim2026!',
        });
      statuses.push(res.status);
    }

    expect(statuses).toContain(429);
  });

  it('borne le renouvellement de jeton (limite 20/min)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'jeton-invalide' });
      statuses.push(res.status);
    }

    expect(statuses).toContain(429);
  });
});
