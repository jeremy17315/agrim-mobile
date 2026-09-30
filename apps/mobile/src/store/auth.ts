import { userSchema, type User } from '@agrim/contracts';
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
import { ApiError } from '@/api/errors';
import { hasInternetConnection } from '@/lib/network';

/**
 * SESSION UTILISATEUR.
 *
 * Les tokens sont des secrets : ils vont dans SecureStore (Keychain iOS /
 * Keystore Android), JAMAIS dans AsyncStorage — contrairement au panier, qui
 * n'a aucune valeur pour un attaquant.
 *
 * Le profil utilisateur n'est pas secret, mais il est aussi conservé dans le
 * coffre : hors ligne, il permet de rendre l'interface déjà autorisée (rôle,
 * nom) sans prétendre valider une nouvelle opération.
 * Dès que le réseau revient, la rotation de session le relit côté serveur.
 */

const ACCESS_TOKEN_KEY = 'agrim.accessToken';
const REFRESH_TOKEN_KEY = 'agrim.refreshToken';
const USER_KEY = 'agrim.sessionUser';

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

function parseStoredUser(raw: string | null): User | null {
  if (!raw) return null;
  try {
    const parsed = userSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function saveSession(
  accessToken: string,
  refreshToken: string,
  user: User,
): Promise<void> {
  await Promise.all([
    vaultSet(ACCESS_TOKEN_KEY, accessToken),
    vaultSet(REFRESH_TOKEN_KEY, refreshToken),
    vaultSet(USER_KEY, JSON.stringify(user)),
  ]);
}

async function clearStoredSession(): Promise<void> {
  await Promise.all([
    vaultDelete(ACCESS_TOKEN_KEY),
    vaultDelete(REFRESH_TOKEN_KEY),
    vaultDelete(USER_KEY),
  ]);
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
   * Restaure la session au lancement.
   *
   * En ligne, le refresh reste la vérification d'autorité. Hors ligne, on
   * restaure la dernière session locale pour que l'utilisateur puisse au moins
   * consulter ses données déjà présentes ; aucune écriture métier ne partira
   * tant que le réseau n'est pas revenu.
   */
  restore: async () => {
    if (!hasSecureVault) {
      set({ hydrated: true });
      return;
    }

    const [storedAccess, storedRefresh, storedUserRaw] = await Promise.all([
      vaultGet(ACCESS_TOKEN_KEY),
      vaultGet(REFRESH_TOKEN_KEY),
      vaultGet(USER_KEY),
    ]);
    const storedUser = parseStoredUser(storedUserRaw);

    if (!storedRefresh) {
      set({ hydrated: true });
      return;
    }

    const restoreLocalSession = () => {
      if (!storedAccess || !storedUser) return false;
      set({
        user: storedUser,
        accessToken: storedAccess,
        refreshToken: storedRefresh,
        hydrated: true,
      });
      return true;
    };

    try {
      if (!(await hasInternetConnection())) {
        if (!restoreLocalSession()) set({ hydrated: true });
        return;
      }

      const session = await refreshSession(storedRefresh);
      await saveSession(session.accessToken, session.refreshToken, session.user);
      set({
        user: session.user,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        hydrated: true,
      });
    } catch (error) {
      // Une coupure, un DNS indisponible ou une maintenance serveur n'est PAS
      // une déconnexion. Seul un 401 du refresh prouve que la session est morte.
      if (!(error instanceof ApiError && error.isAuthError)) {
        if (!restoreLocalSession()) set({ hydrated: true });
        return;
      }

      await clearStoredSession();
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
    await saveSession(session.accessToken, session.refreshToken, session.user);
    set({
      user: session.user,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      hydrated: true,
    });
  },

  signUp: async (payload) => {
    const session = await registerRequest(payload);
    await saveSession(session.accessToken, session.refreshToken, session.user);
    set({
      user: session.user,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      hydrated: true,
    });
  },

  deleteAccount: async () => {
    await deleteAccountRequest();
    await clearStoredSession();
    set({ user: null, accessToken: null, refreshToken: null });
  },

  signOut: async () => {
    const { refreshToken } = get();
    // On efface localement d'abord : même si le serveur est injoignable,
    // l'utilisateur doit être déconnecté sur l'appareil.
    set({ user: null, accessToken: null, refreshToken: null });
    await clearStoredSession();

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
    await saveSession(session.accessToken, session.refreshToken, session.user);
    useAuthStore.setState({
      user: session.user,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    });
    return session.accessToken;
  } catch (error) {
    // Toute indisponibilité temporaire laisse l'accès local intact. Seule une
    // réponse 401 confirme que le refresh token n'est plus valable.
    if (!(error instanceof ApiError && error.isAuthError)) return null;

    await clearStoredSession();
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
