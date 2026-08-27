import {
  createProductReviewSchema,
  productReviewSchema,
  productReviewsResponseSchema,
  type CreateProductReviewInput,
  type ProductReview,
  type ProductReviewsResponse,
} from '@agrim/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from './client';

export const reviewKeys = {
  all: ['reviews'] as const,
  product: (slug: string) => [...reviewKeys.all, slug] as const,
};

export function fetchProductReviews(
  slug: string,
  signal?: AbortSignal,
): Promise<ProductReviewsResponse> {
  return apiRequest({
    path: `/products/${slug}/reviews`,
    schema: productReviewsResponseSchema,
    isPublic: true,
    signal,
  });
}

export function submitProductReview(
  slug: string,
  payload: CreateProductReviewInput,
): Promise<ProductReview> {
  const body = createProductReviewSchema.parse(payload);
  return apiRequest({
    method: 'POST',
    path: `/products/${slug}/reviews`,
    body,
    schema: productReviewSchema,
  });
}

export function useProductReviews(slug: string) {
  return useQuery({
    queryKey: reviewKeys.product(slug),
    queryFn: ({ signal }) => fetchProductReviews(slug, signal),
    enabled: slug.length > 0,
  });
}

export function useSubmitReview(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateProductReviewInput) =>
      submitProductReview(slug, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: reviewKeys.product(slug) });
    },
    retry: false,
  });
}
