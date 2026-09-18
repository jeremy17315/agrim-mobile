import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Port de sortie e-mail — canal transactionnel (reçus, confirmations).
 *
 * Même discipline que le port WhatsApp : jamais appelé par le cœur métier,
 * toujours par le dispatcher depuis l'outbox ; une panne SMTP laisse une
 * ligne FAILED au `MessageLog` et retente par back-off, sans jamais bloquer
 * une commande ni un paiement.
 *
 * Implémentation : SMTP direct via `nodemailer` — le choix cPanel s'impose :
 * LWS fournit un serveur SMTP au compte (ex. `mail.domaine.tld`), avec un
 * expéditeur `no-reply@domaine.tld`. Identifiants dans le `.env`, jamais
 * dans le code. Absents : pilote inerte, aucune erreur.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  /** Nom d'événement métier, repris dans les en-têtes de traçabilité. */
  event: string;
  /** Clé stable d'idempotence — journalisée, utilisable par un relais. */
  uniqueKey: string;
};

export type EmailResult = {
  sent: boolean;
  duplicate: boolean;
  detail: string;
  providerMessageId?: string;
};

export abstract class EmailPort {
  abstract send(message: EmailMessage): Promise<EmailResult>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

@Injectable()
export class SmtpEmailProvider extends EmailPort {
  private readonly logger = new Logger(SmtpEmailProvider.name);
  private transport: import('nodemailer').Transporter | null = null;
  private transportKey = '';

  constructor(private readonly config: ConfigService) {
    super();
  }

  /** Transport paresseux : créé au premier envoi, recréé si la config change. */
  private async transporter(): Promise<import('nodemailer').Transporter | null> {
    const host = this.config.get<string>('SMTP_HOST') ?? '';
    if (!host) return null;

    const port = Number.parseInt(
      this.config.get<string>('SMTP_PORT') ?? '587',
      10,
    );
    const user = this.config.get<string>('SMTP_USER') ?? '';
    const password = this.config.get<string>('SMTP_PASSWORD') ?? '';
    const key = `${host}:${port}:${user}`;
    if (!this.transport || this.transportKey !== key) {
      // Import dynamique : le module lourd ne charge que si le canal est réellement configuré.
      const nodemailer = await import('nodemailer');
      this.transport = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user ? { user, pass: password } : undefined,
        // Un e-mail transactionnel ne doit pas retenir un drain pendant 2 min.
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
      this.transportKey = key;
    }
    return this.transport;
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    const transport = await this.transporter();
    const from = this.config.get<string>('SMTP_FROM') ?? '';
    if (!transport || !from) {
      return { sent: false, duplicate: false, detail: 'Canal non configuré.' };
    }

    try {
      const info = await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        headers: { 'X-AGRIM-Event': message.event ?? '', 'X-AGRIM-Key': message.uniqueKey },
      });
      return {
        sent: true,
        duplicate: false,
        detail: 'Accepté par le serveur SMTP.',
        providerMessageId: info.messageId?.slice(0, 160),
      };
    } catch (error) {
      this.logger.warn(
        `SMTP en échec (${message.subject}) : ${(error as Error).message}`,
      );
      return {
        sent: false,
        duplicate: false,
        detail: `Erreur SMTP : ${(error as Error).message.slice(0, 200)}`,
      };
    }
  }
}

/** Pilote inerte : canal non configuré. Ne lève jamais. */
@Injectable()
export class NoopEmailProvider extends EmailPort {
  private readonly logger = new Logger(NoopEmailProvider.name);

  async send(message: EmailMessage): Promise<EmailResult> {
    this.logger.log(
      `E-mail désactivé — « ${message.subject} » non envoyé à ${message.to}.`,
    );
    return {
      sent: false,
      duplicate: false,
      detail: 'Canal e-mail non configuré (SMTP_HOST absent).',
    };
  }
}
