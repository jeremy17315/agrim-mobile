import { Module } from '@nestjs/common';

import { CatalogSyncModule } from '../catalog-sync/catalog-sync.module';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [DeliveriesModule, CatalogSyncModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
