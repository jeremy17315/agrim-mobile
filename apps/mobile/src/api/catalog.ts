import {
  categorySchema,
  paginated,
  productSchema,
  type Category,
  type Product,
} from '@agrim/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { apiRequest } from './client';

/**
 * Accès au catalogue.
 *
 * Les composants n'utilisent que les hooks exportés ici : ils ne connaissent
 * ni les chemins d'API, ni la forme des réponses.
 */

const categoriesSchema = z.array(categorySchema);

// Réutilise le helper du contrat : la forme { data, pagination } est définie
// une seule fois, côté partagé.
const paginatedProductsSchema = paginated(productSchema);
export type PaginatedProducts = z.infer<typeof paginatedProductsSchema>;

export type ProductFilters = {
  search?: string;
  category?: string;
  featured?: boolean;
  page?: number;
  limit?: number;
};

/** Clés de cache centralisées : évite les invalidations qui ratent leur cible. */
export const catalogKeys = {
  all: ['catalog'] as const,
  categories: () => [...catalogKeys.all, 'categories'] as const,
  products: (filters: ProductFilters) =>
    [...catalogKeys.all, 'products', filters] as const,
  product: (slug: string) => [...catalogKeys.all, 'product', slug] as const,
};

type CachedValue<T> = { data: T; updatedAt: number };

function normalizedFilters(filters: ProductFilters): ProductFilters {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined),
  ) as ProductFilters;
}

function sameFilters(left: ProductFilters, right: ProductFilters): boolean {
  return (
    JSON.stringify(normalizedFilters(left)) ===
    JSON.stringify(normalizedFilters(right))
  );
}

function isUnfilteredCatalog(filters: ProductFilters): boolean {
  return (
    filters.search === undefined &&
    filters.category === undefined &&
    filters.featured === undefined
  );
}

/**
 * À partir du catalogue complet enregistré, reconstruit un résultat local pour
 * une recherche ou un filtre qui n'a pas encore sa propre entrée de cache.
 * Il ne prétend pas connaître les résultats absents du cache : l'écran indique
 * globalement le mode hors connexion et le serveur reprendra autorité dès son
 * retour.
 */
function cachedProducts(
  queryClient: ReturnType<typeof useQueryClient>,
  filters: ProductFilters,
): CachedValue<PaginatedProducts> | undefined {
  const entries = queryClient.getQueriesData<PaginatedProducts>({
    queryKey: [...catalogKeys.all, 'products'],
  });

  for (const [key, data] of entries) {
    const keyFilters = key[2];
    if (
      data &&
      typeof keyFilters === 'object' &&
      keyFilters !== null &&
      sameFilters(keyFilters as ProductFilters, filters)
    ) {
      return {
        data,
        updatedAt: queryClient.getQueryState(key)?.dataUpdatedAt ?? Date.now(),
      };
    }
  }

  // On privilégie l'entrée sans filtre : la racine la précharge avec 100
  // produits précisément pour couvrir le catalogue hors connexion.
  const allProducts = entries.find(([key, data]) => {
    const keyFilters = key[2];
    return (
      data !== undefined &&
      typeof keyFilters === 'object' &&
      keyFilters !== null &&
      isUnfilteredCatalog(keyFilters as ProductFilters)
    );
  });
  if (!allProducts?.[1]) return undefined;

  const [key, source] = allProducts;
  const search = filters.search?.trim().toLocaleLowerCase('fr-CI');
  const data = source.data.filter((product) => {
    if (filters.category && product.category.slug !== filters.category) return false;
    if (filters.featured !== undefined && product.isFeatured !== filters.featured)
      return false;
    if (!search) return true;
    return `${product.name} ${product.shortDescription ?? ''}`
      .toLocaleLowerCase('fr-CI')
      .includes(search);
  });

  return {
    data: {
      data,
      pagination: {
        page: 1,
        limit: source.pagination.limit,
        total: data.length,
      },
    },
    updatedAt: queryClient.getQueryState(key)?.dataUpdatedAt ?? Date.now(),
  };
}

function cachedProduct(
  queryClient: ReturnType<typeof useQueryClient>,
  slug: string,
): CachedValue<Product> | undefined {
  const pages = queryClient.getQueriesData<PaginatedProducts>({
    queryKey: [...catalogKeys.all, 'products'],
  });

  for (const [key, page] of pages) {
    const product = page?.data.find((item) => item.slug === slug);
    if (product) {
      return {
        data: product,
        updatedAt: queryClient.getQueryState(key)?.dataUpdatedAt ?? Date.now(),
      };
    }
  }
  return undefined;
}

export function fetchCategories(signal?: AbortSignal): Promise<Category[]> {
  return apiRequest({
    path: '/categories',
    schema: categoriesSchema,
    isPublic: true,
    signal,
  });
}

export function fetchProducts(
  filters: ProductFilters,
  signal?: AbortSignal,
): Promise<PaginatedProducts> {
  return apiRequest({
    path: '/products',
    query: {
      search: filters.search,
      category: filters.category,
      featured: filters.featured,
      page: filters.page,
      limit: filters.limit,
    },
    schema: paginatedProductsSchema,
    isPublic: true,
    signal,
  });
}

export function fetchProductBySlug(
  slug: string,
  signal?: AbortSignal,
): Promise<Product> {
  return apiRequest({
    path: `/products/${slug}`,
    schema: productSchema,
    isPublic: true,
    signal,
  });
}

/* --------------------------------- Hooks -------------------------------- */

export function useCategories() {
  return useQuery({
    queryKey: catalogKeys.categories(),
    queryFn: ({ signal }) => fetchCategories(signal),
    // Les gammes changent rarement : inutile de les recharger sans cesse.
    staleTime: 10 * 60 * 1000,
  });
}

export function useProducts(filters: ProductFilters = {}) {
  const queryClient = useQueryClient();
  const cached = cachedProducts(queryClient, filters);

  return useQuery({
    queryKey: catalogKeys.products(filters),
    queryFn: ({ signal }) => fetchProducts(filters, signal),
    // Une recherche faite sans réseau reste possible sur le dernier catalogue
    // complet enregistré. Le serveur rafraîchira ce résultat dès qu'il sera
    // joignable, y compris les prix et stocks.
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.updatedAt,
    // Conserve la page précédente pendant la frappe : pas d'écran vide entre
    // deux recherches.
    placeholderData: (previous) => previous,
  });
}

export function useProduct(slug: string) {
  const queryClient = useQueryClient();
  const cached = slug ? cachedProduct(queryClient, slug) : undefined;

  return useQuery({
    queryKey: catalogKeys.product(slug),
    queryFn: ({ signal }) => fetchProductBySlug(slug, signal),
    // Les listes contiennent la fiche complète : ne pas refaire dépendre une
    // fiche déjà consultable du réseau est essentiel pour le mode hors ligne.
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.updatedAt,
    enabled: slug.length > 0,
  });
}
