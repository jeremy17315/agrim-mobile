/**
 * Validation stricte des variables d'environnement au démarrage.
 * L'API refuse de démarrer si un secret est absent : mieux vaut échouer
 * immédiatement qu'exposer un JWT signé avec une valeur vide.
 */
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'staging', 'production', 'test'])
    .default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_GLOBAL_PREFIX: z.string().default('api/v1'),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // Stockage de fichiers. Le pilote local convient au développement et à un
  // déploiement mono-serveur ; un pilote S3-compatible viendra derrière la
  // même interface sans changer ces réglages métier.
  STORAGE_LOCAL_ROOT: z.string().default('storage'),
  STORAGE_PUBLIC_URL: z.string().default('http://127.0.0.1:3000/files'),

  /**
   * Clé de chiffrement des données courtes réversibles (code de livraison).
   * Distincte des secrets JWT : la rotation de l'une ne doit pas rendre
   * l'autre inutilisable.
   */
  ENCRYPTION_KEY: z.string().min(32),

  // Origines navigateur autorisées en production (séparées par des virgules).
  // Sans front web, laisser vide : l'application mobile n'envoie pas d'Origin.
  CORS_ORIGINS: z.string().default(''),

  // Notifications poussées. Désactivé par défaut : en développement et en
  // test, aucun appel au service Expo n'est émis, les notifications restent
  // consultables dans l'application.
  PUSH_ENABLED: z.enum(['true', 'false']).default('false'),
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuration invalide :\n${details}`);
  }
  const env = parsed.data;

  // Les deux jetons n'ont pas la même durée de vie ni le même usage. Avec un
  // secret commun, un access token vaudrait refresh token (et l'inverse) :
  // la rotation et la révocation ne protégeraient plus rien.
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    throw new Error(
      'JWT_ACCESS_SECRET et JWT_REFRESH_SECRET doivent être différents.',
    );
  }

  // Réutiliser un secret JWT comme clé de chiffrement lierait deux périmètres
  // qui doivent pouvoir tourner indépendamment.
  if (
    env.ENCRYPTION_KEY === env.JWT_ACCESS_SECRET ||
    env.ENCRYPTION_KEY === env.JWT_REFRESH_SECRET
  ) {
    throw new Error('ENCRYPTION_KEY doit être distincte des secrets JWT.');
  }

  if (env.NODE_ENV === 'production') {
    // Un secret d'exemple laissé en place permet de forger n'importe quelle
    // session : l'API doit refuser de démarrer, pas se contenter d'un avertissement.
    const placeholders = ['dev_only', 'change', 'secret', 'example', 'test'];
    const suspicious = (
      ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY'] as const
    ).filter((key) =>
      placeholders.some((p) => env[key].toLowerCase().includes(p)),
    );
    if (suspicious.length > 0) {
      throw new Error(
        `Secrets de développement interdits en production : ${suspicious.join(', ')}.`,
      );
    }

    // 16 caractères suffisent à démarrer, pas à résister à une attaque hors ligne.
    const tooShort = (
      ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY'] as const
    ).filter((key) => env[key].length < 32);
    if (tooShort.length > 0) {
      throw new Error(
        `Secrets trop courts en production (32 caractères minimum) : ${tooShort.join(', ')}.`,
      );
    }
  }

  return env;
}
