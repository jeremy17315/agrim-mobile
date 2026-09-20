import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * ── Pourquoi ce repli explicite (CI, job « verification ») ──────────────
 *
 * `env('DATABASE_URL')` de prisma/config EXIGE la variable dès le chargement
 * de la config — même pour `prisma generate`, qui ne se connecte à aucune
 * base. Le job de vérification (lint, typecheck, tests unitaires) ne définit
 * justement PAS de DATABASE_URL : il n'a ni service PostgreSQL, ni .env.
 * Résultat : « Générer le client Prisma » échouait avant même d'exister,
 * et TOUS les garde-fous du job (lint, typecheck strict, tests) étaient
 * court-circuités — une CI rouge que personne ne lisait plus.
 *
 * Le repli est une URL non connectable et nommée comme ce qu'elle est :
 * toute commande qui touche réellement la base (`migrate deploy`, `seed`)
 * reçoit une vraie DATABASE_URL (job e2e, environnement de prod) et ne la
 * voit jamais. Si quelqu'un lance `migrate` sans variable, l'échec de
 * connexion est immédiat et sans ambiguïté — c'est le comportement voulu.
 */
const url =
  process.env.DATABASE_URL ??
  'postgresql://generate-only:no-db@127.0.0.1:5432/generate_only';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { seed: 'tsx prisma/seed.ts' },
  datasource: { url },
});
