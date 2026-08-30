import {
  courierSummarySchema,
  managedOrderSchema,
  managerDashboardSchema,
  reviewableProductionSchema,
  stockItemSchema,
  stockMovementPageSchema,
  type ManualStockMovementType,
  type OrderStatus,
  type ProductionStatus,
} from '@agrim/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { apiRequest } from './client';

/**
 * Back-office opérationnel.
 *
 * Les droits sont vérifiés côté serveur : ces hooks n'ont de sens que pour un
 * compte de gestion, mais rien ici ne fait autorité.
 */

const managedOrdersSchema = z.array(managedOrderSchema);
const stockItemsSchema = z.array(stockItemSchema);
const couriersSchema = z.array(courierSummarySchema);
const reviewableProductionsSchema = z.array(reviewableProductionSchema);

export type ManagedOrder = z.infer<typeof managedOrderSchema>;
export type ManagerDashboard = z.infer<typeof managerDashboardSchema>;
export type StockItem = z.infer<typeof stockItemSchema>;
export type CourierSummary = z.infer<typeof courierSummarySchema>;
export type ReviewableProduction = z.infer<typeof reviewableProductionSchema>;

export const managementKeys = {
  all: ['management'] as const,
  dashboard: () => [...managementKeys.all, 'dashboard'] as const,
  orders: (filters?: { status?: OrderStatus; search?: string }) =>
    [...managementKeys.all, 'orders', filters ?? {}] as const,
  stock: (onlyAlerts?: boolean) =>
    [...managementKeys.all, 'stock', onlyAlerts ?? false] as const,
  stockMovements: (variantId: string, page: number) =>
    [...managementKeys.all, 'stock', variantId, 'movements', page] as const,
  couriers: () => [...managementKeys.all, 'couriers'] as const,
  productionReview: (status?: ProductionStatus) =>
    [...managementKeys.all, 'production-review', status ?? 'PENDING'] as const,
};

export function useManagerDashboard(enabled = true) {
  return useQuery({
    queryKey: managementKeys.dashboard(),
    queryFn: ({ signal }) =>
      apiRequest({
        path: '/management/dashboard',
        schema: managerDashboardSchema,
        signal,
      }),
    enabled,
    // File d'attente opérationnelle : une donnée figée trop longtemps ferait
    // travailler le gestionnaire sur un état périmé.
    staleTime: 15_000,
  });
}

export function useManagedOrders(
  filters: { status?: OrderStatus; search?: string } = {},
  enabled = true,
) {
  return useQuery({
    queryKey: managementKeys.orders(filters),
    queryFn: ({ signal }) =>
      apiRequest({
        path: '/management/orders',
        query: { status: filters.status, search: filters.search },
        schema: managedOrdersSchema,
        signal,
      }),
    enabled,
    staleTime: 15_000,
  });
}

export function useStock(onlyAlerts = false, enabled = true) {
  return useQuery({
    queryKey: managementKeys.stock(onlyAlerts),
    queryFn: ({ signal }) =>
      apiRequest({
        path: '/management/stock',
        query: { onlyAlerts },
        schema: stockItemsSchema,
        signal,
      }),
    enabled,
  });
}

export function useCouriers(enabled = true) {
  return useQuery({
    queryKey: managementKeys.couriers(),
    queryFn: ({ signal }) =>
      apiRequest({
        path: '/management/couriers',
        schema: couriersSchema,
        signal,
      }),
    enabled,
  });
}

/**
 * Déclarations de récolte en attente d'arbitrage de la coopérative.
 *
 * Sans statut, l'API ne renvoie que `DECLARED` et `CONFIRMED` : la file de
 * travail, pas l'historique.
 */
export function useProductionReview(status?: ProductionStatus, enabled = true) {
  return useQuery({
    queryKey: managementKeys.productionReview(status),
    queryFn: ({ signal }) =>
      apiRequest({
        path: '/producers/productions/review',
        query: { status },
        schema: reviewableProductionsSchema,
        signal,
      }),
    enabled,
    staleTime: 15_000,
  });
}

