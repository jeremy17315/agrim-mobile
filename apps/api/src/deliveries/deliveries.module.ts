import { Module } from '@nestjs/common';

import { SecretBoxService } from '../common/crypto/secret-box.service';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { DeliveryOtpService } from './delivery-otp.service';
import { TrackingService } from './tracking.service';

@Module({
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
