import { Prisma } from '../../generated/prisma/client';

/**
 * Rend au compte le crédit consommé par une commande annulée.
 *
 * ── Pourquoi une fonction libre, et non une méthode de service ─────────────
 * Elle s'exécute DANS la transaction de l'appelant — celle qui vient de faire
 * basculer la commande en `CANCELLED` (`common/stock/order-stock.ts`). Un
 * service injecté n'apporterait ici qu'une dépendance à transporter ; ce dont
 * cette fonction a besoin, c'est uniquement du client transactionnel.
 *
 * ── Deux verrous, et pas un de trop ───────────────────────────────────────
 * 1. L'annulation elle-même : `cancelOrderAndReleaseStock` ne laisse qu'un
 *    seul appelant faire sortir la commande de ses statuts « en cours ». Les
 *    voies concurrentes (client, bureau, expiration du paiement) n'arrivent
 *    donc ici qu'une fois.
 * 2. `creditRefundedAt` : le passage à non-NULL est un UPDATE conditionnel,
 *    qui reste vrai même si un jour un autre chemin appelait cette fonction.
 *    Le crédit rendu l'est une fois, pas deux — un solde doublé par une course
 *    serait de l'argent créé de nulle part.
 *
 * @returns le montant rendu (0 : rien à rendre, ou déjà rendu).
 */
export async function refundOrderCredit(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<number> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { credit: true, creditUserId: true },
  });
  const montant = Math.max(order?.credit ?? 0, 0);
  if (montant <= 0 || !order?.creditUserId) return 0;

  // L'écriture EST le verrou : seul l'appelant qui fait passer
  // `creditRefundedAt` de NULL à une date rend le crédit.
  const claimed = await tx.order.updateMany({
    where: { id: orderId, creditRefundedAt: null, credit: { gt: 0 } },
    data: { creditRefundedAt: new Date() },
  });
  if (claimed.count === 0) return 0;

  // Compte supprimé entre-temps : il n'y a personne à créditer. La marque est
  // écrite quand même (la commande a bien été traitée), la transaction reste
  // cohérente, et aucune boucle ne tentera de rendre ce crédit à l'infini.
  const rendu = await tx.user.updateMany({
    where: { id: order.creditUserId },
    data: { creditBalanceXof: { increment: montant } },
  });
  return rendu.count === 1 ? montant : 0;
}
