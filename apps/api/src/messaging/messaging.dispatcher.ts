import { Inject, Injectable, Logger } from '@nestjs/common';
import { renderNotification } from '@agrim/contracts';

import { prisma } from '../prisma/prisma.client';
import { NotificationsService } from '../notifications/notifications.service';
import { EMAIL_PROVIDER, EmailPort } from './email.provider';
import {
  isRenderableNotificationType,
  ROUTED_TYPES,
  ROUTING,
} from './messaging.routing';
import { WHATSAPP_PROVIDER, WhatsappPort } from './whatsapp.provider';
import type { OutboxEventPayload, OutboxHandler } from '../jobs/outbox.handler';

/** Charge utile attendue des événements « commande » — lecture défensive. */
interface OrderEventPayload {
  userId?: string;
  orderId?: string;
  reference?: string;
}

function readPayload(raw: unknown): OrderEventPayload {
  if (!raw || typeof raw !== 'object') return {};
  const p = raw as Record<string, unknown>;
  return {
    userId: typeof p.userId === 'string' ? p.userId : undefined,
    orderId: typeof p.orderId === 'string' ? p.orderId : undefined,
    reference: typeof p.reference === 'string' ? p.reference : undefined,
  };
}

/**
 * Dispatcher de diffusion — LE consommateur d'outbox des notifications.
 *
 * Reçoit un événement métier, consulte la table de routage, résout les
 * destinataires et répartit sur les canaux configurés — puis journalise
 * chaque tentative dans `MessageLog`.
 *
 * ── Politique d'échec (la seule partie subtile) ────────────────────────
 *  - chaque canal est protégé : l'échec de WhatsApp ne coupe pas le push ;
 *  - si TOUS les canaux actifs échouent, l'événement est relancé par le
 *    drain (back-off du `JobsService`) — la diffusion n'abandonne pas au
 *    premier hoquet réseau ;
 *  - si AU MOINS UN canal passe, l'événement est clos : rejouer ré-aurait
 *    envoyé deux fois les canaux déjà partis. Les canaux en échec restent
 *    visibles en FAILED au `MessageLog` — pour reprise manuelle ou
 *    back-office, pas pour un double envoi silencieux ;
 *  - un canal non configuré n'est ni un échec ni une tentative : SKIPPED.
 */
@Injectable()
export class MessagingDispatcher implements OutboxHandler {
  readonly types = ROUTED_TYPES;

  private readonly logger = new Logger(MessagingDispatcher.name);

  constructor(
    private readonly notifications: NotificationsService,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsappPort,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailPort,
  ) {}

  async handle(event: OutboxEventPayload): Promise<void> {
    const channels = ROUTING[event.type] ?? [];
    if (channels.length === 0) {
      // Événement sans politique de diffusion : rien à faire, il est clos.
      return;
    }

    const payload = readPayload(event.payload);
    if (!isRenderableNotificationType(event.type)) {
      this.logger.warn(
        `Événement ${event.type} (${event.id}) sans rendu connu — diffusion ignorée.`,
      );
      return;
    }

    const { title, body } = renderNotification(event.type, {
      reference: payload.reference,
    });

    // Destinataire résolu une seule fois : un canal n'a pas à deviner le
    // téléphone ou l'e-mail à partir du payload (le payload ne porte que
    // des identifiants, jamais des coordonnées).
    const user = payload.userId
      ? await prisma.user.findUnique({
          where: { id: payload.userId },
          select: { phone: true, email: true },
        })
      : null;

    let attempted = 0;
    let succeeded = 0;

    for (const channel of channels) {
      try {
        const outcome = await this.sendOn(channel, event, payload, user, {
          title,
          body,
        });
        if (outcome.status === 'SKIPPED') {
          await this.log(channel, event, payload, user, {
            status: 'SKIPPED',
            error: outcome.detail,
          });
          continue;
        }
        attempted += 1;
        if (outcome.status === 'SENT') succeeded += 1;
        await this.log(channel, event, payload, user, {
          status: outcome.status,
          error: outcome.detail,
          providerMessageId: outcome.providerMessageId,
        });
      } catch (error) {
        attempted += 1;
        await this.log(channel, event, payload, user, {
          status: 'FAILED',
          error: (error as Error).message.slice(0, 480),
        });
      }
    }

    if (attempted > 0 && succeeded === 0) {
      // Tous les canaux actifs ont échoué : lever fait repartir l'événement
      // (attempts++, back-off). Au plafond, le drain le marque FAILED.
      throw new Error(
        `Diffusion de ${event.type} (${event.id}) échouée sur tous les canaux actifs.`,
      );
    }
  }

