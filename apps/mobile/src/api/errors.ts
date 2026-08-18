/**
 * Erreurs réseau et traduction en messages destinés à l'utilisateur.
 *
 * Règle : aucune erreur technique brute (stack, code HTTP, message Prisma) ne
 * doit atteindre l'écran. Ce fichier est le seul endroit qui décide de la
 * phrase affichée.
 */

export type ApiErrorPayload = {
  status: number;
  code: string;
  message: string;
  details?: unknown;
};

/** Erreur renvoyée par le serveur (4xx / 5xx) ou réponse non conforme. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'ApiError';
    this.status = payload.status;
    this.code = payload.code;
    this.details = payload.details;
  }

  /** Vrai si l'utilisateur doit se reconnecter. */
  get isAuthError(): boolean {
    return this.status === 401;
  }
}

/** Échec avant toute réponse : coupure, DNS, délai dépassé. */
export class NetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NetworkError';
  }
}

/**
 * Messages par code métier. Les codes viennent du contrat backend ; tout code
 * inconnu retombe sur un message générique plutôt que d'afficher un identifiant
 * technique.
 */
const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Numéro ou mot de passe incorrect.',
  PHONE_ALREADY_USED: 'Ce numéro est déjà utilisé.',
  ACCOUNT_INACTIVE: 'Ce compte est désactivé. Contactez AGRIM.',
  INVALID_REFRESH_TOKEN: 'Votre session a expiré. Reconnectez-vous.',
  REFRESH_TOKEN_REUSED:
    'Session expirée pour raison de sécurité. Reconnectez-vous.',
  FORBIDDEN_ROLE: "Vous n'avez pas accès à cette fonctionnalité.",
  PRODUCT_NOT_FOUND: 'Ce produit n’est plus disponible.',
  INSUFFICIENT_STOCK: 'Stock insuffisant pour cette quantité.',
  INVALID_RESPONSE: 'Réponse inattendue du serveur.',
};

const BY_STATUS: Record<number, string> = {
  400: 'Les informations envoyées sont incomplètes ou invalides.',
  401: 'Votre session a expiré. Reconnectez-vous.',
  403: "Vous n'avez pas accès à cette fonctionnalité.",
  404: 'Élément introuvable.',
  409: 'Cette action entre en conflit avec des données existantes.',
  429: 'Trop de tentatives. Patientez un instant.',
  500: 'Le service rencontre un problème. Réessayez dans un moment.',
  503: 'Service momentanément indisponible.',
};

export function toUserMessage(
  code: string | undefined,
  status: number,
): string {
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (BY_STATUS[status]) return BY_STATUS[status] as string;
  return 'Une erreur est survenue. Réessayez.';
}

/** Message affichable pour n'importe quelle erreur remontée par le client. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof NetworkError) return error.message;
  return 'Une erreur est survenue. Réessayez.';
}
