import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import {
  ExpoPushProvider,
  NoopPushProvider,
  PUSH_PROVIDER,
} from './push.provider';
import { NoopSmsProvider, SiteSmsProvider, SMS_PROVIDER } from './sms.provider';

/**
 * Global : commandes et livraisons notifient sans importer ce module partout.
 *
 * Les pilotes sont choisis en un seul point.
 *
 *   PUSH  — `PUSH_ENABLED=false` (défaut hors production) évite tout appel
 *           réseau sortant pendant les tests et en local.
 *   SMS   — relayé par le SITE (source unique du crédit SMS, du journal et
 *           des clés d'agrégateur). Sans `SITE_INTEGRATION_URL`, le pilote
 *           inerte prend la place : aucun appel réseau, aucune erreur.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    {
      provide: PUSH_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('PUSH_ENABLED') === 'true'
          ? new ExpoPushProvider()
          : new NoopPushProvider(),
    },
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('SITE_INTEGRATION_URL')
          ? new SiteSmsProvider(config)
          : new NoopSmsProvider(),
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
