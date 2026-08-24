import type { Product, ProductVariant } from '@agrim/contracts';

import {
  MAX_QUANTITY_PER_LINE,
  selectAmountUntilFreeDelivery,
  selectItemCount,
  selectTotals,
  useCartStore,
} from './cart';

/**
 * Le panier manipule de l'argent : chaque règle est verrouillée par un test.
 * Une erreur ici se traduit par un montant faux affiché au client.
 */

const product: Product = {
  id: 'p1',
  slug: 'royal-grains',
  name: 'RIZ BOAGNI Royal Grains',
  shortDescription: null,
  description: null,
  brand: 'RIZ BOAGNI',
  imageUrl: null,
  category: { id: 'c1', slug: 'royal-grains', name: 'Royal Grains' },
  isFeatured: true,
  isActive: true,
  variants: [],
};

const v5kg: ProductVariant = {
  id: 'v-5000',
  sku: 'BOAGNI-ROYAL-5000',
  weightGrams: 5000,
  label: '5 kg',
  price: 6000,
  originalPrice: null,
  stock: 200,
  isAvailable: true,
};

const v900g: ProductVariant = {
  id: 'v-900',
  sku: 'BOAGNI-ROYAL-900',
  weightGrams: 900,
  label: '900 g',
  price: 1200,
  originalPrice: null,
  stock: 200,
  isAvailable: true,
};

beforeEach(() => {
  useCartStore.setState({ items: [], hydrated: true });
});

describe('ajout au panier', () => {
  it('crée une ligne avec le prix et le format retenus', () => {
    useCartStore.getState().addItem(product, v5kg);
    const [line] = useCartStore.getState().items;

    expect(line?.variantId).toBe('v-5000');
    expect(line?.unitPrice).toBe(6000);
    expect(line?.variantLabel).toBe('5 kg');
    expect(line?.quantity).toBe(1);
  });

  it('cumule au lieu de dupliquer quand le format est déjà présent', () => {
    const { addItem } = useCartStore.getState();
    addItem(product, v5kg);
    addItem(product, v5kg, 2);

    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0]?.quantity).toBe(3);
  });

  it('distingue deux formats du même produit', () => {
    const { addItem } = useCartStore.getState();
    addItem(product, v5kg);
    addItem(product, v900g);

    expect(useCartStore.getState().items).toHaveLength(2);
  });

  it('borne la quantité au stock disponible', () => {
    useCartStore.getState().addItem(product, { ...v5kg, stock: 3 }, 10);
    expect(useCartStore.getState().items[0]?.quantity).toBe(3);
  });

  it('borne la quantité au plafond par ligne', () => {
    useCartStore.getState().addItem(product, v5kg, 500);
    expect(useCartStore.getState().items[0]?.quantity).toBe(
      MAX_QUANTITY_PER_LINE,
    );
  });
});

describe('modification des quantités', () => {
  beforeEach(() => {
    useCartStore.getState().addItem(product, v5kg, 2);
  });

  it('incrémente et décrémente', () => {
    useCartStore.getState().increment('v-5000');
    expect(useCartStore.getState().items[0]?.quantity).toBe(3);

    useCartStore.getState().decrement('v-5000');
    expect(useCartStore.getState().items[0]?.quantity).toBe(2);
  });

  it('retire la ligne quand on décrémente en dessous de 1', () => {
    useCartStore.getState().setQuantity('v-5000', 1);
    useCartStore.getState().decrement('v-5000');

    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('retire la ligne quand la quantité passe à zéro', () => {
    useCartStore.getState().setQuantity('v-5000', 0);
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('ignore une quantité fractionnaire', () => {
    useCartStore.getState().setQuantity('v-5000', 3.7);
    expect(useCartStore.getState().items[0]?.quantity).toBe(3);
  });

  it('supprime une ligne explicitement', () => {
    useCartStore.getState().removeItem('v-5000');
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('vide entièrement le panier', () => {
    useCartStore.getState().addItem(product, v900g);
    useCartStore.getState().clear();
    expect(useCartStore.getState().items).toHaveLength(0);
  });
});

describe('totaux', () => {
  it('facture la livraison sous le seuil', () => {
    useCartStore.getState().addItem(product, v5kg, 2); // 12 000 F
    const totals = selectTotals(useCartStore.getState());

    expect(totals.subtotal).toBe(12_000);
    expect(totals.deliveryFee).toBe(1000);
    expect(totals.total).toBe(13_000);
  });

  it('offre la livraison au seuil exact de 25 000 F', () => {
    useCartStore.getState().addItem(product, { ...v5kg, price: 25_000 });
    const totals = selectTotals(useCartStore.getState());

    expect(totals.subtotal).toBe(25_000);
    expect(totals.deliveryFee).toBe(0);
    expect(totals.total).toBe(25_000);
  });

  it('n’applique aucun frais sur un panier vide', () => {
    expect(selectTotals(useCartStore.getState())).toEqual({
      subtotal: 0,
      deliveryFee: 0,
      total: 0,
    });
  });

  it('additionne plusieurs lignes', () => {
    const { addItem } = useCartStore.getState();
    addItem(product, v5kg, 2); // 12 000
    addItem(product, v900g, 3); // 3 600

    expect(selectTotals(useCartStore.getState()).subtotal).toBe(15_600);
  });

  it('ne produit que des entiers : jamais de centime de franc', () => {
    const { addItem } = useCartStore.getState();
    addItem(product, v5kg, 3);
    addItem(product, v900g, 7);

    const totals = selectTotals(useCartStore.getState());
    expect(Number.isInteger(totals.subtotal)).toBe(true);
    expect(Number.isInteger(totals.total)).toBe(true);
  });
});

describe('progression vers la livraison offerte', () => {
  it('indique le montant restant', () => {
    useCartStore.getState().addItem(product, v5kg, 2); // 12 000
    expect(selectAmountUntilFreeDelivery(useCartStore.getState())).toBe(13_000);
  });

  it('retourne zéro une fois le seuil atteint', () => {
    useCartStore.getState().addItem(product, { ...v5kg, price: 30_000 });
    expect(selectAmountUntilFreeDelivery(useCartStore.getState())).toBe(0);
  });
});

describe('compteur d’articles', () => {
  it('somme les quantités, pas les lignes', () => {
    const { addItem } = useCartStore.getState();
    addItem(product, v5kg, 2);
    addItem(product, v900g, 3);

    expect(selectItemCount(useCartStore.getState())).toBe(5);
  });
});
