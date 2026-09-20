import { Logger } from '@nestjs/common';

import { outboxHandlers } from './outbox.handler';
import type { OutboxEventPayload } from './outbox.handler';

/** Plafond de reprises avant abandon définitif d'un événement. */
const OUTBOX_MAX_ATTEMPTS = 10;

const logger = new Logger('OutboxDrain');

/**
 * Le drain d'outbox — réclame et traite les événements arrivés à échéance.
 *
 * La réclamation est atomique et ciblée : UPDATE ... WHERE id = (SELECT …
 * FOR UPDATE SKIP LOCKED). Deux drains simultanés — deux processus
 * Passenger, un drain cron et un drain post-commit — se partagent les
 * événements sans jamais en traiter deux fois un même.
 *
 * Le client Prisma est chargé PARESSEUSEMENT : ce module est importé par des
 * services métier (orders, payments) qui doivent rester exécutables — en
 * tests notamment — sans base ni client généré. Le drain n'en a besoin qu'au
 * moment où il tourne réellement.
 */
export async function drainOutbox(): Promise<{
  processed: number;
  failed: number;
}> {
  const { prisma } = await import('../prisma/prisma.client');

  let processed = 0;
  let failed = 0;

  for (const handler of outboxHandlers()) {
    for (const type of handler.types) {
      let event: OutboxEventPayload | null;
      while ((event = await claimOne(prisma, type))) {
        try {
          await handler.handle(event);
          await markDone(prisma, event.id);
          processed += 1;
        } catch (error) {
          const message = (error as Error).message.slice(0, 480);
          await markRetryOrFail(prisma, event, message);
          failed += 1;
        }
      }
    }
  }

  return { processed, failed };
}

/**
 * Réclame UN événement du type donné, de façon atomique. La fenêtre
 * « lire puis marquer » n'existe pas : l'UPDATE et le SELECT verrouillé
 * forment un seul énoncé — PostgreSQL arbitre entre drains concurrents.
 */
async function claimOne(
  prisma: {
    $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  },
  type: string,
): Promise<OutboxEventPayload | null> {
  // Resultat typé par un cast (et non le générique `$queryRaw<T>`) : la
  // signature exacte du client dépend du codegen, le cast tient dans les
  // deux mondes — avec et sans client généré.
  const rows = (await prisma.$queryRaw`
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
  `) as Array<{
    id: string;
    type: string;
    payload: unknown;
    attempts: number;
  }>;
  return rows[0] ?? null;
}

async function markDone(
  prisma: {
    $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  },
  id: string,
): Promise<void> {
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
async function markRetryOrFail(
  prisma: {
    $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  },
  event: OutboxEventPayload,
  error: string,
): Promise<void> {
  if (event.attempts >= OUTBOX_MAX_ATTEMPTS) {
    await prisma.$executeRaw`
      UPDATE "outbox_events"
      SET "status" = 'FAILED', "processedAt" = now(), "lastError" = ${error}
      WHERE "id" = ${event.id}
    `;
    logger.error(
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

/** Garde en process : un seul drain post-commit à la fois dans CE processus.
 * L'exclusion inter-processus reste portée par la réclamation atomique. */
let kickEnCours = false;

/**
 * Drain post-commit — le « au plus tôt » de la diffusion.
 *
 * Appelé après une transaction métier qui a écrit dans l'outbox : tente de
 * drainer IMMÉDIATEMENT, sans bloquer la réponse HTTP (fire-and-forget), en
 * ne lève jamais. Si le processus est recyclé avant la fin, aucun événement
 * n'est perdu — ils sont en base, et le cron `outbox-drain` rattrape.
 */
export function kickOutboxDrain(): void {
  if (kickEnCours) return;
  kickEnCours = true;
  void drainOutbox()
    .catch((error: Error) => {
      logger.warn(
        `Drain post-commit en échec (le cron rattrapera) : ${error.message}`,
      );
    })
    .finally(() => {
      kickEnCours = false;
    });
}
