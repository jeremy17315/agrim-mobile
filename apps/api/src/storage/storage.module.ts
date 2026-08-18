import { Global, Module } from '@nestjs/common';

import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { LocalStorageProvider } from './local-storage.provider';
import { STORAGE_PROVIDER } from './storage.provider';

/**
 * Le fournisseur est choisi ici, en un seul point. Ajouter un pilote
 * S3-compatible consistera à changer cette liaison, sans toucher aux modules
 * qui consomment le stockage.
 */
@Global()
@Module({
  controllers: [FilesController],
  providers: [
    FilesService,
    { provide: STORAGE_PROVIDER, useClass: LocalStorageProvider },
  ],
  exports: [FilesService, STORAGE_PROVIDER],
})
export class StorageModule {}
