import { Module } from '@nestjs/common';

import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { TrackingService } from './tracking.service';

@Module({
  controllers: [DeliveriesController],
  providers: [DeliveriesService, TrackingService],
  // Le suivi est consomme aussi par le module commandes (vue client).
  exports: [TrackingService],
})
export class DeliveriesModule {}
