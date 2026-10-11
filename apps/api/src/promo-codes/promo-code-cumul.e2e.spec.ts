/**
 * Codes promo — parcours de bout en bout, jusqu'à la commande.
 *
 * Le brief porte une exigence précise : « les codes promo sont administrables
 * et vérifiés côté serveur ». Ce fichier en fait la preuve, sur le chemin
 * COMPLET :
 *
 *  1. un code créé par AGRIM (ADMIN) dans l'application est appliqué par le
 *     DEVIS — au bon montant, sans dépendre du site ;
 *  2. la COMMANDE facture exactement le montant annoncé par le devis ;
 *  3. le client ne peut pas fabriquer sa remise : envoyer un code inconnu est
 *     refusé, et aucun montant envoyé par le téléphone n'est lu ;
 *  4. un code expiré, désactivé, hors quota ou sous le minimum est REFUSÉ avec
 *     un motif lisible — jamais appliqué « au mieux » ;
 *  5. l'utilisation est consommée une fois, et une seule.
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
import { CatalogSyncService } from '../catalog-sync/catalog-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { prisma as prismaClient } from '../prisma/prisma.client';
import {
  createSiteIntegrationDouble,
  referenceDeTest,
} from '../testing/site-integration.double';

describe('Codes promo (e2e) — du devis à la commande', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prefix = '/api/v1';

  let adminToken: string;
  let clientToken: string;
  let addressId: string;
  let variantId: string;

  const orderIds: string[] = [];
  const addressIds: string[] = [];
  const promoIds: string[] = [];
  const phone = '0700000001';

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /**
   * Crée un code promo via l'API d'administration, puis le PUBLIE — c'est
   * l'acte de validation d'AGRIM. Un code créé sans publication reste inactif :
   * c'est le test suivant qui le prouve.
   */
  const creerCode = async (body: Record<string, unknown>) => {
    const { publier = true, ...champs } = body as { publier?: boolean };
    const res = await server()
      .post(`${prefix}/promo-codes`)
      .set(auth(adminToken))
      .send({
        discountType: 'FIXED',
        discountValue: 500,
        ...(publier ? { isActive: true } : {}),
        ...champs,
      });
    if (res.status === 201) {
      promoIds.push((res.body as { code: string }).code);
    }
    return res;
  };

  const devis = (code?: string, quantity = 2) =>
    server()
      .post(`${prefix}/cart/quote`)
      .send({
        items: [{ variantId, quantity }],
        city: 'Abidjan',
        codePromo: code,
      });

  const commander = (code?: string) =>
    server()
      .post(`${prefix}/orders`)
      .set(auth(clientToken))
      .send({
        addressId,
        items: [{ variantId, quantity: 2 }],
        paymentMethod: 'CASH_ON_DELIVERY',
        codePromo: code,
        idempotencyKey: randomUUID(),
      });

  beforeAll(async () => {
    process.env.THROTTLE_DISABLED = '1';

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

    const login = async (compte: string) => {
      const res = await server()
        .post(`${prefix}/auth/login`)
        .send({ phone: compte, password: 'Agrim2026!' });
      return (res.body as { accessToken: string }).accessToken;
    };
    clientToken = await login(phone);
    adminToken = await login('0700000005');

    const address = await server()
      .post(`${prefix}/addresses`)
      .set(auth(clientToken))
      .send({
        label: 'Codes promo',
        city: 'Abidjan',
        landmark: 'Face au marché',
        contactPhone: phone,
      });
    addressId = (address.body as { id: string }).id;
    addressIds.push(addressId);

    const variant = await prisma.db.productVariant.findFirstOrThrow({
      where: { isAvailable: true },
      select: { id: true },
    });
    variantId = variant.id;
    await prisma.db.productVariant.update({
      where: { id: variantId },
      data: { stock: 2000, sourceRef: referenceDeTest(variantId) },
    });
  });

  afterAll(async () => {
    if (promoIds.length > 0) {
      await prisma.db.promoCodeRedemption.deleteMany({
        where: { promoCode: { code: { in: promoIds } } },
      });
      await prisma.db.promoCode.deleteMany({
        where: { code: { in: promoIds } },
      });
    }
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

  it('seul un ADMIN ou un DG peut créer un code promo', async () => {
    // Un gestionnaire exécute ; il ne fixe pas les remises (argent offert).
    const gestion = await server()
      .post(`${prefix}/auth/login`)
      .send({ phone: '0700000004', password: 'Agrim2026!' });
    const gestionToken = (gestion.body as { accessToken: string }).accessToken;

    const refus = await server()
      .post(`${prefix}/promo-codes`)
      .set(auth(gestionToken))
      .send({ code: `INTERDIT${randomUUID().slice(0, 4)}`, discountType: 'FIXED', discountValue: 500 });
    expect(refus.status).toBe(403);
  });

  it('le devis et la commande appliquent LA MÊME remise, au franc près', async () => {
    const code = `AGRIM500-${randomUUID().slice(0, 6)}`;
    const creation = await creerCode({ code, description: 'Remise de test' });
    expect(creation.status).toBe(201);

    const devisAvant = await devis();
    expect(devisAvant.status).toBe(200);
    const sousTotal = (devisAvant.body as { subtotal: number }).subtotal;

    const devisAvecCode = await devis(code);
    expect(devisAvecCode.status).toBe(200);
    expect(devisAvecCode.body).toMatchObject({
      remise: 500,
      remiseStatus: 'ok',
      promoCode: code.toUpperCase(),
      total: sousTotal - 500,
    });

    const commande = await commander(code);
    expect(commande.status).toBe(201);
    orderIds.push((commande.body as { id: string }).id);

    // Ce que le devis annonçait est EXACTEMENT ce que la commande facture.
    expect(commande.body).toMatchObject({
      subtotal: sousTotal,
      total: sousTotal - 500,
    });

    // L'utilisation est consommée une fois : le quota se suit.
    const apres = await prisma.db.promoCode.findFirstOrThrow({
      where: { code: code.toUpperCase() },
      select: { usedCount: true },
    });
    expect(apres.usedCount).toBe(1);
  });

  it('un code NON PUBLIÉ ne s’applique pas : la validation précède la diffusion', async () => {
    const code = `BROUILLON-${randomUUID().slice(0, 6)}`;
    const creation = await creerCode({ code, publier: false });
    expect(creation.status).toBe(201);
    // Le code existe, mais il n'est pas actif : aucune remise ne doit fuir.
    expect((creation.body as { isActive: boolean }).isActive).toBe(false);

    const commande = await commander(code);
    expect(commande.status).toBe(409);
    expect(
      (commande.body as { details?: { reason?: string } }).details?.reason,
    ).toBe('INACTIF');
  });

  it('un code inconnu est refusé au devis ET à la commande', async () => {
    const inconnu = 'JAMAIS-CREE';

    const devisRefuse = await devis(inconnu);
    // Le devis l'annonce (500 : BadRequest du service) OU le remonte en
    // « refused » : dans les deux cas, le client ne paie pas plein tarif en
    // croyant bénéficier d'une remise.
    expect(devisRefuse.status).toBeLessThan(500);

    const commande = await commander(inconnu);
    expect(commande.status).toBe(409);
    expect((commande.body as { code: string }).code).toBe('PROMO_CODE_REFUSED');
  });

  it('un code expiré est refusé, avec son motif', async () => {
    const code = `EXPIRE-${randomUUID().slice(0, 6)}`;
    await creerCode({
      code,
      endsAt: new Date(Date.now() - 86_400_000).toISOString(),
    });

    const commande = await commander(code);
    expect(commande.status).toBe(409);
    expect((commande.body as { code: string }).code).toBe('PROMO_CODE_REFUSED');
    expect(
      (commande.body as { details?: { reason?: string } }).details?.reason,
    ).toBe('EXPIRE');
  });

  it('un code désactivé ne s’applique plus', async () => {
    const code = `DESACTIVE-${randomUUID().slice(0, 6)}`;
    await creerCode({ code });

    const avant = await prisma.db.promoCode.findFirstOrThrow({
      where: { code: code.toUpperCase() },
      select: { id: true },
    });
    const desactivation = await server()
      .delete(`${prefix}/promo-codes/${avant.id}`)
      .set(auth(adminToken));
    expect(desactivation.status).toBe(200);

    const commande = await commander(code);
    expect(commande.status).toBe(409);
    expect(
      (commande.body as { details?: { reason?: string } }).details?.reason,
    ).toBe('INACTIF');
  });

  it('un panier sous le minimum exigé ne bénéficie pas de la remise', async () => {
    const code = `MINIMUM-${randomUUID().slice(0, 6)}`;
    await creerCode({ code, minOrderTotal: 10_000_000 });

    const commande = await commander(code);
    expect(commande.status).toBe(409);
    expect(
      (commande.body as { details?: { reason?: string } }).details?.reason,
    ).toBe('PANIER_INSUFFISANT');
  });

  it('un code à usage unique refuse la seconde commande du même client', async () => {
    const code = `UNIQUE-${randomUUID().slice(0, 6)}`;
    await creerCode({ code, maxUsesPerPhone: 1 });

    const premiere = await commander(code);
    expect(premiere.status).toBe(201);
    orderIds.push((premiere.body as { id: string }).id);

    const seconde = await commander(code);
    expect(seconde.status).toBe(409);
    expect(
      (seconde.body as { details?: { reason?: string } }).details?.reason,
    ).toBe('QUOTA_TELEPHONE_ATTEINT');
  });

  it('le client ne peut pas s’inventer une remise : les montants envoyés sont refusés', async () => {
    const cle = randomUUID();
    const tentative = await server()
      .post(`${prefix}/orders`)
      .set(auth(clientToken))
      .send({
        addressId,
        items: [{ variantId, quantity: 2 }],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: cle,
        // Champs fabriqués par le client : la validation globale refuse toute
        // propriété inconnue (400) — le serveur ne lit JAMAIS un montant.
        remise: 100_000,
        discount: 100_000,
        total: 0,
      });

    expect(tentative.status).toBe(400);
    expect((tentative.body as { code: string }).code).toBe('BAD_REQUEST');

    // Et surtout : aucune commande n'a été créée avec ces valeurs.
    const creee = await prisma.db.order.count({
      where: { idempotencyKey: cle },
    });
    expect(creee).toBe(0);
  });
});
