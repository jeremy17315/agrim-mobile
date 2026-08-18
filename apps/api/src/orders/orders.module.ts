import { Module } from '@nestjs/common';

import { DeliveriesModule } from '../deliveries/deliveries.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [DeliveriesModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
