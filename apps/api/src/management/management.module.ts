import { Module } from '@nestjs/common';

import { CatalogSyncModule } from '../catalog-sync/catalog-sync.module';
import { ManagementController } from './management.controller';
import { ManagementService } from './management.service';

@Module({
  // La libération du stock passe par le SITE : ce module en a besoin depuis
  // que l'annulation ne recrédite plus de compteur local.
  imports: [CatalogSyncModule],
  controllers: [ManagementController],
  providers: [ManagementService],
})
export class ManagementModule {}
