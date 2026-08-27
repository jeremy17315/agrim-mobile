import {
  Logger,
  Module,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DeliveriesModule } from '../deliveries/deliveries.module';
import { PaymentsModule } from '../payments/payments.module';
import { ReconciliationService } from './reconciliation.service';

/** Bornes de l'intervalle configurable, en minutes. */
const MIN_INTERVAL = 1;
const MAX_INTERVAL = 240;
const DEFAULT_INTERVAL = 10;

/**
 * Réconciliation périodique : paiements en suspens et purges de rétention.
 *
 * Même motif que `CatalogSyncModule` — `setInterval` plutôt qu'un
 * ordonnanceur. Ajouter `@nestjs/schedule` pour deux tâches de fond ne se
 * justifie pas ; si une troisième apparaît, migrer les deux d'un coup.
 *
 * UN POINT DE DÉPLOIEMENT À NE PAS PERDRE
 * ────────────────────────────────────────
 * L'instance Render du plan gratuit s'endort après 15 min sans requête. Un
 * minuteur ne tourne pas pendant ce sommeil : une commande dont le paiement
 * expire à 3 h du matin ne serait jamais réconciliée si l'on se contentait de
 * l'intervalle. D'où le passage AU DÉMARRAGE — c'est lui qui rattrape tout ce
 * qui s'est périmé pendant que le processus n'existait pas. Sur un hébergement
 * qui ne dort pas, il est simplement redondant, ce qui ne coûte rien.
 *
 * Trois précautions reprises du module de catalogue :
 *   - le premier passage est différé de 20 s, le temps que la base réponde,
 *     et ne bloque jamais le démarrage ;
 *   - une exécution à la fois (`enCours`), sinon un fournisseur lent finirait
 *     par empiler les balayages ;
 *   - une erreur est journalisée, jamais propagée.
 */
@Module({
  imports: [PaymentsModule, DeliveriesModule],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ReconciliationModule.name);
  private minuteur?: NodeJS.Timeout;
  private demarrage?: NodeJS.Timeout;
  private enCours = false;

  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    // JAMAIS pendant les tests.
    //
    // Chaque suite e2e instancie `AppModule`, donc ce module, donc ce
    // minuteur. Le balayage se declenchait alors AU MILIEU des tests et
    // reglait de vrais paiements : il annulait des commandes et rendait du
    // stock sous les pieds des assertions. Il ouvrait en prime des connexions
    // concurrentes sur une base distante deja limitee.
    //
    // Un travail de fond qui ecrit doit rester silencieux tant que ce n'est
    // pas lui qu'on teste. `PaymentsService.reconcilePending()` a sa propre
    // couverture unitaire, ou il est appele explicitement.
    if (process.env.NODE_ENV === 'test') {
      this.logger.log('Reconciliation desactivee en environnement de test.');
      return;
    }

    const minutes = this.resolveInterval();

    this.demarrage = setTimeout(() => void this.executer(), 20_000);
    this.minuteur = setInterval(() => void this.executer(), minutes * 60_000);
    // `unref` : ces minuteurs ne doivent pas retenir le processus à l'arrêt.
    this.demarrage.unref?.();
    this.minuteur.unref?.();

    this.logger.log(`Réconciliation active (toutes les ${minutes} min)`);
  }

  onModuleDestroy(): void {
    if (this.demarrage) clearTimeout(this.demarrage);
    if (this.minuteur) clearInterval(this.minuteur);
  }

  /** Intervalle borné : une valeur absurde en configuration ne doit pas
   * produire un balayage continu ni un silence de plusieurs jours. */
  private resolveInterval(): number {
    const raw = Number.parseInt(
      this.config.get<string>('RECONCILIATION_INTERVAL_MINUTES') ??
        String(DEFAULT_INTERVAL),
      10,
    );
    if (Number.isNaN(raw)) return DEFAULT_INTERVAL;
    return Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, raw));
  }

  private async executer(): Promise<void> {
    if (this.enCours) return;
    this.enCours = true;
    try {
      await this.reconciliation.run();
    } catch (erreur) {
      this.logger.error(
        `Réconciliation en échec : ${(erreur as Error).message}`,
      );
    } finally {
      this.enCours = false;
    }
  }
}
