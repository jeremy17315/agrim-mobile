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
   * Crédit de parrainage RÉELLEMENT consommé par ce panier : à soustraire.
   *
   * Toujours inférieur ou égal au solde du compte ET à ce qui restait à payer
   * après remise (voir `applicableCredit`). C'est ce montant — jamais le solde
   * — que la commande fige, parce que c'est lui qui a été débité.
   */
  credit: number;
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
 * Ce que ce module accepte : les remises et le crédit. Les frais de livraison
 * ne sont plus un intrant — ils ne sont jamais additionnés.
 */
export interface CartOptions {
  /** Remise globale (volume + code promo) déjà décidée par le serveur. */
  remise?: number;
  /**
   * Crédit de parrainage PROPOSÉ (le solde du compte), pas le montant à
   * consommer : `computeCartTotals` le plafonne au reste à payer. Un compte de
   * 5 000 F qui paie une commande de 2 000 F en consomme 2 000 — le solde
   * restant est celui du compte, pas du panier.
   */
  credit?: number;
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

/**
 * Montant de crédit qu'un panier peut absorber.
 *
 * Deux plafonds, dans cet ordre : ce que le compte possède, et ce qu'il reste
 * à payer. Le second est ce qui empêche un crédit généreux de transformer une
 * commande en avoir négatif — l'application ne rend jamais la monnaie d'un
 * crédit non dépensé, elle le laisse sur le compte pour la commande suivante.
 * Un solde négatif (jamais écrit par l'API, mais possible par accident de
 * données) vaut zéro plutôt que d'augmenter la facture.
 */
export function applicableCredit(balance: number, payable: number): number {
  if (!Number.isFinite(balance) || balance <= 0) return 0;
  if (!Number.isFinite(payable) || payable <= 0) return 0;
  return Math.min(Math.floor(balance), Math.floor(payable));
}

export function computeCartTotals(
  lines: readonly CartLine[],
  options: CartOptions = {},
): CartTotals {
  const subtotal = lines.reduce((sum, l) => sum + computeLineTotal(l), 0);
  // Une remise ne dépasse jamais ce qui est vendu : un panier ne peut pas
  // devenir négatif par excès de générosité d'un code promo.
  const remise = Math.min(Math.max(options.remise ?? 0, 0), subtotal);
  // Le crédit vient APRÈS la remise : il plafonne sur ce qui reste réellement
  // à payer, sinon un code promo et un crédit cumulés passeraient sous zéro.
  const credit = applicableCredit(options.credit ?? 0, subtotal - remise);
  return {
    subtotal,
    remise,
    credit,
    deliveryFee: 0,
    total: subtotal - remise - credit,
  };
}
