/**
 * Énumérations métier partagées AGRIM-Mobile.
 * Source de vérité unique : mobile + backend + Prisma s'alignent sur ces valeurs.
 */

export const ROLES = [
  'CLIENT',
  'LIVREUR',
  'PRODUCTEUR',
  'GESTIONNAIRE',
  'ADMIN',
  'DG',
] as const;
export type Role = (typeof ROLES)[number];

/** Statuts de commande — machine à états (section 28). */
export const ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Transitions autorisées. Toute transition hors de cette table est refusée
 * par le backend (source d'intégrité, jamais l'UI).
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
} as const;

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/**
 * Paiement : machine à états ASYNCHRONE.
 * Le mobile money se confirme hors de l'app (USSD/redirection) puis via webhook.
 * Une réponse du frontend n'est JAMAIS une preuve de paiement (section 29).
 */
export const PAYMENT_STATUSES = [
  'PENDING',
  'AWAITING_CONFIRMATION',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
  'REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = [
  'MOBILE_MONEY',
  'CARD',
  'CASH_ON_DELIVERY',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Opérateurs mobile money pertinents en Côte d'Ivoire. */
export const MOBILE_MONEY_PROVIDERS = [
  'ORANGE_MONEY',
  'MTN_MOMO',
  'MOOV_MONEY',
  'WAVE',
] as const;
export type MobileMoneyProvider = (typeof MOBILE_MONEY_PROVIDERS)[number];

export const DELIVERY_STATUSES = [
  'UNASSIGNED',
  'ASSIGNED',
  'ACCEPTED',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
  'FAILED',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * Transitions autorisées d'une livraison. Comme pour les commandes, cette
 * table est la SEULE source de vérité : le backend la fait respecter, l'UI ne
 * fait que la refléter.
 *
 * `FAILED` reste accessible depuis toute course engagée : un livreur peut
 * trouver porte close à n'importe quel moment du trajet.
 */
export const DELIVERY_TRANSITIONS: Record<
  DeliveryStatus,
  readonly DeliveryStatus[]
> = {
  UNASSIGNED: ['ASSIGNED'],
  // Réassignation possible tant que le livreur n'a pas accepté.
  ASSIGNED: ['ACCEPTED', 'UNASSIGNED'],
  ACCEPTED: ['PICKED_UP', 'FAILED'],
  PICKED_UP: ['IN_TRANSIT', 'FAILED'],
  IN_TRANSIT: ['DELIVERED', 'FAILED'],
  DELIVERED: [],
  FAILED: [],
} as const;

export function canTransitionDelivery(
  from: DeliveryStatus,
  to: DeliveryStatus,
): boolean {
  return DELIVERY_TRANSITIONS[from].includes(to);
}

/** Statuts depuis lesquels la course est terminée. */
export function isDeliveryTerminal(status: DeliveryStatus): boolean {
  return status === 'DELIVERED' || status === 'FAILED';
}

export const NOTIFICATION_TYPES = [
  'ORDER_CREATED',
  'ORDER_CONFIRMED',
  'ORDER_PREPARING',
  'ORDER_READY',
  'ORDER_OUT_FOR_DELIVERY',
  'ORDER_DELIVERED',
  'ORDER_CANCELLED',
  'DELIVERY_ASSIGNED',
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'LOW_STOCK',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Devise : XOF, entier, SANS décimales. Jamais de float pour l'argent. */
export const CURRENCY = 'XOF' as const;
