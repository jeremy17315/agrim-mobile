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

  /**
   * Secret des appels de Cron cPanel vers /jobs/* (en-tête X-Cron-Secret).
   * Vide = tous les jobs refusés, fail-closed : un endpoint de jobs ouvert
   * par oubli de configuration serait une administration anonyme.
   * Générer : `openssl rand -hex 32`.
   */
  CRON_SECRET: z.string().default(''),

  /**
   * Pool PostgreSQL. Avec l'adaptateur PrismaPg, ces réglages pilotent le
   * Pool node-postgres (les paramètres `connection_limit` de l'URL ne
   * s'appliquent pas). Arithmétique mutualisé : connexions totales ≈
   * processus Passenger × PG_POOL_MAX. Ne pas monter sans connaître le
   * max_connections de l'hébergeur (docs/refonte/10 § 1).
   */
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),
  PG_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  PG_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  PG_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

  /**
   * Propriété du stock. `site` (défaut) : chaque commande réserve le stock
   * chez le site (architecture de transition). `local` : cette base possède
   * le stock, avec verrouillage transactionnel — à ne basculer QUE quand le
   * site lit cette base (docs/refonte/08, phase 4) : basculer trop tôt,
   * c'est deux compteurs pour un même entrepôt, donc de la double vente
   * réelle. Voir `config/stock-mode.ts`.
   */
  STOCK_MODE: z.enum(['site', 'local']).default('site'),

  /**
   * Diffusion WhatsApp (agrégateur REST générique : Cloud API Meta, WATI…).
   * URL + jeton absents ⇒ pilote inerte : canal sauté sans erreur (un canal
   * non configuré n'est pas une panne — docs/refonte/02 § 3.5).
   */
  WHATSAPP_API_URL: z.string().default(''),
  WHATSAPP_API_TOKEN: z.string().default(''),

  /** Diffusion e-mail transactionnelle — SMTP du compte LWS (cPanel). */
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM: z.string().default(''),

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

  /**
   * Paiement mobile money. Le défaut « simulation » n'appelle aucun réseau :
   * une installation neuve joue le parcours de commande de bout en bout sans
   * identifiant d'agrégateur.
   */
  PAYMENT_PROVIDER: z
    .enum(['simulation', 'cinetpay', 'paydunya'])
    .default('simulation'),
  PAYMENT_TIMEOUT_SECONDS: z.string().default('20'),
  /** Fenêtre laissée au client pour valider sur son téléphone. */
  PAYMENT_EXPIRY_MINUTES: z.string().default('30'),
  /** Simulation seulement : éprouver le parcours de refus, jamais testé sinon. */
  PAYMENT_SIMULATION_FAILURE_RATE: z.string().default('0'),
  PAYMENT_SIMULATION_ASYNC: z.enum(['true', 'false']).default('false'),
  /**
   * Autorise explicitement le pilote de simulation EN PRODUCTION.
   *
   * Défaut « false », et c'est délibéré : la simulation valide les paiements
   * sans appeler d'opérateur. En production, cela reviendrait à offrir le riz.
   * Sans cette autorisation, le paiement en ligne répond 503 tant qu'un vrai
   * fournisseur n'est pas configuré — le paiement à la livraison, lui,
   * continue de fonctionner.
   */
  PAYMENT_SIMULATION_ALLOW_PRODUCTION: z
    .enum(['true', 'false'])
    .default('false'),

  CINETPAY_API_KEY: z.string().default(''),
  CINETPAY_SITE_ID: z.string().default(''),
  CINETPAY_SECRET: z.string().default(''),

  PAYDUNYA_MASTER_KEY: z.string().default(''),
  PAYDUNYA_PRIVATE_KEY: z.string().default(''),
  PAYDUNYA_TOKEN: z.string().default(''),

  /**
   * URL publique de cette API. Les agrégateurs y renvoient leur webhook.
   * Sans elle, un paiement réel est refusé : voir la validation plus bas.
   */
  PUBLIC_API_URL: z.string().default(''),
  /** URL publique du site web, pour la page de retour après paiement. */
  PUBLIC_WEB_URL: z.string().default(''),

  /**
   * Intégration avec le SITE (audit de cohérence, août 2026).
   *
   * Le site rend DEUX services à cette API, sous la même adresse et le même
   * jeton :
   *
   *   catalogue — le site en est la source de vérité (gammes, formats, prix,
   *     promotions). Cette API en garde une copie locale, parce que ses
   *     paniers et ses commandes référencent les variantes par clé étrangère,
   *     mais elle ne l'invente plus. Les constantes de `@agrim/contracts` ne
   *     servent qu'au démarrage d'une base vide, jamais à corriger un prix.
   *
   *   messagerie — le site envoie les SMS et les WhatsApp pour tout le monde :
   *     un seul crédit, un seul journal, un seul jeu de clés d'agrégateur.
   *     Le push, lui, reste propre à cette application.
   *
   * `SITE_INTEGRATION_URL` est l'URL de BASE du site, sans chemin. Vide =
   * intégration désactivée : le catalogue local n'est plus synchronisé et
   * aucun SMS ne part, mais l'API démarre et sert normalement.
   */
  SITE_INTEGRATION_URL: z.string().default(''),
  SITE_INTEGRATION_TOKEN: z.string().default(''),
  CATALOG_SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),

  /**
   * Surcharge facultative de l'URL du catalogue. Sert quand le catalogue est
   * servi ailleurs que sous `${SITE_INTEGRATION_URL}/api/integration/catalogue`
   * — par exemple derrière un proxy. Vide dans le cas nominal.
   */
  CATALOG_SOURCE_URL: z.string().default(''),

  /**
   * Cadence du balayage de réconciliation : paiements abandonnés réglés (donc
   * stock rendu) et purges de rétention.
   *
   * Un passage a toujours lieu au démarrage, indépendamment de cette valeur —
   * indispensable sur un hébergement dont l'instance s'endort, où le minuteur
   * ne tourne pas.
   */
  RECONCILIATION_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10),
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

  // Leçon du site web : sans URL publique, les URL de notification envoyées à
  // l'agrégateur pointaient vers la machine locale. Le webhook ne revenait
  // jamais et chaque paiement restait « en attente » pour toujours. Un
  // fournisseur réel sans PUBLIC_API_URL est donc refusé au démarrage.
  if (env.PAYMENT_PROVIDER !== 'simulation' && !env.PUBLIC_API_URL) {
    throw new Error(
      `PUBLIC_API_URL est requis avec le fournisseur de paiement « ${env.PAYMENT_PROVIDER} » ` +
        "(URL de notification des agrégateurs).",
    );
  }

  return env;
}
