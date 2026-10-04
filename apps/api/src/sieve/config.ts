import { z } from 'zod';

/**
 * Validation for the Sieve environment variables.
 *
 * SIEVE_API_KEY is the deployer's secret (store in the .env / secret store).
 * SIEVE_BASE_URL points at the scrape agent; it is already derived from the
 * environment, so nothing secret is encoded in it.
 */
const sieveEnvSchema = z.object({
  SIEVE_BASE_URL: z.string().url().default('https://scrape.usesieve.com'),
  // Vide = pilotage désactivé. Une clé absente n'est pas une erreur de
  // configuration : c'est l'état nominal d'une installation sans Sieve.
  SIEVE_API_KEY: z.string().default(''),
});

export type SieveEnv = z.infer<typeof sieveEnvSchema>;

/**
 * Parse and validate the Sieve environment variables.
 *
 * Une clé absente n'est jamais une erreur : l'intégration reste inerte et
 * `SieveSession.hasKey()` la détecte pour répondre 503. Un déploiement sans
 * Sieve se comporte exactement comme avant cette intégration.
 */
export function parseSieveEnv(raw: Record<string, unknown>): SieveEnv {
  const parsed = sieveEnvSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid Sieve configuration:\n${details}`);
  }
  return parsed.data;
}
