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

export const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
