import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { apiRequest } from './client';

/**
 * Codes promo — administration.
 *
 * Décision de prix : de l'argent offert par AGRIM. Deux conséquences dans ce
 * fichier comme côté serveur :
 *  - seul un ADMIN ou un DG peut écrire (le serveur le vérifie ; 403 sinon) ;
 *  - un code créé reste INACTIF jusqu'à publication explicite : rien ne part
 *    chez les clients avant relecture.
 *
 * Le montant de la remise n'est jamais calculé ici : ce fichier décrit la
 * RÈGLE, le serveur l'applique au panier.
 */

export const promoCodeSchema = z.object({
  /** Identifiant technique : sert à publier/désactiver le code. */
  id: z.string(),
  code: z.string(),
  description: z.string().nullable(),
  discountType: z.enum(['PERCENT', 'FIXED']),
  discountValue: z.number().int(),
  minOrderTotal: z.number().int().nullable(),
  appliesTo: z.array(z.string()),
  zone: z.string().nullable(),
  maxUses: z.number().int().nullable(),
  usedCount: z.number().int(),
  maxUsesPerPhone: z.number().int().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  isActive: z.boolean(),
});
export type PromoCode = z.infer<typeof promoCodeSchema>;

const promoListSchema = z.array(promoCodeSchema);

export type PromoCodeInput = {
  code: string;
  description?: string;
  discountType: 'PERCENT' | 'FIXED';
  discountValue: number;
  minOrderTotal?: number;
  maxUses?: number;
  maxUsesPerPhone?: number;
  zone?: string;
  startsAt?: string;
  endsAt?: string;
  isActive?: boolean;
};

export const promoKeys = {
  all: ['promo-codes'] as const,
};

export function usePromoCodes(enabled = true) {
  return useQuery({
    queryKey: promoKeys.all,
    queryFn: ({ signal }) =>
      apiRequest({
        path: '/promo-codes',
        schema: promoListSchema,
        signal,
      }),
    enabled,
    // Une remise diffusée change rarement : inutile de rappeler l'API à
    // chaque retour sur l'écran.
    staleTime: 30_000,
  });
}

function invalidatePromos(queryClient: ReturnType<typeof useQueryClient>) {
  return () => queryClient.invalidateQueries({ queryKey: promoKeys.all });
}

export function useCreatePromoCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PromoCodeInput) =>
      apiRequest({
        method: 'POST',
        path: '/promo-codes',
        body: input,
        schema: promoCodeSchema,
      }),
    onSuccess: invalidatePromos(queryClient),
    retry: false,
  });
}

export function useUpdatePromoCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: Partial<PromoCodeInput> & { id: string }) =>
      apiRequest({
        method: 'PATCH',
        path: `/promo-codes/${id}`,
        // L'identifiant du code ne se modifie pas : c'est la clé que les
        // clients ont sous les yeux. Une faute de frappe se corrige en créant
        // un nouveau code et en désactivant l'ancien.
        body: input,
        schema: z.unknown(),
      }),
    onSuccess: invalidatePromos(queryClient),
    retry: false,
  });
}

export function useDeactivatePromoCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest({
        method: 'DELETE',
        path: `/promo-codes/${id}`,
        schema: z.unknown(),
      }),
    onSuccess: invalidatePromos(queryClient),
    retry: false,
  });
}
