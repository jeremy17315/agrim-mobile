// Mock VIRTUEL du client généré : il n'existe pas hors CI (produit par
// `prisma generate`). Les valeurs d'énumération sont celles du schéma —
// les assertions restent des comparaisons de valeurs réelles.
jest.mock('../../../generated/prisma/client', () => ({
  StockMovementType: {
    ENTREE: 'ENTREE',
    SORTIE: 'SORTIE',
    AJUSTEMENT: 'AJUSTEMENT',
    COMMANDE: 'COMMANDE',
    ANNULATION: 'ANNULATION',
    RETOUR: 'RETOUR',
  },
}), { virtual: true });

import { StockMovementType } from '../../../generated/prisma/client';

import {
  releaseStockForOrder,
  reserveStockForOrder,
  StockReservationError,
} from './reserve-stock';
import { fakeStockTx } from './stock-tx.fake';

/**
 * Primitives de stock SSOT (`reserve-stock.ts`) — tests unitaires.
 *
 * Le faux Prisma (`stock-tx.fake.ts`) évalue RÉELLEMENT les clauses
 * conditionnelles : ce que ces tests prouvent, ce sont les garanties du
 * pattern — condition dans le WHERE, journal véridique, tri déterministe —
 * pas le fait d'avoir appelé des méthodes. La course à cent requêtes
 * simultanées exige un vrai PostgreSQL : c'est T-CONC-01
 * (docs/refonte/09 § 7, suite e2e), pas un mock.
 */

const LOCKED_BASE = {
  price: 2250,
  weightGrams: 5000,
  label: 'Sac de 5 kg',
  productName: 'Riz Djassa',
};

function lockedVariante(
  id: string,
  over: Partial<{ stock: number; isAvailable: boolean; productActive: boolean }> = {},
) {
  return {
    id,
    stock: 10,
    isAvailable: true,
    productActive: true,
    ...over,
    ...LOCKED_BASE,
  };
}

describe('reserveStockForOrder', () => {
  it('décrémente et journalise : compteur, chaîne stockBefore→stockAfter, référence', async () => {
    const { tx, etat, mouvements } = fakeStockTx({ stocks: { v1: 10 } });
    const locked = new Map([['v1', lockedVariante('v1', { stock: 10 })]]);

    await reserveStockForOrder(
      tx,
      locked,
      [{ variantId: 'v1', quantity: 3 }],
      'AGR-2026-0001',
    );

    expect(etat.stocks.v1).toBe(7);
    expect(mouvements).toHaveLength(1);
    expect(mouvements[0]).toMatchObject({
      variantId: 'v1',
      type: StockMovementType.COMMANDE,
      quantity: -3,
      stockBefore: 10,
      stockAfter: 7,
      reference: 'AGR-2026-0001',
      actorId: null,
    });
  });

  it('refuse au-delà du stock disponible (erreur typée INSUFFICIENT_STOCK), sans rien écrire', async () => {
    const { tx, etat, mouvements } = fakeStockTx({ stocks: { v1: 2 } });
    const locked = new Map([['v1', lockedVariante('v1', { stock: 2 })]]);

    await expect(
      reserveStockForOrder(
        tx,
        locked,
        [{ variantId: 'v1', quantity: 5 }],
        'AGR-2026-0001',
      ),
    ).rejects.toThrow(StockReservationError);

    expect(etat.stocks.v1).toBe(2); // inchangé — le rollback est affaire de transaction, pas du primitive
    expect(mouvements).toHaveLength(0);
  });

  it('refuse une variante indisponible (VARIANT_UNAVAILABLE)', async () => {
    const { tx, mouvements } = fakeStockTx({ stocks: { v1: 10 } });
    const locked = new Map([
      ['v1', lockedVariante('v1', { stock: 10, isAvailable: false })],
    ]);

    await expect(
      reserveStockForOrder(
        tx,
        locked,
        [{ variantId: 'v1', quantity: 1 }],
        'AGR-2026-0001',
      ),
    ).rejects.toMatchObject({ code: 'VARIANT_UNAVAILABLE' });
    expect(mouvements).toHaveLength(0);
  });

  it('refuse une variante sous un produit désactivé (VARIANT_UNAVAILABLE)', async () => {
    const { tx } = fakeStockTx({ stocks: { v1: 10 } });
    const locked = new Map([
      ['v1', lockedVariante('v1', { stock: 10, productActive: false })],
    ]);

    await expect(
      reserveStockForOrder(
        tx,
        locked,
        [{ variantId: 'v1', quantity: 1 }],
        'AGR-2026-0001',
      ),
    ).rejects.toMatchObject({ code: 'VARIANT_UNAVAILABLE' });
  });

  it('refuse une variante absente du verrou (VARIANT_NOT_FOUND)', async () => {
    const { tx } = fakeStockTx({ stocks: {} });
    const locked = new Map();

    await expect(
      reserveStockForOrder(
        tx,
        locked,
        [{ variantId: 'ghost', quantity: 1 }],
        'AGR-2026-0001',
      ),
    ).rejects.toMatchObject({ code: 'VARIANT_NOT_FOUND' });
  });

  it('traite les lignes dans l’ordre des ids, quel que soit l’ordre reçu', async () => {
    const { tx, mouvements } = fakeStockTx({
      stocks: { vb: 5, va: 5, vc: 5 },
    });
    const locked = new Map([
      ['va', lockedVariante('va', { stock: 5 })],
      ['vb', lockedVariante('vb', { stock: 5 })],
      ['vc', lockedVariante('vc', { stock: 5 })],
    ]);

    await reserveStockForOrder(
      tx,
      locked,
      [
        { variantId: 'vc', quantity: 1 },
        { variantId: 'va', quantity: 1 },
        { variantId: 'vb', quantity: 1 },
      ],
      'AGR-2026-0002',
    );

    expect(mouvements.map((m) => m.variantId)).toEqual(['va', 'vb', 'vc']);
  });
});

describe('releaseStockForOrder', () => {
  it('recrédite et journalise avec l’auteur de l’annulation', async () => {
    const { tx, etat, mouvements } = fakeStockTx({ stocks: { v1: 7 } });

    await releaseStockForOrder(
      tx,
      [{ variantId: 'v1', quantity: 3 }],
      'AGR-2026-0001',
      'user-1',
    );

    expect(etat.stocks.v1).toBe(10);
    expect(mouvements[0]).toMatchObject({
      variantId: 'v1',
      type: StockMovementType.ANNULATION,
      quantity: 3,
      stockBefore: 7,
      stockAfter: 10,
      reference: 'AGR-2026-0001',
      actorId: 'user-1',
    });
  });

  it('ignore sans planter une variante supprimée entre-temps', async () => {
    const { tx, mouvements } = fakeStockTx({ stocks: {} });

    await expect(
      releaseStockForOrder(
        tx,
        [{ variantId: 'ghost', quantity: 3 }],
        'AGR-2026-0001',
      ),
    ).resolves.toBeUndefined();
    expect(mouvements).toHaveLength(0);
  });

  it('groupe correctement : deux restitutions successives s’additionnent', async () => {
    const { tx, etat, mouvements } = fakeStockTx({ stocks: { v1: 4 } });

    await releaseStockForOrder(tx, [{ variantId: 'v1', quantity: 2 }], 'R1');
    await releaseStockForOrder(tx, [{ variantId: 'v1', quantity: 2 }], 'R2');

    expect(etat.stocks.v1).toBe(8);
    expect(mouvements).toHaveLength(2);
    expect(mouvements[1]).toMatchObject({ stockBefore: 6, stockAfter: 8 });
  });
});
