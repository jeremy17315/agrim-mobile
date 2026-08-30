import { Prisma } from '../../../generated/prisma/client';
import { recordStockMovement } from './stock-movement';

/**
 * Annulation d'une commande — POINT DE PASSAGE UNIQUE.
 *
 * Depuis le 29 août 2026, le SITE possède le stock
 * ─────────────────────────────────────────────────
 * Cette fonction ne recrédite plus de compteur local : il n'y en a plus. Elle
 * fait deux choses — elle ARBITRE l'annulation (une seule gagne) et elle
 * journalise le mouvement. La libération réelle du stock est un appel au site,
 * que l'appelant émet HORS transaction avec la `reservationRef` renvoyée ici.
 *
 * Audit des fondations, août 2026 — l'arbitrage, et pourquoi il existe
 * ────────────────────────────────────────────────────────────────────
 * L'annulation est déclenchée depuis trois endroits, qui peuvent s'exécuter en
 * même temps sur la même commande :
 *
 *   1. `OrdersService.cancel`            — le client annule ;
 *   2. `ManagementService.cancelOrder`   — le bureau annule ;
 *   3. `PaymentsService.settle`          — le paiement échoue ou expire, et
 *      cette voie est déclenchée à la fois par le webhook du fournisseur et
 *      par le balayage de réconciliation (`ReconciliationService`).
 *
 * Les trois lisaient le statut de la commande AVANT d'ouvrir la transaction,
 * puis incrémentaient le stock sans revérifier. Sous PostgreSQL en READ
 * COMMITTED — l'isolation par défaut, celle qu'utilise Prisma — deux de ces
 * chemins peuvent lire `PENDING` tous les deux, puis rendre le stock tous les
 * deux. Le rayon gagne alors des sacs qui n'existent pas, et la survente
 * suivante est garantie. Le double-tap sur le bouton « Annuler » suffit à le
 * produire ; le webhook qui arrive pendant la réconciliation aussi.
 *
 * La correction ne consiste pas à verrouiller plus fort, mais à faire de la
 * TRANSITION DE STATUT elle-même le jeton d'exclusion : passer la commande à
 * `CANCELLED` par un UPDATE conditionnel est atomique, et le perdant de la
 * course voit `count === 0`. Il ne rend alors rien — ce qui est correct : son
 * concurrent l'a déjà fait.
 *
 * C'est le même raisonnement que le décrément conditionnel de `create` et que
 * la consommation d'OTP : une seule écriture décide, personne ne relit.
 */

/** Statuts depuis lesquels la marchandise est encore en entrepôt. */
const STOCK_HELD_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
] as const;

export interface StockReleaseResult {
  /** Faux quand un autre chemin a déjà annulé la commande : rien n'a été rendu. */
  released: boolean;
  /**
   * Clé de la réservation à libérer chez le site, quand il y a lieu.
   *
   * `null` : commande antérieure à la réservation centralisée, ou perdante de
   * la course — dans les deux cas, rien à libérer.
   */
  reservationRef?: string | null;
}

/**
 * Bascule la commande en `CANCELLED` et rend son stock, une seule fois.
 *
 * À appeler DANS une transaction : l'annulation et la restitution doivent
 * être écrites ensemble ou pas du tout.
 *
 * @param actorId auteur de l'annulation — le client, le gestionnaire, ou
 *   `null` quand c'est l'expiration d'un paiement qui la déclenche. Cette
 *   valeur part au journal des mouvements : ne jamais y mettre un auteur par
 *   défaut, l'absence est une information.
 *
 * @returns `released: false` si la commande était déjà annulée — l'appelant
 *   doit alors s'abstenir d'écrire un événement ou d'envoyer une notification,
 *   sous peine d'annoncer deux fois la même annulation au client.
 */
export async function cancelOrderAndReleaseStock(
  tx: Prisma.TransactionClient,
  orderId: string,
  actorId: string | null = null,
): Promise<StockReleaseResult> {
  // Le UPDATE conditionnel EST le verrou. Un seul appelant peut faire passer
  // la commande hors de `STOCK_HELD_STATUSES` ; les autres obtiennent 0.
  const claimed = await tx.order.updateMany({
    where: { id: orderId, status: { in: [...STOCK_HELD_STATUSES] } },
    data: { status: 'CANCELLED' },
  });
  if (claimed.count === 0) return { released: false };

  // Deux lectures SÉQUENTIELLES, et non un `Promise.all`.
  //
  // Une transaction Prisma tient UN client du pool. Y lancer deux requêtes en
  // parallèle les envoie sur la même connexion, ce que `pg` signale déjà —
  // « Calling client.query() when the client is already executing a query » —
  // et qui lèvera en `pg@9`. Le gain d'un aller-retour local ne vaut pas de
  // s'appuyer sur un comportement déprécié au cœur du chemin d'annulation.
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { variantId: true, quantity: true },
  });

  // La référence accompagne chaque mouvement : sans elle, une restitution
  // serait une ligne de journal orpheline, impossible à rattacher à la vente
  // qu'elle annule.
  //
  // `idempotencyKey` est en outre la clé de la RÉSERVATION posée chez le
  // site : c'est elle que l'appelant devra libérer.
  const commande = await tx.order.findUnique({
    where: { id: orderId },
    select: { reference: true, idempotencyKey: true },
  });

  // Regroupé par variante : une commande peut porter deux lignes de la même
  // variante (reprise d'un panier fusionné côté client), et deux UPDATE
  // successifs sur la même ligne prennent le verrou deux fois pour rien.
  const parVariante = new Map<string, number>();
  for (const item of items) {
    parVariante.set(
      item.variantId,
      (parVariante.get(item.variantId) ?? 0) + item.quantity,
    );
  }

  // Le stock n'est PAS recrédité ici : il est retenu par le site, qui en est
  // propriétaire depuis le 29 août 2026. On journalise le mouvement pour que
  // l'inventaire local reste explicable, et l'appelant libère la réservation
  // chez le site — hors transaction, parce que c'est un appel réseau.
  for (const [variantId, quantity] of parVariante) {
    await recordStockMovement(tx, {
      variantId,
      quantity,
      type: 'ANNULATION',
      reference: commande?.reference ?? null,
      actorId,
    });
  }

  return {
    released: true,
    // Clé de la réservation à libérer. `null` pour une commande antérieure à
    // la réservation centralisée : il n'y a alors rien à libérer côté site.
    reservationRef: commande?.idempotencyKey ?? null,
  };
}
