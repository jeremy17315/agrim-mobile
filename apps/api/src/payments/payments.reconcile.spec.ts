/**
 * Le bug corrigé, mis sous test.
 *
 * Un paiement mobile money abandonné laissait sa commande en attente et son
 * stock décrémenté POUR TOUJOURS : l'expiration écrivait `EXPIRED` sans passer
 * par `settle()`, seule fonction qui rende la marchandise au rayon. Et comme
 * rien ne balayait les paiements en attente, l'expiration elle-même ne se
 * déclenchait que si le client rouvrait son écran.
 *
 * L'audit des fondations (août 2026) a montré que ce correctif n'était pas
 * encore sûr : relire le statut DANS la transaction ne suffit pas en READ
 * COMMITTED, l'isolation par défaut de Prisma. Le webhook du fournisseur et le
 * balayage de réconciliation pouvaient lire tous deux « en attente » et rendre
 * le stock tous deux. Le règlement se fait désormais par bascule
 * conditionnelle — voir `common/stock/order-stock.ts` — et ces tests gardent
 * les deux invariants : le stock revient, et il ne revient qu'une fois.
 *
 * Test unitaire et non e2e : il vérifie une DÉCISION (qui rend le stock, et
 * quand), pas une intégration. Il tourne donc sans PostgreSQL, ce qui est
 * précisément ce qu'on veut d'un test qui garde un invariant d'argent.
 */
// La chaîne d'imports traverse `prisma.client`, qui exige `DATABASE_URL` dès
// son chargement. Aucune connexion n'est ouverte ici — le PrismaService est
// entièrement simulé — mais la variable doit exister, comme dans les suites e2e.
import 'dotenv/config';

import { ConfigService } from '@nestjs/config';

import type { CatalogSyncService } from '../catalog-sync/catalog-sync.service';
import { fakeStockTx } from '../common/stock/stock-tx.fake';
import { PaymentsService } from './payments.service';
import type { PaymentProvider } from './payment.provider';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';

type AnyFn = jest.Mock;

/** Commande à deux lignes, pour prouver que CHAQUE ligne est recréditée. */
const ORDER = {
  id: 'order-1',
  reference: 'AGR-2026-0001',
  userId: 'user-1',
  status: 'PENDING',
  items: [
    { variantId: 'variant-a', quantity: 2 },
    { variantId: 'variant-b', quantity: 3 },
  ],
};

/** Stock de départ de chaque variante, généreux : rien ne doit buter dessus. */
const STOCK_INITIAL = 100;

/**
 * Prisma en mémoire, avec un ÉTAT.
 *
 * Le socle « commande + stock » vient de `fakeStockTx`, partagé avec les
 * suites de `common/stock` : la restitution passe désormais par le même point
 * de passage, et un faux divergent ferait passer ici des tests que la
 * production ne tiendrait pas. On n'ajoute au-dessus que le paiement.
 *
 * Les `updateMany` y sont simulés avec leur vrai contrat : ils n'écrivent que
 * si la clause de statut correspond, et renvoient le nombre de lignes
 * touchées. C'est ce détail qui porte tout le mécanisme d'exclusion — des
 * `jest.fn()` à retour figé ne prouveraient rien de la course entre le webhook
 * et le balayage, qui est précisément ce qu'on cherche à garder ici.
 */
