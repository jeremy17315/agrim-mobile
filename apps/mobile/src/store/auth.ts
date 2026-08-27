import type { User } from '@agrim/contracts';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';

import {
  deleteAccount as deleteAccountRequest,
  login as loginRequest,
  logout as logoutRequest,
  refreshSession,
  register as registerRequest,
  type LoginPayload,
  type RegisterPayload,
} from '@/api/auth';
import { setSessionRefresher, setTokenProvider } from '@/api/client';

/**
 * SESSION UTILISATEUR.
 *
 * Les tokens sont des secrets : ils vont dans SecureStore (Keychain iOS /
 * Keystore Android), JAMAIS dans AsyncStorage — contrairement au panier, qui
 * n'a aucune valeur pour un attaquant.
 *
 * Le profil utilisateur, lui, n'est pas secret : il est conservé en mémoire et
 * rechargé depuis l'API. On ne duplique pas des données serveur dans un store
 * persistant.
 */

const ACCESS_TOKEN_KEY = 'agrim.accessToken';
const REFRESH_TOKEN_KEY = 'agrim.refreshToken';

/**
 * SecureStore n'existe pas sur le web : on dégrade explicitement en mémoire
 * plutôt que de laisser l'application planter, et on n'écrit alors aucun
 * secret sur le disque du navigateur.
 */
const memoryVault = new Map<string, string>();

/**
 * SecureStore n'existe pas sur le web. On le sait de façon SYNCHRONE, ce qui
 * permet de ne pas afficher d'écran d'attente là où il n'y a rien à restaurer.
 */
const hasSecureVault = Platform.OS !== 'web';
const secureStoreAvailable =
  hasSecureVault && SecureStore.isAvailableAsync !== undefined;

async function vaultGet(key: string): Promise<string | null> {
  try {
    if (!secureStoreAvailable || !(await SecureStore.isAvailableAsync())) {
      return memoryVault.get(key) ?? null;
    }
    return await SecureStore.getItemAsync(key);
  } catch {
    return memoryVault.get(key) ?? null;
  }
}

async function vaultSet(key: string, value: string): Promise<void> {
  try {
    if (!secureStoreAvailable || !(await SecureStore.isAvailableAsync())) {
      memoryVault.set(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  } catch {
    memoryVault.set(key, value);
  }
}

async function vaultDelete(key: string): Promise<void> {
  memoryVault.delete(key);
  try {
    if (secureStoreAvailable && (await SecureStore.isAvailableAsync())) {
      await SecureStore.deleteItemAsync(key);
    }
  } catch {
    // Rien à faire : la session est de toute façon considérée fermée.
  }
}

type AuthState = {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  /** Faux tant que la session stockée n'a pas été relue au démarrage. */
  hydrated: boolean;

  restore: () => Promise<void>;
  signIn: (payload: LoginPayload) => Promise<void>;
  signUp: (payload: RegisterPayload) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
};

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  // Sans coffre sécurisé (web), aucune session ne peut avoir été persistée :
  // inutile de faire patienter l'utilisateur devant un écran vide.
  hydrated: !hasSecureVault,

  /**
   * Restaure la session au lancement. On ne fait pas confiance au token
   * stocké : on le rafraîchit, ce qui vérifie du même coup qu'il est encore
   * valide côté serveur.
   */
  restore: async () => {
    if (!hasSecureVault) {
      set({ hydrated: true });
      return;
    }

    const stored = await vaultGet(REFRESH_TOKEN_KEY);
    if (!stored) {
      set({ hydrated: true });
      return;
    }

    try {
      const session = await refreshSession(stored);
      await vaultSet(ACCESS_TOKEN_KEY, session.accessToken);
      await vaultSet(REFRESH_TOKEN_KEY, session.refreshToken);
      set({
        user: session.user,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        hydrated: true,
      });
    } catch {
      // Token révoqué, expiré ou réseau coupé : on repart déconnecté plutôt
      // que de laisser l'application dans un état ambigu.
      await vaultDelete(ACCESS_TOKEN_KEY);
      await vaultDelete(REFRESH_TOKEN_KEY);
      set({
        user: null,
        accessToken: null,
        refreshToken: null,
        hydrated: true,
      });
    }
  },

  signIn: async (payload) => {
    const session = await loginRequest(payload);
    await vaultSet(ACCESS_TOKEN_KEY, session.accessToken);
    await vaultSet(REFRESH_TOKEN_KEY, session.refreshToken);
    set({
      user: session.user,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      hydrated: true,
    });
  },

  signUp: async (payload) => {
    const session = await registerRequest(payload);
    await vaultSet(ACCESS_TOKEN_KEY, session.accessToken);
    await vaultSet(REFRESH_TOKEN_KEY, session.refreshToken);
    set({
      user: session.user,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      hydrated: true,
    });
  },

  deleteAccount: async () => {
    await deleteAccountRequest();
    await vaultDelete(ACCESS_TOKEN_KEY);
    await vaultDelete(REFRESH_TOKEN_KEY);
    set({ user: null, accessToken: null, refreshToken: null });
  },

  signOut: async () => {
    const { refreshToken } = get();
    // On efface localement d'abord : même si le serveur est injoignable,
    // l'utilisateur doit être déconnecté sur l'appareil.
    set({ user: null, accessToken: null, refreshToken: null });
    await vaultDelete(ACCESS_TOKEN_KEY);
    await vaultDelete(REFRESH_TOKEN_KEY);

    if (refreshToken) {
      try {
        await logoutRequest(refreshToken);
      } catch {
        // Révocation impossible hors ligne ; le token expirera de lui-même.
      }
    }
  },
}));

// Le client HTTP lit le token ici. Cette indirection évite un import circulaire
// entre le client et le store.
setTokenProvider(() => useAuthStore.getState().accessToken);

// Renouvellement automatique sur 401. Le client déduplique les appels
// concurrents ; ici on se contente de faire tourner la rotation.
setSessionRefresher(async () => {
  const { refreshToken } = useAuthStore.getState();
  if (!refreshToken) return null;

  try {
    const session = await refreshSession(refreshToken);
    await vaultSet(ACCESS_TOKEN_KEY, session.accessToken);
    await vaultSet(REFRESH_TOKEN_KEY, session.refreshToken);
    useAuthStore.setState({
      user: session.user,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    });
    return session.accessToken;
  } catch {
    // Refresh refusé : la session est morte, on nettoie l'appareil.
    await vaultDelete(ACCESS_TOKEN_KEY);
    await vaultDelete(REFRESH_TOKEN_KEY);
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
    });
    return null;
  }
});

/** Vrai si une session est ouverte. */
export function useIsAuthenticated(): boolean {
  return useAuthStore((s) => s.accessToken !== null);
}
