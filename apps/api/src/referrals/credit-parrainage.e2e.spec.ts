/**
 * Le crédit de parrainage, DÉPENSABLE — tests d'intégration contre la vraie
 * base PostgreSQL.
 *
 * ── Ce qui est prouvé ici, et qui ne peut pas l'être en unitaire ──────────
 * Le crédit était incrémenté à la livraison du filleul et affiché dans l'écran
 * Parrainage, mais il n'entrait dans aucun total : 1 000 F gagnés, jamais
 * dépensés. Cette suite éprouve le parcours réel — devis, commande, paiement,
 * annulation — contre la base, y compris les deux points où l'argent se perd
 * ou se crée s'ils sont mal placés :
 *
 *   1. la CONSOMMATION sous concurrence : deux commandes simultanées du même
 *      compte ne peuvent pas dépenser deux fois le même solde ;
 *   2. le REMBOURSEMENT à l'annulation, une seule fois, même si les trois
 *      chemins d'annulation (client, bureau, expiration du paiement) se
 *      disputent la même commande.
 *
 * Plus une règle de sécurité, vérifiée ici plutôt qu'affirmée : connaître le
 * numéro de téléphone d'un parrain ne donne PAS accès à son crédit.
 */
import 'dotenv/config';

import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { AppModule } from '../app.module';
import { configureApp } from '../bootstrap';
import { CatalogSyncService } from '../catalog-sync/catalog-sync.service';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { prisma as prismaClient } from '../prisma/prisma.client';
import { createSiteIntegrationDouble } from '../testing/site-integration.double';

