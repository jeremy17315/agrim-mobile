import { Prisma, StockMovementType } from '../../../generated/prisma/client';

/**
 * Réservation de stock pour une commande — LA primitive SSOT.
 *
 * ── Ce que cette fonction garantit ─────────────────────────────────────
 * Un article dont `stock = 1` ne peut pas être vendu deux fois, même face à
 * cent commandes simultanées. Trois mécanismes se tiennent, dans UNE
 * transaction :
 *
 * 1. **`SELECT … FOR UPDATE`**, dans un ordre DÉTERMINISTE (tri par id).
 *    Les lignes de variantes sont verrouillées jusqu'au commit : un second
 *    checkout qui touche la même variante attend, puis voit le stock déjà
 *    décrémenté. Le tri par id élimine l'interblocage : deux commandes qui
 *    verrouillent A puis B, et B puis A, sont le scénario classique de
 *    deadlock — verrouiller toujours dans le même ordre le rend
 *    structurellement impossible.
 *
 * 2. **`UPDATE … WHERE stock >= quantité`** (décrément conditionnel). La
 *    condition est DANS le WHERE : c'est PostgreSQL qui arbitre, jamais une
 *    lecture antérieure. Le `count === 0` après coup est un filet qui ne
 *    devrait jamais parler — si l'un de nous oublie un verrou un jour, la
 *    condition ne laissera quand même pas vendre au-delà du rayon.
 *
 * 3. **CHECK (`stock >= 0`)** en base. Même un bug combinant 1 et 2 ne peut
 *    pas rendre le compteur négatif : PostgreSQL refuserait la ligne.
 *
 * Et chaque variation écrit sa ligne `StockMovement` dans la même
 * transaction — le compteur n'a plus jamais de variation inexpliquée.
 *
 * ── Différence avec le stock existant ──────────────────────────────────
 * `stock-movement.ts` documente une époque où le compteur vivait chez le
 * site (le journal local décrivait une COPIE, sans la modifier). La refonte
 * ramène le stock DANS cette base (docs/refonte/00, § 4.1) : cette fonction
 * est la voie nouvelle ; `recordStockMovement` reste pour les chemins de
 * transition et sera retiré à l'itération « inventory ».
 *
 * ── Ce que cette fonction ne fait PAS ──────────────────────────────────
 * Elle ne touche ni au prix, ni au panier, ni au paiement. Elle reçoit des
 * lignes déjà validées et des quantités entières positives. Elle s'exécute
 * DANS une transaction ouverte (voir `checkout.service.ts` pour l'orchestre
 * complet) — jamais seule.
 */

/** Une ligne de commande, telle que la réservation la reçoit. */
export interface StockReservationLine {
  variantId: string;
  /** Quantité entière strictement positive — validée par l'appelant. */
  quantity: number;
}

/** Échec métier typé : l'appelant le traduit en réponse HTTP. */
export class StockReservationError extends Error {
  constructor(
    /** Code stable du registre d'erreurs API (docs/refonte/04 § 3). */
    readonly code: 'VARIANT_NOT_FOUND' | 'VARIANT_UNAVAILABLE' | 'INSUFFICIENT_STOCK',
    message: string,
    /** Détail par ligne concernée, pour la réponse `details`. */
    readonly details: Array<{
      variantId: string;
      productName: string;
      variantLabel?: string;
      requested?: number;
      available?: number;
    }>,
  ) {
    super(message);
    this.name = 'StockReservationError';
  }
}

/** Ce que le verrouillage lit et garde sur chaque variante concernée. */
interface LockedVariant {
  id: string;
  stock: number;
  isAvailable: boolean;
  price: number;
  weightGrams: number;
  label: string;
  productName: string;
}

/**
 * Verrouille les variantes concernées et retourne leur état au moment du
 * verrou — prix, stock, disponibilité — pour que le calcul des montants se
 * fasse sur EXACTEMENT ce qui vient d'être verrouillé, pas sur une lecture
 * d'avant-guerre.
 *
 * `id::text IN (...)` : le transtypage évite l'ambiguïté de type des
 * paramètres Prisma face à une colonne UUID. Le coût est négligeable
 * (l'index primaire reste utilisé, la liste compte rarement plus de 50 ids).
 */
