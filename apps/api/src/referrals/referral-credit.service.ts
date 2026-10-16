import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Le crédit de parrainage — LECTURE et CONSOMMATION.
 *
 * ── Ce qui existait avant, et pourquoi c'était cassé ──────────────────────
 * `creditBalanceXof` était incrémenté à la livraison du filleul
 * (`deliveries.service.ts`) et affiché dans l'écran Parrainage, mais il
 * n'entrait dans aucun total : le parrain voyait « 1 000 F de crédit gagné »
 * sans jamais pouvoir le dépenser. Un solde qui ne sert à rien est pire qu'un
 * solde absent : il fait une promesse.
 *
 * ── La règle de consommation ─────────────────────────────────────────────
 * Le crédit se consomme DANS la transaction qui crée la commande, par un
 * UPDATE CONDITIONNEL — jamais par un `update` après une lecture. Un solde lu
 * hors verrou est une information périmée : deux commandes simultanées du même
 * compte liraient 1 000 F toutes les deux et le dépenseraient deux fois. Ici,
 * c'est l'écriture qui décide : `WHERE creditBalanceXof >= montant` fait que le
 * perdant de la course obtient `count === 0` et relit le solde réel.
 *
 * Ce service ne rend JAMAIS le solde négatif : le montant consommé est
 * toujours ≤ solde lu, et l'écriture elle-même est conditionnelle.
 */
@Injectable()
export class ReferralCreditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Solde dépensable d'un compte. Inconnu (compte supprimé) ⇒ 0. */
  async balance(userId: string): Promise<number> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { creditBalanceXof: true },
    });
    return Math.max(user?.creditBalanceXof ?? 0, 0);
  }

  /**
   * Consomme jusqu'à `wanted` XOF du crédit du compte, dans la transaction de
   * l'appelant.
   *
   * @returns le montant RÉELLEMENT consommé (0 si le solde ne le permet pas, ou
   *   s'il a fondu entre-temps). L'appelant facture ce montant-là : facturer
   *   `wanted` parce qu'il « devait » être disponible serait encaisser un
   *   crédit que le compte n'avait plus.
   */
  async consume(
    tx: Prisma.TransactionClient,
    userId: string,
    wanted: number,
  ): Promise<number> {
    if (!Number.isInteger(wanted) || wanted <= 0) return 0;

    // Deux tentatives, pas une boucle ouverte : la première lit le solde, la
    // seconde rattrape une commande concurrente du même compte qui aurait
    // consommé entre la lecture et l'écriture. Au-delà, la contention est
    // anormale — on préfère facturer sans crédit plutôt que de faire patienter
    // la commande sous verrou.
    for (let essai = 0; essai < 2; essai += 1) {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { creditBalanceXof: true },
      });
      if (!user) return 0;

      const montant = Math.min(Math.max(user.creditBalanceXof, 0), wanted);
      if (montant <= 0) return 0;

      const pris = await tx.user.updateMany({
        where: { id: userId, creditBalanceXof: { gte: montant } },
        data: { creditBalanceXof: { decrement: montant } },
      });
      if (pris.count === 1) return montant;
    }

    return 0;
  }
}
