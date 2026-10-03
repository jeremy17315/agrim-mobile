import {
  addressSchema,
  orderSchema,
  paginated,
  type Address,
  type CreateAddressInput,
  type GuestOrderInput,
  type MobileMoneyProvider,
  type Order,
  type PaymentMethod,
} from '@agrim/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { apiRequest } from './client';

/**
 * Adresses et commandes.
 *
 * Le serveur reste l'autorité : on lui envoie des variantes et des quantités,
 * il renvoie les montants. Aucun prix ne circule dans ce sens.
 */

const addressesSchema = z.array(addressSchema);

/** Ligne de l'historique : allégée, sans le détail des articles. */
const orderSummarySchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  status: orderSchema.shape.status,
  total: z.number().int(),
  createdAt: z.iso.datetime(),
  itemCount: z.number().int(),
});
export type OrderSummary = z.infer<typeof orderSummarySchema>;

/**
 * Le détail renvoyé par l'API est plus riche que `orderSchema` (note, paiement
 * imbriqué) : on décrit ici la forme réellement servie plutôt que de forcer le
 * backend à s'aligner sur un schéma partiel.
 */
const orderDetailSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  status: orderSchema.shape.status,
  subtotal: z.number().int(),
  deliveryFee: z.number().int(),
  total: z.number().int(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
  items: z.array(
    z.object({
      id: z.uuid(),
      productName: z.string(),
      variantLabel: z.string(),
      unitPrice: z.number().int(),
      quantity: z.number().int(),
      lineTotal: z.number().int(),
    }),
  ),
  address: addressSchema.omit({ isDefault: true }),
  payment: z
    .object({
      method: orderSchema.shape.paymentMethod,
      status: orderSchema.shape.paymentStatus,
    })
    .nullable(),
  /** Chronologie des changements de statut, du plus ancien au plus récent. */
  events: z.array(
    z.object({
      id: z.uuid(),
      status: orderSchema.shape.status,
      comment: z.string().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
});
export type OrderDetail = z.infer<typeof orderDetailSchema>;

/** Réponse du checkout public : une capacité de paiement n'est renvoyée que
 * pour une commande Mobile Money invitée, jamais pour un compte connecté. */
const guestOrderResponseSchema = orderDetailSchema.extend({
  paymentAccessToken: z.string().min(20).optional(),
});
export type GuestOrderDetail = z.infer<typeof guestOrderResponseSchema>;

const paginatedOrdersSchema = paginated(orderSummarySchema);

export const orderKeys = {
  all: ['orders'] as const,
  list: () => [...orderKeys.all, 'list'] as const,
  detail: (reference: string) =>
    [...orderKeys.all, 'detail', reference] as const,
};

export const addressKeys = {
  all: ['addresses'] as const,
  list: () => [...addressKeys.all, 'list'] as const,
};

/* -------------------------------- Adresses ------------------------------ */

export function fetchAddresses(signal?: AbortSignal): Promise<Address[]> {
  return apiRequest({ path: '/addresses', schema: addressesSchema, signal });
}

export function createAddress(payload: CreateAddressInput): Promise<Address> {
  return apiRequest({
    method: 'POST',
    path: '/addresses',
    body: payload,
    schema: addressSchema,
  });
}

export function useAddresses(enabled = true) {
  return useQuery({
    queryKey: addressKeys.list(),
    queryFn: ({ signal }) => fetchAddresses(signal),
    enabled,
  });
}

export function useCreateAddress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAddress,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: addressKeys.list() });
    },
  });
}

/* ------------------------------- Commandes ------------------------------ */

export type CreateOrderPayload = {
  addressId: string;
  items: { variantId: string; quantity: number }[];
  paymentMethod: PaymentMethod;
  mobileMoneyProvider?: MobileMoneyProvider;
  idempotencyKey: string;
  note?: string;
};

/** Checkout public : trois informations de livraison, aucun compte. */
export type CreateGuestOrderPayload = GuestOrderInput;

/**
 * La livraison telle qu'elle est PRÉSENTÉÉE : un libellé et un délai, jamais
 * un montant à additionner. Le site n'encaisse aucun frais en ligne — sa
 * page `/commander` affiche « À confirmer » et laisse le total intact.
 */
