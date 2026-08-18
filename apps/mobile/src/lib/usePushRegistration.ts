import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { registerPushToken, removePushToken } from '@/api/notifications';
import { useAuthStore } from '@/store/auth';

/**
 * Notifications poussées : cycle de vie du jeton d'appareil.
 *
 * Points de vigilance traités ici :
 *  - la permission n'est demandée qu'une fois l'utilisateur connecté, jamais à
 *    l'ouverture de l'application devant un écran vide ;
 *  - le canal Android doit exister AVANT la demande de jeton (Android 13+) ;
 *  - un émulateur ne délivre pas de jeton : on n'insiste pas ;
 *  - le jeton est retiré du serveur à la déconnexion, sinon le compte suivant
 *    recevrait les notifications du précédent.
 *
 * Aucun échec ici n'est bloquant : l'application reste utilisable sans push,
 * les notifications restent consultables dans l'écran dédié.
 */

/** Affichage lorsque l'application est au premier plan. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

async function resolveToken(): Promise<string | null> {
  // Un simulateur ne possède pas de jeton de notification distant.
  if (!Device.isDevice) return null;

  if (Platform.OS === 'android') {
    // Doit précéder getExpoPushTokenAsync sur Android 13+.
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Commandes et livraisons',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    // Redemander à chaque lancement après un refus serait harcelant : le
    // système ne réaffiche de toute façon pas la boîte de dialogue.
    if (!existing.canAskAgain) return null;
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId) return null;

  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return token.data;
}

export function usePushRegistration() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const registeredToken = useRef<string | null>(null);

  // Enregistrement / retrait au fil de la session.
  useEffect(() => {
    let cancelled = false;

    const platform = Platform.OS === 'ios' ? 'ios' : 'android';

    if (userId === null) {
      const stale = registeredToken.current;
      registeredToken.current = null;
      if (stale) void removePushToken(stale, platform).catch(() => {});
      return;
    }

    void (async () => {
      try {
        const token = await resolveToken();
        if (!token || cancelled) return;
        await registerPushToken(token, platform);
        registeredToken.current = token;
      } catch {
        // Sans push, l'application fonctionne : on n'alerte pas l'utilisateur.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Ouverture depuis une notification : mener à la commande concernée.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as {
          reference?: string;
        };
        if (typeof data?.reference === 'string' && data.reference.length > 0) {
          router.push(`/commandes/${data.reference}`);
        } else {
          router.push('/notifications');
        }
      },
    );
    return () => subscription.remove();
  }, [router]);
}
