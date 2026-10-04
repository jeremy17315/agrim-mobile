import { Module } from '@nestjs/common';

import { SitePricingService } from './site-pricing.service';

/**
 * Prix officiels du site, servis par `SitePricingService`.
 *
 * Règle d'or de cette intégration : le SITE fait foi. Le mobile n'affiche
 * jamais de prix écrasé, et la commande paie le tarif du site à la seconde
 * commande — le module expose donc UNIQUEMENT le prix résolu, et le protège
 * de toute divergence locale.
 *
 * `ConfigService` est global (`ConfigModule.forRoot({ isGlobal: true })`),
 * donc aucun import supplémentaire n'est nécessaire ici.
 */
@Module({
  providers: [SitePricingService],
  exports: [SitePricingService],
})
export class SitePricingModule {}