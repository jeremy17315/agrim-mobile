import { canTransition, type OrderStatus } from '@agrim/contracts';

import { computeCartTotals, computeLineTotal } from './cart-totals';
import { formatOrderReference } from './order-reference';

describe('Référence de commande', () => {
  it('formate au standard AGR-YYYY-NNNN', () => {
    expect(formatOrderReference(2026, 1)).toBe('AGR-2026-0001');
    expect(formatOrderReference(2026, 42)).toBe('AGR-2026-0042');
  });

  it('ne tronque pas au-delà de 9999 commandes', () => {
    expect(formatOrderReference(2026, 12345)).toBe('AGR-2026-12345');
  });

  it('rejette les entrées invalides', () => {
    expect(() => formatOrderReference(2026, 0)).toThrow();
    expect(() => formatOrderReference(1999, 1)).toThrow();
  });
});

describe('Calculs du panier', () => {
  // Logique du SITE, vérifiée sur agrimsarl.ci le 2 octobre 2026 : aucun
  // frais de livraison n'est ajouté au total payable, de la mise au panier
  // jusqu'au bouton « Payer ». Le seul intrant qui puisse baisser le total
  // est une REMISE — volume, grossiste ou code promo, tous décidés là-bas.

  it('calcule le total d’une ligne', () => {
    expect(computeLineTotal({ unitPrice: 6000, quantity: 3 })).toBe(18_000);
  });

  it('n’ajoute AUCUN frais de livraison au total', () => {
    const t = computeCartTotals([{ unitPrice: 6000, quantity: 2 }]);
    expect(t).toEqual({
      subtotal: 12_000,
      remise: 0,
      deliveryFee: 0,
      total: 12_000,
    });
  });

  it('soustrait la remise décidée par le site', () => {
    const t = computeCartTotals(
      [{ unitPrice: 10_000, quantity: 2 }],
      { remise: 1_000 },
    );
    expect(t).toEqual({
      subtotal: 20_000,
      remise: 1_000,
      deliveryFee: 0,
      total: 19_000,
    });
  });

  it('ne laisse jamais un total descendre sous zéro', () => {
    // Une remise trop généreuse (ou périmée) ne doit pas PAYER le client.
    const t = computeCartTotals([{ unitPrice: 500, quantity: 1 }], {
      remise: 999_999,
    });
    expect(t.total).toBe(0);
    expect(t.remise).toBe(500);
  });

  it('ne facture rien sur un panier vide', () => {
    expect(computeCartTotals([], { remise: 1_000 })).toEqual({
      subtotal: 0,
      remise: 0,
      deliveryFee: 0,
      total: 0,
    });
  });

  it('reste exact en XOF entier (aucun arrondi flottant)', () => {
    const t = computeCartTotals(
      [
        { unitPrice: 1200, quantity: 7 },
        { unitPrice: 800, quantity: 3 },
      ],
      { remise: 800 },
    );
    expect(t.subtotal).toBe(10_800);
    expect(t.total).toBe(10_000);
    expect(Number.isInteger(t.total)).toBe(true);
  });

  it('rejette une quantité nulle ou négative', () => {
    expect(() => computeLineTotal({ unitPrice: 1000, quantity: 0 })).toThrow();
    expect(() => computeLineTotal({ unitPrice: 1000, quantity: -2 })).toThrow();
  });
});

describe('Machine à états des commandes', () => {
  it('autorise le flux nominal', () => {
    const flow: OrderStatus[] = [
      'PENDING',
      'CONFIRMED',
      'PREPARING',
      'READY',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ];
    flow.slice(0, -1).forEach((s, i) => {
      expect(canTransition(s, flow[i + 1])).toBe(true);
    });
  });

  it('interdit les sauts d\u2019étape', () => {
    expect(canTransition('PENDING', 'DELIVERED')).toBe(false);
    expect(canTransition('CONFIRMED', 'OUT_FOR_DELIVERY')).toBe(false);
  });

  it('rend les états terminaux définitifs', () => {
    expect(canTransition('DELIVERED', 'CANCELLED')).toBe(false);
    expect(canTransition('CANCELLED', 'CONFIRMED')).toBe(false);
  });

  it('permet l\u2019annulation avant la livraison', () => {
    expect(canTransition('PENDING', 'CANCELLED')).toBe(true);
    expect(canTransition('OUT_FOR_DELIVERY', 'CANCELLED')).toBe(true);
  });
});
