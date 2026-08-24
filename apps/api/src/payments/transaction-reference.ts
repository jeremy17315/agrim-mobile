/**
 * Identifiant de transaction envoyé au fournisseur.
 *
 * Il porte la référence de commande pour rester lisible dans le back-office de
 * l'agrégateur, suivie d'un suffixe aléatoire : une commande peut donner lieu à
 * plusieurs tentatives de paiement, et un agrégateur refuse un identifiant déjà vu.
 *
 * `randomInt` plutôt que `Math.random` : cet identifiant se retrouve dans des
 * URL de retour, il ne doit pas être devinable.
 */
import { randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function buildTransactionReference(orderReference: string): string {
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${orderReference}-${suffix}`;
}
