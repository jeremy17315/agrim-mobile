import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import {
  setPromoPreference,
  registerDevice,
  registerPushToken,
  removePushToken,
} from '@/api/notifications';
import { useAuthStore } from '@/store/auth';

import { pushTargetRoute } from './pushRoute';

import {
  getInstallationId,
  getPromoOptIn,
} from './pushInstallation';

/**
 * Notifications poussées : cycle de vie du jeton d'appareil.
 *
 *  - Deux canaux Android : « commandes » (suivi, service) et « promotions »
 *    (que le client peut couper sans toucher aux commandes).
 *  - La permission n'est JAMAIS demandée à l'ouverture ni à la connexion. Elle
 *    est demandée après la première commande, avec une explication (voir
 *    `OrderNotificationsPrompt`).
 *  - L'appareil est enregistré dès qu'une permission existe, compte ou non.
 *  - Le toucher ouvre la bonne page, application fermée comprise.
 *  - Le jeton est détaché du compte à la déconnexion.
 *
 * Aucun échec ici n'est bloquant : l'application reste utilisable sans push.
 */

export const CHANNEL_ORDERS = 'commandes';
export const CHANNEL_PROMOS = 'promotions';

/** Affichage lorsque l'application est au premier plan. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

function platformOf(): 'ios' | 'android' {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

/** Canaux Android. À créer avant toute demande de jeton (Android 13+). */
export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ORDERS, {
    name: 'Commandes et livraisons',
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  await Notifications.setNotificationChannelAsync(CHANNEL_PROMOS, {
    name: 'Promotions',
    description: 'Offres et nouveautés AGRIM, que vous pouvez désactiver.',
    importance: Notifications.AndroidImportance.LOW,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

async function fetchExpoToken(): Promise<string | null> {
  // Un simulateur ne possède pas de jeton de notification distant.
  if (!Device.isDevice) return null;
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId) return null;
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return token.data;
}

/**
 * Enregistre l'appareil SI la permission est déjà accordée. Ne demande rien.
 * Renvoie le jeton, ou null.
 */
export async function registerDeviceIfGranted(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return null;

  await ensureAndroidChannels();
  const token = await fetchExpoToken();
  if (!token) return null;

  const installationId = await getInstallationId();
  await registerDevice({
    installationId,
    token,
    platform: platformOf(),
  });
  // Le réglage promotionnel local est renvoyé à chaque enregistrement : le
  // serveur ne doit pas l'oublier si la ligne d'appareil est recréée.
  await setPromoPreference(installationId, await getPromoOptIn()).catch(
    () => undefined,
  );
  return token;
}

/**
 * Demande la permission, avec explication préalable faite par l'écran.
 * Ne redemande pas après un refus définitif (le système ne réaffiche rien).
 */
export async function askForOrderNotifications(): Promise<
  'granted' | 'denied' | 'unavailable'
> {
  if (!Device.isDevice) return 'unavailable';
  await ensureAndroidChannels();

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted' && current.canAskAgain) {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return 'denied';

  await registerDeviceIfGranted();
  return 'granted';
}

function routeFromResponse(
  response: Notifications.NotificationResponse,
  router: ReturnType<typeof useRouter>,
) {
  const data = response.notification.request.content.data;
  const loggedIn = useAuthStore.getState().user !== null;
  router.push(pushTargetRoute(data, loggedIn) as Href);
}

export function usePushRegistration() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const registeredToken = useRef<string | null>(null);
  const wasLoggedIn = useRef(false);

  // Déconnexion : détacher l'appareil du compte qui vient de partir.
  useEffect(() => {
    const leaving = wasLoggedIn.current && userId === null;
    wasLoggedIn.current = userId !== null;
    const token = registeredToken.current;
    if (leaving && token) {
      void getInstallationId()
        .then((installationId) =>
          removePushToken(token, platformOf(), installationId),
        )
        .catch(() => undefined);
    }
  }, [userId]);

  // Enregistrement au fil de la session, sans demander de permission.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await registerDeviceIfGranted();
        if (!token || cancelled) return;
        registeredToken.current = token;
        if (userId !== null) {
          const installationId = await getInstallationId();
          await registerPushToken(token, platformOf(), installationId);
        }
      } catch {
        // Sans push, l'application fonctionne : on n'alerte pas l'utilisateur.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Toucher pendant l'exécution, et toucher qui a ouvert l'application à froid.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => routeFromResponse(response, router),
    );
    // Effacée après usage : sinon chaque lancement rouvrirait la même page.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      void Notifications.clearLastNotificationResponseAsync();
      routeFromResponse(response, router);
    });
    return () => subscription.remove();
  }, [router]);
}
