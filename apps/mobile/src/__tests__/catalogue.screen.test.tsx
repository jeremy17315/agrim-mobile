import type { Category, Product } from '@agrim/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import CatalogueScreen from '../../app/(tabs)/catalogue';

/**
 * Catalogue : recherche temporisée et filtre par gamme.
 *
 * Risques couverts : une requête par frappe (coûteuse en data sur un réseau
 * mobile), et l'écrasement d'un filtre choisi à la main par le paramètre de
 * navigation venu de l'accueil — régression réintroduite facilement, la
 * synchronisation se faisant pendant le rendu.
 */

let mockParams: { category?: string } = {};
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

/** Capture les filtres reçus par le hook produits à chaque rendu. */
const productCalls: { search?: string; category?: string }[] = [];

let mockProducts: {
  data: { data: Product[]; pagination: { total: number } } | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: jest.Mock;
};

const categories: Category[] = [
  {
    id: 'c1',
    slug: 'royal-grains',
    name: 'Royal Grains',
    description: null,
    imageUrl: null,
    sortOrder: 1,
  },
  {
    id: 'c2',
    slug: 'sika',
    name: 'Sika',
    description: null,
    imageUrl: null,
    sortOrder: 2,
  },
];

jest.mock('@/api/catalog', () => ({
  useCategories: () => ({ data: categories, isPending: false }),
  useProducts: (filters: { search?: string; category?: string }) => {
    productCalls.push({ search: filters.search, category: filters.category });
    return mockProducts;
  },
}));

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'p1',
  slug: 'royal-grains',
  name: 'RIZ BOAGNI Royal Grains',
  shortDescription: 'Pur riz local de luxe',
  description: null,
  brand: 'RIZ BOAGNI',
  imageUrl: null,
  isFeatured: true,
  isActive: true,
  category: { id: 'c1', slug: 'royal-grains', name: 'Royal Grains' },
  variants: [
    {
      id: 'v1',
      sku: 'ROYAL-5000',
      label: '5 kg',
      weightGrams: 5000,
      price: 6000,
      stock: 120,
      isAvailable: true,
    },
  ],
  ...overrides,
});

const listing = (items: Product[]) => ({
  data: { data: items, pagination: { total: items.length } },
  isPending: false,
  isError: false,
  error: null as unknown,
  refetch: jest.fn(),
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  productCalls.length = 0;
  mockParams = {};
  mockProducts = listing([product()]);
});

afterEach(() => {
  jest.useRealTimers();
});

/** Dernier jeu de filtres transmis au hook produits. */
const lastCall = () => productCalls[productCalls.length - 1]!;

it('affiche la grille et le nombre de résultats', () => {
  render(<CatalogueScreen />);

  expect(screen.getByText('1 produit')).toBeTruthy();
  expect(screen.getByText('RIZ BOAGNI Royal Grains')).toBeTruthy();
});

it('accorde le compteur au pluriel', () => {
  mockProducts = listing([
    product(),
    product({ id: 'p2', slug: 'sika', name: 'RIZ BOAGNI Sika' }),
  ]);

  render(<CatalogueScreen />);

  expect(screen.getByText('2 produits')).toBeTruthy();
});

it('ne lance pas une requête à chaque frappe', () => {
  render(<CatalogueScreen />);

  const input = screen.getByLabelText('Rechercher un produit');
  fireEvent.changeText(input, 'r');
  fireEvent.changeText(input, 'ri');
  fireEvent.changeText(input, 'riz');

  // Avant l'expiration du délai, aucun terme n'est encore parti au serveur.
  expect(lastCall().search).toBeUndefined();

  act(() => {
    jest.advanceTimersByTime(350);
  });

  // Une seule valeur finit par être interrogée : la dernière.
  expect(lastCall().search).toBe('riz');
});

it('efface la recherche', () => {
  render(<CatalogueScreen />);

  const input = screen.getByLabelText('Rechercher un produit');
  fireEvent.changeText(input, 'riz');
  act(() => {
    jest.advanceTimersByTime(350);
  });
  expect(lastCall().search).toBe('riz');

  fireEvent.press(screen.getByLabelText('Effacer la recherche'));
  act(() => {
    jest.advanceTimersByTime(350);
  });

  // Une chaîne vide n'est pas un critère : le filtre disparaît.
  expect(lastCall().search).toBeUndefined();
});

