/**
 * CODES PROMO — contrat partagé.
 *
 * Règle non négociable : **le serveur décide du rabais**. Le client envoie un
 * code (une chaîne), jamais un montant. Toute la logique de validité vit dans
 * `evaluatePromoCode`, appelée par le devis panier ET par le checkout — deux
 * chemins, une seule règle : un code refusé au devis ne peut pas passer à la
 * commande, et un code accepté ne peut pas changer de valeur entre les deux.
 */

export const PROMO_DISCOUNT_TYPES = ['PERCENT', 'FIXED'] as const;
export type PromoDiscountType = (typeof PROMO_DISCOUNT_TYPES)[number];

export interface PromoCodeRule {
  code: string;
  description: string | null;
  discountType: PromoDiscountType;
  /** Pourcentage (1-100) ou montant en XOF entier, selon `discountType`. */
  discountValue: number;
  minOrderTotal: number | null;
  /** Formats concernés (références `sourceRef` ou `sku`). Vide = tout le panier. */
  appliesTo: string[];
  /** Zone de livraison concernée. `null` = toutes. */
  zone: string | null;
  maxUses: number | null;
  usedCount: number;
  maxUsesPerPhone: number | null;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
}

export type PromoRejectionReason =
  | 'INCONNU'
  | 'INACTIF'
  | 'PAS_ENCORE_VALIDE'
  | 'EXPIRE'
  | 'QUOTA_ATTEINT'
  | 'QUOTA_TELEPHONE_ATTEINT'
  | 'PANIER_INSUFFISANT'
  | 'AUCUN_PRODUIT_CONCERNE'
  | 'HORS_ZONE';

export interface PromoEvaluationInput {
  /** Le code tel que saisi par le client (casse et espaces ignorés). */
  code: string;
  /** Lignes du panier, avec leur prix effectif et leur rattachement produit. */
  lines: {
    unitPrice: number;
    quantity: number;
    /** Référence site (sourceRef) ou, à défaut, sku. */
    sourceRef: string | null;
    sku: string;
  }[];
  /** Sous-total AVANT remise, en XOF entier. */
  subtotal: number;
  zone: string | null;
  /** Nombre d'utilisations déjà faites par ce téléphone, si connu. */
  usesByPhone?: number;
  /** Instant de l'évaluation — injecté pour être testable. */
  now: Date;
}

export type PromoEvaluation =
  | {
      status: 'ok';
      code: string;
      /** Remise en XOF entier, bornée au sous-total. */
      discount: number;
      message: string;
    }
  | { status: 'refused'; code: string; reason: PromoRejectionReason; message: string };

/** Message affiché au client, par motif de refus. */
export const PROMO_REFUSAL_MESSAGES: Record<PromoRejectionReason, string> = {
  INCONNU: 'Ce code promo n’existe pas.',
  INACTIF: 'Ce code promo n’est plus actif.',
  PAS_ENCORE_VALIDE: 'Ce code promo n’est pas encore valable.',
  EXPIRE: 'Ce code promo a expiré.',
  QUOTA_ATTEINT: 'Ce code promo a atteint sa limite d’utilisation.',
  QUOTA_TELEPHONE_ATTEINT:
    'Vous avez déjà utilisé ce code promo le nombre de fois autorisé.',
  PANIER_INSUFFISANT: 'Le montant de votre panier est insuffisant pour ce code.',
  AUCUN_PRODUIT_CONCERNE:
    'Ce code ne s’applique à aucun article de votre panier.',
  HORS_ZONE: 'Ce code promo ne s’applique pas à votre zone de livraison.',
};

/** Normalisation d'un code saisi : majuscules, sans espaces ni tirets parasites. */
export function normalizePromoCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * La règle de validité, unique et pure.
 *
 * Ordre des contrôles délibéré : existence → activation → dates → quotas →
 * panier. Un code expiré doit dire « expiré », pas « panier insuffisant » :
 * le motif affiché est ce que le client lira pour comprendre.
 */
