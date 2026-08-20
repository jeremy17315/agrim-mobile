import { referralSummarySchema, type ReferralSummary } from '@agrim/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiRequest } from './client';

/**
 * Parrainage de l'utilisateur connecté.
 *
 * Une seule route, comme les adresses : le compte vient toujours du JWT,
 * jamais d'un identifiant transmis par le client.
 */

export const referralKeys = {
  all: ['referrals'] as const,
  me: () => [...referralKeys.all, 'me'] as const,
};

export function useReferralSummary(
  enabled = true,
): UseQueryResult<ReferralSummary> {
  return useQuery({
    queryKey: referralKeys.me(),
    queryFn: () =>
      apiRequest({ path: '/referrals/me', schema: referralSummarySchema }),
    enabled,
  });
}