function makeHarness(
  paymentStatus = 'AWAITING_CONFIRMATION',
  orderStatus = ORDER.status,
) {
  const socle = fakeStockTx({
    order: { id: ORDER.id, reference: ORDER.reference, status: orderStatus },
    items: ORDER.items,
    stocks: Object.fromEntries(
      ORDER.items.map((i) => [i.variantId, STOCK_INITIAL]),
    ),
  });

  const etatPaiement = { status: paymentStatus };

  const tx = {
    ...socle.brut,
    payment: {
      findUnique: jest.fn(async () => ({
        id: 'pay-1',
        status: etatPaiement.status,
        order: { ...ORDER, status: socle.etat.order.status },
      })),
      updateMany: jest.fn(
        async (args: {
          where: { status?: { notIn?: string[] } };
          data: { status: string };
        }) => {
          const interdits = args.where.status?.notIn;
          if (interdits?.includes(etatPaiement.status)) return { count: 0 };
          etatPaiement.status = args.data.status;
          return { count: 1 };
        },
      ),
    },
  };

  /** Vue unifiée, pour que les tests parlent d'états et non d'appels. */
  const etat = {
    get payment() {
      return etatPaiement.status;
    },
    get order() {
      return socle.etat.order.status;
    },
    get stocks() {
      return socle.etat.stocks;
    },
  };

  const prisma = {
    db: {
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      // Exécute le callback comme le ferait Prisma, avec notre `tx`.
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    },
  } as unknown as PrismaService;

  const notifications = {
    notify: jest.fn().mockResolvedValue(undefined),
    notifyOrderStatus: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationsService;

  const gateway = {
    name: 'simulation',
    callbackIsProof: false,
    isConfigured: () => true,
    initiate: jest.fn(),
    verify: jest.fn(),
    readCallback: jest.fn(),
  } as unknown as PaymentProvider;

  const config = new ConfigService({});

  // La libération du stock est un appel au SITE : simulé ici, et observé par
  // les tests qui vérifient qu'il part une seule fois.
  const catalog = {
    releaseStock: jest.fn(async () => ({ status: 'ok', body: {} })),
  } as unknown as CatalogSyncService;

  const service = new PaymentsService(
    prisma,
    notifications,
    config,
    catalog,
    gateway,
  );

  return {
    service,
    prisma,
    tx,
    notifications,
    gateway,
    etat,
    mouvements: socle.mouvements,
    catalog,
  };
}

describe('PaymentsService.reconcilePending', () => {
  const now = new Date('2026-08-27T12:00:00.000Z');
  const passe = new Date('2026-08-27T11:00:00.000Z');
  const futur = new Date('2026-08-27T13:00:00.000Z');

  it('rend le stock quand un paiement expire', async () => {
    const { service, prisma, etat, catalog } = makeHarness();
    (prisma.db.payment.findMany as AnyFn).mockResolvedValue([
      { id: 'pay-1', expiresAt: passe, providerReference: 'TX-1' },
    ]);

    const result = await service.reconcilePending(now);

    expect(result.expired).toBe(1);

    // Le cœur du correctif : le stock revient au rayon. Depuis le 29 août
    // 2026 il est retenu par le SITE, donc ce qu'on observe n'est plus un
    // compteur local mais l'ORDRE donné au site de le rendre — une fois, avec
    // la clé de la réservation.
    expect(catalog.releaseStock).toHaveBeenCalledTimes(1);
    expect(catalog.releaseStock).toHaveBeenCalledWith('idem-key-1');
    // Et la copie locale n'a pas bougé : deux compteurs, c'est le défaut
    // qu'on supprime.
    expect(etat.stocks).toEqual({
      'variant-a': STOCK_INITIAL,
      'variant-b': STOCK_INITIAL,
    });

    // La commande atteint bien un état terminal, au lieu de rester en attente
    // indéfiniment.
    expect(etat.order).toBe('CANCELLED');
    expect(etat.payment).toBe('EXPIRED');
  });

  it('ne demande AUCUNE libération quand la commande était déjà annulée', async () => {
    // Deuxième garde contre la double libération : le perdant de la bascule
    // ne renvoie pas de clé, donc rien ne part au site.
    const { service, prisma, catalog } = makeHarness(
      'AWAITING_CONFIRMATION',
      'CANCELLED',
    );
    (prisma.db.payment.findMany as AnyFn).mockResolvedValue([
      { id: 'pay-1', expiresAt: passe, providerReference: 'TX-1' },
    ]);

    await service.reconcilePending(now);

    expect(catalog.releaseStock).not.toHaveBeenCalled();
  });

  it('journalise la restitution comme une annulation, sans auteur', async () => {
    // Le journal doit pouvoir expliquer plus tard pourquoi le rayon a regagné
    // cinq sacs. « Système » est la bonne réponse ici : aucun humain n'a
    // annulé, c'est le délai de paiement qui a expiré.
    const { service, prisma, mouvements } = makeHarness();
    (prisma.db.payment.findMany as AnyFn).mockResolvedValue([
      { id: 'pay-1', expiresAt: passe, providerReference: 'TX-1' },
    ]);

    await service.reconcilePending(now);

    expect(mouvements).toHaveLength(2);
    expect(mouvements[0]).toMatchObject({
      type: 'ANNULATION',
      quantity: 2,
      reference: ORDER.reference,
      actorId: null,
    });
  });

  it('prévient le client plutôt que de le laisser dans le noir', async () => {
    const { service, prisma, notifications } = makeHarness();
    (prisma.db.payment.findMany as AnyFn).mockResolvedValue([
      { id: 'pay-1', expiresAt: passe, providerReference: 'TX-1' },
    ]);

    await service.reconcilePending(now);

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PAYMENT_FAILED', userId: ORDER.userId }),
    );
  });

  it('interroge le fournisseur tant que le délai court encore', async () => {
    const { service, prisma, gateway, etat, mouvements } = makeHarness();
    (prisma.db.payment.findMany as AnyFn).mockResolvedValue([
      { id: 'pay-1', expiresAt: futur, providerReference: 'TX-1' },
    ]);
    (gateway.verify as AnyFn).mockResolvedValue({
      status: 'PAID',
      message: 'Paiement confirmé.',
    });

    const result = await service.reconcilePending(now);

    expect(gateway.verify).toHaveBeenCalledWith('TX-1');
    expect(result.resolved).toBe(1);
    // Un paiement réussi ne rend RIEN : la marchandise part chez le client.
    expect(mouvements).toEqual([]);
    expect(etat.order).toBe('CONFIRMED');
    expect(etat.payment).toBe('SUCCEEDED');
  });

  it('ne règle pas deux fois un paiement déjà tranché', async () => {
    // Idempotence : le paiement se règle par bascule conditionnelle, donc deux
    // balayages concurrents ne peuvent pas recréditer le stock deux fois.
    const { service, prisma, tx, mouvements } = makeHarness('SUCCEEDED');
    (prisma.db.payment.findMany as AnyFn).mockResolvedValue([
      { id: 'pay-1', expiresAt: passe, providerReference: 'TX-1' },
    ]);

    await service.reconcilePending(now);

    expect(mouvements).toEqual([]);
    expect(tx.orderEvent.create).not.toHaveBeenCalled();
  });

  it('ne rend pas le stock une seconde fois si la commande est déjà annulée', async () => {
    // La course que l'audit a mise au jour : gagner sur le PAIEMENT ne dit
    // rien de la COMMANDE. Un client qui vient d'annuler a déjà rendu le
    // stock ; l'expiration du paiement ne doit pas le rendre une fois de plus,
    // sans quoi le rayon gagne des sacs qui n'existent pas.
    const { service, prisma, tx, etat, mouvements } = makeHarness(
      'AWAITING_CONFIRMATION',
      'CANCELLED',
    );
    (prisma.db.payment.findMany as AnyFn).mockResolvedValue([
      { id: 'pay-1', expiresAt: passe, providerReference: 'TX-1' },
    ]);

    const result = await service.reconcilePending(now);

    // Le paiement, lui, est bien clos : il ne doit pas rester en attente.
    expect(result.expired).toBe(1);
    expect(etat.payment).toBe('EXPIRED');
    // Mais rien ne revient au rayon, et aucun second événement d'annulation
    // n'est écrit dans le journal de la commande.
    expect(mouvements).toEqual([]);
    expect(tx.orderEvent.create).not.toHaveBeenCalled();
  });

  it('poursuit le balayage quand un paiement échoue', async () => {
    // Un incident isolé ne doit pas laisser tous les paiements suivants
    // bloqués — ce serait reproduire la panne que ce job vient corriger.
    const { service, prisma, gateway } = makeHarness();
    (prisma.db.payment.findMany as AnyFn).mockResolvedValue([
      { id: 'pay-ko', expiresAt: futur, providerReference: 'TX-KO' },
      { id: 'pay-1', expiresAt: passe, providerReference: 'TX-1' },
    ]);
    (gateway.verify as AnyFn).mockRejectedValue(new Error('réseau'));

    const result = await service.reconcilePending(now);

    expect(result.expired).toBe(1);
  });
});
