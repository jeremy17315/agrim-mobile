import { Module, Provider, type DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import {
  EMAIL_PROVIDER,
  EmailPort,
  NoopEmailProvider,
  SmtpEmailProvider,
} from './email.provider';
import { MessagingDispatcher } from './messaging.dispatcher';
import {
  NoopWhatsappProvider,
  HttpWhatsappProvider,
  WHATSAPP_PROVIDER,
  WhatsappPort,
} from './whatsapp.provider';
import { OUTBOX_HANDLERS } from '../jobs/outbox.handler';

/**
 * Module de diffusion découplée (docs/refonte/02, § 3.5).
 *
 * Le choix des pilotes se fait EN UN SEUL POINT, par présence de
 * configuration — pas par une variable « mode » de plus à se souvenir :
 *   - WHATSAPP_API_URL + WHATSAPP_API_TOKEN renseignés ⇒ pilote HTTP
 *     d'agrégateur, sinon pilote inerte ;
 *   - SMTP_HOST renseigné ⇒ pilote SMTP (nodemailer), sinon pilote inerte.
 *
 * Le dispatcher est exposé au `JobsModule` sous le jeton `OUTBOX_HANDLERS` :
 * c'est LUI que le drain d'outbox appelle — jamais un module métier.
 */
@Module({})
export class MessagingModule {
  static register(): DynamicModule {
    const channels: Provider[] = [
      {
        provide: WHATSAPP_PROVIDER,
        useFactory: (config: ConfigService): WhatsappPort =>
          config.get<string>('WHATSAPP_API_URL') &&
          config.get<string>('WHATSAPP_API_TOKEN')
            ? new HttpWhatsappProvider(config)
            : new NoopWhatsappProvider(),
        inject: [ConfigService],
      },
      {
        provide: EMAIL_PROVIDER,
        useFactory: (config: ConfigService): EmailPort =>
          config.get<string>('SMTP_HOST')
            ? new SmtpEmailProvider(config)
            : new NoopEmailProvider(),
        inject: [ConfigService],
      },
    ];

    return {
      module: MessagingModule,
      imports: [ConfigModule],
      providers: [
        ...channels,
        MessagingDispatcher,
        { provide: OUTBOX_HANDLERS, useExisting: MessagingDispatcher },
      ],
      exports: [OUTBOX_HANDLERS],
    };
  }
}
