/**
 * Instance PrismaClient partagée (Prisma 7 : driver adapter obligatoire).
 * Utilisée par le service NestJS et par les scripts (seed, maintenance).
 *
 * ── Réglages cPanel / LWS (refonte — docs/refonte/10) ──────────────────
 *
 * Avec l'adaptateur `@prisma/adapter-pg`, le pool de connexions est un Pool
 * node-postgres créé ICI : les paramètres `connection_limit` / `pool_timeout`
 * de l'URL Prisma NE S'APPLIQUENT PAS (ce sont des paramètres du moteur
 * natif, d'une époque révolue). Le réglage passe par les options du Pool.
 *
 * Arithmétique d'un hébergement mutualisé :
 *   connexions totales ≈ (processus Passenger actifs) × (max du pool)
 * cPanel n'offre pas de contrôle fin du nombre de processus Passenger ;
 * seul le plafond « Entry Processes » de CloudLinux borne. D'où un `max`
 * FAIBLE et configurable (PG_POOL_MAX, défaut 3 en production) : avec 5
 * processus et max=3, on reste sous les 15 connexions, marge comprise,
 * là où un mutualisé en accorde souvent 20 à 30. `PG_POOL_MAX=10` en
 * développement retrouve le comportement par défaut de node-postgres.
 */
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../generated/prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL est requis (voir .env.example)');
}

/** Lecture d'un entier d'environnement avec repli. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const adapter = new PrismaPg({
  connectionString,
  // Taille du pool PAR PROCESSUS. Voir l'arithmétique ci-dessus : ne pas
  // monter ce chiffre sans connaître le max_connections de l'hébergeur.
  max: envInt('PG_POOL_MAX', 10),
  // Échouer vite si la base ne répond pas : une requête qui attend la base
  // tient un processus Passenger (et donc un slot LVE) en otage.
  connectionTimeoutMillis: envInt('PG_CONNECT_TIMEOUT_MS', 5_000),
  // Une connexion oisive rendue vite : sur mutualisé, chaque connexion
  // dormante consomme un slot max_connections partagé avec les autres locataires.
  idleTimeoutMillis: envInt('PG_IDLE_TIMEOUT_MS', 30_000),
  // Garde-fou : aucune requête ne doit durer plus qu'une transaction métier
  // saine (les transactions elles-mêmes sont bornées ci-dessous). Migrations
  // et psql ne passent pas par ce client : elles ne sont pas concernées.
  statement_timeout: envInt('PG_STATEMENT_TIMEOUT_MS', 20_000),
  application_name: 'agrim-api',
});

/**
 * Délais de transaction, relevés pour une base DISTANTE.
 *
 * Les valeurs par défaut de Prisma — 2 s pour obtenir une transaction, 5 s
 * pour la tenir — supposent un PostgreSQL local. Contre une base gérée
 * (Neon en l'occurrence), il faut compter la latence réseau, la poignée de
 * main TLS, et le réveil du compute lorsqu'il s'est suspendu. Avec les
 * défauts, le seed échouait en `P2028 : Unable to start a transaction in the
 * given time` avant même d'écrire une ligne.
 *
 * Le point n'est pas cosmétique : les transactions les plus longues de
 * l'application enchaînent une écriture de stock PAR LIGNE de commande
 * (`settle()`, annulation par la gestion). Sur un aller-retour de plusieurs
 * dizaines de millisecondes, une commande à dix lignes frôle la limite de
 * 5 s. Un dépassement laisserait la commande réglée sans que le stock soit
 * rendu — exactement la fuite que ce lot vient corriger.
 *
 * `timeout` reste borné : une transaction qui dure tient des verrous sur les
 * lignes de stock, et laisser filer ne ferait que déplacer le problème.
 */
export const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  transactionOptions: {
    maxWait: 15_000,
    timeout: 20_000,
  },
});