  // `email` est nullable au schéma (un compte peut n'avoir ni e-mail ni
  // téléphone) : chaque canal décide lui-même de sa voie SKIPPED.
  private async sendOn(
    channel: string,
    event: OutboxEventPayload,
    payload: OrderEventPayload,
    user: { phone: string; email: string | null } | null,
    content: { title: string; body: string },
  ): Promise<{
    status: 'SENT' | 'FAILED' | 'SKIPPED';
    detail?: string;
    providerMessageId?: string;
  }> {
    if (channel === 'PUSH') {
      if (!payload.userId) return { status: 'SKIPPED', detail: 'Pas de destinataire.' };
      // Le service existant écrit la notification in-app ET délègue au
      // pilote push — un seul appel, canal gratuit.
      await this.notifications.notify({
        userId: payload.userId,
        type: event.type as Parameters<NotificationsService['notify']>[0]['type'],
        reference: payload.reference,
        orderId: payload.orderId,
      });
      return { status: 'SENT' };
    }

    if (channel === 'WHATSAPP') {
      if (!user?.phone) {
        return { status: 'SKIPPED', detail: 'Pas de téléphone connu.' };
      }
      const result = await this.whatsapp.send({
        to: user.phone,
        body: `${content.title} — ${content.body}`,
        event: event.type,
        uniqueKey: `${event.id}:whatsapp`,
      });
      if (result.sent || result.duplicate) return { status: 'SENT', detail: result.detail, providerMessageId: result.providerMessageId };
      return { status: result.detail.startsWith('Canal') ? 'SKIPPED' : 'FAILED', detail: result.detail };
    }

    if (channel === 'EMAIL') {
      if (!user?.email) {
        return { status: 'SKIPPED', detail: 'Pas d’e-mail connu.' };
      }
      const result = await this.email.send({
        to: user.email,
        subject: content.title,
        text: `${content.body}${payload.reference ? ` (réf. ${payload.reference})` : ''}`,
        event: event.type,
        uniqueKey: `${event.id}:email`,
      });
      if (result.sent || result.duplicate) return { status: 'SENT', detail: result.detail, providerMessageId: result.providerMessageId };
      return { status: result.detail.startsWith('Canal') ? 'SKIPPED' : 'FAILED', detail: result.detail };
    }

    return { status: 'SKIPPED', detail: `Canal inconnu : ${channel}` };
  }

  private async log(
    channel: string,
    event: OutboxEventPayload,
    payload: OrderEventPayload,
    user: { phone: string; email: string | null } | null,
    fields: {
      status: string;
      error?: string;
      providerMessageId?: string;
    },
  ): Promise<void> {
    await prisma.messageLog.create({
      data: {
        channel,
        toAddress:
          channel === 'EMAIL'
            ? (user?.email ?? '(inconnu)')
            : channel === 'WHATSAPP'
              ? (user?.phone ?? '(inconnu)')
              : (payload.userId ?? '(inconnu)'),
        userId: payload.userId ?? null,
        orderId: payload.orderId ?? null,
        outboxEventId: event.id,
        providerMessageId: fields.providerMessageId ?? null,
        status: fields.status,
        error: fields.error ?? null,
      },
    });
  }
}
