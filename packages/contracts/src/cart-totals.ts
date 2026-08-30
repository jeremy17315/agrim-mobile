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

/**
 * Frais de livraison DÉJÀ décidés, à additionner.
 *
 * Ce module ne calcule plus le montant : depuis la décision du 29 août 2026,
 * il vient de la grille du site (`computeDeliveryFee`, dans `delivery.ts`).
 * Additionner et décider sont deux responsabilités, et les mélanger avait
 * produit exactement le défaut corrigé — un forfait local qui contredisait le
 * tarif officiel.
 */
export interface CartDeliveryFee {
  deliveryFee: number;
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
  options: CartDeliveryFee,
): CartTotals {
  const subtotal = lines.reduce((sum, l) => sum + computeLineTotal(l), 0);
  // Un panier vide ne coûte pas de livraison, quel que soit le tarif : il n'y
  // a rien à transporter.
  const deliveryFee = subtotal === 0 ? 0 : options.deliveryFee;
  return { subtotal, deliveryFee, total: subtotal + deliveryFee };
}
