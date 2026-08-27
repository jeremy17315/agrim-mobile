/**
 * Instance PrismaClient partagée (Prisma 7 : driver adapter obligatoire).
 * Utilisée par le service NestJS et par les scripts (seed, maintenance).
 */
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../generated/prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL est requis (voir .env.example)');
}

const adapter = new PrismaPg({ connectionString });

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
