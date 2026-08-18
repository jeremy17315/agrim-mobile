import {
  categorySchema,
  paginated,
  productSchema,
  type Category,
  type Product,
} from '@agrim/contracts';
import { useQuery } from '@tanstack/react-query';
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
  return useQuery({
    queryKey: catalogKeys.products(filters),
    queryFn: ({ signal }) => fetchProducts(filters, signal),
    // Conserve la page précédente pendant la frappe : pas d'écran vide entre
    // deux recherches.
    placeholderData: (previous) => previous,
  });
}

export function useProduct(slug: string) {
  return useQuery({
    queryKey: catalogKeys.product(slug),
    queryFn: ({ signal }) => fetchProductBySlug(slug, signal),
    enabled: slug.length > 0,
  });
}