export async function lockVariantsForOrder(
  tx: Prisma.TransactionClient,
  variantIds: readonly string[],
): Promise<Map<string, LockedVariant>> {
  const ordered = [...new Set(variantIds)].sort();
  if (ordered.length === 0) return new Map();

  // Prisma.join étend le tableau en paramètres ($1, $2…) : passer le tableau
  // brut le lierait comme UN paramètre et casserait le IN.
  const rows = await tx.$queryRaw<LockedVariant[]>`
    SELECT v."id",
           v."stock",
           v."isAvailable",
           v."price",
           v."weightGrams",
           v."label",
           p."name" AS "productName"
    FROM "ProductVariant" v
    JOIN "Product" p ON p."id" = v."productId"
    WHERE v."id"::text IN (${Prisma.join(ordered)})
    ORDER BY v."id"
    FOR UPDATE OF v
  `;

  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Décrémente le stock des lignes commandées et journalise chaque mouvement.
 *
 * À appeler APRÈS `lockVariantsForOrder` DANS LA MÊME transaction : les
 * lectures de `stockBefore` sont celles des lignes verrouillées, donc
 * exactes par construction. Les lignes sont traitées dans l'ordre des ids
 * (même anti-interblocage que le verrouillage).
 */
export async function reserveStockForOrder(
  tx: Prisma.TransactionClient,
  locked: Map<string, LockedVariant>,
  lines: readonly StockReservationLine[],
  reference: string,
): Promise<void> {
  const ordered = [...lines].sort((a, b) =>
    a.variantId.localeCompare(b.variantId),
  );

  for (const line of ordered) {
    const variant = locked.get(line.variantId);

    if (!variant) {
      throw new StockReservationError(
        'VARIANT_NOT_FOUND',
        'Un article de votre panier n’existe plus.',
        [{ variantId: line.variantId, productName: '(inconnu)' }],
      );
    }
    if (!variant.isAvailable) {
      throw new StockReservationError(
        'VARIANT_UNAVAILABLE',
        'Un article de votre panier n’est plus disponible.',
        [{ variantId: variant.id, productName: variant.productName }],
      );
    }
    if (variant.stock < line.quantity) {
      throw new StockReservationError(
        'INSUFFICIENT_STOCK',
        'Le stock disponible ne couvre plus votre panier.',
        [
          {
            variantId: variant.id,
            productName: variant.productName,
            variantLabel: variant.label,
            requested: line.quantity,
            available: variant.stock,
          },
        ],
      );
    }

    // Le décrément conditionnel — la condition est dans le WHERE.
    const updated = await tx.productVariant.updateMany({
      where: { id: line.variantId, stock: { gte: line.quantity } },
      data: { stock: { decrement: line.quantity } },
    });
    if (updated.count === 0) {
      // Filet. Avec le FOR UPDATE ci-dessus, ce chemin est inatteignable —
      // et c'est précisément le genre de chose qu'on vérifie plutôt qu'on ne
      // l'affirme. Si un jour il parle, un verrou a sauté : le CHECK
      // `stock >= 0` est le rempart derrière lui.
      throw new StockReservationError(
        'INSUFFICIENT_STOCK',
        'Le stock disponible ne couvre plus votre panier.',
        [
          {
            variantId: variant.id,
            productName: variant.productName,
            variantLabel: variant.label,
            requested: line.quantity,
            available: variant.stock,
          },
        ],
      );
    }

    // Le journal, dans la même transaction : une variation sans explication
    // n'existe pas. `stockBefore`/`stockAfter` viennent des lignes
    // verrouillées — pas d'une relecture qui pourrait avoir bougé.
    await tx.stockMovement.create({
      data: {
        variantId: variant.id,
        type: StockMovementType.COMMANDE,
        quantity: -line.quantity,
        stockBefore: variant.stock,
        stockAfter: variant.stock - line.quantity,
        reference,
        actorId: null,
      },
    });
  }
}

/**
 * Restitue le stock d'une commande annulée — le chemin inverse, même
 * discipline : ordre déterministe, condition dans le WHERE, journal
 * immédiat. Appelé par le point de passage unique d'annulation
 * (`order-stock.ts`, à converger vers cette primitive à l'itération
 * « inventory »).
 */
export async function releaseStockForOrder(
  tx: Prisma.TransactionClient,
  lines: readonly StockReservationLine[],
  reference: string,
): Promise<void> {
  const ordered = [...lines].sort((a, b) =>
    a.variantId.localeCompare(b.variantId),
  );

  for (const line of ordered) {
    const updated = await tx.productVariant.updateMany({
      where: { id: line.variantId },
      data: { stock: { increment: line.quantity } },
    });
    if (updated.count === 0) continue; // variante supprimée entre-temps : le journal reste la trace.

    const variant = await tx.productVariant.findUniqueOrThrow({
      where: { id: line.variantId },
      select: { stock: true },
    });
    await tx.stockMovement.create({
      data: {
        variantId: line.variantId,
        type: StockMovementType.ANNULATION,
        quantity: line.quantity,
        // `stockAfter` lu APRÈS l'incrément, sous nos propres verrous de
        // transaction : la ligne vient d'être écrite par nous.
        stockBefore: variant.stock - line.quantity,
        stockAfter: variant.stock,
        reference,
        actorId: null,
      },
    });
  }
}