const deliveryQuoteSchema = z.object({
  mode: z.enum(['domicile', 'retrait']),
  zone: z.string(),
  libelle: z.string(),
  delai: z.string(),
  statut: z.enum(['A_CONFIRMER', 'GRATUIT']),
  message: z.string(),
  frais: z.number().int(),
});

const cartQuoteSchema = z.object({
  subtotal: z.number().int(),
  /** Remise décidée par le site (volume, grossiste, code promo). */
  remise: z.number().int().default(0),
  /** `unavailable` : le calculateur est injoignable ⇒ aucune remise. */
  remiseStatus: z.enum(['ok', 'unavailable']).default('unavailable'),
  promoCode: z.string().nullable().default(null),
  promoMessage: z.string().nullable().default(null),
  delivery: deliveryQuoteSchema,
  /** Toujours 0 : aucun frais n'est encaissé en ligne. */
  deliveryFee: z.number().int(),
  total: z.number().int(),
  currency: z.literal('XOF'),
  zone: z.string(),
});
export type CartQuote = z.infer<typeof cartQuoteSchema>;

export function quoteGuestCart(payload: {
  items: { variantId: string; quantity: number }[];
  city: string;
  /** Code promo à faire valider par le calculateur du site. */
  codePromo?: string;
  phone?: string;
}): Promise<CartQuote> {
  return apiRequest({
    method: 'POST',
    path: '/cart/quote',
    body: payload,
    schema: cartQuoteSchema,
    isPublic: true,
  });
}

export function createGuestOrder(
  payload: CreateGuestOrderPayload,
): Promise<GuestOrderDetail> {
  return apiRequest({
    method: 'POST',
    path: '/orders/guest',
    body: payload,
    schema: guestOrderResponseSchema,
    isPublic: true,
  });
}

export function createOrder(payload: CreateOrderPayload): Promise<OrderDetail> {
  return apiRequest({
    method: 'POST',
    path: '/orders',
    body: payload,
    schema: orderDetailSchema,
  });
}

export function fetchOrders(signal?: AbortSignal) {
  return apiRequest({
    path: '/orders',
    schema: paginatedOrdersSchema,
    signal,
  });
}

export function fetchOrder(
  reference: string,
  signal?: AbortSignal,
): Promise<OrderDetail> {
  return apiRequest({
    path: `/orders/${reference}`,
    schema: orderDetailSchema,
    signal,
  });
}

export function cancelOrder(reference: string): Promise<OrderDetail> {
  return apiRequest({
    method: 'POST',
    path: `/orders/${reference}/cancel`,
    schema: orderDetailSchema,
  });
}

export function useOrders(enabled = true) {
  return useQuery({
    queryKey: orderKeys.list(),
    queryFn: ({ signal }) => fetchOrders(signal),
    enabled,
  });
}

export function useOrder(reference: string) {
  return useQuery({
    queryKey: orderKeys.detail(reference),
    queryFn: ({ signal }) => fetchOrder(reference, signal),
    enabled: reference.length > 0,
  });
}

export function useGuestCartQuote() {
  return useMutation({
    mutationFn: quoteGuestCart,
    // Le devis n'écrit rien et peut être relancé quand la zone évolue.
    retry: false,
  });
}

export function useCreateGuestOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createGuestOrder,
    onSuccess: (order) => {
      queryClient.setQueryData(orderKeys.detail(order.reference), order);
    },
    // La clé d'idempotence reste stable dans l'écran tant que le client retente.
    retry: false,
  });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createOrder,
    onSuccess: (order) => {
      // Le stock a bougé et l'historique a changé : on invalide les deux.
      void queryClient.invalidateQueries({ queryKey: orderKeys.list() });
      queryClient.setQueryData(orderKeys.detail(order.reference), order);
    },
    // Une commande n'est JAMAIS rejouée automatiquement par TanStack Query :
    // l'idempotence est gérée explicitement par la clé envoyée au serveur.
    retry: false,
  });
}

export function useCancelOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelOrder,
    onSuccess: (order) => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.list() });
      queryClient.setQueryData(orderKeys.detail(order.reference), order);
    },
    retry: false,
  });
}

export type { Address, Order };
