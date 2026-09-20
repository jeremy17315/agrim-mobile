import type { Prisma } from '../../../generated/prisma/client';

/**
 * Prisma en mémoire pour les tests de stock — un ÉTAT, pas des retours figés.
 *
 * Pourquoi un faux avec état plutôt que des `jest.fn()`
 * ─────────────────────────────────────────────────────
 * Tout ce que le stock garantit repose sur des écritures CONDITIONNELLES :
 * `WHERE status IN (…)` pour l'annulation, `WHERE stock >= q` pour le
 * retrait. Un `jest.fn()` qui renvoie toujours `{ count: 1 }` ne prouverait
 * rien de ces conditions — il prouverait seulement qu'on les a appelées.
 *
 * Ce faux évalue donc réellement les clauses et tient les quantités à jour.
 * C'est ce qui permet à un test de vérifier qu'un second appelant repart les
 * mains vides, et que `stockBefore`/`stockAfter` décrivent la réalité.
 *
 * Partagé par les suites qui touchent au stock : trois copies d'un tel faux
 * finiraient par diverger, et c'est exactement le défaut que ce lot corrige
 * dans le code de production.
 */

export interface FakeOrder {
  id: string;
  reference: string;
  status: string;
  /** Clé d'idempotence, qui sert aussi de clé de réservation côté site. */
  idempotencyKey?: string;
}

export interface FakeLine {
  variantId: string;
  quantity: number;
}

export interface FakeMovement {
  variantId: string;
  type: string;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  reason: string | null;
  reference: string | null;
  actorId: string | null;
}

export interface FakeStockTxOptions {
  order?: FakeOrder;
  items?: FakeLine[];
  /** Stock de départ par variante. Absent = variante inconnue. */
  stocks?: Record<string, number>;
}

function correspond(
  courant: string,
  clause?: { in?: string[]; notIn?: string[] },
): boolean {
  if (!clause) return true;
  if (clause.in) return clause.in.includes(courant);
  if (clause.notIn) return !clause.notIn.includes(courant);
  return true;
}

export function fakeStockTx(options: FakeStockTxOptions = {}) {
  const etat = {
    order: options.order
      ? { idempotencyKey: 'idem-key-1', ...options.order }
      : {
          id: 'order-1',
          reference: 'AGR-2026-0001',
          status: 'PENDING',
          idempotencyKey: 'idem-key-1',
        },
    stocks: { ...(options.stocks ?? {}) },
  };
  const items = options.items ?? [];
  const mouvements: FakeMovement[] = [];

  const tx = {
    order: {
      findUnique: jest.fn(async () => ({
        reference: etat.order.reference,
        // Clé de la réservation posée chez le site : c'est elle que
        // l'appelant libérera.
        idempotencyKey: etat.order.idempotencyKey,
      })),
      update: jest.fn(async (args: { data: { status: string } }) => {
        etat.order.status = args.data.status;
        return {};
      }),
      updateMany: jest.fn(
        async (args: {
          where: { status?: { in?: string[] } };
          data: { status: string };
        }) => {
          if (!correspond(etat.order.status, args.where.status)) {
            return { count: 0 };
          }
          etat.order.status = args.data.status;
          return { count: 1 };
        },
      ),
    },
    orderItem: { findMany: jest.fn(async () => items) },
    orderEvent: { create: jest.fn(async () => ({})) },
    productVariant: {
      updateMany: jest.fn(
        async (args: {
          where: { id: string; stock?: { gte?: number } };
          data: { stock: { increment?: number; decrement?: number } };
        }) => {
          const courant = etat.stocks[args.where.id];
          if (courant === undefined) return { count: 0 };
          const plancher = args.where.stock?.gte;
          // La clause du WHERE, évaluée pour de vrai : c'est elle qui empêche
          // un stock négatif, et c'est donc elle qu'il faut simuler.
          if (plancher !== undefined && courant < plancher) return { count: 0 };
          const delta = (args.data.stock.increment ?? 0) -
            (args.data.stock.decrement ?? 0);
          etat.stocks[args.where.id] = courant + delta;
          return { count: 1 };
        },
      ),
      findUniqueOrThrow: jest.fn(async (args: { where: { id: string } }) => {
        const stock = etat.stocks[args.where.id];
        if (stock === undefined) throw new Error(`variante ${args.where.id}`);
        return { stock };
      }),
    },
    stockMovement: {
      create: jest.fn(async (args: { data: FakeMovement }) => {
        mouvements.push({ ...args.data });
        return { ...args.data };
      }),
    },
  };

  return { tx: tx as unknown as Prisma.TransactionClient, etat, mouvements, brut: tx };
}
