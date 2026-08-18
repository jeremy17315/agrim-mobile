import { TRACKING_CONFIG } from '@agrim/contracts';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';

import { usePushLocations } from '@/api/deliveries';

/**
 * Émission de la position du livreur pendant une course.
 *
 * Trois contraintes gouvernent ce code :
 *
 *  - La permission GPS n'est demandée QU'AU démarrage effectif du suivi,
 *    jamais à l'ouverture de l'écran.
 *  - Le réseau ivoirien connaît des zones sans couverture : les points sont
 *    mis en file localement et rejoués au retour du signal. Le serveur
 *    déduplique, l'envoi peut donc être retenté sans risque.
 *  - Batterie et forfait data : la cadence vient de `TRACKING_CONFIG`, pas de
 *    valeurs dispersées dans les écrans.
 */

export type TrackingPoint = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  recordedAt: string;
};

export type CourierTrackingState = {
  isTracking: boolean;
  /** `false` quand l'utilisateur a refusé la localisation. */
  hasPermission: boolean | null;
  /** Points en attente d'envoi (coupure réseau). */
  queuedCount: number;
  /**
   * Dernière position connue, si le suivi a déjà relevé un point.
   *
   * Exposée pour joindre une position à la validation par code sans déclencher
   * de nouvelle demande de permission ni faire attendre le livreur : c'est une
   * information de traçabilité, jamais une condition.
   */
  lastPosition: TrackingPoint | null;
  error: string | null;
};

export function useCourierTracking(deliveryId: string) {
  const [state, setState] = useState<CourierTrackingState>({
    isTracking: false,
    hasPermission: null,
    queuedCount: 0,
    lastPosition: null,
    error: null,
  });

  const subscription = useRef<Location.LocationSubscription | null>(null);
  const queue = useRef<TrackingPoint[]>([]);
  const isFlushing = useRef(false);
  const pushMutation = usePushLocations();

  /**
   * Vide la file vers le serveur. En cas d'échec, les points sont remis en
   * tête : perdre une trace vaut mieux que la dupliquer, mais ne rien perdre
   * vaut encore mieux.
   */
  const flush = useCallback(async () => {
    if (isFlushing.current || queue.current.length === 0) return;
    isFlushing.current = true;

    const batch = queue.current.slice(0, 100);
    queue.current = queue.current.slice(batch.length);

    try {
      await pushMutation.mutateAsync({ deliveryId, points: batch });
      setState((s) => ({
        ...s,
        queuedCount: queue.current.length,
        error: null,
      }));
    } catch {
      // Réseau indisponible : on réinsère en tête, sans écraser les nouveaux.
      queue.current = [...batch, ...queue.current].slice(
        0,
        TRACKING_CONFIG.offlineQueueMaxPoints,
      );
      setState((s) => ({ ...s, queuedCount: queue.current.length }));
    } finally {
      isFlushing.current = false;
    }
  }, [deliveryId, pushMutation]);

  const stop = useCallback(() => {
    subscription.current?.remove();
    subscription.current = null;
    setState((s) => ({ ...s, isTracking: false }));
  }, []);

  const start = useCallback(async () => {
    // La permission est demandée ICI, au moment où elle devient nécessaire.
    const { granted } = await Location.requestForegroundPermissionsAsync();
    if (!granted) {
      setState((s) => ({
        ...s,
        hasPermission: false,
        error: 'Autorisez la localisation pour suivre la livraison.',
      }));
      return false;
    }

    setState((s) => ({ ...s, hasPermission: true, error: null }));

    subscription.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: TRACKING_CONFIG.distanceIntervalMeters,
        timeInterval: TRACKING_CONFIG.timeIntervalSeconds * 1000,
      },
      (position) => {
        const point: TrackingPoint = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy ?? undefined,
          heading:
            position.coords.heading !== null && position.coords.heading >= 0
              ? position.coords.heading
              : undefined,
          speed:
            position.coords.speed !== null && position.coords.speed >= 0
              ? position.coords.speed
              : undefined,
          // Horodatage de la MESURE : un rejeu tardif ne fausse pas le trajet.
          recordedAt: new Date(position.timestamp).toISOString(),
        };

        queue.current = [...queue.current, point].slice(
          -TRACKING_CONFIG.offlineQueueMaxPoints,
        );
        setState((s) => ({
          ...s,
          queuedCount: queue.current.length,
          lastPosition: point,
        }));
        void flush();
      },
    );

    setState((s) => ({ ...s, isTracking: true }));
    return true;
  }, [flush]);

  // L'abonnement doit disparaître avec l'écran : un capteur GPS laissé actif
  // viderait la batterie du livreur en arrière-plan.
  useEffect(() => stop, [stop]);

  return { ...state, start, stop, flush };
}
