import { Injectable, NotFoundException } from '@nestjs/common';
import {
  computeCartTotals,
  computeDeliveryFee,
  resolveDeliveryZone,
  weightUntilFreeDelivery,
} from '@agrim/contracts';

import { prixEffectif, promosActives } from '../common/pricing/effective-price';
import { PrismaService } from '../prisma/prisma.service';
import { readDeliveryGrid } from './delivery-grid';
import type { CartQuoteDto } from './dto/cart-quote.dto';

/** Écho d'une ligne, telle que le devis l'a RECALCULÉE. */
interface LigneDevis {
  variantId: string;
  sku: string;
  productName: string;
  variantLabel: string;
  unitPrice: number;
  quantity: number;
  weightGrams: number;
  stock: number;
}

/**
 * Le devis panier — CE QUE LE CLIENT VERRA AVANT DE COMMANDER, calculé
 * intégralement côté serveur.
 *
 * Le client (site, mobile) n'est jamais une source fiable : il dit CE QU'IL
 * VEUT (des variantes et des quantités), l'API dit CE QUE C'EST — prix
 * effectifs (promotions dans leur fenêtre), poids, zone, frais, total.
 * Aucun montant envoyé par le front n'est lu, aucun n'est accepté.
 *
 * Le devis ne réserve RIEN et n'écrit RIEN : il est idempotent par
 * construction et peut être rappelé à chaque frappe du panier. La commande,
 * elle, re-vérifiera tout sous verrou (checkout) — entre le devis et le
 * paiement, un prix peut avoir changé ; c'est le checkout qui fait foi.
 */
@Injectable()
export class CartQuoteService {
  constructor(private readonly prisma: PrismaService) {}

  async quote(dto: CartQuoteDto) {
    // Quantités fusionnées par variante : « 2 + 3 » est « 5 », pas deux
    // lignes — même règle que le checkout, même montant affiché.
    const merged = new Map<string, number>();
    for (const item of dto.items) {
      merged.set(item.variantId, (merged.get(item.variantId) ?? 0) + item.quantity);
    }

    const variants = await this.prisma.db.productVariant.findMany({
      where: {
        id: { in: [...merged.keys()] },
        isAvailable: true,
        product: { isActive: true },
      },
      select: {
        id: true,
        sku: true,
        label: true,
        price: true,
        weightGrams: true,
        stock: true,
        product: { select: { name: true } },
        promotions: {
          where: { isActive: true },
          select: { isActive: true, priceXof: true, startsAt: true, endsAt: true },
        },
      },
    });

    if (variants.length !== merged.size) {
      throw new NotFoundException({
        code: 'VARIANT_NOT_FOUND',
        message: 'Un article de votre panier n’est plus disponible.',
      });
    }

    const now = new Date();
    const lines: LigneDevis[] = variants.map((variant) => {
      const promo = promosActives(variant.promotions, now)[0] ?? null;
      return {
        variantId: variant.id,
        sku: variant.sku,
        productName: variant.product.name,
        variantLabel: variant.label,
        unitPrice: prixEffectif(variant.price, promo),
        quantity: merged.get(variant.id)!,
        weightGrams: variant.weightGrams,
        stock: variant.stock,
      };
    });

    const grid = await readDeliveryGrid(this.prisma.db);
    const weightKg =
      lines.reduce((sum, l) => sum + l.weightGrams * l.quantity, 0) / 1000;
    const zone = resolveDeliveryZone(dto.city, grid);
    const deliveryFee = computeDeliveryFee(
      { zone, mode: 'domicile', weightKg },
      grid,
    );
    const totals = computeCartTotals(
      lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })),
      { deliveryFee },
    );

    return {
      items: lines,
      weightKg,
      zone,
      // Barre de progression du panier : « plus que X kg pour la livraison
      // offerte » (0 = atteint ou offre désactivée).
      weightUntilFreeDeliveryKg: weightUntilFreeDelivery(weightKg, grid),
      subtotal: totals.subtotal,
      deliveryFee: totals.deliveryFee,
      total: totals.total,
      currency: 'XOF',
    };
  }
}
