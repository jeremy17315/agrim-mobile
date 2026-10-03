/**
 * Calculs monétaires du panier — PARTAGÉS entre le mobile et l'API.
 *
 * Ces fonctions vivent dans le contrat, pas dans une application : le panier
 * local du mobile et le recalcul serveur au moment de la commande doivent
 * produire le MÊME montant. Deux implémentations séparées finiraient par
 * diverger, et le client verrait un total changer entre le panier et le
 * paiement — la pire chose qui puisse arriver à la confiance.
 *
 * Tout est en XOF entier : aucun flottant, donc aucune erreur d'arrondi.
 * Le serveur reste l'autorité : le total local est un affichage, celui de la
 * commande est celui que l'API recalcule.
 */

export interface CartLine {
  unitPrice: number;
  quantity: number;
}

export interface CartTotals {
  subtotal: number;
  /** Remises déjà calculées (volume, code promo) : à soustraire. */
  remise: number;
  /**
   * Montant ENCAISSÉ pour la livraison — toujours `0`.
   *
   * Le site n'ajoute aucun frais de livraison au total payable, de la mise au
   * panier jusqu'au paiement : sa ligne « Livraison » affiche « À confirmer »
   * (domicile) ou « Gratuit » (retrait), et le total reste le sous-total moins
   * les remises. L'application suit cette logique — la grille du site ne sert
   * plus qu'à décrire la zone et son délai.
   *
   * Le champ reste nommé `deliveryFee` parce que la colonne de la commande et
   * les réponses d'API portent ce nom ; sa valeur est désormais, honnêtement,
   * le montant facturé en ligne : zéro.
   */
  deliveryFee: number;
  total: number;
}

/**
 * Ce que ce module accepte : les remises. Les frais de livraison ne sont
 * plus un intrant — ils ne sont jamais additionnés.
 */
export interface CartOptions {
  /** Remise globale (volume + code promo) déjà décidée par le serveur. */
  remise?: number;
}

export function computeLineTotal(line: CartLine): number {
  if (!Number.isInteger(line.unitPrice) || line.unitPrice < 0) {
    throw new Error('Prix unitaire invalide');
  }
  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    throw new Error('Quantité invalide');
  }
  return line.unitPrice * line.quantity;
}

export function computeCartTotals(
  lines: readonly CartLine[],
  options: CartOptions = {},
): CartTotals {
  const subtotal = lines.reduce((sum, l) => sum + computeLineTotal(l), 0);
  // Une remise ne dépasse jamais ce qui est vendu : un panier ne peut pas
  // devenir négatif par excès de générosité d'un code promo.
  const remise = Math.min(Math.max(options.remise ?? 0, 0), subtotal);
  return {
    subtotal,
    remise,
    deliveryFee: 0,
    total: subtotal - remise,
  };
}
