import {
  courierSummarySchema,
  managedOrderSchema,
  managerDashboardSchema,
  stockItemSchema,
  type OrderStatus,
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

export type ManagedOrder = z.infer<typeof managedOrderSchema>;
export type ManagerDashboard = z.infer<typeof managerDashboardSchema>;
export type StockItem = z.infer<typeof stockItemSchema>;
export type CourierSummary = z.infer<typeof courierSummarySchema>;

export const managementKeys = {
  all: ['management'] as const,
  dashboard: () => [...managementKeys.all, 'dashboard'] as const,
  orders: (filters?: { status?: OrderStatus; search?: string }) =>
    [...managementKeys.all, 'orders', filters ?? {}] as const,
  stock: (onlyAlerts?: boolean) =>
    [...managementKeys.all, 'stock', onlyAlerts ?? false] as const,
  couriers: () => [...managementKeys.all, 'couriers'] as const,
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
