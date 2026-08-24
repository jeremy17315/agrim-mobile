import type { Product } from '@agrim/contracts';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { useCartStore } from '@/store/cart';

import ProductScreen from '../../app/produit/[slug]';

/** Espace insécable étroit produit par formatXof. */
const NB = ' ';

/**
 * Flux critique : depuis la fiche produit, choisir un format et une quantité,
 * puis ajouter au panier. C'est le geste qui déclenche tout le reste du
 * parcours d'achat ; il est testé de bout en bout côté client.
 */

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ slug: 'royal-grains' }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const product: Product = {
  id: 'p1',
  slug: 'royal-grains',
  name: 'RIZ BOAGNI Royal Grains',
  shortDescription: 'Pur riz local de luxe',
  description: null,
  brand: 'RIZ BOAGNI',
  imageUrl: null,
  category: { id: 'c1', slug: 'royal-grains', name: 'Royal Grains' },
  isFeatured: true,
  isActive: true,
  variants: [
    {
      id: 'v-900',
      sku: 'BOAGNI-ROYAL-900',
      weightGrams: 900,
      label: '900 g',
      price: 1200,
      originalPrice: null,
      stock: 50,
      isAvailable: true,
    },
    {
      id: 'v-5000',
      sku: 'BOAGNI-ROYAL-5000',
      weightGrams: 5000,
      label: '5 kg',
      price: 6000,
      originalPrice: null,
      stock: 20,
      isAvailable: true,
    },
    {
      id: 'v-22500',
      sku: 'BOAGNI-ROYAL-22500',
      weightGrams: 22500,
      label: '22,5 kg',
      price: 25_000,
      originalPrice: null,
      stock: 0,
      isAvailable: false,
    },
  ],
};

const mockUseProduct = jest.fn();
jest.mock('@/api/catalog', () => ({
  useProduct: (slug: string) => mockUseProduct(slug),
}));

beforeEach(() => {
  useCartStore.setState({ items: [], hydrated: true });
  mockUseProduct.mockReturnValue({
    data: product,
    isPending: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  });
});

it('ajoute le format sélectionné au panier', () => {
  render(<ProductScreen />);

  fireEvent.press(screen.getByText('Ajouter au panier'));

  const items = useCartStore.getState().items;
  expect(items).toHaveLength(1);
  // Premier format disponible sélectionné par défaut.
  expect(items[0]?.variantId).toBe('v-900');
  expect(items[0]?.quantity).toBe(1);
});

it('respecte le format choisi et la quantité saisie', () => {
  render(<ProductScreen />);

  fireEvent.press(screen.getByLabelText(/^5 kg/));
  fireEvent.press(screen.getByLabelText('Augmenter la quantité'));
  fireEvent.press(screen.getByLabelText('Augmenter la quantité'));
  fireEvent.press(screen.getByText('Ajouter au panier'));

  const [line] = useCartStore.getState().items;
  expect(line?.variantId).toBe('v-5000');
  expect(line?.quantity).toBe(3);
  expect(line?.unitPrice).toBe(6000);
});

it('remet la quantité à 1 après l’ajout et confirme visuellement', () => {
  render(<ProductScreen />);

  fireEvent.press(screen.getByLabelText('Augmenter la quantité'));
  fireEvent.press(screen.getByText('Ajouter au panier'));

  expect(screen.getByText('Ajouté au panier.')).toBeTruthy();
  expect(useCartStore.getState().items[0]?.quantity).toBe(2);

  // Un second ajout ne doit pas réutiliser l'ancienne quantité.
  fireEvent.press(screen.getByText('Ajouter au panier'));
  expect(useCartStore.getState().items[0]?.quantity).toBe(3);
});

it('cumule sur la même ligne plutôt que de dupliquer le format', () => {
  render(<ProductScreen />);

  fireEvent.press(screen.getByText('Ajouter au panier'));
  fireEvent.press(screen.getByText('Ajouter au panier'));

  expect(useCartStore.getState().items).toHaveLength(1);
  expect(useCartStore.getState().items[0]?.quantity).toBe(2);
});

it('n’ajoute rien depuis un format en rupture', () => {
  mockUseProduct.mockReturnValue({
    data: { ...product, variants: [product.variants[2]!] },
    isPending: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  });
  render(<ProductScreen />);

  expect(screen.getByText('Indisponible')).toBeTruthy();
  expect(screen.queryByText('Ajouter au panier')).toBeNull();
  expect(useCartStore.getState().items).toHaveLength(0);
});

it('affiche le prix barré du format sélectionné', () => {
  mockUseProduct.mockReturnValue({
    data: {
      ...product,
      variants: [
        { ...product.variants[0]!, originalPrice: 1400 },
        product.variants[1]!,
        product.variants[2]!,
      ],
    },
    isPending: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  });
  render(<ProductScreen />);

  // Apparaît à la fois dans le sélecteur de format et le pied de page.
  expect(
    screen.getAllByText(`1${NB}400${NB}F`).length,
  ).toBeGreaterThan(0);
});
