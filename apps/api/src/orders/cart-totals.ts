/**
 * Les calculs de panier vivent dans @agrim/contracts : mobile et API doivent
 * produire des montants identiques. Ce fichier ne fait que réexporter, pour
 * ne pas casser les imports existants du module orders.
 *
 * `computeDeliveryFee` y figure depuis la décision du 29 août 2026 : le tarif
 * n'est plus déduit d'un forfait local, il vient de la grille du site.
 */
export {
  computeCartTotals,
  computeDeliveryFee,
  computeLineTotal,
  resolveDeliveryZone,
  weightUntilFreeDelivery,
  type CartLine,
  type CartTotals,
  type CartDeliveryFee,
  type DeliveryGrid,
} from '@agrim/contracts';
