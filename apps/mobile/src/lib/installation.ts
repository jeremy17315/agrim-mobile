import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Identité de l'APPAREIL, et non d'un compte.
 *
 * Un client qui commande en invité doit pouvoir être prévenu — paiement
 * confirmé, livreur en route — sans créer de compte. Le serveur rattache donc
 * le jeton de notification à une installation : un identifiant aléatoire,
 * fabriqué une fois et conservé sur l'appareil.
 *
 * Ce n'est PAS un secret et il ne donne aucun droit : il sert uniquement à
 * retrouver la ligne `PushDevice` à mettre à jour (numéro de l'invité, refus
 * des promotions). Le compte, lui, vient toujours du jeton de session.
 *
 * Le stockage est volontairement tolérant : si AsyncStorage est indisponible
 * (navigateur en navigation privée, stockage plein), l'identifiant vit le temps
 * de la session au lieu de faire échouer l'enregistrement.
 */

const INSTALLATION_KEY = 'agrim.installationId';
const GUEST_PHONE_KEY = 'agrim.guestPhone';

let cachedInstallationId: string | null = null;
let cachedGuestPhone: string | null = null;

/** 32 caractères aléatoires : les collisions entre appareils sont exclues. */
function createInstallationId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let index = 0; index < 32; index += 1) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export async function getInstallationId(): Promise<string> {
  if (cachedInstallationId) return cachedInstallationId;

  try {
    const stored = await AsyncStorage.getItem(INSTALLATION_KEY);
    if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) {
      cachedInstallationId = stored;
      return stored;
    }
  } catch {
    // Stockage indisponible : on continue avec un identifiant de session.
  }

  const created = createInstallationId();
  cachedInstallationId = created;
  try {
    await AsyncStorage.setItem(INSTALLATION_KEY, created);
  } catch {
    // Sans persistance, l'appareil s'enregistrera sous un nouvel identifiant
    // au prochain démarrage : gênant, jamais bloquant.
  }
  return created;
}

/**
 * Numéro déclaré par un invité sur cet appareil.
 *
 * Conservé pour que l'enregistrement suivant (nouveau démarrage, jeton obtenu
 * plus tard) le renvoie : sans lui, l'appareil d'un invité redeviendrait
 * injoignable après une réinstallation ou un redémarrage.
 */
export async function getGuestPhone(): Promise<string | null> {
  if (cachedGuestPhone) return cachedGuestPhone;
  try {
    const stored = await AsyncStorage.getItem(GUEST_PHONE_KEY);
    if (stored) cachedGuestPhone = stored;
  } catch {
    // Rien à faire : l'appelant se passera du numéro.
  }
  return cachedGuestPhone;
}

export async function rememberGuestPhone(phone: string): Promise<void> {
  cachedGuestPhone = phone;
  try {
    await AsyncStorage.setItem(GUEST_PHONE_KEY, phone);
  } catch {
    // Le numéro reste en mémoire pour cette session.
  }
}
