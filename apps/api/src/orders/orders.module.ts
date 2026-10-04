import { Module } from '@nestjs/common';

import { CatalogSyncModule } from '../catalog-sync/catalog-sync.module';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { SitePricingModule } from '../site-pricing/site-pricing.module';
import { SieveModule } from '../sieve/sieve.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { CartQuoteController } from './cart-quote.controller';
import { CartQuoteService } from './cart-quote.service';
import { CheckoutService } from './checkout.service';
import { GuestCheckoutService } from './guest-checkout.service';
import { GuestPaymentTokenService } from './guest-payment-token.service';

@Module({
  imports: [SieveModule, DeliveriesModule, CatalogSyncModule, SitePricingModule],
  controllers: [OrdersController, CartQuoteController],
  providers: [
    OrdersService,
    CheckoutService,
    CartQuoteService,
    GuestCheckoutService,
    GuestPaymentTokenService,
  ],
  exports: [GuestPaymentTokenService],
})
export class OrdersModule {}