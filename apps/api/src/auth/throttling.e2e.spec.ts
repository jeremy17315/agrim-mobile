/**
 * Vérifie que le rate limiting protège réellement /auth/login.
 * Suite séparée : le ThrottlerGuard y est actif, contrairement aux autres.
 */
import 'dotenv/config';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';

describe('Rate limiting de la connexion (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Cette suite exige le rate limiting actif.
    delete process.env.THROTTLE_DISABLED;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
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
});
