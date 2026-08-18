import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import {
  ExpoPushProvider,
  NoopPushProvider,
  PUSH_PROVIDER,
} from './push.provider';

/**
 * Global : commandes et livraisons notifient sans importer ce module partout.
 *
 * Le pilote est choisi en un seul point. `PUSH_ENABLED=false` (défaut hors
 * production) évite tout appel réseau sortant pendant les tests et en local.
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
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
