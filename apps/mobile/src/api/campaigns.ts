import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { apiRequest } from './client';

/**
 * Campagnes de notifications — administrateur uniquement.
 *
 * Les compteurs disent ce que le service d'envoi a ACCEPTÉ ou REFUSÉ. Il n'existe
 * aucun compteur « lu » : l'interface ne doit jamais en suggérer un.
 */

export const CAMPAIGN_CATEGORIES = [
  { value: 'PROMOTION', label: 'Promotion' },
  { value: 'NOUVEAU_PRODUIT', label: 'Nouveau produit' },
  { value: 'PROMO_CODE', label: 'Code promo' },
  { value: 'INFORMATION', label: 'Information' },
] as const;

export const CAMPAIGN_LINK_TARGETS = [
  { value: 'information', label: 'Aucun (ouvrir l’application)' },
  { value: 'produit', label: 'Une fiche produit' },
  { value: 'offre', label: 'Les offres' },
  { value: 'categorie', label: 'Une catégorie' },
] as const;

const campaignSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  audience: z.string(),
  status: z.enum(['DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED']),
  targetCount: z.number().int(),
  sentCount: z.number().int(),
  failedCount: z.number().int(),
  invalidCount: z.number().int(),
  lastError: z.string().nullable(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Campaign = z.infer<typeof campaignSchema>;

const sendResultSchema = z.object({
  id: z.string(),
  status: z.string(),
  targetCount: z.number().int(),
  sentCount: z.number().int(),
  failedCount: z.number().int(),
  invalidCount: z.number().int(),
  lastError: z.string().nullable(),
});
export type CampaignSendResult = z.infer<typeof sendResultSchema>;

export type CampaignInput = {
  category: string;
  title: string;
  body: string;
  imageUrl?: string;
  linkTarget?: string;
  linkValue?: string;
  audience: 'TEST' | 'ALL_OPTED_IN';
  confirm?: boolean;
};

export const campaignKeys = {
  all: ['admin-campaigns'] as const,
};

export function useCampaigns(enabled = true) {
  return useQuery({
    queryKey: campaignKeys.all,
    queryFn: () =>
      apiRequest({
        path: '/admin/campaigns',
        schema: z.array(campaignSchema),
      }),
    enabled,
  });
}

export function useSendCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CampaignInput) =>
      apiRequest({
        method: 'POST',
        path: '/admin/campaigns',
        body: input,
        schema: sendResultSchema,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: campaignKeys.all }),
    // Un envoi ne se rejoue pas à l'aveugle : pas de nouvelle tentative auto.
    retry: false,
  });
}
