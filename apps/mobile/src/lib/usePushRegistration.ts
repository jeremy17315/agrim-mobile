import {
  deepLinkFromData,
  deepLinkToPath,
  NOTIFICATION_FALLBACK_PATH,
} from '@agrim/contracts';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useAppConfig } from '@/api/config';
import { registerPushDevice, unlinkPushDevice } from '@/api/notifications';
import { getGuestPhone, getInstallationId } from '@/lib/installation';
import { useAuthStore } from '@/store/auth';

/**
 * Notifications poussées : cycle de vie de l'appareil et des liens reçus.
 *
 * Ce que ce fichier garantit, point par point :
 *
 *  - **Recevoir SANS compte.** C'est l'INSTALLATION qui est enregistrée, pas
 *    l'utilisateur : un client qui commande en invité reçoit la confirmation
 *    de son paiement et l'arrivée de son livreur. Le compte, s'il existe, est
 *    ajouté par le serveur depuis le jeton de session.
 *  - **Ne pas promettre l'impossible.** Si le serveur n'envoie pas
 *    (`push.enabled = false` publié par `GET /config/app`), la permission
 *    n'est même pas demandée : on ne fait pas accepter des alertes qui
 *    n'arriveront jamais.
 *  - **Un tap mène quelque part.** La destination enregistrée par le serveur
 *    (`target`/`value`) devient la route de l'écran via `deepLinkToPath` —
 *    fiche produit, catalogue, suivi de commande, dossier interne. Destination
 *    absente ou inconnue : la liste des notifications.
 *  - **La déconnexion détache sans éteindre.** L'appareil ne reçoit plus les
 *    notifications du compte précédent (sinon le compte suivant lirait
 *    celles du précédent) mais reste actif pour les commandes invitées.
 *  - **Android d'abord.** Le canal doit exister AVANT la demande de jeton
 *    (Android 13+), et un émulateur ne délivre aucun jeton : on n'insiste pas.
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

/**
 * Plateforme déclarée au serveur, ou `null` sur le web.
 *
 * Le web n'a pas de jeton de notification : rien à enregistrer, et surtout pas
 * une plateforme inventée.
 */
const PLATFORM: 'ios' | 'android' | null =
  Platform.OS === 'ios'
    ? 'ios'
    : Platform.OS === 'android'
      ? 'android'
      : null;

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
  const config = useAppConfig();
  const pushEnabled = config.data?.push.enabled ?? null;

  const device = useRef<{ installationId: string; token: string } | null>(null);
  const wasAuthenticated = useRef(false);
  const handledResponses = useRef<Set<string>>(new Set());

  // Enregistrement, rattachement et détachement au fil de la session.
  useEffect(() => {
    const loggedOut = wasAuthenticated.current && userId === null;
    wasAuthenticated.current = userId !== null;

    if (loggedOut) {
      const current = device.current;
      device.current = null;
      if (current) void unlinkPushDevice(current).catch(() => undefined);
      return;
    }

    // Rien ne peut être envoyé (développement, recette) : on ne demande pas la
    // permission, et l'écran des notifications le dit à sa manière.
    if (pushEnabled !== true || PLATFORM === null) return;

    let cancelled = false;

    void (async () => {
      try {
        const installationId = await getInstallationId();
        const token = await resolveToken();
        if (cancelled || !token) return;

        const phone = await getGuestPhone();
        await registerPushDevice({
          installationId,
          token,
          platform: PLATFORM,
          phone: phone ?? undefined,
        });
        if (cancelled) return;
        device.current = { installationId, token };
      } catch {
        // Sans push, l'application fonctionne : on n'alerte pas l'utilisateur.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pushEnabled, userId]);

  // Un tap sur une notification mène à la destination enregistrée par le
  // serveur, y compris lorsque l'application est ouverte PAR ce tap.
  useEffect(() => {
    const open = (data: unknown, identifier: string) => {
      if (handledResponses.current.has(identifier)) return;
      handledResponses.current.add(identifier);

      const link = deepLinkFromData(
        data as Record<string, unknown> | undefined,
      );
      const path = link ? deepLinkToPath(link) : null;
      // `deepLinkToPath` ne produit QUE des routes de l'application : le
      // contrat partagé est la liste de ce que le mobile sait ouvrir. La
      // conversion est donc sûre, et l'affirmation est portée ici, à un seul
      // endroit, plutôt que dispersée dans les écrans.
      router.push((path ?? NOTIFICATION_FALLBACK_PATH) as Href);
    };

    const subscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        open(
          response.notification.request.content.data,
          response.notification.request.identifier,
        );
      });

    // Application lancée par une notification : l'écouteur ci-dessus n'a rien
    // vu passer. `finally` plutôt que `then` : un échec de lecture ne doit pas
    // empêcher l'abonnement de rester en place.
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response) return;
        open(
          response.notification.request.content.data,
          response.notification.request.identifier,
        );
      })
      .catch(() => undefined);

    return () => subscription.remove();
  }, [router]);
}
