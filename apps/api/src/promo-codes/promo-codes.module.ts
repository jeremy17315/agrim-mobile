import { Module } from '@nestjs/common';

import { SitePricingModule } from '../site-pricing/site-pricing.module';
import { PromoCodesController } from './promo-codes.controller';
import { PromoCodesService } from './promo-codes.service';

/**
 * Codes promo.
 *
 * Exporté : le devis panier et le checkout en ont besoin pour appliquer LA
 * même règle — un code accepté au devis doit l'être à la commande, et au même
 * montant.
 */
@Module({
  imports: [SitePricingModule],
  controllers: [PromoCodesController],
  providers: [PromoCodesService],
  exports: [PromoCodesService],
})
export class PromoCodesModule {}
