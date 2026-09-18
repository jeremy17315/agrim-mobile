import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { CronLocksService, DEFAULT_LOCK_TTL_SECONDS } from '../common/cron/cron-locks.service';
import { prisma } from '../prisma/prisma.client';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import {
  OUTBOX_HANDLERS,
  OutboxEventPayload,
  OutboxHandler,
} from './outbox.handler';

/** Résumé retourné au cron (et visible dans `cron_locks.lastStatus`). */
export interface JobSummary {
  job: string;
  detail: string;
}

/** Plafond de reprises avant abandon définitif d'un événement. */
const OUTBOX_MAX_ATTEMPTS = 10;

/**
 * Exécuteur des tâches planifiées — le point d'entrée des Cron Jobs cPanel.
 *
 * Principes (docs/refonte/02 § 3.1 et 07 § 4) :
 *  - le crontab ne contient AUCUNE logique : il réveille l'API par HTTP ;
 *  - chaque job est protégé par un verrou d'exclusion mutuelle
 *    (`cron_locks`) et doit rester idempotent par construction ;
 *  - un job absent du registre répond 404 : ne jamais accepter un nom
 *    quelconque, même derrière le secret.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  /** Registre des jobs exécutables, avec leur bail de verrou dédié. */
  private readonly registry: Record<
    string,
    { ttlSeconds: number; run: () => Promise<string> }
  > = {
    // Le balayage existant : paiements en suspens réglés, stock rendu,
    // purges de rétention. Il est déjà idempotent par conception ; le verrou
    // évite juste de le faire tourner deux fois en parallèle.
    reconciliation: {
      ttlSeconds: DEFAULT_LOCK_TTL_SECONDS,
      run: async () => {
        await this.reconciliation.run();
        return 'balayage de réconciliation exécuté';
      },
    },

    // Diffusion des événements métier (outbox). Sans handler enregistré
    // (module notifications à venir), il ne réclame rien et rend la main :
    // le mécanisme est en place, les consommateurs arrivent avec la
    // refonte « messaging ».
    'outbox-drain': {
      ttlSeconds: 120,
      run: () => this.drainOutbox(),
    },
  };

  constructor(
    private readonly locks: CronLocksService,
    private readonly reconciliation: ReconciliationService,
    @Inject(OUTBOX_HANDLERS) private readonly handlers: OutboxHandler[],
  ) {}

  /**
   * Exécute un job nommé sous verrou. Lève `JOB_ALREADY_RUNNING` (409) quand
   * un verrou actif existe déjà — c'est un fonctionnement NORMAL du
   * dispositif, pas une panne : le prochain cron passera.
   */
  async run(job: string): Promise<JobSummary> {
    const entry = this.registry[job];
    if (!entry) {
      throw new NotFoundException({
        code: 'JOB_NOT_FOUND',
        message: `Tâche planifiée inconnue : ${job}`,
      });
    }

    const result = await this.locks.runExclusive(job, entry.ttlSeconds, () =>
      entry.run(),
    );

    if (!result.acquired) {
      throw new ConflictException({
        code: 'JOB_ALREADY_RUNNING',
        message: `La tâche ${job} est déjà en cours.`,
      });
    }

    const detail = result.result ?? 'terminé';
    this.logger.log(`Job ${job} : ${detail}`);
    return { job, detail };
  }

  /** Noms des jobs exécutables (introspection, usage opérationnel). */
  list(): string[] {
    return Object.keys(this.registry);
  }

  /**
   * Réclame et traite les événements d'outbox arrivés à échéance.
   *
   * La réclamation est atomique et ciblée : UPDATE ... WHERE id = (SELECT …
   * FOR UPDATE SKIP LOCKED). Deux drains simultanés — deux processus
   * Passenger, par exemple — se partagent les événements sans jamais en
   * traiter deux fois un même.
   */
  private async drainOutbox(): Promise<string> {
    let processed = 0;
    let failed = 0;

    for (const handler of this.handlers) {
      let event: OutboxEventPayload | null;
      while ((event = await this.claimOne(handler.type))) {
        try {
          await handler.handle(event);
          await this.markDone(event.id);
          processed += 1;
        } catch (error) {
          const message = (error as Error).message.slice(0, 480);
          await this.markRetryOrFail(event, message);
          failed += 1;
        }
      }
    }

    return `outbox : ${processed} événement(s) traité(s), ${failed} en échec`;
  }

  /**
   * Réclame UN événement du type donné, de façon atomique. La fenêtre
   * « lire puis marquer » n'existe pas : l'UPDATE et le SELECT verrouillé
   * forment un seul énoncé — PostgreSQL arbitre entre drains concurrents.
   */
  private async claimOne(type: string): Promise<OutboxEventPayload | null> {
    const rows = await prisma.$queryRaw<
      { id: string; type: string; payload: unknown; attempts: number }[]
    >`
      UPDATE "outbox_events"
      SET "status" = 'PROCESSING', "attempts" = "attempts" + 1
      WHERE "id" = (
        SELECT "id" FROM "outbox_events"
        WHERE "status" = 'PENDING'
          AND "availableAt" <= now()
          AND "type" = ${type}
        ORDER BY "createdAt"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "type", "payload", "attempts"
    `;
    return rows[0] ?? null;
  }

  private async markDone(id: string): Promise<void> {
    await prisma.$executeRaw`
      UPDATE "outbox_events"
      SET "status" = 'DONE', "processedAt" = now()
      WHERE "id" = ${id}
    `;
  }

  /**
   * Échec de traitement : re-planification avec back-off exponentiel, et
   * abandon tracé au plafond. Un événement en FAILED reste visible — on ne
   * supprime jamais une preuve de dysfonctionnement.
   */
  private async markRetryOrFail(
    event: OutboxEventPayload,
    error: string,
  ): Promise<void> {
    if (event.attempts >= OUTBOX_MAX_ATTEMPTS) {
      await prisma.$executeRaw`
        UPDATE "outbox_events"
        SET "status" = 'FAILED', "processedAt" = now(), "lastError" = ${error}
        WHERE "id" = ${event.id}
      `;
      this.logger.error(
        `Événement ${event.type} (${event.id}) abandonné après ${event.attempts} tentatives : ${error}`,
      );
      return;
    }

    // Back-off : 1, 2, 4, 8… minutes, plafonné à 60. Assez patient pour
    // une panne WhatsApp passagère, assez prompt pour ne pas faire attendre
    // un client une heure pour une notification urgente.
    const delayMinutes = Math.min(2 ** (event.attempts - 1), 60);
    await prisma.$executeRaw`
      UPDATE "outbox_events"
      SET "status" = 'PENDING',
          "availableAt" = now() + (${delayMinutes} * interval '1 minute'),
          "lastError" = ${error}
      WHERE "id" = ${event.id}
    `;
  }
}