it('n’affiche le bouton d’effacement que s’il y a du texte', () => {
  render(<CatalogueScreen />);

  expect(screen.queryByLabelText('Effacer la recherche')).toBeNull();

  fireEvent.changeText(screen.getByLabelText('Rechercher un produit'), 'riz');
  expect(screen.getByLabelText('Effacer la recherche')).toBeTruthy();
});

it('filtre par gamme et permet de désélectionner', () => {
  render(<CatalogueScreen />);

  fireEvent.press(screen.getByLabelText('Filtrer par Royal Grains'));
  expect(lastCall().category).toBe('royal-grains');

  // Retoucher la même gamme la retire : le geste est réversible.
  fireEvent.press(screen.getByLabelText('Filtrer par Royal Grains'));
  expect(lastCall().category).toBeUndefined();
});

it('revient à toutes les gammes', () => {
  render(<CatalogueScreen />);

  fireEvent.press(screen.getByLabelText('Filtrer par Sika'));
  expect(lastCall().category).toBe('sika');

  fireEvent.press(screen.getByLabelText('Filtrer par Toutes'));
  expect(lastCall().category).toBeUndefined();
});

it('applique la gamme reçue de l’accueil', () => {
  mockParams = { category: 'sika' };

  render(<CatalogueScreen />);

  expect(lastCall().category).toBe('sika');
});

it('n’écrase pas un filtre choisi à la main après coup', () => {
  mockParams = { category: 'sika' };
  const view = render(<CatalogueScreen />);
  expect(lastCall().category).toBe('sika');

  // L'utilisateur change d'avis.
  fireEvent.press(screen.getByLabelText('Filtrer par Royal Grains'));
  expect(lastCall().category).toBe('royal-grains');

  // Un nouveau rendu avec le MÊME paramètre ne doit pas revenir en arrière.
  view.rerender(<CatalogueScreen />);
  expect(lastCall().category).toBe('royal-grains');
});

it('suit une navigation vers une autre gamme', () => {
  mockParams = { category: 'royal-grains' };
  const view = render(<CatalogueScreen />);
  expect(lastCall().category).toBe('royal-grains');

  // Nouvelle navigation depuis l'accueil vers une AUTRE gamme : l'intention
  // de navigation l'emporte sur le filtre affiché.
  mockParams = { category: 'sika' };
  view.rerender(<CatalogueScreen />);
  expect(lastCall().category).toBe('sika');
});

it('documente la limite : re-viser la même gamme ne réapplique rien', () => {
  mockParams = { category: 'royal-grains' };
  const view = render(<CatalogueScreen />);

  fireEvent.press(screen.getByLabelText('Filtrer par Sika'));
  expect(lastCall().category).toBe('sika');

  // L'onglet catalogue reste monté et le paramètre est inchangé : rien ne
  // distingue cette navigation de la précédente, le filtre manuel est
  // conservé. Comportement assumé — la valeur du paramètre est la seule
  // information disponible, et l'écraser à chaque rendu casserait le filtre
  // choisi à la main (le cas fréquent).
  mockParams = { category: 'royal-grains' };
  view.rerender(<CatalogueScreen />);
  expect(lastCall().category).toBe('sika');
});

it('distingue une recherche infructueuse d’une gamme vide', () => {
  mockProducts = listing([]);

  const view = render(<CatalogueScreen />);
  expect(
    screen.getByText('Aucun produit dans cette gamme pour le moment.'),
  ).toBeTruthy();

  fireEvent.changeText(
    screen.getByLabelText('Rechercher un produit'),
    'quinoa',
  );
  act(() => {
    jest.advanceTimersByTime(350);
  });
  view.rerender(<CatalogueScreen />);

  expect(screen.getByText(/Rien ne correspond à « quinoa »/)).toBeTruthy();
});

it('affiche une erreur récupérable', () => {
  mockProducts = {
    data: undefined,
    isPending: false,
    isError: true,
    error: new Error('réseau'),
    refetch: jest.fn(),
  };

  render(<CatalogueScreen />);

  expect(screen.getByText(/Réessayer/i)).toBeTruthy();
});
