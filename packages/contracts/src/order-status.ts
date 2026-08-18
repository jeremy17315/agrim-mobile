import type { OrderStatus } from './enums';

/**
 * Présentation des statuts de commande — PARTAGÉE.
 *
 * Les libellés vivent dans le contrat pour qu'une notification, un écran
 * client et un tableau de bord gestionnaire nomment la même chose de la même
 * façon. Rien ici ne décide d'une transition : l'intégrité reste au backend.
 */

export interface OrderStatusPresentation {
  /** Libellé court, affichable dans une étiquette. */
  label: string;
  /** Phrase destinée au client, à la première personne du pluriel. */
  description: string;
}

export const ORDER_STATUS_PRESENTATION: Record<
  OrderStatus,
  OrderStatusPresentation
> = {
  PENDING: {
    label: 'En attente',
    description: 'Nous avons bien reçu votre commande.',
  },
  CONFIRMED: {
    label: 'Confirmée',
    description: 'Votre commande est confirmée par AGRIM.',
  },
  PREPARING: {
    label: 'En préparation',
    description: 'Votre riz est en cours de préparation.',
  },
  READY: {
    label: 'Prête',
    description: 'Votre commande est prête à partir.',
  },
  OUT_FOR_DELIVERY: {
    label: 'En livraison',
    description: 'Le livreur est en route.',
  },
  DELIVERED: {
    label: 'Livrée',
    description: 'Votre commande a été livrée. Merci !',
  },
  CANCELLED: {
    label: 'Annulée',
    description: 'Cette commande a été annulée.',
  },
};

/**
 * Étapes affichées dans le suivi, dans l'ordre. `CANCELLED` n'en fait pas
 * partie : une annulation interrompt le parcours au lieu de le poursuivre.
 */
export const ORDER_PROGRESS_STEPS = [
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const satisfies readonly OrderStatus[];

export type OrderProgressStep = (typeof ORDER_PROGRESS_STEPS)[number];

/**
 * Statuts pour lesquels le client peut encore annuler lui-même.
 *
 * `OUT_FOR_DELIVERY` en est volontairement exclu : la marchandise est déjà
 * partie avec le livreur. Annuler à ce stade recréditerait un stock qui n'est
 * pas revenu en entrepôt et laisserait une course active vers un client qui
 * croit avoir annulé. Passé ce point, la sortie se fait par le terrain — le
 * livreur clôt la course en échec — et non par un bouton dans l'application.
 *
 * Même frontière que `isCancellableByManager` : bureau et client s'arrêtent où
 * commence la route.
 */
export const CLIENT_CANCELLABLE_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY',
] as const satisfies readonly OrderStatus[];

export function isCancellableByClient(status: OrderStatus): boolean {
  return (CLIENT_CANCELLABLE_STATUSES as readonly OrderStatus[]).includes(
    status,
  );
}

/**
 * Position d'un statut dans la progression : `-1` si le statut n'appartient
 * pas au parcours nominal (commande annulée).
 */
export function orderProgressIndex(status: OrderStatus): number {
  return (ORDER_PROGRESS_STEPS as readonly OrderStatus[]).indexOf(status);
}

/** Vrai si la commande ne bougera plus. */
export function isTerminalStatus(status: OrderStatus): boolean {
  return status === 'DELIVERED' || status === 'CANCELLED';
}