describe('Crédit de parrainage (e2e)', () => {
  jest.setTimeout(60000);
  const prefix = '/api/v1';

  let app: INestApplication;
  let prisma: PrismaService;

  let token: string;
  let tokenGestion: string;
  let parrainId: string;
  let adresseId: string;
  let variantId: string;
  let variantPrice: number;

  /** Solde du compte de test avant la suite : rendu à l'identique à la fin. */
  let soldeInitial: number;

  const ordresCrees: string[] = [];
  const adressesCreees: string[] = [];

  const serveur = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.THROTTLE_DISABLED = '1';

    // Le site est un système externe : ses prix, sa grille et son stock sont
    // simulés par le double, qui applique le même contrat (voir orders.e2e).
    const double = createSiteIntegrationDouble({
      db: prismaClient,
    } as unknown as PrismaService);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    })
      .overrideProvider(CatalogSyncService)
      .useValue(double.service)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    configureApp(app, { isProd: false });
    await app.init();
    prisma = app.get(PrismaService);

    const connexion = await serveur()
      .post(`${prefix}/auth/login`)
      .send({ phone: '0700000001', password: 'Agrim2026!' });
    token = connexion.body.accessToken as string;

    // Le bureau annule par un AUTRE chemin que le client : c'est le même point
    // de passage unique qui doit rendre le crédit, au bon compte.
    const connexionGestion = await serveur()
      .post(`${prefix}/auth/login`)
      .send({ phone: '0700000004', password: 'Agrim2026!' });
    tokenGestion = connexionGestion.body.accessToken as string;

    const compte = await prisma.db.user.findUniqueOrThrow({
      where: { phone: '0700000001' },
      select: { id: true, creditBalanceXof: true },
    });
    parrainId = compte.id;
    soldeInitial = compte.creditBalanceXof;

    const adresse = await serveur()
      .post(`${prefix}/addresses`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'Test crédit parrainage',
        city: 'Yamoussoukro',
        commune: 'Habitat',
        landmark: 'Derrière la station',
        contactPhone: '0700000001',
      });
    adresseId = adresse.body.id;
    adressesCreees.push(adresseId);

    // Une variante VENDABLE, déjà rattachée au site (`sourceRef`) — sans quoi
    // aucune commande ne peut naître (`VARIANT_NOT_SYNCED`) et la suite
    // n'éprouverait rien — et dont le PRIX DÉPASSE le crédit testé.
    //
    // Le plancher de prix n'est pas cosmétique : le catalogue contient des
    // sachets à 500 F, et un panier moins cher que le crédit ferait jouer le
    // plafond « jamais plus que le reste à payer », brouillant les deux règles
    // que cette suite doit distinguer. L'ordre est EXPLICITE : sans `orderBy`,
    // PostgreSQL ne garantit aucun ordre et le test changerait de variante
    // selon les statistiques de la base partagée.
    const variante = await prisma.db.productVariant.findFirstOrThrow({
      where: { isAvailable: true, price: { gte: 5_000 }, sourceRef: { not: null } },
      orderBy: { price: 'asc' },
      select: { id: true, price: true },
    });
    variantId = variante.id;
    variantPrice = variante.price;
    expect(variantPrice).toBeGreaterThan(1_000);
    // Le stock est garanti ; `sourceRef` est laissé tel quel : d'autres suites
    // partagent cette variante, et la référence du site n'a pas à bouger.
    await prisma.db.productVariant.update({
      where: { id: variantId },
      data: { stock: 5_000 },
    });
  });

  afterAll(async () => {
    // Le solde du compte de test est REMIS à sa valeur d'origine : la base de
    // développement est partagée avec les autres suites.
    await prisma.db.user.update({
      where: { id: parrainId },
      data: { creditBalanceXof: soldeInitial },
    });

    const commandes = await prisma.db.order.findMany({
      where: { id: { in: ordresCrees } },
      select: { id: true, userId: true, addressId: true },
    });
    await prisma.db.notification.deleteMany({
      where: { orderId: { in: ordresCrees } },
    });
    await prisma.db.order.deleteMany({ where: { id: { in: ordresCrees } } });
    await prisma.db.address.deleteMany({
      where: {
        id: { in: [...adressesCreees, ...commandes.map((c) => c.addressId)] },
      },
    });
    // Les profils techniques créés pour les commandes invitées par cette suite.
    const invites = [...new Set(commandes.map((c) => c.userId))].filter(
      (id) => id !== parrainId,
    );
    if (invites.length > 0) {
      await prisma.db.user.deleteMany({ where: { id: { in: invites } } });
    }

    await app.close();
    delete process.env.THROTTLE_DISABLED;
  });

  /** Pose un solde de crédit connu : c'est la situation d'un parrain récompensé. */
  const poserSolde = async (montant: number) => {
    await prisma.db.user.update({
      where: { id: parrainId },
      data: { creditBalanceXof: montant },
    });
  };

  const lireSolde = async () => {
    const user = await prisma.db.user.findUniqueOrThrow({
      where: { id: parrainId },
      select: { creditBalanceXof: true },
    });
    return user.creditBalanceXof;
  };

  const commander = (corps: Record<string, unknown> = {}, bearer = token) =>
    serveur()
      .post(`${prefix}/orders`)
      .set('Authorization', `Bearer ${bearer}`)
      .send({
        addressId: adresseId,
        items: [{ variantId, quantity: 1 }],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: randomUUID(),
        ...corps,
      });

  const devis = (bearer?: string) => {
    const appel = serveur()
      .post(`${prefix}/cart/quote`)
      .send({ items: [{ variantId, quantity: 1 }], city: 'Yamoussoukro' });
    return bearer ? appel.set('Authorization', `Bearer ${bearer}`) : appel;
  };

  it('le devis applique le crédit du compte CONNECTÉ, et rien pour un visiteur', async () => {
    await poserSolde(1_000);

    const anonyme = await devis();
    expect(anonyme.status).toBe(200);
    // Un visiteur n'a pas de crédit. Le corps de la requête ne contient aucun
    // numéro de compte : rien ne pourrait le désigner.
    expect(anonyme.body.credit).toBe(0);
    expect(anonyme.body.creditBalanceXof).toBe(0);
    expect(anonyme.body.total).toBe(variantPrice);

    const connecte = await devis(token);
    expect(connecte.status).toBe(200);
    expect(connecte.body.credit).toBe(1_000);
    expect(connecte.body.creditBalanceXof).toBe(1_000);
    // Le devis annonce EXACTEMENT ce que la commande facturera.
    expect(connecte.body.total).toBe(variantPrice - 1_000);
  });

  it('la commande consomme le crédit : total réduit, paiement et solde à jour', async () => {
    await poserSolde(1_000);

    const res = await commander();
    expect(res.status).toBe(201);
    ordresCrees.push(res.body.id);

    expect(res.body.credit).toBe(1_000);
    expect(res.body.total).toBe(variantPrice - 1_000);
    expect(res.body.subtotal).toBe(variantPrice);

    // Le montant réclamé au client est le total APRÈS crédit — sinon le
    // client paierait deux fois, ou l'écart serait encaissé en silence.
    const paiement = await prisma.db.payment.findFirstOrThrow({
      where: { orderId: res.body.id },
      select: { amount: true, status: true },
    });
    expect(paiement.amount).toBe(variantPrice - 1_000);
    expect(paiement.status).toBe('PENDING');

    expect(await lireSolde()).toBe(0);
  });

  it('le crédit est plafonné au reste à payer : le surplus reste sur le compte', async () => {
    // Solde très supérieur au panier : le client ne doit PAS se voir rendre la
    // différence en monnaie, ni la perdre.
    await poserSolde(1_000_000);

    const res = await commander();
    expect(res.status).toBe(201);
    ordresCrees.push(res.body.id);

    expect(res.body.credit).toBe(variantPrice);
    expect(res.body.total).toBe(0);
    // 1 000 000 − ce qui a réellement servi (le prix de l'article).
    expect(await lireSolde()).toBe(1_000_000 - variantPrice);
  });

  it('annuler la commande REND le crédit au compte, une seule fois', async () => {
    await poserSolde(1_000);

    const commande = await commander();
    ordresCrees.push(commande.body.id);
    const reference = commande.body.reference as string;
    expect(await lireSolde()).toBe(0);

    const annulation = await serveur()
      .post(`${prefix}/orders/${reference}/cancel`)
      .set('Authorization', `Bearer ${token}`);
    expect(annulation.status).toBe(201);
    expect(annulation.body.status).toBe('CANCELLED');

    // Le crédit consommé est rendu : sans cela, le parrain perdrait son avoir
    // en même temps que sa commande.
    expect(await lireSolde()).toBe(1_000);

    const marque = await prisma.db.order.findUniqueOrThrow({
      where: { id: commande.body.id },
      select: { credit: true, creditRefundedAt: true },
    });
    expect(marque.credit).toBe(1_000);
    expect(marque.creditRefundedAt).toBeInstanceOf(Date);

    // Deuxième annulation (double-tap, ou webhook de paiement expiré) : refusée,
    // et le solde ne double pas.
    const seconde = await serveur()
      .post(`${prefix}/orders/${reference}/cancel`)
      .set('Authorization', `Bearer ${token}`);
    expect(seconde.status).toBe(409);
    expect(await lireSolde()).toBe(1_000);
  });

  it('une commande INVITÉE anonyme ne consomme aucun crédit, même avec le numéro d’un parrain', async () => {
    await poserSolde(1_000);

    const res = await serveur()
      .post(`${prefix}/orders/guest`)
      .send({
        customerName: 'Client Invité',
        // Le numéro du parrain est CONNU : c'est exactement le scénario d'abus
        // que cette règle doit arrêter.
        phone: '0700000001',
        deliveryLocation: 'Cocody, près du carrefour',
        items: [{ variantId, quantity: 1 }],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: randomUUID(),
      });
    expect(res.status).toBe(201);
    ordresCrees.push(res.body.id);

    // Aucun jeton : aucune session, donc aucun crédit. Un numéro déclaré ne
    // prouve rien — sinon le crédit de n'importe qui serait dépensable.
    expect(res.body.credit).toBe(0);
    expect(res.body.total).toBe(variantPrice);
    expect(await lireSolde()).toBe(1_000);
  });

  it('une commande invitée passée CONNECTÉE paie avec le crédit du compte', async () => {
    await poserSolde(1_000);

    // C'est le parcours réel du mobile : le tunnel invité (nom, téléphone,
    // zone) avec la session du client — son crédit doit servir.
    const res = await serveur()
      .post(`${prefix}/orders/guest`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName: 'Client Connecté',
        phone: '0700000001',
        deliveryLocation: 'Yamoussoukro, près du marché',
        items: [{ variantId, quantity: 1 }],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: randomUUID(),
      });
    expect(res.status).toBe(201);
    ordresCrees.push(res.body.id);

    expect(res.body.credit).toBe(1_000);
    expect(res.body.total).toBe(variantPrice - 1_000);
    expect(await lireSolde()).toBe(0);

    // Le crédit appartient au compte connecté, pas au profil technique de
    // livraison : c'est ce qui rend le remboursement possible à l'annulation.
    const fiche = await prisma.db.order.findUniqueOrThrow({
      where: { id: res.body.id },
      select: { creditUserId: true, userId: true },
    });
    expect(fiche.creditUserId).toBe(parrainId);
    expect(fiche.userId).not.toBe(parrainId);

    // Et l'annulation le rend bien au compte, malgré ce profil intermédiaire.
    //
    // Une commande invitée n'a AUCUNE route d'annulation côté client (ce
    // parcours n'ouvre que le paiement) : c'est le bureau qui annule. Le
    // remboursement doit donc trouver le compte du client à travers le profil
    // technique — sans `creditUserId`, ce crédit serait perdu pour de bon.
    const annulation = await serveur()
      .patch(`${prefix}/management/orders/${res.body.reference}/status`)
      .set('Authorization', `Bearer ${tokenGestion}`)
      .send({ status: 'CANCELLED' });
    expect(annulation.status).toBe(200);
    expect(await lireSolde()).toBe(1_000);
  });

  it('deux commandes simultanées ne dépensent pas deux fois le même crédit', async () => {
    // Un solde qui ne couvre QU'UNE seule des deux commandes.
    await poserSolde(1_000);

    const [a, b] = await Promise.all([
      commander({ items: [{ variantId, quantity: 2 }] }),
      commander({ items: [{ variantId, quantity: 2 }] }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    ordresCrees.push(a.body.id, b.body.id);

    // Le total du crédit réellement consommé est EXACTEMENT le solde : 1 000.
    // Deux milliers signifieraient de l'argent créé de nulle part.
    const consomme = (a.body.credit as number) + (b.body.credit as number);
    expect(consomme).toBe(1_000);
    expect(await lireSolde()).toBe(0);

    // Chaque commande facture ce qu'elle a réellement obtenu — les deux totaux
    // sont donc cohérents avec leur propre crédit, même inégaux entre eux.
    for (const reponse of [a, b]) {
      const paiement = await prisma.db.payment.findFirstOrThrow({
        where: { orderId: reponse.body.id },
        select: { amount: true },
      });
      expect(paiement.amount).toBe(reponse.body.total);
      expect(reponse.body.total).toBe(
        (reponse.body.subtotal as number) - (reponse.body.credit as number),
      );
    }
  });
});
