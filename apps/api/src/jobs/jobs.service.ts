import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { CronLocksService, DEFAULT_LOCK_TTL_SECONDS } from '../common/cron/cron-locks.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { drainOutbox } from './outbox-drain';

/** Résumé retourné au cron (et visible dans `cron_locks.lastStatus`). */
export interface JobSummary {
  job: string;
  detail: string;
}

/**
 * Exécuteur des tâches planifiées — le point d'entrée des Cron Jobs cPanel.
 *
 * Principes (docs/refonte/02 § 3.1 et 07 § 4) :
 *  - le crontab ne contient AUCUNE logique : il réveille l'API par HTTP ;
 *  - chaque job est protégé par un verrou d'exclusion mutuelle
 *    (`cron_locks`) et doit rester idempotent par construction ;
 *  - un job absent du registre répond 404 : ne jamais accepter un nom
 *    quelconque, même derrière le secret.
 *
 * Le drain d'outbox, lui, vit dans `outbox-drain.ts` : partagé avec le
 * drain post-commit (`kickOutboxDrain`), il est réclamé atomiquement en
 * base — le cron n'en est que le filet de rattrapage.
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

    // Filet de rattrapage de la diffusion : tout événement que le drain
    // post-commit n'a pas pu traiter (processus recyclé, panne des canaux,
    // back-off en cours) est repris ici, à la cadence du cron.
    'outbox-drain': {
      ttlSeconds: 120,
      run: async () => {
        const { processed, failed } = await drainOutbox();
        return `outbox : ${processed} événement(s) traité(s), ${failed} en échec`;
      },
    },
  };

  // Le drain résout les handlers par le registre global (amorcé par
  // MessagingModule au bootstrap) — aucune dépendance à injecter ici, et
  // donc aucun cycle possible.
  constructor(
    private readonly locks: CronLocksService,
    private readonly reconciliation: ReconciliationService,
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
}
