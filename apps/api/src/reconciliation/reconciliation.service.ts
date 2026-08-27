import { Injectable, Logger } from '@nestjs/common';

import { TrackingService } from '../deliveries/tracking.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Jours pendant lesquels un refresh token EXPIRÉ reste en base.
 *
 * On ne supprime pas dès l'expiration. La détection de vol repose sur la
 * présence de la ligne : présenter un token révoqué invalide toutes les
 * sessions de l'utilisateur. Effacer trop tôt transformerait une réutilisation
 * suspecte en simple « token inconnu », donc en incident invisible. Passé la
 * date d'expiration le jeton ne vaut plus rien de toute façon ; cette fenêtre
 * ne sert qu'à garder une trace exploitable en cas d'analyse.
 */
const REFRESH_TOKEN_RETENTION_DAYS = 30;

/**
 * Travaux de fond qui garantissent qu'aucune donnée ne reste en suspens.
 *
 * Chaque balayage est indépendant et isolé : la panne de l'un ne doit jamais
 * empêcher les autres de s'exécuter. C'est la raison des `try` séparés plutôt
 * que d'un seul bloc autour de la méthode.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly tracking: TrackingService,
  ) {}

  async run(now = new Date()): Promise<void> {
    await this.reconcilePayments(now);
    await this.purgeRefreshTokens(now);
    await this.purgeTraces(now);
  }

  /**
   * Paiements laissés en attente : expiration ou vérification auprès du
   * fournisseur. C'est le balayage qui rend le stock des commandes
   * abandonnées.
   */
  private async reconcilePayments(now: Date): Promise<void> {
    try {
      const { expired, resolved } = await this.payments.reconcilePending(now);
      if (expired || resolved) {
        this.logger.log(
          `Paiements réconciliés : ${expired} expiré(s), ${resolved} tranché(s) par le fournisseur.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Réconciliation des paiements en échec : ${(error as Error).message}`,
      );
    }
  }

  /** Refresh tokens dont la date d'expiration est largement dépassée. */
  private async purgeRefreshTokens(now: Date): Promise<void> {
    try {
      const cutoff = new Date(
        now.getTime() - REFRESH_TOKEN_RETENTION_DAYS * 24 * 3600 * 1000,
      );
      const { count } = await this.prisma.db.refreshToken.deleteMany({
        where: { expiresAt: { lt: cutoff } },
      });
      if (count) this.logger.log(`${count} refresh token(s) expiré(s) purgé(s).`);
    } catch (error) {
      this.logger.error(
        `Purge des refresh tokens en échec : ${(error as Error).message}`,
      );
    }
  }

  /**
   * Traces GPS des courses terminées.
   *
   * `purgeOldTraces` annonçait en commentaire être « appelée par une tâche
   * planifiée » — laquelle n'existait pas. La minimisation des données promise
   * par le schéma n'avait donc jamais lieu : les positions des livreurs
   * s'accumulaient indéfiniment. C'est ici qu'elle est réellement branchée.
   *
   * Les codes de livraison (`DeliveryOtp`) ne sont volontairement PAS purgés :
   * le schéma conserve une ligne par génération pour pouvoir démontrer, en cas
   * de litige, combien de codes ont été émis et lequel a validé la remise.
   */
  private async purgeTraces(now: Date): Promise<void> {
    try {
      const { deleted } = await this.tracking.purgeOldTraces(now);
      if (deleted) this.logger.log(`${deleted} position(s) GPS purgée(s).`);
    } catch (error) {
      this.logger.error(
        `Purge des traces GPS en échec : ${(error as Error).message}`,
      );
    }
  }
}
