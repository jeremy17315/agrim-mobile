import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Port de sortie WhatsApp — l'un des trois canaux de diffusion découplée.
 *
 * Le cœur métier n'appelle JAMAIS ce port : il écrit un événement d'outbox,
 * et c'est le dispatcher (consommateur du drain) qui le résout en envois.
 * Une panne WhatsApp n'empêche donc jamais une confirmation de paiement —
 * elle laisse une ligne FAILED au `MessageLog`, retentée par le back-off
 * du drain (docs/refonte/02, § 3.5).
 *
 * Implémentation : API REST générique d'agrégateur (Cloud API Meta, WATI,
 * 360dialog… toutes exposent un POST authentifié par jeton). L'URL et le
 * jeton vivent dans le `.env` et ne quittent jamais le serveur. Absents :
 * le pilote inerte prend la place — aucune erreur, aucun appel réseau,
 * l'événement est marqué traité (un canal non configuré n'est pas une panne).
 */

export type WhatsappMessage = {
  /** Numéro du destinataire, tel qu'il est en base. */
  to: string;
  body: string;
  /** Nom d'événement, repris au journal. */
  event: string;
  /**
   * Clé stable d'idempotence. Un WhatsApp se paie : la même clé rejouée
   * (drain après bail expiré, curl répété) ne doit envoyer qu'une fois.
   */
  uniqueKey: string;
};

export type WhatsappResult = {
  sent: boolean;
  /** `true` quand l'agrégateur reconnaît un envoi déjà effectué. */
  duplicate: boolean;
  detail: string;
  /** Identifiant côté agrégateur, pour la réconciliation. */
  providerMessageId?: string;
};

export abstract class WhatsappPort {
  abstract send(message: WhatsappMessage): Promise<WhatsappResult>;
}

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');

/** Délai borné des appels sortants (Node 20 : `fetch` global, zéro dépendance). */
const TIMEOUT_MS = 15_000;

@Injectable()
export class HttpWhatsappProvider extends WhatsappPort {
  private readonly logger = new Logger(HttpWhatsappProvider.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  async send(message: WhatsappMessage): Promise<WhatsappResult> {
    const url = (
      this.config.get<string>('WHATSAPP_API_URL') ?? ''
    ).replace(/\/+$/, '');
    const token = this.config.get<string>('WHATSAPP_API_TOKEN') ?? '';
    if (!url || !token) {
      return { sent: false, duplicate: false, detail: 'Canal non configuré.' };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to: message.to,
          body: message.body,
          event: message.event,
          unique_key: message.uniqueKey,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const raw = (await response.text()).slice(0, 500);
      if (!response.ok) {
        return {
          sent: false,
          duplicate: false,
          detail: `HTTP ${response.status} : ${raw}`,
        };
      }

      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Corps non JSON : l'envoi a répondu 2xx, on ne le considère pas perdu.
      }
      const duplicate = payload.duplicate === true;
      const providerMessageId =
        typeof payload.message_id === 'string' ? payload.message_id : undefined;

      return {
        sent: !duplicate,
        duplicate,
        detail: duplicate ? 'Déjà envoyé (clé reconnue).' : 'Accepté.',
        providerMessageId,
      };
    } catch (error) {
      // Journalisé, jamais propagé : le dispatcher décide du sort de
      // l'événement (retry via outbox), pas le pilote.
      this.logger.warn(
        `WhatsApp injoignable (${message.event}) : ${(error as Error).message}`,
      );
      return {
        sent: false,
        duplicate: false,
        detail: `Erreur réseau : ${(error as Error).message.slice(0, 200)}`,
      };
    }
  }
}

/** Pilote inerte : canal non configuré. Ne lève jamais. */
@Injectable()
export class NoopWhatsappProvider extends WhatsappPort {
  private readonly logger = new Logger(NoopWhatsappProvider.name);

  async send(message: WhatsappMessage): Promise<WhatsappResult> {
    this.logger.log(
      `WhatsApp désactivé — message « ${message.event} » non envoyé à ${message.to}.`,
    );
    return {
      sent: false,
      duplicate: false,
      detail: 'Canal WhatsApp non configuré (WHATSAPP_API_URL absent).',
    };
  }
}
