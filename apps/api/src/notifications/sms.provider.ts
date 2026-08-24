import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Envoi de SMS — relayé par le SITE.
 *
 * Décision d'architecture (audit de cohérence, août 2026)
 * ──────────────────────────────────────────────────────
 * Cette API n'appelle AUCUN agrégateur SMS directement. Elle demande au site
 * d'envoyer pour elle, via `POST /api/integration/message`.
 *
 * Trois raisons, dans l'ordre :
 *
 *  1. **Un seul crédit, un seul journal.** Le site trace déjà chaque envoi
 *     dans sa table `notifications` et sait le renvoyer depuis son back
 *     office. Un second client SMS ici n'aurait ni l'un ni l'autre, et
 *     personne ne saurait dire combien de SMS AGRIM a payés.
 *  2. **Un seul jeu de clés.** La clé de l'agrégateur ne quitte jamais le
 *     site. Cette API ne connaît qu'un jeton de service, révocable seul.
 *  3. **Un seul anti-doublon.** Un SMS se paie. La `cle_unicite` transmise
 *     ici garantit qu'un réseau qui hoquette ne le fait pas payer deux fois :
 *     le relais refuse de rejouer une clé déjà envoyée.
 *
 * Le PUSH reste propre à cette application : gratuit, et le site n'en a pas
 * l'usage. La règle est donc : push = application, SMS/WhatsApp = site.
 */

export type SmsMessage = {
  /** Numéro du destinataire, tel qu'il est en base. */
  to: string;
  body: string;
  /** Nom d'événement, repris tel quel dans le journal du site. */
  event: string;
  /**
   * Clé stable d'idempotence. Deux appels avec la même clé n'envoient qu'un
   * SMS — c'est ce qui rend un réessai sans danger.
   */
  uniqueKey?: string;
};

export type SmsResult = {
  sent: boolean;
  /** `true` quand le relais a reconnu un envoi déjà effectué. */
  duplicate: boolean;
  detail: string;
};

export abstract class SmsProvider {
  abstract send(message: SmsMessage): Promise<SmsResult>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

/** Chemin de la route de relais, côté site. */
const CHEMIN_RELAIS = '/api/integration/message';

@Injectable()
export class SiteSmsProvider extends SmsProvider {
  private readonly logger = new Logger(SiteSmsProvider.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  private get relayUrl(): string {
    const base = (this.config.get<string>('SITE_INTEGRATION_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    return base ? `${base}${CHEMIN_RELAIS}` : '';
  }

  async send(message: SmsMessage): Promise<SmsResult> {
    const url = this.relayUrl;
    const token = this.config.get<string>('SITE_INTEGRATION_TOKEN') ?? '';

    if (!url || !token) {
      // Ni exception ni retentative : une notification ne doit jamais faire
      // échouer l'action métier qui l'a déclenchée.
      this.logger.warn(
        'SITE_INTEGRATION_URL ou SITE_INTEGRATION_TOKEN absent : aucun SMS ne ' +
          'partira. Le client ne recevra que la notification poussée.',
      );
      return { sent: false, duplicate: false, detail: 'relais non configuré' };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Sync-Token': token,
        },
        body: JSON.stringify({
          canal: 'sms',
          destinataire: message.to,
          message: message.body,
          evenement: message.event,
          cle_unicite: message.uniqueKey ?? '',
          origine: 'app',
        }),
        // Le site peut être lent ou indisponible : on ne retient pas la
        // requête métier plus de quelques secondes pour un SMS.
        signal: AbortSignal.timeout(15_000),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        statut?: string;
        envoye?: boolean;
        detail?: string;
      };

      if (!response.ok) {
        this.logger.warn(
          `Relais SMS refusé (HTTP ${response.status}) : ${payload.detail ?? ''}`,
        );
        return {
          sent: false,
          duplicate: false,
          detail: `HTTP ${response.status}`,
        };
      }

      return {
        sent: payload.envoye === true,
        duplicate: payload.statut === 'deja_envoye',
        detail: payload.detail ?? payload.statut ?? '',
      };
    } catch (error) {
      this.logger.warn(
        `Relais SMS injoignable : ${
          error instanceof Error ? error.message : 'erreur inconnue'
        }`,
      );
      return { sent: false, duplicate: false, detail: 'relais injoignable' };
    }
  }
}

/**
 * Pilote inerte : tests et environnements sans réseau sortant.
 * Il ne prétend pas avoir envoyé — le contraire masquerait une panne.
 */
@Injectable()
export class NoopSmsProvider extends SmsProvider {
  send(): Promise<SmsResult> {
    return Promise.resolve({ sent: false, duplicate: false, detail: 'inerte' });
  }
}
