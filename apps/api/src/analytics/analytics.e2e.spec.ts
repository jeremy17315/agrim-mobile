/**
 * Tests d'intégration du tableau de bord de la direction.
 *
 * Enjeux vérifiés ici :
 *  - le périmètre de rôle : la direction voit tout, le gestionnaire non ;
 *  - une commande annulée ne gonfle jamais le chiffre d'affaires ;
 *  - les mois sans vente apparaissent à zéro plutôt que d'être omis ;
 *  - les parts par gamme totalisent exactement 100 %.
 */
import 'dotenv/config';

import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  averageBasket,
  distributionShares,
  growthRate,
  SALES_HISTORY_MONTHS,
} from '@agrim/contracts';

import { AppModule } from '../app.module';
import { configureApp } from '../bootstrap';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { CatalogSyncService } from '../catalog-sync/catalog-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { prisma as prismaClient } from '../prisma/prisma.client';
import {
  createSiteIntegrationDouble,
  referenceDeTest,
} from '../testing/site-integration.double';

type Dashboard = {
  month: string;
  monthLabel: string;
  revenueMonth: number;
  revenueGrowth: number | null;
  ordersMonth: number;
  ordersGrowth: number | null;
  newCustomers: number;
  averageBasket: number;
  lateDeliveries: number;
  lowStockCount: number;
  productionReceivedKg: number;
  pendingProductionReviews: number;
  sales: { month: string; label: string; revenue: number; orders: number }[];
  categories: {
    categoryId: string;
    name: string;
    revenue: number;
    share: number;
  }[];
};

