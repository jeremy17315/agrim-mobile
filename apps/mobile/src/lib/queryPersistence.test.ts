import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';

import { catalogKeys, type PaginatedProducts } from '@/api/catalog';

import { persistCatalogCache, restoreCatalogCache } from './queryPersistence';

const cachedCatalogue: PaginatedProducts = {
  data: [
    {
      id: 'product-1',
      slug: 'royal-grains',
      name: 'RIZ BOAGNI Royal Grains',
      shortDescription: 'Riz local',
      description: null,
      brand: 'RIZ BOAGNI',
      imageUrl: null,
      category: { id: 'category-1', slug: 'royal', name: 'Royal' },
      variants: [
        {
          id: 'variant-1',
          sku: 'ROYAL-5KG',
          weightGrams: 5000,
          label: '5 kg',
          price: 5000,
          originalPrice: null,
          stock: 20,
          isAvailable: true,
        },
      ],
      isFeatured: true,
      isActive: true,
    },
  ],
  pagination: { page: 1, limit: 100, total: 1 },
};

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

it('restaure le catalogue public après le redémarrage hors connexion', async () => {
  const source = new QueryClient();
  const stopPersisting = persistCatalogCache(source);

  source.setQueryData(catalogKeys.products({ limit: 100 }), cachedCatalogue);
  jest.advanceTimersByTime(300);
  // AsyncStorage écrit de façon asynchrone après le debounce.
  await Promise.resolve();

  const restarted = new QueryClient();
  await restoreCatalogCache(restarted);

  expect(
    restarted.getQueryData(catalogKeys.products({ limit: 100 })),
  ).toEqual(cachedCatalogue);

  stopPersisting();
});

it('n’écrit pas les réponses authentifiées dans le cache hors connexion', async () => {
  const client = new QueryClient();
  const stopPersisting = persistCatalogCache(client);

  client.setQueryData(['orders', 'mine'], [{ reference: 'AGR-2026-0001' }]);
  jest.advanceTimersByTime(300);
  await Promise.resolve();

  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  stopPersisting();
});
