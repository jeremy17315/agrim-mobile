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
 *
 * `OUT_FOR_DELIVERY → READY` est le SEUL retour en arrière du parcours. Il
 * traduit un fait physique : le livreur a trouvé porte close, la marchandise
 * revient en entrepôt et repart plus tard. Sans cette arête, une course
 * échouée laissait la commande bloquée à `OUT_FOR_DELIVERY` — statut qu'aucun
 * rôle ne peut quitter — avec son stock réservé pour toujours.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'READY', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
} as const;

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/**
 * Paiement : machine à états ASYNCHRONE — et, depuis le 11 octobre 2026,
 * à DEUX régimes.
 *
 * Régime historique (agrégateur) : la transaction est confirmée par le
 * fournisseur (webhook, puis reconfirmation par appel sortant). Concerne les
 * commandes antérieures à l'abandon des agrégateurs ; conservé pour ne pas
 * casser leur historique.
 *
 * Régime en vigueur (**paiement direct manuel**) : le client transfère
 * lui-même vers le numéro officiel d'AGRIM, déclare sa transaction, et un
 * responsable constate la réception réelle des fonds. Les statuts
 * `DECLARED_BY_CUSTOMER` → `UNDER_REVIEW` → `SUCCEEDED` (ou `REJECTED`)
 * décrivent ce chemin.
 *
 * Règle inchangée et non négociable : **une réponse du frontend n'est jamais
 * une preuve de paiement**. `SUCCEEDED` ne s'atteint que par une action
 * d'administrateur authentifié et journalisée.
 */
