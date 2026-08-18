/**
 * Calculs monétaires du panier.
 * Tout est en XOF entier : aucun flottant, donc aucune erreur d'arrondi.
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
  options: { baseFee: number; freeDeliveryThreshold: number },
): CartTotals {
  const subtotal = lines.reduce((sum, l) => sum + computeLineTotal(l), 0);
  // Livraison offerte au-delà du seuil ; panier vide = pas de frais.
  const deliveryFee =
    subtotal === 0 || subtotal >= options.freeDeliveryThreshold
      ? 0
      : options.baseFee;
  return { subtotal, deliveryFee, total: subtotal + deliveryFee };
}
