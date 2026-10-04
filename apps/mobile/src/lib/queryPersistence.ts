import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  dehydrate,
  hydrate,
  type Query,
  type QueryClient,
} from '@tanstack/react-query';
import { Platform } from 'react-native';

/**
 * Cache public du catalogue, conservé pour la consultation hors connexion.
 *
 * On ne persiste volontairement PAS les commandes, adresses, notifications ou
 * réponses authentifiées : elles peuvent être périmées et ne doivent pas être
 * relues par une autre personne qui utiliserait le même téléphone.
 */
// v3 : l'ancienne structure présentait chaque produit comme une gamme.
// Invalider ce cache force l'affichage de l'unique gamme Bélier d’Or et de
// ses cinq produits au prochain démarrage, même après une longue période hors
// connexion.
const CACHE_KEY = 'agrim.catalog-query-cache.v3';
const CACHE_VERSION = 3;
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const WRITE_DEBOUNCE_MS = 250;

type PersistedCatalogCache = {
  version: number;
  persistedAt: number;
  state: ReturnType<typeof dehydrate>;
};

function canUseStorage(): boolean {
  // Metro peut effectuer un rendu web côté serveur. AsyncStorage ne doit être
  // touché que dans le navigateur effectif ; sur iOS et Android il est natif.
  return Platform.OS !== 'web' || typeof window !== 'undefined';
}

function isCatalogQuery(query: Query): boolean {
  return query.queryKey[0] === 'catalog' && query.state.data !== undefined;
}

/** Réhydrate le seul cache qui a une vraie valeur sans réseau : le catalogue. */
export async function restoreCatalogCache(
  queryClient: QueryClient,
): Promise<void> {
  if (!canUseStorage()) return;

  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return;

    const parsed: unknown = JSON.parse(raw);
    if (!isValidCache(parsed)) {
      await AsyncStorage.removeItem(CACHE_KEY);
      return;
    }

    // Les prix et les stocks affichés doivent rester explicitement temporaires.
    // Au-delà d'un mois sans connexion, mieux vaut ne rien afficher plutôt que
    // présenter à tort un vieux catalogue comme actuel.
    if (Date.now() - parsed.persistedAt > MAX_CACHE_AGE_MS) {
      await AsyncStorage.removeItem(CACHE_KEY);
      return;
    }

    hydrate(queryClient, parsed.state);
  } catch {
    // Un cache illisible ne doit jamais empêcher l'ouverture de l'application.
    // La prochaine réponse catalogue le remplacera.
  }
}

function isValidCache(value: unknown): value is PersistedCatalogCache {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === CACHE_VERSION &&
    typeof record.persistedAt === 'number' &&
    Number.isFinite(record.persistedAt) &&
    record.state !== null &&
    typeof record.state === 'object'
  );
}

/**
 * Écrit les réponses catalogue après leur succès. Le debounce évite une écriture
 * disque par carte rendue ou par requête préchargée.
 */
export function persistCatalogCache(queryClient: QueryClient): () => void {
  if (!canUseStorage()) return () => undefined;

  let timer: ReturnType<typeof setTimeout> | null = null;

  const save = () => {
    timer = null;
    const state = dehydrate(queryClient, {
      shouldDehydrateQuery: isCatalogQuery,
    });

    // Ne jamais écraser un cache valable par un état encore vide au démarrage.
    if (state.queries.length === 0) return;

    const payload: PersistedCatalogCache = {
      version: CACHE_VERSION,
      persistedAt: Date.now(),
      state,
    };
    void AsyncStorage.setItem(CACHE_KEY, JSON.stringify(payload)).catch(() => {
      // Espace de stockage indisponible : l'application reste utilisable en
      // ligne, simplement sans promesse de catalogue au prochain lancement.
    });
  };

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (!isCatalogQuery(event.query)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, WRITE_DEBOUNCE_MS);
  });

  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}
