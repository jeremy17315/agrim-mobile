import { Injectable, NotFoundException } from '@nestjs/common';
import {
  computeCartTotals,
  quoteDelivery,
  resolveDeliveryZone,
  weightUntilFreeDelivery,
} from '@agrim/contracts';

import { prixEffectif, promosActives } from '../common/pricing/effective-price';
import { PrismaService } from '../prisma/prisma.service';
import { SitePricingService } from '../site-pricing/site-pricing.service';
import { readDeliveryGrid } from './delivery-grid';
import type { CartQuoteDto } from './dto/cart-quote.dto';

/** Écho d'une ligne, telle que le devis l'a RECALCULÉE. Exporté : le
 * type apparaît dans la déclaration publique du service (declaration). */
export interface LigneDevis {
  variantId: string;
  sku: string;
  productName: string;
  variantLabel: string;
  unitPrice: number;
  quantity: number;
  weightGrams: number;
  stock: number;
  /** Référence côté site : clé de rattachement des remises. */
  sourceRef: string | null;
}

/**
 * Le devis panier — CE QUE LE CLIENT VERRA AVANT DE COMMANDER, calculé
 * intégralement côté serveur.
 *
 * Le client (site, mobile) n'est jamais une source fiable : il dit CE QU'IL
 * VEUT (des variantes et des quantités), l'API dit CE QUE C'EST — prix
 * effectifs (promotions dans leur fenêtre), remises décidées par le site,
 * zone et délai de livraison, total à payer. Aucun montant envoyé par le front
 * n'est lu, aucun n'est accepté.
 *
 * La livraison n'y figure comme MONTANT nulle part : le site n'encaisse
 * aucun frais en ligne, ce devis expose donc un libellé et un délai.
 *
 * Le devis ne réserve RIEN et n'écrit RIEN : il est idempotent par
 * construction et peut être rappelé à chaque frappe du panier. La commande,
 * elle, re-vérifiera tout sous verrou (checkout) — entre le devis et le
 * paiement, un prix peut avoir changé ; c'est le checkout qui fait foi.
 */
@Injectable()
export class CartQuoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: SitePricingService,
  ) {}

  /**
   * Zones de livraison telles que le site les publie.
   *
   * Le client CHOISIT sa zone au lieu de la taper : un texte libre se trompait
   * de zone (et donc de délai) plus souvent qu'il ne servait. La liste reste
   * celle du site — aucune zone n'est écrite en dur ici.
   */
  async zones() {
    const grid = await readDeliveryGrid(this.prisma.db);
    return {
      zones: Object.entries(grid.zones).map(([value, zone]) => ({
        value,
        label: zone.libelle,
        delai: zone.delai,
        frais: zone.frais,
      })),
      defaultZone: grid.zoneParDefaut,
      retrait: grid.retrait,
    };
  }

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
        sourceRef: true,
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
        sourceRef: variant.sourceRef,
      };
    });

    const grid = await readDeliveryGrid(this.prisma.db);
    const weightKg =
      lines.reduce((sum, l) => sum + l.weightGrams * l.quantity, 0) / 1000;
    const zone = resolveDeliveryZone(dto.city, grid);

    // ── Livraison : DESCRIPTEUR, pas montant ────────────────────────────
    // Le site n'ajoute aucun frais au total payable — vérifié sur sa page
    // `/commander` (« Livraison : À confirmer », total inchangé). Ce devis
    // affiche donc le même libellé, pour le même délai, sans jamais
    // additionner un tarif.
    const delivery = quoteDelivery({ mode: 'domicile', zone, grid });

    // ── Remises : LE SITE les calcule ───────────────────────────────────
    // Volume, grossiste et code promo vivent dans son back office. Site
    // injoignable ⇒ aucune remise appliquée, jamais une remise devinée.
    const remise = await this.pricing.remise({
      items: lines.map((l) => ({
        sourceRef: l.sourceRef,
        quantity: l.quantity,
      })),
      zone,
      mode: 'domicile',
      codePromo: dto.codePromo,
      phone: dto.phone,
    });

    const totals = computeCartTotals(
      lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })),
      { remise: remise.status === 'ok' ? remise.remise : 0 },
    );

    return {
      items: lines,
      weightKg,
      zone,
      delivery,
      // Barre de progression du panier : « plus que X kg pour la livraison
      // offerte » (0 = atteint ou offre désactivée sur le site).
      weightUntilFreeDeliveryKg: weightUntilFreeDelivery(weightKg, grid),
      subtotal: totals.subtotal,
      remise: totals.remise,
      remiseStatus: remise.status === 'ok' ? ('ok' as const) : ('unavailable' as const),
      promoCode: remise.status === 'ok' ? remise.code : null,
      promoMessage: remise.status === 'ok' ? remise.message : null,
      // Toujours 0 : aucun frais n'est encaissé en ligne (voir contracts).
      deliveryFee: totals.deliveryFee,
      total: totals.total,
      currency: 'XOF',
    };
  }
}
