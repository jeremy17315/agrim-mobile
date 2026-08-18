/**
 * Tests d'intégration du carnet d'adresses.
 * L'enjeu principal est l'isolation : le carnet d'un client ne doit jamais
 * être lisible ni modifiable par un autre.
 */
import 'dotenv/config';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';

describe('Adresses (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prefix = '/api/v1';

  let token: string;
  let otherToken: string;
  let userId: string;
  const created: string[] = [];

  const validAddress = {
    label: 'Maison',
    city: 'Yamoussoukro',
    commune: 'Habitat',
    district: 'Quartier Millionnaire',
    landmark: 'En face de la pharmacie du Rond-point',
    contactPhone: '0700000001',
  };

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

    const mine = await login('0700000001');
    token = mine.accessToken;
    userId = mine.user.id;
    otherToken = (await login('0700000002')).accessToken;

    // La base de dev est partagée entre les suites : on part d'un carnet vide
    // pour que les assertions sur l'adresse par défaut soient déterministes,
    // quel que soit l'ordre d'exécution. Les adresses déjà rattachées à une
    // commande sont conservées (contrainte d'intégrité).
    const removable = await prisma.db.address.findMany({
      where: { userId, orders: { none: {} } },
      select: { id: true },
    });
    if (removable.length > 0) {
      await prisma.db.address.deleteMany({
        where: { id: { in: removable.map((a) => a.id) } },
      });
    }
  });

  afterAll(async () => {
    if (created.length > 0) {
      await prisma.db.address.deleteMany({ where: { id: { in: created } } });
    }
    await app.close();
    delete process.env.THROTTLE_DISABLED;
  });

  const post = (body: Record<string, unknown>, bearer = token) =>
    request(app.getHttpServer())
      .post(`${prefix}/addresses`)
      .set('Authorization', `Bearer ${bearer}`)
      .send(body);

  const track = (id: string) => {
    created.push(id);
    return id;
  };

  it('refuse l’accès sans authentification', async () => {
    const res = await request(app.getHttpServer()).get(`${prefix}/addresses`);
    expect(res.status).toBe(401);
  });

  it('crée une adresse avec point de repère', async () => {
    const res = await post(validAddress);
    expect(res.status).toBe(201);
    track(res.body.id);

    expect(res.body.landmark).toBe(validAddress.landmark);
    expect(res.body.city).toBe('Yamoussoukro');
    // Pas de GPS fourni : le champ reste nul, aucune permission n'est requise.
    expect(res.body.latitude).toBeNull();
  });

  it('rend la première adresse du carnet par défaut sans le demander', async () => {
    const list = await request(app.getHttpServer())
      .get(`${prefix}/addresses`)
      .set('Authorization', `Bearer ${token}`);

    // Une adresse par défaut existe forcément dès la première création, sinon
    // le tunnel de commande n'aurait rien à présélectionner.
    const defaults = list.body.filter(
      (a: { isDefault: boolean }) => a.isDefault,
    );
    expect(defaults).toHaveLength(1);
  });

  it('bascule l’adresse par défaut sans en laisser deux', async () => {
    const first = await post({ ...validAddress, label: 'A', isDefault: true });
    track(first.body.id);
    const second = await post({ ...validAddress, label: 'B', isDefault: true });
    track(second.body.id);

    const list = await request(app.getHttpServer())
      .get(`${prefix}/addresses`)
      .set('Authorization', `Bearer ${token}`);

    const defaults = list.body.filter(
      (a: { isDefault: boolean }) => a.isDefault,
    );
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(second.body.id);
    // L'adresse par défaut est présentée en tête de liste.
    expect(list.body[0].id).toBe(second.body.id);
  });

  it('rejette un numéro de téléphone invalide', async () => {
    const res = await post({ ...validAddress, contactPhone: '12' });
    expect(res.status).toBe(400);
  });

  it('rejette un champ inconnu', async () => {
    const res = await post({ ...validAddress, userId: 'autre-utilisateur' });
    expect(res.status).toBe(400);
  });

  it('ne liste que mes propres adresses', async () => {
    const mine = await post({ ...validAddress, label: 'Privée' });
    track(mine.body.id);

    const theirs = await request(app.getHttpServer())
      .get(`${prefix}/addresses`)
      .set('Authorization', `Bearer ${otherToken}`);

    const ids = theirs.body.map((a: { id: string }) => a.id);
    expect(ids).not.toContain(mine.body.id);
  });

  it('empêche la modification de l’adresse d’un autre client', async () => {
    const mine = await post({ ...validAddress, label: 'Cible' });
    track(mine.body.id);

    const res = await request(app.getHttpServer())
      .put(`${prefix}/addresses/${mine.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ ...validAddress, label: 'Détournée' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ADDRESS_NOT_FOUND');
  });

  it('modifie une adresse et vide les champs retirés', async () => {
    const address = await post({ ...validAddress, label: 'À corriger' });
    track(address.body.id);

    const res = await request(app.getHttpServer())
      .put(`${prefix}/addresses/${address.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'Corrigée',
        city: 'Abidjan',
        contactPhone: '0757665527',
      });

    expect(res.status).toBe(200);
    expect(res.body.label).toBe('Corrigée');
    expect(res.body.city).toBe('Abidjan');
    expect(res.body.landmark).toBeNull();
  });

  it('supprime une adresse inutilisée', async () => {
    const address = await post({ ...validAddress, label: 'Jetable' });
    const id = address.body.id as string;

    const res = await request(app.getHttpServer())
      .delete(`${prefix}/addresses/${id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    const still = await prisma.db.address.findUnique({ where: { id } });
    expect(still).toBeNull();
  });

  it('conserve une adresse déjà rattachée à une commande', async () => {
    const address = await post({ ...validAddress, label: 'Historique' });
    const id = track(address.body.id as string);

    const variant = await prisma.db.productVariant.findFirstOrThrow({
      where: { isAvailable: true },
      select: { id: true },
    });

    const order = await request(app.getHttpServer())
      .post(`${prefix}/orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        addressId: id,
        items: [{ variantId: variant.id, quantity: 1 }],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: crypto.randomUUID(),
      });
    expect(order.status).toBe(201);

    const res = await request(app.getHttpServer())
      .delete(`${prefix}/addresses/${id}`)
      .set('Authorization', `Bearer ${token}`);

    // Supprimer effacerait l'adresse de livraison d'une commande passée :
    // on la déclasse au lieu de casser l'historique.
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(false);
    expect(res.body.reason).toBe('USED_BY_ORDER');

    const still = await prisma.db.address.findUnique({ where: { id } });
    expect(still).not.toBeNull();

    await prisma.db.order.deleteMany({ where: { id: order.body.id } });
  });

  it('n’attribue jamais une adresse à un autre utilisateur', async () => {
    const res = await post(validAddress);
    track(res.body.id);

    const stored = await prisma.db.address.findUniqueOrThrow({
      where: { id: res.body.id },
      select: { userId: true },
    });
    expect(stored.userId).toBe(userId);
  });
});