export function evaluatePromoCode(
  rule: PromoCodeRule | null,
  input: PromoEvaluationInput,
): PromoEvaluation {
  const code = normalizePromoCode(input.code);

  if (!rule) {
    return {
      status: 'refused',
      code,
      reason: 'INCONNU',
      message: PROMO_REFUSAL_MESSAGES.INCONNU,
    };
  }
  if (!rule.isActive) {
    return {
      status: 'refused',
      code,
      reason: 'INACTIF',
      message: PROMO_REFUSAL_MESSAGES.INACTIF,
    };
  }

  const now = input.now.getTime();
  if (rule.startsAt && new Date(rule.startsAt).getTime() > now) {
    return {
      status: 'refused',
      code,
      reason: 'PAS_ENCORE_VALIDE',
      message: PROMO_REFUSAL_MESSAGES.PAS_ENCORE_VALIDE,
    };
  }
  if (rule.endsAt && new Date(rule.endsAt).getTime() < now) {
    return {
      status: 'refused',
      code,
      reason: 'EXPIRE',
      message: PROMO_REFUSAL_MESSAGES.EXPIRE,
    };
  }
  if (rule.maxUses !== null && rule.usedCount >= rule.maxUses) {
    return {
      status: 'refused',
      code,
      reason: 'QUOTA_ATTEINT',
      message: PROMO_REFUSAL_MESSAGES.QUOTA_ATTEINT,
    };
  }
  if (
    rule.maxUsesPerPhone !== null &&
    input.usesByPhone !== undefined &&
    input.usesByPhone >= rule.maxUsesPerPhone
  ) {
    return {
      status: 'refused',
      code,
      reason: 'QUOTA_TELEPHONE_ATTEINT',
      message: PROMO_REFUSAL_MESSAGES.QUOTA_TELEPHONE_ATTEINT,
    };
  }
  if (rule.zone && input.zone && rule.zone !== input.zone) {
    return {
      status: 'refused',
      code,
      reason: 'HORS_ZONE',
      message: PROMO_REFUSAL_MESSAGES.HORS_ZONE,
    };
  }
  if (
    rule.minOrderTotal !== null &&
    input.subtotal < rule.minOrderTotal
  ) {
    return {
      status: 'refused',
      code,
      reason: 'PANIER_INSUFFISANT',
      message: PROMO_REFUSAL_MESSAGES.PANIER_INSUFFISANT,
    };
  }

  // Base de calcul : les articles CONCERNÉS par le code. Un code « Royal
  // Grains » ne doit pas remiser un sac de Djassa.
  const targeted =
    rule.appliesTo.length === 0
      ? input.lines
      : input.lines.filter((line) =>
          rule.appliesTo.some(
            (ref) => ref === line.sourceRef || ref === line.sku,
          ),
        );

  if (targeted.length === 0) {
    return {
      status: 'refused',
      code,
      reason: 'AUCUN_PRODUIT_CONCERNE',
      message: PROMO_REFUSAL_MESSAGES.AUCUN_PRODUIT_CONCERNE,
    };
  }

  const base = targeted.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0,
  );

  const raw =
    rule.discountType === 'PERCENT'
      ? Math.floor((base * clampPercent(rule.discountValue)) / 100)
      : rule.discountValue;

  // Bornes : jamais de remise négative, jamais plus que le panier.
  const discount = Math.max(0, Math.min(raw, input.subtotal));
  if (discount === 0) {
    return {
      status: 'refused',
      code,
      reason: 'AUCUN_PRODUIT_CONCERNE',
      message: PROMO_REFUSAL_MESSAGES.AUCUN_PRODUIT_CONCERNE,
    };
  }

  return {
    status: 'ok',
    code,
    discount,
    message: rule.description ?? `Code ${code} appliqué`,
  };
}

/** Un pourcentage hors bornes est traité comme une donnée corrompue, pas comme un cadeau. */
function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.trunc(value)));
}

/** Le code est-il affiché comme « en cours de validité » dans l'administration ? */
export function isPromoCodeLive(
  rule: Pick<PromoCodeRule, 'isActive' | 'startsAt' | 'endsAt' | 'maxUses' | 'usedCount'>,
  now: Date,
): boolean {
  if (!rule.isActive) return false;
  const time = now.getTime();
  if (rule.startsAt && new Date(rule.startsAt).getTime() > time) return false;
  if (rule.endsAt && new Date(rule.endsAt).getTime() < time) return false;
  if (rule.maxUses !== null && rule.usedCount >= rule.maxUses) return false;
  return true;
}
