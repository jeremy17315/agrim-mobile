import { Prisma, StockMovementType } from '../../../generated/prisma/client';

/**
 * Toute variation de stock passe par ici — écriture ET journal, ensemble.
 *
 * Administration centrale, août 2026
 * ──────────────────────────────────
 * Le stock se modifiait depuis plusieurs endroits, chacun avec sa propre
 * écriture et aucun avec de trace. On lisait « 148 » sans pouvoir dire si
 * c'était 150 moins deux ventes ou 200 moins une erreur de saisie. Un écart
 * d'inventaire n'était ni explicable ni imputable.
 *
 * Deux garanties, et elles ne valent que prises ensemble :
 *
 * 1. **Le journal ne peut pas diverger du compteur.** Les deux écritures
 *    vivent dans la même fonction et la même transaction. Il n'y a pas de
 *    chemin qui modifie le stock sans laisser de ligne, parce qu'il n'y a
 *    plus de chemin du tout — celui-ci est le seul.
 *
 * 2. **Le stock ne peut pas devenir négatif.** L'ancien code lisait la
 *    quantité, vérifiait `stock + delta >= 0`, puis incrémentait sans
 *    revérifier. Deux retraits simultanés — ou un retrait pendant une
 *    commande — passaient tous deux le contrôle et le compteur tombait sous
 *    zéro. Ici, la condition `stock >= -delta` est DANS le `WHERE` : c'est
 *    PostgreSQL qui arbitre, pas une lecture antérieure.
 *
 * Même raisonnement que `order-stock.ts` : une seule écriture décide,
 * personne ne relit.
 */

export interface StockChange {
  variantId: string;
  /** Variation signée. `+50` à la réception, `−2` à la commande. */
  delta: number;
  type: StockMovementType;
  /** Motif libre. Exigé pour un ajustement d'inventaire, par l'appelant. */
  reason?: string | null;
  /** Référence de commande, quand le mouvement en découle. */
  reference?: string | null;
  /** `null` pour un mouvement du système — ne jamais inventer d'auteur. */
  actorId?: string | null;
}

export interface StockChangeResult {
  stockBefore: number;
  stockAfter: number;
}

/**
 * Journalise un mouvement SANS toucher au compteur local.
 *
 * Depuis que le site possède le stock (29 août 2026), une commande mobile ne
 * décrémente plus rien ici : le retrait a eu lieu chez le site. Mais
 * l'inventaire local doit rester explicable — sinon la copie de stock
 * changerait à la synchronisation sans qu'aucune ligne n'explique pourquoi.
 *
 * `stockBefore` et `stockAfter` sont donc identiques : ils décrivent l'état de
 * la COPIE, que ce mouvement n'a pas modifiée. La quantité, elle, est bien
 * signée — c'est elle qui raconte la vente.
 */
export async function recordStockMovement(
  tx: Prisma.TransactionClient,
  mouvement: Omit<StockChange, 'delta'> & { quantity: number },
): Promise<void> {
  const { stock } = await tx.productVariant.findUniqueOrThrow({
    where: { id: mouvement.variantId },
    select: { stock: true },
  });

  await tx.stockMovement.create({
    data: {
      variantId: mouvement.variantId,
      type: mouvement.type,
      quantity: mouvement.quantity,
      stockBefore: stock,
      stockAfter: stock,
      reason: mouvement.reason ?? null,
      reference: mouvement.reference ?? null,
      actorId: mouvement.actorId ?? null,
    },
  });
}

/**
 * Applique une variation de stock et la journalise.
 *
 * À appeler DANS une transaction : le compteur, le journal et ce qui motive
 * le mouvement (commande, annulation) s'écrivent ensemble ou pas du tout.
 *
 * @returns `null` si le stock disponible ne couvre pas un retrait. L'appelant
 *   décide alors du message : « rupture » n'a pas le même sens au comptoir
 *   qu'au passage en caisse.
 */
export async function applyStockChange(
  tx: Prisma.TransactionClient,
  change: StockChange,
): Promise<StockChangeResult | null> {
  const { variantId, delta } = change;

  if (!Number.isInteger(delta) || delta === 0) {
    // Un mouvement nul n'est pas un mouvement : l'écrire polluerait
    // l'historique sans rien expliquer.
    throw new Error('Variation de stock invalide : entier non nul attendu.');
  }

  // Le retrait est conditionnel, l'apport ne l'est pas : rien n'empêche
  // jamais d'ajouter du stock.
  const applied = await tx.productVariant.updateMany({
    where: {
      id: variantId,
      ...(delta < 0 ? { stock: { gte: -delta } } : {}),
    },
    data: { stock: { increment: delta } },
  });
  if (applied.count === 0) return null;

  // Relu APRÈS l'écriture, sur une ligne que notre propre `UPDATE` verrouille
  // jusqu'à la fin de la transaction : cette valeur est la bonne, et
  // `stockBefore` s'en déduit exactement. Lire avant aurait rouvert la course
  // que le `WHERE` vient de fermer.
  const { stock: stockAfter } = await tx.productVariant.findUniqueOrThrow({
    where: { id: variantId },
    select: { stock: true },
  });
  const stockBefore = stockAfter - delta;

  await tx.stockMovement.create({
    data: {
      variantId,
      type: change.type,
      quantity: delta,
      stockBefore,
      stockAfter,
      reason: change.reason ?? null,
      reference: change.reference ?? null,
      actorId: change.actorId ?? null,
    },
  });

  return { stockBefore, stockAfter };
}