/**
 * Après une écriture, la file ET les indicateurs deviennent faux : on invalide
 * tout le back-office plutôt que d'entretenir des compteurs locaux qui
 * divergeraient du serveur.
 */
function useManagementMutation<TInput, TOutput>(
  mutationFn: (input: TInput) => Promise<TOutput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: managementKeys.all }),
  });
}

/**
 * Clôture d'exception d'une livraison.
 *
 * Voie de secours quand le client ne peut pas donner son code (téléphone
 * déchargé, remise à un tiers). Réservée à la gestion : si le livreur pouvait
 * s'en servir, la validation par code ne vaudrait plus rien. Le motif est
 * conservé et ces clôtures sont comptées à part au tableau de bord.
 */
export function useCloseDelivery() {
  return useManagementMutation(
    ({ reference, reason }: { reference: string; reason: string }) =>
      apiRequest({
        path: `/deliveries/orders/${reference}/close`,
        method: 'POST',
        body: { reason },
        schema: z.object({ id: z.uuid(), status: z.string() }),
      }),
  );
}

export function useUpdateOrderStatus() {
  return useManagementMutation(
    ({ reference, status }: { reference: string; status: OrderStatus }) =>
      apiRequest({
        path: `/management/orders/${reference}/status`,
        method: 'PATCH',
        body: { status },
        schema: managedOrderSchema,
      }),
  );
}

export function useAdjustStock() {
  return useManagementMutation(
    ({
      variantId,
      ...body
    }: {
      variantId: string;
      delta?: number;
      /**
       * Motif du mouvement. Omis, le signe décide (`ENTREE` / `SORTIE`).
       * `AJUSTEMENT` exige en outre une `reason` — le serveur la réclame.
       */
      type?: ManualStockMovementType;
      reason?: string;
      lowStockThreshold?: number;
    }) =>
      apiRequest({
        path: `/management/stock/${variantId}`,
        method: 'PATCH',
        body,
        schema: stockItemSchema,
      }),
  );
}

/**
 * Historique d'une variante — « pourquoi ce chiffre ? ».
 *
 * Chargé à la demande (`enabled`) : personne n'ouvre l'historique de chaque
 * ligne de l'inventaire, et le tirer d'avance ferait autant de requêtes que
 * de références affichées.
 */
export function useStockMovements(
  variantId: string | null,
  page = 1,
  enabled = true,
) {
  return useQuery({
    queryKey: managementKeys.stockMovements(variantId ?? '', page),
    queryFn: ({ signal }) =>
      apiRequest({
        path: `/management/stock/${variantId}/movements`,
        query: { page },
        schema: stockMovementPageSchema,
        signal,
      }),
    enabled: enabled && Boolean(variantId),
  });
}

/**
 * L'assignation appartient au module livraisons : le back-office ne fait que
 * la déclencher, la règle métier reste là où elle a été écrite.
 */
export function useAssignCourier() {
  return useManagementMutation(
    ({ reference, courierId }: { reference: string; courierId: string }) =>
      apiRequest({
        path: `/deliveries/orders/${reference}/assign`,
        method: 'POST',
        body: { courierId },
        schema: z.object({ id: z.uuid(), status: z.string() }),
      }),
  );
}

/**
 * Décision de la coopérative sur une déclaration.
 *
 * Le motif est obligatoire au rejet ; la règle vit dans le contrat partagé et
 * le serveur la revalide.
 */
export function useReviewProduction() {
  return useManagementMutation(
    ({
      id,
      ...body
    }: {
      id: string;
      status: ProductionStatus;
      reviewNote?: string;
    }) =>
      apiRequest({
        path: `/producers/productions/${id}/review`,
        method: 'PATCH',
        body,
        schema: reviewableProductionSchema.partial({
          producerId: true,
          producerName: true,
          producerPhone: true,
        }),
      }),
  );
}
