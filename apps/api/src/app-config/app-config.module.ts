import { Module } from '@nestjs/common';

import { AppConfigController, AppConfigAdminController } from './app-config.controller';
import { AppConfigService } from './app-config.service';

/**
 * Configuration commerciale servie à l'application.
 *
 * Exporté : d'autres écrans (livraison, contact) peuvent vouloir les mêmes
 * valeurs sans repasser par HTTP.
 */
@Module({
  controllers: [AppConfigController, AppConfigAdminController],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
