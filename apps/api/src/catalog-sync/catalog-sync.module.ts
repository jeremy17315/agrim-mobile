import {
  Logger,
  Module,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CatalogSyncController } from './catalog-sync.controller';
import { CatalogSyncService } from './catalog-sync.service';

/**
 * Synchronisation périodique du catalogue depuis le site.
 *
 * Un simple `setInterval` plutôt qu'un ordonnanceur : aucune de ces tâches n'a
 * besoin d'expression cron. Le même choix a été fait côté site pour la relance
 * des paniers abandonnés, et dans `ReconciliationModule`.
 *
 * Ces deux modules sont désormais les DEUX tâches de fond de l'API. À la
 * troisième, migrer l'ensemble vers `@nestjs/schedule` d'un seul geste plutôt
 * que d'accumuler les minuteurs à la main.
 *
 * Trois précautions :
 *   - un premier passage 30 s après le démarrage, le temps que la base soit
 *     prête, et jamais bloquant pour le démarrage lui-même ;
 *   - une exécution à la fois (`enCours`), sinon un site lent finirait par
 *     empiler les synchronisations ;
 *   - une erreur est journalisée, jamais propagée : l'API doit continuer de
 *     servir son catalogue local même quand le site est injoignable.
 */
@Module({
  controllers: [CatalogSyncController],
  providers: [CatalogSyncService],
  exports: [CatalogSyncService],
})
export class CatalogSyncModule implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CatalogSyncModule.name);
  private minuteur?: NodeJS.Timeout;
  private demarrage?: NodeJS.Timeout;
  private enCours = false;

  constructor(
    private readonly sync: CatalogSyncService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    // Meme garde que ReconciliationModule : un travail de fond qui ecrit en
    // base n'a rien a faire pendant une suite de tests. Inerte aujourd'hui
    // faute de SITE_INTEGRATION_URL, ce module ecraserait les prix et
    // desactiverait des variantes au milieu des assertions des que le jeton
    // de synchronisation sera configure.
    if (process.env.NODE_ENV === 'test') {
      this.logger.log('Synchronisation du catalogue desactivee en test.');
      return;
    }

    if (!this.sync.isConfigured) {
      this.logger.warn(
        'SITE_INTEGRATION_URL absent : le catalogue local ne sera pas synchronisé ' +
          'avec le site. Les prix peuvent diverger.',
      );
      return;
    }

    const minutes =
      this.config.get<number>('CATALOG_SYNC_INTERVAL_MINUTES') ?? 15;

    this.demarrage = setTimeout(() => void this.executer(), 30_000);
    this.minuteur = setInterval(() => void this.executer(), minutes * 60_000);
    // `unref` : ces minuteurs ne doivent pas retenir le processus à l'arrêt.
    this.demarrage.unref?.();
    this.minuteur.unref?.();

    this.logger.log(`Synchronisation du catalogue active (toutes les ${minutes} min)`);
  }

  onModuleDestroy(): void {
    if (this.demarrage) clearTimeout(this.demarrage);
    if (this.minuteur) clearInterval(this.minuteur);
  }

  private async executer(): Promise<void> {
    if (this.enCours) return;
    this.enCours = true;
    try {
      await this.sync.sync();
    } catch (erreur) {
      this.logger.error(
        `Synchronisation du catalogue en échec : ${(erreur as Error).message}`,
      );
    } finally {
      this.enCours = false;
    }
  }
}
