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
  deliveryFee: number;
  total: number;
}

export interface DeliveryFeeRules {
  baseFee: number;
  freeDeliveryThreshold: number;
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
  options: DeliveryFeeRules,
): CartTotals {
  const subtotal = lines.reduce((sum, l) => sum + computeLineTotal(l), 0);
  // Livraison offerte au-delà du seuil ; panier vide = pas de frais.
  const deliveryFee =
    subtotal === 0 || subtotal >= options.freeDeliveryThreshold
      ? 0
      : options.baseFee;
  return { subtotal, deliveryFee, total: subtotal + deliveryFee };
}

/**
 * Montant restant avant la livraison offerte. `0` signifie « seuil atteint ».
 * Utilisé pour la barre de progression du panier.
 */
export function amountUntilFreeDelivery(
  subtotal: number,
  options: DeliveryFeeRules,
): number {
  if (subtotal >= options.freeDeliveryThreshold) return 0;
  return options.freeDeliveryThreshold - subtotal;
}
