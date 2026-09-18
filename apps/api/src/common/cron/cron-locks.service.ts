import { Injectable, Logger } from '@nestjs/common';

import { prisma } from '../prisma/prisma.client';

/**
 * Verrou d'exclusion mutuelle pour les tâches planifiées.
 *
 * ── Pourquoi ce service existe ─────────────────────────────────────────
 * Les crons cPanel appellent l'API par HTTP. Rien n'empêche deux
 * déclencheurs de se chevaucher : une cadence de 5 min devant un job qui
 * dure 7 min, une double ligne crontab, un curl rejoué par un proxy. Deux
 * exécutions simultanées d'un job non conçu pour ça font des dégâts en
 * double (deux relances au client, deux purges concurrentes).
 *
 * ── Comment le verrou est pris ─────────────────────────────────────────
 * Un seul énoncé SQL, atomique de bout en bout : INSERT ... ON CONFLICT DO
 * UPDATE ... WHERE ... RETURNING. S'il renvoie une ligne, le verrou est à
 * nous ; s'il n'en renvoie pas, quelqu'un le tient encore et l'appelant
 * abandonne SANS ERREUR (un cron qui râle sur une exécution normale crée
 * des alertes fausses).
 *
 * Le `WHERE` porte sur `lockedUntil` : un verrou PERIMÉ est repris. C'est la
 * condition de survie du dispositif sur Passenger — le processus peut être
 * recyclé entre l'acquisition et la libération, et un verrou orphelin qui ne
 * périmerait jamais fermerait le job pour toujours.
 *
 * ── Ce que ce verrou n'est pas ─────────────────────────────────────────
 * Ce n'est PAS un verrou de base de données PostgreSQL (advisory lock) : il
 * vivrait dans la connexion, pas dans les données, et un mutualisé qui
 * redémarre PostgreSQL entre deux crons n'a pas à être consulté pour savoir
 * si hier a tourné. La table `cron_locks` fait foi, elle survit aux
 * redémarrages et donne gratuitement l'historique d'exécution.
 */

/** Durée par défaut du bail : largement au-dessus du job le plus lent connu,
 * assez court pour qu'un processus tué bloque au plus quelques minutes. */
export const DEFAULT_LOCK_TTL_SECONDS = 600;

/** Résultat d'une tentative d'exécution protégée. */
export interface ExclusiveRunResult<T> {
  /** `false` : une autre exécution tient le verrou — rien n'a tourné. */
  acquired: boolean;
  /** Résultat du job, quand il a tourné. */
  result?: T;
}

@Injectable()
export class CronLocksService {
  private readonly logger = new Logger(CronLocksService.name);

  /**
   * Exécute `job` en exclusion mutuelle.
   *
   * La fonction métier NE DOIT PAS être idempotente-par-chance : elle doit
   * être idempotente PAR CONSTRUCTION (reprises après bail expiré, curl
   * rejoué par un proxy…). Le verrou réduit fortement les collisions, il ne
   * les rend pas impossibles.
   */
  async runExclusive<T>(
    job: string,
    ttlSeconds: number,
    fn: () => Promise<T>,
  ): Promise<ExclusiveRunResult<T>> {
    const acquired = await this.acquire(job, ttlSeconds);
    if (!acquired) {
      this.logger.log(
        `Job ${job} : un verrou actif existe déjà, exécution sautée.`,
      );
      return { acquired: false };
    }

    try {
      const result = await fn();
      await this.release(job, 'OK');
      return { acquired: true, result };
    } catch (error) {
      const message = (error as Error).message.slice(0, 480);
      // Le verrou est rendu MÊME en échec : un job qui plante ne doit pas
      // s'interdire de retenter au prochain cron. L'erreur reste tracée.
      await this.release(job, 'FAILED', message).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Acquisition atomique. L'énoncé entier est un seul aller-retour : pas de
   * fenêtre entre « regarder si libre » et « prendre » — c'est PostgreSQL qui
   * arbitre, pas une lecture antérieure (même principe que le décrément de
   * stock conditionnel).
   */
  private async acquire(job: string, ttlSeconds: number): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ job: string }[]>`
      INSERT INTO "cron_locks"
        ("job", "lockedAt", "lockedUntil", "lastRunStartedAt", "runCount", "updatedAt")
      VALUES
        (${job}, now(), now() + (${ttlSeconds} * interval '1 second'), now(), 1, now())
      ON CONFLICT ("job") DO UPDATE
        SET "lockedAt" = EXCLUDED."lockedAt",
            "lockedUntil" = EXCLUDED."lockedUntil",
            "lastRunStartedAt" = EXCLUDED."lastRunStartedAt",
            "runCount" = "cron_locks"."runCount" + 1,
            "updatedAt" = now()
        -- Un verrou périmé est repris : c'est ce qui rend le dispositif
        -- supportable par un hébergement qui recycle ses processus.
        WHERE "cron_locks"."lockedUntil" IS NULL
           OR "cron_locks"."lockedUntil" < now()
      RETURNING "job"
    `;
    return rows.length > 0;
  }

  /**
   * Libération + trace d'exécution. On ne rend le verrou que s'il est
   * toujours le nôtre (`lockedUntil > now()`) : si le bail a expiré et qu'un
   * autre exécutant l'a repris, écraser son verrou serait exactement la
   * collision qu'on veut empêcher.
   */
  private async release(
    job: string,
    status: 'OK' | 'FAILED',
    error?: string,
  ): Promise<void> {
    await prisma.$executeRaw`
      UPDATE "cron_locks"
      SET "lockedAt" = NULL,
          "lockedUntil" = NULL,
          "lastRunFinishedAt" = now(),
          "lastStatus" = ${status},
          "lastError" = ${error ?? null},
          "updatedAt" = now()
      WHERE "job" = ${job}
        AND "lockedUntil" IS NOT NULL
        AND "lockedUntil" > now()
    `;
  }
}
