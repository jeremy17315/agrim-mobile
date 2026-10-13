import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';

/**
 * Identité d'installation de l'application — pas une identité personnelle.
 *
 * Un UUID aléatoire, créé une fois sur l'appareil, sert à relier le jeton de
 * notification à l'appareil (client sans compte compris). Il n'est jamais
 * affiché et ne contient rien de l'utilisateur. Effacer les données de
 * l'application le remet à zéro.
 */
const INSTALLATION_KEY = 'agrim.push.installationId';
const PROMO_KEY = 'agrim.push.promoOptIn';
const INSTALLATION_PATTERN = /^[A-Za-z0-9-]{16,64}$/;

let cached: string | null = null;

export async function getInstallationId(): Promise<string> {
  if (cached) return cached;
  const stored = await AsyncStorage.getItem(INSTALLATION_KEY);
  if (stored && INSTALLATION_PATTERN.test(stored)) {
    cached = stored;
    return stored;
  }
  const created = randomUUID();
  await AsyncStorage.setItem(INSTALLATION_KEY, created);
  cached = created;
  return created;
}

/**
 * Réglage « Recevoir les promotions ». Désactivé par défaut : aucune
 * promotion sans choix explicite du client.
 */
export async function getPromoOptIn(): Promise<boolean> {
  return (await AsyncStorage.getItem(PROMO_KEY)) === 'true';
}

export async function setPromoOptInLocal(value: boolean): Promise<void> {
  await AsyncStorage.setItem(PROMO_KEY, value ? 'true' : 'false');
}
