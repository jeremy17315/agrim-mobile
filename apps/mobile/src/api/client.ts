import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { z } from 'zod';

import { ApiError, NetworkError, toUserMessage } from './errors';

/**
 * Client HTTP unique de l'application.
 *
 * Aucun composant n'appelle `fetch` directement : tout passe par ici, ce qui
 * centralise l'URL de base, le token, les délais d'attente, la validation des
 * réponses et la traduction des erreurs en messages lisibles.
 *
 * Le schéma Zod attendu est OBLIGATOIRE : une réponse serveur non conforme est
 * une erreur, pas un `any` qui explose trois écrans plus loin.
 */

const DEFAULT_TIMEOUT_MS = 15_000;

function resolveBaseUrl(): string {
  // Sur le web, on passe par un chemin relatif : le navigateur qui affiche
  // l'application n'est pas forcément la machine qui exécute l'API, et un
  // chemin relatif évite aussi tout problème de CORS.
  if (Platform.OS === 'web') return '/api/v1';

  const fromConfig = Constants.expoConfig?.extra?.['apiUrl'];
  if (typeof fromConfig === 'string' && fromConfig.length > 0)
    return fromConfig;

  // Émulateur Android : 10.0.2.2 pointe vers la machine hôte.
  return 'http://10.0.2.2:3000/api/v1';
}

export const API_BASE_URL = resolveBaseUrl();

/** Fournit le token courant. Injecté par le store d'auth pour éviter un cycle. */
type TokenProvider = () => string | null;

let getAccessToken: TokenProvider = () => null;

export function setTokenProvider(provider: TokenProvider): void {
  getAccessToken = provider;
}

export type RequestOptions<TSchema extends z.ZodTypeAny> = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  /** Paramètres de requête ; les valeurs `undefined` sont ignorées. */
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Schéma de validation de la réponse. */
  schema: TSchema;
  /** Requête publique : n'attache pas le token même s'il existe. */
  isPublic?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
};

function buildUrl(
  path: string,
  query?: RequestOptions<z.ZodTypeAny>['query'],
): string {
  const url = new URL(
    `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`,
  );
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiRequest<TSchema extends z.ZodTypeAny>(
  options: RequestOptions<TSchema>,
): Promise<z.infer<TSchema>> {
  const {
    method = 'GET',
    path,
    query,
    body,
    schema,
    isPublic = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
  } = options;

  // Un réseau mobile qui « pend » est pire qu'une erreur franche : on borne.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (signal)
    signal.addEventListener('abort', () => controller.abort(), { once: true });

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (!isPublic) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause) {
    throw new NetworkError(
      controller.signal.aborted
        ? 'La connexion est trop lente. Réessayez.'
        : 'Connexion impossible. Vérifiez votre réseau.',
      { cause },
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 204) {
    return schema.parse(undefined) as z.infer<TSchema>;
  }

  const raw: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    // Le backend renvoie { statusCode, code, message, details }.
    const payload = (raw ?? {}) as Record<string, unknown>;
    throw new ApiError({
      status: response.status,
      code:
        typeof payload['code'] === 'string' ? payload['code'] : 'UNKNOWN_ERROR',
      message: toUserMessage(
        typeof payload['code'] === 'string' ? payload['code'] : undefined,
        response.status,
      ),
      details: payload['details'],
    });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // Contrat rompu : on le signale explicitement plutôt que de laisser des
    // `undefined` se propager jusqu'à l'écran.
    throw new ApiError({
      status: response.status,
      code: 'INVALID_RESPONSE',
      message: 'Réponse inattendue du serveur.',
      details: parsed.error.flatten(),
    });
  }

  return parsed.data;
}