export const PAYMENT_STATUSES = [
  'PENDING',
  'AWAITING_CONFIRMATION',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
  'REFUNDED',
  /** Le client a déclaré un transfert. Rien n'est encore vérifié. */
  'DECLARED_BY_CUSTOMER',
  /** Vérification humaine en cours, ou montant annoncé ≠ montant attendu. */
  'UNDER_REVIEW',
  /** Déclaration écartée par AGRIM (référence fausse, fonds non reçus…). */
  'REJECTED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Statuts atteints uniquement par une décision humaine d'AGRIM. */
export const MANUAL_PAYMENT_STATUSES = [
  'DECLARED_BY_CUSTOMER',
  'UNDER_REVIEW',
] as const satisfies readonly PaymentStatus[];

/**
 * Statuts dits « en suspens » : la commande attend encore une décision de
 * paiement. Un écran qui rafraîchit un statut doit traiter ces valeurs comme
 * « ça peut encore bouger ».
 */
export const PAYMENT_PENDING_STATUSES = [
  'PENDING',
  'AWAITING_CONFIRMATION',
  'DECLARED_BY_CUSTOMER',
  'UNDER_REVIEW',
] as const satisfies readonly PaymentStatus[];

export function isPaymentSettled(status: PaymentStatus): boolean {
  return (
    status === 'SUCCEEDED' ||
    status === 'FAILED' ||
    status === 'EXPIRED' ||
    status === 'REFUNDED'
  );
}

export function isPaymentPending(status: PaymentStatus): boolean {
  return (PAYMENT_PENDING_STATUSES as readonly PaymentStatus[]).includes(status);
}

export const PAYMENT_METHODS = [
  /** Historique : agrégateur mobile money (plus utilisé pour les nouvelles commandes). */
  'MOBILE_MONEY',
  'CARD',
  'CASH_ON_DELIVERY',
  /**
   * **Paiement direct manuel** — régime en vigueur.
   * Le client transfère vers le numéro officiel d'AGRIM et déclare sa
   * transaction ; AGRIM vérifie puis confirme.
   */
  'DIRECT_MOBILE_MONEY',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Méthodes proposables sur une NOUVELLE commande.
 *
 * `MOBILE_MONEY` et `CARD` en sont exclus : ils supposent un agrégateur, que
 * la décision commerciale a écarté. Les accepter à la création rouvrirait un
 * encaissement par commission.
 */
export const NEW_ORDER_PAYMENT_METHODS = [
  'DIRECT_MOBILE_MONEY',
  'CASH_ON_DELIVERY',
] as const satisfies readonly PaymentMethod[];
export type NewOrderPaymentMethod = (typeof NEW_ORDER_PAYMENT_METHODS)[number];

/** Opérateurs mobile money pertinents en Côte d'Ivoire. */
export const MOBILE_MONEY_PROVIDERS = [
  'ORANGE_MONEY',
  'MTN_MOMO',
  'MOOV_MONEY',
  'WAVE',
] as const;
export type MobileMoneyProvider = (typeof MOBILE_MONEY_PROVIDERS)[number];

/**
 * Origine d'un mouvement de stock — vocabulaire officiel, partagé.
 *
 * Le signe de la quantité dit le SENS (+ entrée, − sortie) ; ce type dit la
 * RAISON. Les deux sont nécessaires : un −2 de vente et un −2 de casse
 * n'appellent pas la même lecture d'inventaire.
 *
 * Doit rester identique à l'énumération `StockMovementType` du schéma Prisma.
 */
export const STOCK_MOVEMENT_TYPES = [
  'ENTREE',
  'SORTIE',
  'AJUSTEMENT',
  'COMMANDE',
  'ANNULATION',
  'RETOUR',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/**
 * Mouvements qu'un humain peut invoquer depuis l'administration.
 *
 * `COMMANDE` et `ANNULATION` en sont exclus : ils décrivent ce que le système
 * fait seul, et un gestionnaire qui les choisirait falsifierait l'historique
 * des ventes.
 */
export const MANUAL_STOCK_MOVEMENT_TYPES = [
  'ENTREE',
  'SORTIE',
  'AJUSTEMENT',
  'RETOUR',
] as const satisfies readonly StockMovementType[];
export type ManualStockMovementType =
  (typeof MANUAL_STOCK_MOVEMENT_TYPES)[number];

export const DELIVERY_STATUSES = [
  'UNASSIGNED',
  'ASSIGNED',
  'ACCEPTED',
  'IN_TRANSIT',
  'ARRIVED',
  'OTP_VERIFIED',
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
  ACCEPTED: ['IN_TRANSIT', 'FAILED'],
  IN_TRANSIT: ['ARRIVED', 'FAILED'],
  ARRIVED: ['OTP_VERIFIED', 'FAILED'],
  // Franchi par le backend seul, après vérification de l'OTP.
  OTP_VERIFIED: ['DELIVERED'],
  DELIVERED: [],
  // Une course échouée peut être REMISE EN JEU par la gestion : la marchandise
  // est revenue en entrepôt, elle repart avec un livreur — le même ou un autre.
  // La cible est `ASSIGNED` et non `UNASSIGNED` parce que `assign()` nomme
  // toujours un livreur dans le même geste ; il n'existe pas d'endpoint qui
  // renvoie une course au pot commun.
  //
  // Cette arête n'appartient qu'au bureau : `FAILED` n'est pas dans
  // COURIER_SETTABLE_DELIVERY_STATUSES comme point de départ autorisé pour le
  // terrain, donc un livreur ne se réattribue jamais une course qu'il vient
  // d'abandonner.
  FAILED: ['ASSIGNED'],
} as const;

/**
 * Statuts qu'un livreur peut positionner lui-même.
 *
 * `OTP_VERIFIED` et `DELIVERED` en sont volontairement absents : la clôture
 * d'une course n'appartient pas au terrain. Elle résulte de la vérification
 * d'un OTP par le backend, et d'elle seule. Un livreur ne peut donc jamais
 * déclarer une commande livrée.
 */
export const COURIER_SETTABLE_DELIVERY_STATUSES = [
  'ACCEPTED',
  'IN_TRANSIT',
  'ARRIVED',
  'FAILED',
] as const satisfies readonly DeliveryStatus[];

export type CourierSettableDeliveryStatus =
  (typeof COURIER_SETTABLE_DELIVERY_STATUSES)[number];

export function isCourierSettable(
  status: DeliveryStatus,
): status is CourierSettableDeliveryStatus {
  return (
    COURIER_SETTABLE_DELIVERY_STATUSES as readonly DeliveryStatus[]
  ).includes(status);
}

export function canTransitionDelivery(
  from: DeliveryStatus,
  to: DeliveryStatus,
): boolean {
  return DELIVERY_TRANSITIONS[from].includes(to);
}

/**
 * Statuts depuis lesquels la course est terminée POUR LE LIVREUR.
 *
 * Nuance à ne pas perdre : `FAILED` est terminal pour le terrain — le livreur
 * n'a plus rien à faire, la course sort de sa tournée — mais pas pour la
 * gestion, qui peut la remettre en jeu (`FAILED → UNASSIGNED`). Cette fonction
 * répond « le livreur a-t-il fini ? », pas « le dossier est-il clos ? ».
 */
export function isDeliveryTerminal(status: DeliveryStatus): boolean {
  return status === 'DELIVERED' || status === 'FAILED';
}

export const NOTIFICATION_TYPES = [
  'ORDER_CREATED',
  'ORDER_CONFIRMED',
  'ORDER_PREPARING',
  'ORDER_READY',
  /** Prête au retrait en point de vente (pas encore de mode « retrait » en base). */
  'ORDER_READY_FOR_PICKUP',
  'ORDER_OUT_FOR_DELIVERY',
  'ORDER_DELIVERED',
  'ORDER_CANCELLED',
  'DELIVERY_ASSIGNED',
  'DELIVERY_OTP',
  'DELIVERY_FAILED',
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  /** Le client a déclaré un transfert : l'équipe doit aller vérifier. */
  'PAYMENT_DECLARED',
  /** Réception des fonds confirmée par un responsable AGRIM. */
  'PAYMENT_CONFIRMED',
  /** Déclaration écartée (fonds non reçus, référence invalide, montant faux). */
  'PAYMENT_REJECTED',
  /** Montant annoncé différent du montant attendu : arbitrage humain. */
  'PAYMENT_AMOUNT_MISMATCH',
  /** Campagne commerciale envoyée depuis l'administration. */
  'PROMOTION',
  'LOW_STOCK',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Devise : XOF, entier, SANS décimales. Jamais de float pour l'argent. */
export const CURRENCY = 'XOF' as const;
