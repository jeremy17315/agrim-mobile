import { Module } from '@nestjs/common';

import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { PromotionsService } from './promotions.service';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, PromotionsService],
})
export class CatalogModule {}
