import { Module } from '@nestjs/common';

import { CatalogSyncModule } from '../catalog-sync/catalog-sync.module';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { CartQuoteController } from './cart-quote.controller';
import { CartQuoteService } from './cart-quote.service';
import { CheckoutService } from './checkout.service';

@Module({
  imports: [DeliveriesModule, CatalogSyncModule],
  controllers: [OrdersController, CartQuoteController],
  providers: [OrdersService, CheckoutService, CartQuoteService],
})
export class OrdersModule {}
