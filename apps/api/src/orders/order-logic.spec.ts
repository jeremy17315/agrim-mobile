import { canTransition, type OrderStatus } from '@agrim/contracts';

import {
  applicableCredit,
  computeCartTotals,
  computeLineTotal,
} from './cart-totals';
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
      credit: 0,
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
      credit: 0,
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
      credit: 0,
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

  // ── Crédit de parrainage (16 octobre 2026) ────────────────────────────
  // Le crédit était incrémenté et affiché, mais n'entrait dans AUCUN total :
  // le parrain ne pouvait pas le dépenser. Ces règles-là sont celles qui le
  // rendent dépensable, et elles vivent dans le contrat PARTAGÉ — mobile et
  // API ne peuvent donc pas diverger sur ce que le client doit.

  it('soustrait le crédit parrainage du total', () => {
    const t = computeCartTotals([{ unitPrice: 6_000, quantity: 1 }], {
      credit: 1_000,
    });
    expect(t).toEqual({
      subtotal: 6_000,
      remise: 0,
      credit: 1_000,
      deliveryFee: 0,
      total: 5_000,
    });
  });

  it('ne consomme QUE ce qui reste à payer : un crédit plus gros n’est pas perdu', () => {
    const t = computeCartTotals([{ unitPrice: 1_000, quantity: 1 }], {
      credit: 5_000,
    });
    // 1 000 consommés — pas 5 000. Le reste demeure sur le compte et servira à
    // la commande suivante : l'application ne « rend » jamais la monnaie d'un
    // avoir.
    expect(t.credit).toBe(1_000);
    expect(t.total).toBe(0);
  });

  it('empile remise et crédit sans passer sous zéro', () => {
    const t = computeCartTotals([{ unitPrice: 10_000, quantity: 1 }], {
      remise: 8_000,
      credit: 8_000,
    });
    expect(t.remise).toBe(8_000);
    expect(t.credit).toBe(2_000);
    expect(t.total).toBe(0);
  });

  it('un solde négatif ou un panier nul n’augmente jamais la facture', () => {
    expect(applicableCredit(-500, 6_000)).toBe(0);
    expect(applicableCredit(1_000, 0)).toBe(0);
    expect(applicableCredit(0, 6_000)).toBe(0);
    const t = computeCartTotals([{ unitPrice: 6_000, quantity: 1 }], {
      credit: -500,
    });
    expect(t.credit).toBe(0);
    expect(t.total).toBe(6_000);
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
