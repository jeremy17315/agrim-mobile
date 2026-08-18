/**
 * Direction générale : indicateurs consolidés.
 *
 * Trois partis pris qui conditionnent la lecture des chiffres :
 *
 *  1. **Le chiffre d'affaires exclut les commandes annulées.** Une commande
 *     annulée n'a jamais produit de recette ; l'inclure gonflerait le CA d'un
 *     montant qui n'existe pas.
 *  2. **L'espace DG est en lecture seule.** Aucune décision opérationnelle ne
 *     s'y prend : piloter depuis un écran d'agrégats court-circuiterait les
 *     contrôles métier des espaces gestionnaire et livreur.
 *  3. **Les périodes sont des mois calendaires** dans le fuseau de l'entreprise
 *     (Abidjan, UTC+0), pas des fenêtres glissantes : c'est la maille dont
 *     parlent les équipes.
 */

/** Nombre de mois affichés dans l'historique des ventes. */
export const SALES_HISTORY_MONTHS = 6;

/**
 * Au-delà de ce délai, une course encore en cours est signalée à la direction.
 *
 * Valeur provisoire : aucun engagement de service n'a été arrêté avec AGRIM.
 * À ajuster ici, sans toucher au code.
 */
export const DELIVERY_SLA_HOURS = 4;

export const MONTH_LABELS = [
  'Jan',
  'Fév',
  'Mar',
  'Avr',
  'Mai',
  'Juin',
  'Juil',
  'Août',
  'Sep',
  'Oct',
  'Nov',
  'Déc',
] as const;

/**
 * Variation en pourcentage entre deux périodes.
 *
 * Renvoie `null` quand la période de référence est nulle : passer de 0 à
 * quelque chose n'est pas « +100 % », c'est un point de départ. Afficher un
 * pourcentage ici induirait en erreur.
 */
export function growthRate(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Panier moyen. Sans commande, la moyenne n'existe pas — on renvoie 0 plutôt
 * que `NaN`, que l'affichage propagerait.
 */
export function averageBasket(revenue: number, orderCount: number): number {
  if (orderCount <= 0) return 0;
  return Math.round(revenue / orderCount);
}

/**
 * Part de chaque gamme, en pourcentage entier.
 *
 * Les arrondis individuels ne totalisent pas toujours 100 % : le reste est
 * reporté sur la part la plus élevée pour que la somme affichée soit juste.
 */
export function distributionShares<T extends { revenue: number }>(
  rows: readonly T[],
): (T & { share: number })[] {
  const total = rows.reduce((sum, row) => sum + row.revenue, 0);
  if (total <= 0) return rows.map((row) => ({ ...row, share: 0 }));

  const withShares = rows.map((row) => ({
    ...row,
    share: Math.round((row.revenue / total) * 100),
  }));

  const drift = 100 - withShares.reduce((sum, row) => sum + row.share, 0);
  if (drift !== 0 && withShares.length > 0) {
    let biggest = 0;
    for (let i = 1; i < withShares.length; i += 1) {
      if (withShares[i]!.revenue > withShares[biggest]!.revenue) biggest = i;
    }
    withShares[biggest]!.share += drift;
  }

  return withShares;
}

/**
 * Seuil d'alerte sur les clôtures d'exception, en pourcentage des livraisons.
 *
 * Au-delà, le parcours par code ne fonctionne pas sur le terrain : le problème
 * est à corriger dans le produit, pas à absorber par les gestionnaires.
 */
export const MANUAL_CLOSURE_ALERT_RATE = 10;
