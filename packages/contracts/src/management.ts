import type { OrderStatus } from './enums';

/**
 * Espace gestionnaire.
 *
 * Le gestionnaire fait avancer les commandes jusqu'à la remise au livreur ;
 * au-delà, c'est la course qui pilote (voir `deliveries`). Les règles ici
 * décrivent ce qu'il a le droit de faire, jamais ce que l'interface affiche.
 */

/**
 * Transitions que le gestionnaire déclenche lui-même.
 *
 * `OUT_FOR_DELIVERY` et `DELIVERED` en sont volontairement absents : ils
 * découlent de l'action du livreur sur le terrain. Les poser à la main ferait
 * mentir le suivi client.
 */
export const MANAGER_ORDER_ACTIONS: Partial<
  Record<OrderStatus, { next: OrderStatus; label: string }>
> = {
  PENDING: { next: 'CONFIRMED', label: 'Confirmer' },
  CONFIRMED: { next: 'PREPARING', label: 'Préparer' },
  PREPARING: { next: 'READY', label: 'Marquer prête' },
} as const;

export function managerActionFor(status: OrderStatus) {
  return MANAGER_ORDER_ACTIONS[status] ?? null;
}

/** Une commande prête attend une assignation, pas un changement de statut. */
export function awaitsCourierAssignment(status: OrderStatus): boolean {
  return status === 'READY';
}

/**
 * Statuts qui composent la file de travail du jour. Les commandes livrées ou
 * annulées n'y figurent pas : elles ne demandent plus rien.
 */
export const MANAGER_QUEUE_STATUSES: readonly OrderStatus[] = [
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY',
] as const;

/** Un gestionnaire peut annuler tant que le colis n'est pas parti. */
export function isCancellableByManager(status: OrderStatus): boolean {
  return (
    status !== 'DELIVERED' &&
    status !== 'CANCELLED' &&
    status !== 'OUT_FOR_DELIVERY'
  );
}

/* ------------------------------- Stocks --------------------------------- */

export type StockLevel = 'OK' | 'LOW' | 'CRITICAL' | 'OUT';

/**
 * Niveau d'alerte d'une variante.
 *
 * Le seuil est propre à chaque variante : comparer tous les formats à un même
 * nombre déclencherait des alertes permanentes sur les petits conditionnements.
 * « Critique » se déclenche à la moitié du seuil — assez tôt pour agir, assez
 * tard pour ne pas noyer le gestionnaire.
 */
export function stockLevel(stock: number, threshold: number): StockLevel {
  if (stock <= 0) return 'OUT';
  if (threshold <= 0) return 'OK';
  if (stock <= Math.floor(threshold / 2)) return 'CRITICAL';
  if (stock <= threshold) return 'LOW';
  return 'OK';
}

export const STOCK_LEVEL_PRESENTATION: Record<
  StockLevel,
  { label: string; tone: 'green' | 'warn' | 'danger' | 'neutral' }
> = {
  OK: { label: 'OK', tone: 'green' },
  LOW: { label: 'Faible', tone: 'warn' },
  CRITICAL: { label: 'Critique', tone: 'danger' },
  OUT: { label: 'Rupture', tone: 'neutral' },
};

/** Part du seuil déjà couverte, bornée à 100 % pour l'affichage. */
export function stockRatio(stock: number, threshold: number): number {
  if (threshold <= 0) return 100;
  return Math.min(100, Math.round((stock / threshold) * 100));
}

/** Limites de saisie d'un réapprovisionnement. */
export const STOCK_LIMITS = {
  /** Garde-fou de saisie, pas une règle logistique. */
  maxAdjustment: 100_000,
  minThreshold: 0,
  maxThreshold: 100_000,
} as const;
