import { Module } from '@nestjs/common';

import { CatalogSyncModule } from '../catalog-sync/catalog-sync.module';
import { SecretBoxService } from '../common/crypto/secret-box.service';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { DeliveryOtpService } from './delivery-otp.service';
import { TrackingService } from './tracking.service';

@Module({
  // La finalisation de la réservation passe par le SITE : c'est lui qui
  // possède le stock depuis le 29 août 2026.
  imports: [CatalogSyncModule],
  controllers: [DeliveriesController],
  providers: [
    DeliveriesService,
    DeliveryOtpService,
    SecretBoxService,
    TrackingService,
  ],
  // Le suivi est consomme aussi par le module commandes (vue client).
  exports: [TrackingService],
})
export class DeliveriesModule {}
