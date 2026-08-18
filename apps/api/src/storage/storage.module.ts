import { Global, Module } from '@nestjs/common';

import { LocalStorageProvider } from './local-storage.provider';
import { STORAGE_PROVIDER } from './storage.provider';

/**
 * Accès au stockage de fichiers.
 *
 * Aucune route HTTP : depuis le passage à la validation par OTP, plus aucun
 * fichier n'est déposé par les utilisateurs. Les points d'entrée de dépôt et
 * de consultation des preuves ont été retirés — une route d'upload sans
 * consommateur reste une surface d'attaque.
 *
 * L'abstraction est conservée telle quelle pour le prochain besoin réel
 * (visuels produits) : le pilote S3-compatible se branchera ici, sans toucher
 * aux modules métier.
 */
@Global()
@Module({
  providers: [{ provide: STORAGE_PROVIDER, useClass: LocalStorageProvider }],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
