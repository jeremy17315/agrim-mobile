import {
  farmSchema,
  producerOverviewSchema,
  productionSchema,
  type CreateFarmInput,
  type CreateProductionInput,
  type ProductionStatus,
  type UpdateFarmInput,
} from '@agrim/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { apiRequest } from './client';

/**
 * Espace producteur.
 *
 * Le serveur résout l'exploitation à partir du jeton : aucun identifiant de
 * producteur n'est manipulé côté mobile.
 */

const farmsSchema = z.array(farmSchema);
const productionsSchema = z.array(productionSchema);

export type Farm = z.infer<typeof farmSchema>;
export type Production = z.infer<typeof productionSchema>;
export type ProducerOverview = z.infer<typeof producerOverviewSchema>;

export const producerKeys = {
  all: ['producer'] as const,
  overview: () => [...producerKeys.all, 'overview'] as const,
  farms: () => [...producerKeys.all, 'farms'] as const,
  productions: (filters?: { farmId?: string; status?: ProductionStatus }) =>
    [...producerKeys.all, 'productions', filters ?? {}] as const,
};

export function useProducerOverview(enabled = true) {
  return useQuery({
    queryKey: producerKeys.overview(),
    queryFn: ({ signal }) =>
      apiRequest({
        path: '/producers/me',
        schema: producerOverviewSchema,
        signal,
      }),
    enabled,
  });
}

export function useFarms(enabled = true) {
  return useQuery({
    queryKey: producerKeys.farms(),
    queryFn: ({ signal }) =>
      apiRequest({
        path: '/producers/me/farms',
        schema: farmsSchema,
        signal,
      }),
    enabled,
  });
}

export function useProductions(
  filters: { farmId?: string; status?: ProductionStatus } = {},
  enabled = true,
) {
  return useQuery({
    queryKey: producerKeys.productions(filters),
    queryFn: ({ signal }) =>
      apiRequest({
        path: '/producers/me/productions',
        query: { farmId: filters.farmId, status: filters.status },
        schema: productionsSchema,
        signal,
      }),
    enabled,
  });
}

/**
 * Après toute écriture, la synthèse (surfaces, cumuls, déclarations en
 * attente) devient fausse : on invalide l'ensemble de l'espace plutôt que de
 * recalculer des totaux côté client.
 */
function useProducerMutation<TInput, TOutput>(
  mutationFn: (input: TInput) => Promise<TOutput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: producerKeys.all }),
  });
}

export function useCreateFarm() {
  return useProducerMutation((input: CreateFarmInput) =>
    apiRequest({
      path: '/producers/me/farms',
      method: 'POST',
      body: input,
      schema: farmSchema,
    }),
  );
}

export function useUpdateFarm() {
  return useProducerMutation(
    ({ id, ...input }: UpdateFarmInput & { id: string }) =>
      apiRequest({
        path: `/producers/me/farms/${id}`,
        method: 'PUT',
        body: input,
        schema: farmSchema,
      }),
  );
}

export function useDeleteFarm() {
  return useProducerMutation((id: string) =>
    apiRequest({
      path: `/producers/me/farms/${id}`,
      method: 'DELETE',
      schema: z.object({ deleted: z.boolean(), deactivated: z.boolean() }),
    }),
  );
}

export function useCreateProduction() {
  return useProducerMutation((input: CreateProductionInput) =>
    apiRequest({
      path: '/producers/me/productions',
      method: 'POST',
      body: input,
      schema: productionSchema,
    }),
  );
}

export function useDeleteProduction() {
  return useProducerMutation((id: string) =>
    apiRequest({
      path: `/producers/me/productions/${id}`,
      method: 'DELETE',
      schema: z.object({ deleted: z.boolean() }),
    }),
  );
}
