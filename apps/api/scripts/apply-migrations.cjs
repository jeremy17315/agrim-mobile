#!/usr/bin/env node
/**
 * Application directe des migrations Prisma — SANS le CLI prisma.
 *
 * Pourquoi ce script existe : `prisma migrate deploy` télécharge le moteur
 * de schéma depuis binaries.prisma.sh — hors de portée des environnements à
 * réseau filtré (bac à sable restreint, hébergement verrouillé). Les
 * migrations, elles, sont du SQL versionné : les appliquer et les journaliser
 * est un protocole simple, reproduit ici à l'identique :
 *   - table `_prisma_migrations` (même schéma que le CLI) ;
 *   - chaque migration dans une transaction, dans l'ordre des noms ;
 *   - enregistrement avec le checksum SHA-256 du fichier.
 * Un `prisma migrate deploy` ultérieur (machine avec réseau) reconnaît les
 * enregistrements et ne ré-applique rien — les deux chemins sont
 * compatibles, c'est le même format de journal.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const répertoire = path.join(__dirname, '..', 'prisma', 'migrations');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL est requis.');
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      id                  VARCHAR(36) PRIMARY KEY,
      checksum            VARCHAR(64) NOT NULL,
      finished_at         TIMESTAMPTZ,
      migration_name      VARCHAR(255) NOT NULL,
      logs                TEXT,
      applied_steps_count INTEGER NOT NULL DEFAULT 0,
      started_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const appliquées = new Set(
    (
      await client.query('SELECT migration_name FROM "_prisma_migrations"')
    ).rows.map((r) => r.migration_name),
  );

  const dossiers = fs
    .readdirSync(répertoire)
    .filter((d) => /^\d{14}_/.test(d))
    .sort();

  let nouvelles = 0;
  for (const dossier of dossiers) {
    if (appliquées.has(dossier)) continue;
    const fichier = path.join(répertoire, dossier, 'migration.sql');
    const sql = fs.readFileSync(fichier, 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const id = crypto.randomUUID();

    const t0 = Date.now();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        `INSERT INTO "_prisma_migrations"
           (id, checksum, finished_at, migration_name, logs, applied_steps_count, started_at)
         VALUES ($1, $2, now(), $3, NULL, 1, now())`,
        [id, checksum, dossier],
      );
      await client.query('COMMIT');
      nouvelles += 1;
      console.log(`✓ ${dossier} (${Date.now() - t0} ms)`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`✗ ${dossier} : ${e.message}`);
      process.exit(1);
    }
  }

  console.log(
    nouvelles === 0
      ? 'Base à jour (aucune migration nouvelle).'
      : `${nouvelles} migration(s) appliquée(s).`,
  );
  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