describe('Direction générale (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prefix = '/api/v1';

  let dgToken: string;
  let managerToken: string;
  let adminToken: string;
  let clientToken: string;
  let courierToken: string;
  let addressId: string;
  let variantId: string;

  const orderIds: string[] = [];
  const addressIds: string[] = [];

  beforeAll(async () => {
    process.env.THROTTLE_DISABLED = '1';
    // Le SITE est un système externe : sans double, `POST /orders` répond 503
    // dès qu'il dort — juste en production, inexploitable en test. Le double
    // applique le MÊME contrat, décrément conditionnel du stock compris.
    // Voir `testing/site-integration.double.ts`.
    const site = createSiteIntegrationDouble({
      db: prismaClient,
    } as unknown as PrismaService);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    })
      .overrideProvider(CatalogSyncService)
      .useValue(site.service)
      .compile();

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

    dgToken = (await login('0700000006')).accessToken;
    // 0700000004 est le GESTIONNAIRE ; 0700000005 est ADMIN et a bien accès.
    managerToken = (await login('0700000004')).accessToken;
    adminToken = (await login('0700000005')).accessToken;
    clientToken = (await login('0700000001')).accessToken;
    courierToken = (await login('0700000002')).accessToken;

    const address = await request(app.getHttpServer())
      .post(`${prefix}/addresses`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        label: 'Test direction',
        city: 'Yamoussoukro',
        landmark: 'Près du marché',
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
      // Rattachement au site : sans `sourceRef`, la variante est invendable.
      data: { stock: 1000, sourceRef: referenceDeTest(variantId) },
    });
  });

  afterAll(async () => {
    if (orderIds.length > 0) {
      await prisma.db.notification.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await prisma.db.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (addressIds.length > 0) {
      await prisma.db.address.deleteMany({ where: { id: { in: addressIds } } });
    }
    await app.close();
    delete process.env.THROTTLE_DISABLED;
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const fetchDashboard = async (): Promise<Dashboard> => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/analytics/dashboard`)
      .set(auth(dgToken));
    expect(res.status).toBe(200);
    return res.body as Dashboard;
  };

  const createOrder = async (quantity = 1) => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/orders`)
      .set(auth(clientToken))
      .send({
        addressId,
        items: [{ variantId, quantity }],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: randomUUID(),
      });
    expect(res.status).toBe(201);
    orderIds.push(res.body.id);
    return res.body as { id: string; reference: string; total: number };
  };

  /* -------------------------------- Accès -------------------------------- */

  it('réserve les indicateurs à la direction', async () => {
    const parGestionnaire = await request(app.getHttpServer())
      .get(`${prefix}/analytics/dashboard`)
      .set(auth(managerToken));
    // Le gestionnaire pilote une file de travail, pas l'entreprise.
    expect(parGestionnaire.status).toBe(403);

    const parClient = await request(app.getHttpServer())
      .get(`${prefix}/analytics/dashboard`)
      .set(auth(clientToken));
    expect(parClient.status).toBe(403);

    const parLivreur = await request(app.getHttpServer())
      .get(`${prefix}/analytics/dashboard`)
      .set(auth(courierToken));
    expect(parLivreur.status).toBe(403);

    // L'administrateur, lui, y a accès.
    const parAdmin = await request(app.getHttpServer())
      .get(`${prefix}/analytics/dashboard`)
      .set(auth(adminToken));
    expect(parAdmin.status).toBe(200);
  });

  it('exige une authentification', async () => {
    const res = await request(app.getHttpServer()).get(
      `${prefix}/analytics/dashboard`,
    );
    expect(res.status).toBe(401);
  });

  /* ------------------------------ Structure ------------------------------ */

  it('renvoie un mois identifiable et un historique complet', async () => {
    const body = await fetchDashboard();

    expect(body.month).toMatch(/^\d{4}-\d{2}$/);
    expect(body.monthLabel).toBeTruthy();

    // Les mois sans vente valent zéro : un trou se lirait comme une donnée
    // manquante, pas comme une absence de commande.
    expect(body.sales).toHaveLength(SALES_HISTORY_MONTHS);
    for (const point of body.sales) {
      expect(point.month).toMatch(/^\d{4}-\d{2}$/);
      expect(point.revenue).toBeGreaterThanOrEqual(0);
      expect(point.orders).toBeGreaterThanOrEqual(0);
    }

    // Historique trié du plus ancien au plus récent, dernier point = mois courant.
    const keys = body.sales.map((p) => p.month);
    expect([...keys].sort()).toEqual(keys);
    expect(keys[keys.length - 1]).toBe(body.month);
  });

  it('ne renvoie aucun indicateur négatif', async () => {
    const body = await fetchDashboard();

    expect(body.revenueMonth).toBeGreaterThanOrEqual(0);
    expect(body.ordersMonth).toBeGreaterThanOrEqual(0);
    expect(body.newCustomers).toBeGreaterThanOrEqual(0);
    expect(body.averageBasket).toBeGreaterThanOrEqual(0);
    expect(body.lateDeliveries).toBeGreaterThanOrEqual(0);
    expect(body.lowStockCount).toBeGreaterThanOrEqual(0);
    expect(body.productionReceivedKg).toBeGreaterThanOrEqual(0);
    expect(body.pendingProductionReviews).toBeGreaterThanOrEqual(0);
  });

  /* ----------------------------- Cohérence ------------------------------- */

  it('incrémente le chiffre d’affaires du mois d’une nouvelle commande', async () => {
    const avant = await fetchDashboard();

    const order = await createOrder(2);

    const apres = await fetchDashboard();
    expect(apres.revenueMonth).toBe(avant.revenueMonth + order.total);
    expect(apres.ordersMonth).toBe(avant.ordersMonth + 1);

    // Le mois courant de l'historique suit le même mouvement.
    const pointAvant = avant.sales[avant.sales.length - 1]!;
    const pointApres = apres.sales[apres.sales.length - 1]!;
    expect(pointApres.revenue).toBe(pointAvant.revenue + order.total);
    expect(pointApres.orders).toBe(pointAvant.orders + 1);
  });

  it('retire une commande annulée du chiffre d’affaires', async () => {
    const order = await createOrder(1);
    const avant = await fetchDashboard();

    const cancelled = await request(app.getHttpServer())
      .post(`${prefix}/orders/${order.reference}/cancel`)
      .set(auth(clientToken))
      .send({});
    expect(cancelled.status).toBe(201);

    const apres = await fetchDashboard();
    // Une commande annulée n'a jamais produit de recette.
    expect(apres.revenueMonth).toBe(avant.revenueMonth - order.total);
    expect(apres.ordersMonth).toBe(avant.ordersMonth - 1);
  });

  it('calcule le panier moyen à partir des seules commandes retenues', async () => {
    const body = await fetchDashboard();
    expect(body.averageBasket).toBe(
      averageBasket(body.revenueMonth, body.ordersMonth),
    );
  });

  it('fait totaliser 100 % aux parts par gamme', async () => {
    await createOrder(1);
    const body = await fetchDashboard();

    expect(body.categories.length).toBeGreaterThan(0);
    const somme = body.categories.reduce((acc, row) => acc + row.share, 0);
    expect(somme).toBe(100);

    // Trié par chiffre d'affaires décroissant : la gamme qui pèse le plus vient
    // en premier.
    const revenus = body.categories.map((row) => row.revenue);
    expect([...revenus].sort((a, b) => b - a)).toEqual(revenus);

    // Le total des gammes correspond au chiffre d'affaires hors livraison.
    const totalGammes = body.categories.reduce(
      (acc, row) => acc + row.revenue,
      0,
    );
    expect(totalGammes).toBeGreaterThan(0);
    expect(totalGammes).toBeLessThanOrEqual(body.revenueMonth);
  });

  it('reflète l’état réel des alertes de stock', async () => {
    const variants = await prisma.db.productVariant.findMany({
      where: { isAvailable: true },
      select: { stock: true, lowStockThreshold: true },
    });
    const attendu = variants.filter(
      (v) => v.stock <= v.lowStockThreshold,
    ).length;

    const body = await fetchDashboard();
    expect(body.lowStockCount).toBe(attendu);
  });

  it('compte les déclarations de récolte en attente d’arbitrage', async () => {
    const attendu = await prisma.db.production.count({
      where: { status: { in: ['DECLARED', 'CONFIRMED'] } },
    });

    const body = await fetchDashboard();
    expect(body.pendingProductionReviews).toBe(attendu);
  });
});

