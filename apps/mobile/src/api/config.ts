import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { apiRequest } from './client';

/**
 * Configuration commerciale publiée par AGRIM.
 *
 * Ce que l'application affiche — numéro du service client, points de vente,
 * textes de livraison, questions fréquentes — vient du SERVEUR. Corriger un
 * numéro se fait donc dans l'administration, sans nouvelle version sur le Play
 * Store, et aucun écran ne recopie une valeur commerciale dans le bundle.
 */

const pointOfSaleSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  city: z.string(),
  landmark: z.string().nullable(),
  phone: z.string().nullable(),
  openingHours: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  supportsPickup: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
});
export type PointOfSale = z.infer<typeof pointOfSaleSchema>;

export const appConfigSchema = z.object({
  version: z.number().int(),
  support: z.object({
    phone: z.string().nullable(),
    landlinePhone: z.string().nullable(),
    whatsapp: z.string().nullable(),
    email: z.string().nullable(),
  }),
  pointsOfSale: z.array(pointOfSaleSchema),
  delivery: z.object({
    summary: z.string(),
    delays: z.string(),
    pickupConditions: z.string(),
    pickupNotice: z.string().optional(),
    feeNotice: z.string(),
  }),
  faq: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
    }),
  ),
  announcement: z.string().nullable(),
  updatedAt: z.string(),
});
export type AppConfig = z.infer<typeof appConfigSchema>;

export const configKeys = {
  all: ['config'] as const,
};

export function useAppConfig() {
  return useQuery({
    queryKey: configKeys.all,
    queryFn: ({ signal }) =>
      apiRequest({ path: '/config/app', schema: appConfigSchema, isPublic: true, signal }),
    // Ces valeurs changent rarement ; les relire à chaque écran coûterait de
    // la data sur un réseau facturé au mégaoctet.
    staleTime: 10 * 60_000,
  });
}
