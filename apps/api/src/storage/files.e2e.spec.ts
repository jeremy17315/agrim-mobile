/**
 * Tests d'intégration du dépôt de fichiers.
 *
 * Un point de dépôt est une surface d'attaque classique. On vérifie ici que le
 * type déclaré ne suffit pas, qu'un fichier trop lourd est rejeté, que le nom
 * d'origine n'influence pas le chemin de destination, et que seul le livreur
 * peut déposer une preuve.
 */
import 'dotenv/config';

import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { AppModule } from '../app.module';
import { configureApp } from '../bootstrap';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';

/** Image PNG valide minimale (1×1 pixel). */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** JPEG minimal : en-tête FF D8 FF suivi de remplissage. */
const JPEG_HEADER = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(64, 0x20),
]);

describe('Dépôt de fichiers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prefix = '/api/v1';

  let courierToken: string;
  let clientToken: string;
  let managerToken: string;
  const createdFileIds: string[] = [];

  beforeAll(async () => {
    process.env.THROTTLE_DISABLED = '1';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api/v1');
    configureApp(app, { isProd: false });
    await app.init();
    prisma = app.get(PrismaService);

    const login = async (phone: string) => {
      const res = await request(app.getHttpServer())
        .post(`${prefix}/auth/login`)
        .send({ phone, password: 'Agrim2026!' });
      return res.body.accessToken as string;
    };
    courierToken = await login('0700000002');
    clientToken = await login('0700000001');
    managerToken = await login('0700000004');
  });

  afterAll(async () => {
    if (createdFileIds.length > 0) {
      await prisma.db.fileAsset.deleteMany({
        where: { id: { in: createdFileIds } },
      });
    }
    await app.close();
    delete process.env.THROTTLE_DISABLED;
  });

  const upload = (
    buffer: Buffer,
    filename: string,
    contentType: string,
    token = courierToken,
  ) =>
    request(app.getHttpServer())
      .post(`${prefix}/files/proofs`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, { filename, contentType });

  it('accepte une image PNG et renvoie un identifiant exploitable', async () => {
    const res = await upload(PNG_1PX, 'signature.png', 'image/png');

    expect(res.status).toBe(201);
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.url).toContain('/files/proofs/');
    createdFileIds.push(res.body.id);

    // Le fichier doit exister réellement, pas seulement en base.
    const asset = await prisma.db.fileAsset.findUniqueOrThrow({
      where: { id: res.body.id },
      select: { key: true, sizeBytes: true },
    });
    const root = resolve(process.env.STORAGE_LOCAL_ROOT ?? 'storage');
    expect(existsSync(resolve(root, asset.key))).toBe(true);
    expect(asset.sizeBytes).toBe(PNG_1PX.byteLength);
  });

  it('accepte une image JPEG', async () => {
    const res = await upload(JPEG_HEADER, 'photo.jpg', 'image/jpeg');
    expect(res.status).toBe(201);
    createdFileIds.push(res.body.id);
  });

  it('refuse un fichier dont le contenu ne correspond pas au type déclaré', async () => {
    // Script déguisé en PNG : le type MIME est déclaratif, pas une preuve.
    const res = await upload(
      Buffer.from('<?php system($_GET["c"]); ?>'.padEnd(64, ' ')),
      'malveillant.png',
      'image/png',
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FILE_CONTENT');
  });

  it('refuse un type non autorisé', async () => {
    const res = await upload(
      Buffer.from('%PDF-1.7 contenu'),
      'facture.pdf',
      'application/pdf',
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('refuse une requête sans fichier', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/files/proofs`)
      .set('Authorization', `Bearer ${courierToken}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_REQUIRED');
  });

  it('rejette un fichier au-delà de la limite', async () => {
    const tooBig = Buffer.concat([PNG_1PX, Buffer.alloc(6 * 1024 * 1024, 0)]);
    const res = await upload(tooBig, 'enorme.png', 'image/png');

    // Multer coupe la requête avant de charger le fichier en mémoire.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('ignore le nom fourni par le client', async () => {
    const res = await upload(PNG_1PX, '../../evasion.png', 'image/png');

    expect(res.status).toBe(201);
    createdFileIds.push(res.body.id);

    const asset = await prisma.db.fileAsset.findUniqueOrThrow({
      where: { id: res.body.id },
      select: { key: true },
    });
    // Le serveur nomme le fichier : aucune remontée d'arborescence possible.
    expect(asset.key).toMatch(/^proofs\/[0-9a-f-]{36}\.png$/);
    expect(asset.key).not.toContain('..');
  });

  it('refuse le dépôt à un client', async () => {
    const res = await upload(PNG_1PX, 'x.png', 'image/png', clientToken);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_ROLE');
  });

  it('refuse le dépôt sans authentification', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/files/proofs`)
      .attach('file', PNG_1PX, {
        filename: 'x.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(401);
  });

  it('attribue le dépôt à son auteur', async () => {
    const res = await upload(PNG_1PX, 'trace.png', 'image/png');
    createdFileIds.push(res.body.id);

    const asset = await prisma.db.fileAsset.findUniqueOrThrow({
      where: { id: res.body.id },
      select: { uploadedBy: true },
    });
    // Traçabilité : savoir qui a déposé une preuve compte en cas de litige.
    expect(asset.uploadedBy).toEqual(expect.any(String));
  });

  describe('consultation d’une preuve', () => {
    let fileId: string;

    beforeAll(async () => {
      const res = await upload(PNG_1PX, 'preuve.png', 'image/png');
      fileId = res.body.id;
      createdFileIds.push(fileId);
    });

    it('refuse un accès sans jeton', async () => {
      // Ces fichiers étaient auparavant servis en statique, sans aucun contrôle.
      const res = await request(app.getHttpServer()).get(
        `${prefix}/files/proofs/${fileId}`,
      );
      expect(res.status).toBe(401);
    });

    it('laisse le livreur relire la preuve qu’il a déposée', async () => {
      const res = await request(app.getHttpServer())
        .get(`${prefix}/files/proofs/${fileId}`)
        .set('Authorization', `Bearer ${courierToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
      // Donnée personnelle : aucun cache intermédiaire.
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('autorise l’encadrement, qui traite les litiges', async () => {
      const res = await request(app.getHttpServer())
        .get(`${prefix}/files/proofs/${fileId}`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
    });

    it('refuse un client étranger à la livraison', async () => {
      const res = await request(app.getHttpServer())
        .get(`${prefix}/files/proofs/${fileId}`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FILE_ACCESS_DENIED');
    });

    it('renvoie 404 pour un fichier inexistant', async () => {
      const res = await request(app.getHttpServer())
        .get(`${prefix}/files/proofs/${randomUUID()}`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(404);
    });

    it('rejette un identifiant mal formé plutôt que de toucher au disque', async () => {
      // Le paramètre est validé comme UUID : une tentative de traversée
      // n'atteint jamais la couche de stockage.
      const res = await request(app.getHttpServer())
        .get(`${prefix}/files/proofs/${encodeURIComponent('../../etc/passwd')}`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toMatch(/ENOENT|passwd|prisma/i);
    });
  });
});
