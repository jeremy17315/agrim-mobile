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
  if (
    parsed.data.NODE_ENV === 'production' &&
    parsed.data.JWT_ACCESS_SECRET.startsWith('dev_only')
  ) {
    throw new Error('Secrets de développement interdits en production.');
  }
  return parsed.data;
}