/* ------------------------- Logique pure du contrat ------------------------ */

describe('Calculs de la direction', () => {
  it('refuse d’inventer une croissance depuis zéro', () => {
    // Passer de 0 à 100 000 n'est pas « +100 % » : c'est un point de départ.
    expect(growthRate(100_000, 0)).toBeNull();
    expect(growthRate(0, 0)).toBeNull();
  });

  it('calcule une variation signée à une décimale', () => {
    expect(growthRate(1_234, 1_000)).toBe(23.4);
    expect(growthRate(800, 1_000)).toBe(-20);
  });

  it('évite la division par zéro sur le panier moyen', () => {
    expect(averageBasket(0, 0)).toBe(0);
    expect(averageBasket(30_000, 4)).toBe(7_500);
  });

  it('reporte l’écart d’arrondi sur la part la plus élevée', () => {
    // 1/3 chacun : 33+33+33 = 99, le point manquant va au plus gros.
    const rows = distributionShares([
      { revenue: 100 },
      { revenue: 100 },
      { revenue: 101 },
    ]);
    expect(rows.reduce((acc, row) => acc + row.share, 0)).toBe(100);
    expect(rows[2]!.share).toBe(34);
  });

  it('renvoie des parts nulles quand il n’y a aucune vente', () => {
    const rows = distributionShares([{ revenue: 0 }, { revenue: 0 }]);
    expect(rows.every((row) => row.share === 0)).toBe(true);
  });
});
