/**
 * Le bug corrigé, mis sous test.
 *
 * Un paiement mobile money abandonné laissait sa commande en attente et son
 * stock décrémenté POUR TOUJOURS : l'expiration écrivait `EXPIRED` sans passer
 * par `settle()`, seule fonction qui rende la marchandise au rayon. Et comme
 * rien ne balayait les paiements en attente, l'expiration elle-même ne se
 * déclenchait que si le client rouvrait son écran.
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

function makeHarness(paymentStatus = 'AWAITING_CONFIRMATION') {
  const tx = {
    payment: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'pay-1',
        status: paymentStatus,
        order: ORDER,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    order: { update: jest.fn().mockResolvedValue({}) },
    orderEvent: { create: jest.fn().mockResolvedValue({}) },
    productVariant: { update: jest.fn().mockResolvedValue({}) },
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

  const service = new PaymentsService(prisma, notifications, config, gateway);

  return { service, prisma, tx, notifications, gateway };
}

describe('PaymentsService.reconcilePending', () => {
  const now = new Date('2026-08-27T12:00:00.000Z');
  const passe = new Date('2026-08-27T11:00:00.000Z');
  const futur = new Date('2026-08-27T13:00:00.000Z');

  it('rend le stock quand un paiement expire', async () => {
    const { service, prisma, tx } = makeHarness();
    (prisma.db.payment.findMany as AnyFn).mockResolvedValue([
      { id: 'pay-1', expiresAt: passe, providerReference: 'TX-1' },
    ]);

    const result = await service.reconcilePending(now);

    expect(result.expired).toBe(1);

    // Le cœur du correctif : chaque ligne revient en rayon, à la bonne quantité.
    expect(tx.productVariant.update).toHaveBeenCalledTimes(2);
    expect(tx.productVariant.update).toHaveBeenCalledWith({
      where: { id: 'variant-a' },
      data: { stock: { increment: 2 } },
    });
    expect(tx.productVariant.update).toHaveBeenCalledWith({
      where: { id: 'variant-b' },
      data: { stock: { increment: 3 } },
    });

    // Et la commande atteint bien un état terminal, au lieu de rester en
    // attente indéfiniment.
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: ORDER.id },
      data: { status: 'CANCELLED' },
    });
    expect(tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'EXPIRED' }) }),
    );
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
    const { service, prisma, tx, gateway } = makeHarness();
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
    expect(tx.productVariant.update).not.toHaveBeenCalled();
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: ORDER.id },
      data: { status: 'CONFIRMED' },
    });
  });

  it('ne règle pas deux fois un paiement déjà tranché', async () => {
    // Idempotence : la relecture du statut a lieu DANS la transaction, donc
    // deux balayages concurrents ne peuvent pas recréditer le stock deux fois.
    const { service, prisma, tx } = makeHarness('SUCCEEDED');
    (prisma.db.payment.findMany as AnyFn).mockResolvedValue([
      { id: 'pay-1', expiresAt: passe, providerReference: 'TX-1' },
    ]);

    await service.reconcilePending(now);

    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.productVariant.update).not.toHaveBeenCalled();
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
