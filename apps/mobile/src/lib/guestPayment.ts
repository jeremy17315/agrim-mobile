import * as SecureStore from 'expo-secure-store';

/**
 * Capacité de paiement d'une commande sans compte.
 *
 * Elle ne remplace pas une session client : elle est courte, limitée à une
 * seule référence et stockée dans le coffre natif uniquement pour permettre le
 * retour depuis la page Mobile Money.
 */
const keyFor = (reference: string) => `guest-payment:${reference}`;

export async function saveGuestPaymentAccess(
  reference: string,
  token: string,
): Promise<void> {
  await SecureStore.setItemAsync(keyFor(reference), token);
}

export function getGuestPaymentAccess(
  reference: string,
): Promise<string | null> {
  return SecureStore.getItemAsync(keyFor(reference));
}

export function clearGuestPaymentAccess(reference: string): Promise<void> {
  return SecureStore.deleteItemAsync(keyFor(reference));
}
