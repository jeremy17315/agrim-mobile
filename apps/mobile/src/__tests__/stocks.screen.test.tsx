import { stockLevel, stockRatio } from '@agrim/contracts';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { StockItem } from '@/api/management';

import StocksScreen from '../../app/gestion/stocks';

/**
 * Stocks.
 *
 * Risques couverts : un seuil unique appliqué à tous les formats, et un
 * réapprovisionnement envoyé en valeur absolue plutôt qu'en apport.
 */

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockAdjust = jest.fn();
let mockStock: {
  data: StockItem[] | undefined;
  isLoading: boolean;
  isError: boolean;
  isRefetching: boolean;
  error: unknown;
  refetch: jest.Mock;
};

jest.mock('@/api/management', () => ({
  useStock: () => mockStock,
  useAdjustStock: () => ({ mutate: mockAdjust, isPending: false }),
}));

const item = (overrides: Partial<StockItem> = {}): StockItem => ({
  variantId: '11111111-1111-4111-8111-111111111111',
  sku: 'BOAGNI-ROYAL-5000',
  productName: 'Royal Grains',
  label: '5 kg',
  weightGrams: 5000,
  stock: 200,
  lowStockThreshold: 30,
  isAvailable: true,
  ...overrides,
});

const state = (items: StockItem[]) => ({
  data: items,
  isLoading: false,
  isError: false,
  isRefetching: false,
  error: null as unknown,
  refetch: jest.fn(),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockStock = state([item()]);
});

describe('niveau de stock (contrat partagé)', () => {
  it('compare au seuil propre à la variante', () => {
    // Même stock, seuils différents : deux verdicts différents.
    expect(stockLevel(25, 30)).toBe('LOW');
    expect(stockLevel(25, 10)).toBe('OK');
  });

  it('signale « critique » à la moitié du seuil', () => {
    expect(stockLevel(15, 30)).toBe('CRITICAL');
    expect(stockLevel(16, 30)).toBe('LOW');
  });

  it('distingue la rupture', () => {
    expect(stockLevel(0, 30)).toBe('OUT');
  });

  it('borne le ratio à 100 %', () => {
    expect(stockRatio(200, 30)).toBe(100);
    expect(stockRatio(15, 30)).toBe(50);
  });
});

it('affiche une variante avec son SKU et son seuil', () => {
  render(<StocksScreen />);

  expect(screen.getByText('BOAGNI-ROYAL-5000')).toBeTruthy();
  expect(screen.getByText('200 unités · seuil 30')).toBeTruthy();
  expect(screen.getByText('OK')).toBeTruthy();
});

it('marque une variante sous le seuil', () => {
  mockStock = state([item({ stock: 12, lowStockThreshold: 40 })]);

  render(<StocksScreen />);

  expect(screen.getByText('Critique')).toBeTruthy();
});

it('résume le nombre d’alertes', () => {
  mockStock = state([
    item(),
    item({
      variantId: '22222222-2222-4222-8222-222222222222',
      sku: 'BOAGNI-SIKA-22500',
      stock: 5,
      lowStockThreshold: 10,
    }),
  ]);

  render(<StocksScreen />);

  expect(screen.getByText('1 variante sous le seuil d’alerte')).toBeTruthy();
});

it('envoie un apport, jamais une valeur absolue', () => {
  render(<StocksScreen />);

  fireEvent.press(screen.getByLabelText('Réapprovisionner Royal Grains 5 kg'));
  fireEvent.changeText(screen.getByLabelText('Apport (unités)'), '50');
  fireEvent.press(screen.getByText('Enregistrer l’apport'));

  expect(mockAdjust).toHaveBeenCalledWith(
    {
      variantId: '11111111-1111-4111-8111-111111111111',
      delta: 50,
    },
    expect.anything(),
  );
});

it('rappelle le stock courant avant la saisie', () => {
  render(<StocksScreen />);

  fireEvent.press(screen.getByLabelText('Réapprovisionner Royal Grains 5 kg'));

  expect(screen.getByText('Stock actuel : 200 unités · seuil 30')).toBeTruthy();
});

it('affiche une erreur récupérable', () => {
  mockStock = {
    ...state([]),
    data: undefined,
    isError: true,
    error: new Error('réseau'),
  };

  render(<StocksScreen />);

  expect(screen.getByText(/Réessayer/i)).toBeTruthy();
});
