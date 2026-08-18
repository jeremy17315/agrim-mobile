import { executiveDashboardSchema } from '@agrim/contracts';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { apiRequest } from './client';

/**
 * Indicateurs de la direction.
 *
 * Lecture seule : aucun hook de mutation ici, par construction. Les montants
 * sont agrégés côté serveur — le mobile n'additionne rien, sans quoi deux
 * écrans pourraient afficher deux chiffres d'affaires différents.
 */

export type ExecutiveDashboard = z.infer<typeof executiveDashboardSchema>;

export const analyticsKeys = {
  all: ['analytics'] as const,
  dashboard: () => [...analyticsKeys.all, 'dashboard'] as const,
};

export function useExecutiveDashboard(enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.dashboard(),
    queryFn: ({ signal }) =>
      apiRequest({
        path: '/analytics/dashboard',
        schema: executiveDashboardSchema,
        signal,
      }),
    enabled,
    // Des indicateurs mensuels ne bougent pas à la seconde : on évite de
    // rappeler l'API à chaque retour sur l'écran.
    staleTime: 60_000,
  });
}
