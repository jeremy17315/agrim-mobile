/**
 * Génération de références de commande AGR-YYYY-NNNN.
 *
 * Le compteur est incrémenté dans une transaction atomique : deux commandes
 * simultanées ne peuvent pas obtenir la même référence (section 27).
 */
export function formatOrderReference(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 2000) {
    throw new Error('Année invalide pour une référence de commande');
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error('Séquence invalide pour une référence de commande');
  }
  return `AGR-${year}-${String(sequence).padStart(4, '0')}`;
}
