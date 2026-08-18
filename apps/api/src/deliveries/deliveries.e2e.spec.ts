/**
 * Tests d'intégration de l'espace livreur.
 *
 * Enjeux vérifiés ici, impossibles à couvrir en unitaire :
 *  - un livreur ne voit ni ne touche les courses d'un autre ;
 *  - aucune livraison ne se valide sans preuve ;
 *  - la commande suit la course sans jamais reculer.
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

describe('Livraisons (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prefix = '/api/v1';

  let clientToken: string;
  let courierToken: string;
  let managerToken: string;
  let courierId: string;
  let otherCourierId: string;
  let addressId: string;
  let variantId: string;

  const orderIds: string[] = [];
  const addressIds: string[] = [];
  const fileIds: string[] = [];

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

    const client = await login('0700000001');
    clientToken = client.accessToken;

    const courier = await login('0700000002');
    courierToken = courier.accessToken;
    courierId = courier.user.id;

    // 0700000004 = GESTIONNAIRE. 0700000005 est ADMIN : l'utiliser ici
    // laisserait le rôle de gestion sans aucune couverture.
    managerToken = (await login('0700000004')).accessToken;

    // Second livreur, pour prouver l'isolation entre tournées.
    const other = await prisma.db.user.findFirst({
      where: { role: 'LIVREUR', id: { not: courierId } },
      select: { id: true },
    });
    otherCourierId =
      other?.id ??
      (
        await prisma.db.user.create({
          data: {
            firstName: 'Autre',
            lastName: 'Livreur',
            phone: '0700009999',
            // Ce livreur ne sert qu'à vérifier le cloisonnement des courses.
            // Empreinte réelle : une chaîne arbitraire ferait lever argon2 à
            // la connexion. Le compte reste actif, sans quoi il ne serait plus
            // assignable et les tests d'isolation perdraient leur objet.
            passwordHash: await (await import('argon2')).hash('Agrim2026!'),
            role: 'LIVREUR',
          },
          select: { id: true },
        })
      ).id;

    const address = await request(app.getHttpServer())
      .post(`${prefix}/addresses`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        label: 'Test livraison',
        city: 'Yamoussoukro',
        landmark: 'En face de la pharmacie',
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
      data: { stock: 500 },
    });
  });

  afterAll(async () => {
    if (orderIds.length > 0) {
      await prisma.db.order.deleteMany({ where: { id: { in: orderIds } } });
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

  /** Crée une commande cliente et renvoie sa référence. */
  const createOrder = async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/orders`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        addressId,
        items: [{ variantId, quantity: 1 }],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: randomUUID(),
      });
    orderIds.push(res.body.id);
    return res.body.reference as string;
  };

  const assign = (reference: string, to = courierId, bearer = managerToken) =>
    request(app.getHttpServer())
      .post(`${prefix}/deliveries/orders/${reference}/assign`)
      .set('Authorization', `Bearer ${bearer}`)
      .send({ courierId: to });

  const setStatus = (
    id: string,
    status: string,
    extra: Record<string, unknown> = {},
    bearer = courierToken,
  ) =>
    request(app.getHttpServer())
      .patch(`${prefix}/deliveries/${id}/status`)
      .set('Authorization', `Bearer ${bearer}`)
      .send({ status, ...extra });

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

  /** Amène une course jusqu'à IN_TRANSIT, prête à recevoir une preuve. */
  const deliveryInTransit = async () => {
    const reference = await createOrder();
    const assigned = await assign(reference);
    const id = assigned.body.id as string;
    await setStatus(id, 'ACCEPTED');
    await setStatus(id, 'PICKED_UP');
    await setStatus(id, 'IN_TRANSIT');
    return { id, reference };
  };

  /* ------------------------------ Habilitations ------------------------- */

  it('refuse la tournée à un client', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/deliveries/mine`)
      .set('Authorization', `Bearer ${clientToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_ROLE');
  });

  it('refuse l’affectation à un livreur', async () => {
    const reference = await createOrder();
    const res = await assign(reference, courierId, courierToken);

    // Affecter relève du gestionnaire : un livreur ne se donne pas du travail.
    expect(res.status).toBe(403);
  });

  it('refuse l’accès sans authentification', async () => {
    const res = await request(app.getHttpServer()).get(
      `${prefix}/deliveries/mine`,
    );
    expect(res.status).toBe(401);
  });

  /* ------------------------------ Affectation --------------------------- */

  it('affecte un livreur et place la course en ASSIGNED', async () => {
    const reference = await createOrder();
    const res = await assign(reference);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ASSIGNED');
    expect(res.body.order.reference).toBe(reference);
    expect(res.body.assignedAt).not.toBeNull();
  });

  it('rejette un livreur inexistant', async () => {
    const reference = await createOrder();
    const res = await assign(reference, randomUUID());

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COURIER_NOT_FOUND');
  });

  it('refuse d’affecter un utilisateur qui n’est pas livreur', async () => {
    const client = await prisma.db.user.findFirstOrThrow({
      where: { phone: '0700000001' },
      select: { id: true },
    });
    const reference = await createOrder();
    const res = await assign(reference, client.id);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COURIER_NOT_FOUND');
  });

  it('refuse de réassigner une course déjà acceptée', async () => {
    const reference = await createOrder();
    const assigned = await assign(reference);
    await setStatus(assigned.body.id, 'ACCEPTED');

    const res = await assign(reference, otherCourierId);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DELIVERY_ALREADY_STARTED');
  });

  /* -------------------------------- Isolation --------------------------- */

  it('ne montre au livreur que ses propres courses', async () => {
    const reference = await createOrder();
    const assigned = await assign(reference, otherCourierId);

    const mine = await request(app.getHttpServer())
      .get(`${prefix}/deliveries/mine`)
      .set('Authorization', `Bearer ${courierToken}`);

    const ids = mine.body.map((d: { id: string }) => d.id);
    expect(ids).not.toContain(assigned.body.id);
  });

  it('empêche un livreur de faire avancer la course d’un autre', async () => {
    const reference = await createOrder();
    const assigned = await assign(reference, otherCourierId);

    const res = await setStatus(assigned.body.id, 'ACCEPTED');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('DELIVERY_NOT_FOUND');
  });

  /* ------------------------------ Transitions --------------------------- */

  it('suit le parcours nominal jusqu’à la livraison', async () => {
    const reference = await createOrder();
    const assigned = await assign(reference);
    const id = assigned.body.id as string;

    expect((await setStatus(id, 'ACCEPTED')).body.status).toBe('ACCEPTED');
    expect((await setStatus(id, 'PICKED_UP')).body.status).toBe('PICKED_UP');
    expect((await setStatus(id, 'IN_TRANSIT')).body.status).toBe('IN_TRANSIT');

    const signatureFileId = await createFile();
    await request(app.getHttpServer())
      .post(`${prefix}/deliveries/${id}/proof`)
      .set('Authorization', `Bearer ${courierToken}`)
      .send({
        methods: ['SIGNATURE'],
        signatureFileId,
        receivedBy: 'Awa Koné',
      });

    const delivered = await setStatus(id, 'DELIVERED');
    expect(delivered.status).toBe(200);
    expect(delivered.body.status).toBe('DELIVERED');
    expect(delivered.body.deliveredAt).not.toBeNull();
  });

  it('interdit de sauter une étape', async () => {
    const reference = await createOrder();
    const assigned = await assign(reference);

    const res = await setStatus(assigned.body.id, 'DELIVERED');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_DELIVERY_TRANSITION');
  });

  it('exige un motif pour un échec', async () => {
    const { id } = await deliveryInTransit();

    const withoutReason = await setStatus(id, 'FAILED');
    expect(withoutReason.status).toBe(400);
    expect(withoutReason.body.code).toBe('FAILURE_REASON_REQUIRED');

    const withReason = await setStatus(id, 'FAILED', {
      failureReason: 'Client absent après deux appels',
    });
    expect(withReason.status).toBe(200);
    expect(withReason.body.failureReason).toContain('Client absent');
  });

  it('ferme définitivement une course échouée', async () => {
    const { id } = await deliveryInTransit();
    await setStatus(id, 'FAILED', { failureReason: 'Adresse introuvable' });

    const res = await setStatus(id, 'DELIVERED');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_DELIVERY_TRANSITION');
  });

  /* --------------------------------- Preuve ----------------------------- */

  it('refuse de valider une livraison sans preuve', async () => {
    const { id } = await deliveryInTransit();

    const res = await setStatus(id, 'DELIVERED');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROOF_REQUIRED');
  });

  it('accepte signature et photo combinées', async () => {
    const { id } = await deliveryInTransit();
    const signatureFileId = await createFile();
    const photoFileId = await createFile();

    const res = await request(app.getHttpServer())
      .post(`${prefix}/deliveries/${id}/proof`)
      .set('Authorization', `Bearer ${courierToken}`)
      .send({
        methods: ['SIGNATURE', 'PHOTO'],
        signatureFileId,
        photoFileId,
        receivedBy: 'Awa Koné',
        position: { latitude: 6.8276, longitude: -5.2893 },
      });

    expect(res.status).toBe(201);
    expect(res.body.proofMethods).toEqual(['SIGNATURE', 'PHOTO']);
    expect(res.body.proofSubmittedAt).not.toBeNull();
  });

  it('refuse une signature sans nom de réceptionnaire', async () => {
    const { id } = await deliveryInTransit();
    const signatureFileId = await createFile();

    const res = await request(app.getHttpServer())
      .post(`${prefix}/deliveries/${id}/proof`)
      .set('Authorization', `Bearer ${courierToken}`)
      .send({ methods: ['SIGNATURE'], signatureFileId });

    // Un tracé anonyme n'est exploitable dans aucun litige.
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PROOF');
  });

  it('refuse une méthode annoncée sans son fichier', async () => {
    const { id } = await deliveryInTransit();

    const res = await request(app.getHttpServer())
      .post(`${prefix}/deliveries/${id}/proof`)
      .set('Authorization', `Bearer ${courierToken}`)
      .send({ methods: ['PHOTO'] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PROOF');
  });

  it('refuse un fichier étranger aux méthodes retenues', async () => {
    const { id } = await deliveryInTransit();
    const signatureFileId = await createFile();
    const photoFileId = await createFile();

    // Photo prise puis abandonnée : elle ne doit pas être enregistrée comme
    // preuve d'une livraison validée par signature.
    const res = await request(app.getHttpServer())
      .post(`${prefix}/deliveries/${id}/proof`)
      .set('Authorization', `Bearer ${courierToken}`)
      .send({
        methods: ['SIGNATURE'],
        signatureFileId,
        photoFileId,
        receivedBy: 'Awa Koné',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PROOF');
  });

  it('rejette un identifiant de fichier inexistant', async () => {
    const { id } = await deliveryInTransit();

    const res = await request(app.getHttpServer())
      .post(`${prefix}/deliveries/${id}/proof`)
      .set('Authorization', `Bearer ${courierToken}`)
      .send({
        methods: ['PHOTO'],
        photoFileId: randomUUID(),
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROOF_FILE_NOT_FOUND');
  });

  it('refuse une preuve avant la récupération de la commande', async () => {
    const reference = await createOrder();
    const assigned = await assign(reference);
    await setStatus(assigned.body.id, 'ACCEPTED');
    const photoFileId = await createFile();

    const res = await request(app.getHttpServer())
      .post(`${prefix}/deliveries/${assigned.body.id}/proof`)
      .set('Authorization', `Bearer ${courierToken}`)
      .send({ methods: ['PHOTO'], photoFileId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DELIVERY_NOT_STARTED');
  });

  /* --------------------- Répercussion sur la commande ------------------- */

  it('passe la commande en livraison quand le livreur récupère le colis', async () => {
    const reference = await createOrder();
    const assigned = await assign(reference);
    await setStatus(assigned.body.id, 'ACCEPTED');
    await setStatus(assigned.body.id, 'PICKED_UP');

    const order = await request(app.getHttpServer())
      .get(`${prefix}/orders/${reference}`)
      .set('Authorization', `Bearer ${clientToken}`);

    expect(order.body.status).toBe('OUT_FOR_DELIVERY');
    // Le client doit voir l'étape apparaître dans sa chronologie.
    expect(
      order.body.events.some(
        (e: { status: string }) => e.status === 'OUT_FOR_DELIVERY',
      ),
    ).toBe(true);
  });

  it('marque la commande livrée à la fin de la course', async () => {
    const { id, reference } = await deliveryInTransit();
    const photoFileId = await createFile();

    await request(app.getHttpServer())
      .post(`${prefix}/deliveries/${id}/proof`)
      .set('Authorization', `Bearer ${courierToken}`)
      .send({ methods: ['PHOTO'], photoFileId });

    await setStatus(id, 'DELIVERED');

    const order = await request(app.getHttpServer())
      .get(`${prefix}/orders/${reference}`)
      .set('Authorization', `Bearer ${clientToken}`);

    expect(order.body.status).toBe('DELIVERED');
  });

  it('n’expose pas la commande d’un autre client au livreur', async () => {
    const reference = await createOrder();
    const assigned = await assign(reference);

    const detail = await request(app.getHttpServer())
      .get(`${prefix}/deliveries/${assigned.body.id}`)
      .set('Authorization', `Bearer ${courierToken}`);

    expect(detail.status).toBe(200);
    // Le livreur a besoin de l'adresse et des articles, pas de l'identité
    // complète ni de l'historique d'achat du client.
    expect(detail.body.order.userId).toBeUndefined();
    expect(detail.body.address.contactPhone).toBeDefined();
  });
});
