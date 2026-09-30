import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/**
 * Connectivité unique pour l'application.
 *
 * `fetch` ne permet de savoir qu'après plusieurs secondes qu'un téléphone est
 * hors ligne. NetInfo le signale immédiatement et informe aussi TanStack
 * Query : les requêtes sont alors mises en pause au lieu d'échouer en boucle.
 */
function isReachable(state: NetInfoState): boolean {
  // `null` signifie « état encore inconnu ». On laisse passer les requêtes
  // pendant cette très courte phase plutôt que de bloquer l'application sur un
  // faux hors-ligne au démarrage.
  return state.isConnected !== false && state.isInternetReachable !== false;
}

let monitoringStarted = false;

/** Active une seule fois l'écoute native, depuis la racine de l'application. */
export function startNetworkMonitoring(): void {
  if (monitoringStarted) return;
  monitoringStarted = true;

  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(isReachable(state))),
  );
}

/** État actuel, utile avant un appel réseau critique (restauration de session). */
export async function hasInternetConnection(): Promise<boolean> {
  return isReachable(await NetInfo.fetch());
}

/** État réactif utilisé par les écrans pour rendre les actions réseau honnêtes. */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => onlineManager.subscribe(onStoreChange),
    () => onlineManager.isOnline(),
    // Le rendu serveur de l'aperçu web n'a aucun capteur réseau. L'hydratation
    // côté navigateur remplacera immédiatement cette valeur.
    () => true,
  );
}
