/**
 * Espace producteur : cycle de vie d'une déclaration de production.
 *
 * Un producteur déclare une récolte ; la coopérative la vérifie puis la
 * réceptionne. Le producteur n'est jamais l'auteur de sa propre validation —
 * sinon la déclaration ne vaudrait rien comme pièce de suivi.
 */

export const PRODUCTION_STATUSES = [
  'DECLARED',
  'CONFIRMED',
  'RECEIVED',
  'REJECTED',
] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

/** Transitions autorisées, contrôlées par le backend. */
export const PRODUCTION_TRANSITIONS: Record<
  ProductionStatus,
  readonly ProductionStatus[]
> = {
  DECLARED: ['CONFIRMED', 'REJECTED'],
  CONFIRMED: ['RECEIVED', 'REJECTED'],
  RECEIVED: [],
  REJECTED: [],
} as const;

export function canTransitionProduction(
  from: ProductionStatus,
  to: ProductionStatus,
): boolean {
  return PRODUCTION_TRANSITIONS[from].includes(to);
}

export function isProductionTerminal(status: ProductionStatus): boolean {
  return PRODUCTION_TRANSITIONS[status].length === 0;
}

/**
 * Une déclaration n'est modifiable ou supprimable que tant qu'elle n'a pas été
 * examinée : après vérification, la corriger fausserait le suivi.
 */
export function isProductionEditable(status: ProductionStatus): boolean {
  return status === 'DECLARED';
}

export const PRODUCTION_STATUS_PRESENTATION: Record<
  ProductionStatus,
  { label: string; tone: 'neutral' | 'info' | 'green' | 'danger'; hint: string }
> = {
  DECLARED: {
    label: 'Déclarée',
    tone: 'neutral',
    hint: 'En attente de vérification par la coopérative.',
  },
  CONFIRMED: {
    label: 'Confirmée',
    tone: 'info',
    hint: 'Vérifiée. Réception en cours d’organisation.',
  },
  RECEIVED: {
    label: 'Réceptionnée',
    tone: 'green',
    hint: 'Récolte réceptionnée par la coopérative.',
  },
  REJECTED: {
    label: 'Rejetée',
    tone: 'danger',
    hint: 'Déclaration refusée. Consultez le motif.',
  },
};

/** Bornes de saisie, partagées entre le formulaire mobile et la validation serveur. */
export const PRODUCTION_LIMITS = {
  /** 1 kg minimum : une déclaration à zéro n'a pas de sens. */
  minQuantityKg: 1,
  /** 500 tonnes : garde-fou contre la faute de frappe, pas une règle agricole. */
  maxQuantityKg: 500_000,
  maxSeasonLength: 40,
  maxCropVarietyLength: 80,
} as const;

export const FARM_LIMITS = {
  maxNameLength: 120,
  maxLocationLength: 160,
  /** Garde-fou de saisie uniquement. */
  maxAreaHectares: 100_000,
} as const;

/**
 * Taux d'avancement d'une saison, borné à 100 % pour l'affichage.
 * Sans objectif, l'indicateur n'a pas de sens : on renvoie `null` plutôt que
 * d'inventer une référence.
 */
export function productionProgress(
  quantityKg: number,
  targetKg: number | null | undefined,
): number | null {
  if (!targetKg || targetKg <= 0) return null;
  return Math.min(100, Math.round((quantityKg / targetKg) * 100));
}
