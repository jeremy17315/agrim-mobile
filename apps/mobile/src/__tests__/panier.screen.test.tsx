import type { Product, ProductVariant } from '@agrim/contracts';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { useCartStore } from '@/store/cart';

// Le test NE PEUT PAS vivre dans app/ : expo-router traite tout fichier de ce
// dossier comme une route et Metro tenterait de bundler la bibliothèque de
// test dans l'application.
import PanierScreen from '../../app/(tabs)/panier';

/**
 * L'écran panier affiche de l'argent : on vérifie que ce que voit le client
 * correspond à l'état du store, et que les gestes de base fonctionnent.
 */

// Préfixe `mock` obligatoire : jest.mock est hissé avant les déclarations.
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const NB = '\u202F';

const product: Product = {
  id: 'p1',
  slug: 'royal-grains',
  name: 'RIZ BOAGNI Royal Grains',
  shortDescription: null,
  description: null,
  brand: 'RIZ BOAGNI',
  imageUrl: null,
  category: { id: 'c1', slug: 'royal-grains', name: 'Royal Grains' },
  isFeatured: false,
  isActive: true,
  variants: [],
};

const variant: ProductVariant = {
  id: 'v-5000',
  sku: 'BOAGNI-ROYAL-5000',
  weightGrams: 5000,
  label: '5 kg',
  price: 6000,
  originalPrice: null,
  stock: 100,
  isAvailable: true,
};

beforeEach(() => {
  mockPush.mockClear();
  useCartStore.setState({ items: [], hydrated: true });
});

it('invite à parcourir le catalogue quand le panier est vide', () => {
  render(<PanierScreen />);

  expect(screen.getByText('Votre panier est vide')).toBeTruthy();

  fireEvent.press(screen.getByText('Voir le catalogue'));
  expect(mockPush).toHaveBeenCalledWith('/catalogue');
});

it('n’annonce pas un panier vide avant la relecture du stockage', () => {
  useCartStore.setState({ items: [], hydrated: false });
  render(<PanierScreen />);

  expect(screen.queryByText('Votre panier est vide')).toBeNull();
});

it('affiche la ligne, son total et le récapitulatif', () => {
  useCartStore.getState().addItem(product, variant, 2);
  render(<PanierScreen />);

  expect(screen.getByText('RIZ BOAGNI Royal Grains')).toBeTruthy();
  // 2 x 6 000 = 12 000 F, sous le seuil : 1 000 F de livraison.
  expect(screen.getAllByText(`12${NB}000${NB}F`).length).toBeGreaterThan(0);
  expect(screen.getAllByText(`13${NB}000${NB}F`).length).toBeGreaterThan(0);
});

it('incrémente la quantité depuis la ligne', () => {
  useCartStore.getState().addItem(product, variant, 1);
  render(<PanierScreen />);

  fireEvent.press(screen.getByLabelText('Augmenter la quantité'));
  expect(useCartStore.getState().items[0]?.quantity).toBe(2);
});

it('retire la ligne via la corbeille', () => {
  useCartStore.getState().addItem(product, variant, 1);
  render(<PanierScreen />);

  fireEvent.press(
    screen.getByLabelText('Retirer RIZ BOAGNI Royal Grains 5 kg'),
  );
  expect(useCartStore.getState().items).toHaveLength(0);
});

it('affiche le reste à atteindre pour la livraison offerte', () => {
  useCartStore.getState().addItem(product, variant, 2); // 12 000 F
  render(<PanierScreen />);

  expect(screen.getByText(/Plus que/)).toBeTruthy();
  // 13 000 F apparaît aussi comme total : on vérifie la présence, pas l'unicité.
  expect(screen.getAllByText(`13${NB}000${NB}F`).length).toBeGreaterThan(0);
});

it('signale la livraison offerte au-delà du seuil', () => {
  useCartStore.getState().addItem(product, { ...variant, price: 30_000 }, 1);
  render(<PanierScreen />);

  expect(
    screen.getByText('Livraison offerte : le seuil est atteint.'),
  ).toBeTruthy();
  expect(screen.getByText('Offerte')).toBeTruthy();
});
