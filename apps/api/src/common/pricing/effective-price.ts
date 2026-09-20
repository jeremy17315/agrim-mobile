/**
 * LA règle de prix client — partagée par le checkout, le catalogue et les
 * lectures publiques.
 *
 * Pourquoi un module séparé : ces trois chemins ont fini par DIVERGER —
 * la fiche admin appliquait une promotion périmée (dates jamais relues),
 * les lectures publiques n'exposaient AUCUN prix promotionnel (le site
 * affichait le prix normal pendant que le checkout facturait le promo).
 * Une règle de prix qui vit à trois endroits est trois règles de prix.
 *
 * Sémantique (docs/refonte/10 §10) : une promotion est ACTIVE si elle est
 * activée ET dans sa fenêtre de validité ; le prix client est alors le MIN
 * du prix de base et du prix promotionnel — le `min` est un garde-fou final
 * (l'administration garantit déjà `priceXof <= base`), pas la règle.
 */

/** Champs de promotion nécessaires pour trancher l'activité. */
export interface PromotionFenetre {
  isActive: boolean;
  startsAt: Date;
  endsAt: Date | null;
}

/** Une promotion est active si activée ET dans sa fenêtre de validité. */
export function promotionActive(
  promo: PromotionFenetre,
  now: Date = new Date(),
): boolean {
  const commencee = promo.startsAt.getTime() <= now.getTime();
  const nonTerminee = !promo.endsAt || promo.endsAt.getTime() >= now.getTime();
  return promo.isActive && commencee && nonTerminee;
}

/** Filtre les promotions actives à l'instant donné (ordre conservé). */
export function promosActives<T extends PromotionFenetre>(
  promotions: readonly T[],
  now: Date = new Date(),
): T[] {
  return promotions.filter((promo) => promotionActive(promo, now));
}

/** Prix client : la promotion active ne peut qu'abaisser le prix de base. */
export function prixEffectif(
  basePrice: number,
  promo: { priceXof: number } | null | undefined,
): number {
  return promo ? Math.min(promo.priceXof, basePrice) : basePrice;
}
