import { Injectable, NotFoundException } from '@nestjs/common';
import {
  computeCartTotals,
  quoteDelivery,
  resolveDeliveryZone,
  weightUntilFreeDelivery,
} from '@agrim/contracts';

import { prixEffectif, promosActives } from '../common/pricing/effective-price';
import { PrismaService } from '../prisma/prisma.service';
import { PromoCodesService } from '../promo-codes/promo-codes.service';
import { ReferralCreditService } from '../referrals/referral-credit.service';
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
    // La remise passe par la MÊME règle que le checkout : la table des codes
    // promo d'AGRIM d'abord, le calculateur du site pour ses remises
    // automatiques. Un code refusé au devis ne peut donc pas passer à la
    // commande, et un code accepté garde la même valeur des deux côtés.
    private readonly promos: PromoCodesService,
    private readonly credit: ReferralCreditService,
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

  /**
   * @param userId compte connecté (facultatif) : lui seul peut faire entrer son
   *   crédit de parrainage dans le devis. Le `phone` du corps de requête ne
   *   désigne JAMAIS un crédit — il n'est utilisé que pour le quota d'un code
   *   promo, et un numéro déclaré ne prouve rien.
   */
  async quote(dto: CartQuoteDto, userId?: string | null) {
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

    // ── Remises : règle unique, partagée avec le checkout ───────────────
    // Les codes créés par AGRIM dans l'application sont appliqués LOCALEMENT
    // (donc même si le site est injoignable), et le site ne fournit que ses
    // remises automatiques. Le montant affiché ici est celui qui sera facturé.
    const subtotalAvantRemise = lines.reduce(
      (sum, l) => sum + l.unitPrice * l.quantity,
      0,
    );
    const remise = await this.promos.resolveRemise({
      lines: lines.map((l) => ({
        sourceRef: l.sourceRef,
        sku: l.sku,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
      })),
      subtotal: subtotalAvantRemise,
      zone,
      mode: 'domicile',
      codePromo: dto.codePromo,
      phone: dto.phone,
    });

    // ── Crédit de parrainage : lu pour le compte connecté, et lui seul ────
    //
    // Le devis reste PUBLIC : un visiteur chiffre son panier sans compte, et il
    // n'a alors aucun crédit. Un client connecté voit le sien appliqué ici —
    // exactement le montant que la commande consommera, plafonné de la même
    // façon (le calcul est partagé, `computeCartTotals`).
    const soldeCredit = userId ? await this.credit.balance(userId) : 0;

    const totals = computeCartTotals(
      lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })),
      {
        remise: remise.status === 'refused' ? 0 : remise.remise,
        credit: soldeCredit,
      },
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
      // Montant de crédit parrainage appliqué à CE panier (= 0 sans compte).
      credit: totals.credit,
      // Solde du compte avant application : c'est lui qui permet à l'écran
      // d'annoncer « il vous restera X » plutôt qu'un montant sans suite.
      // `0` pour un visiteur — il n'a pas de solde, il n'est pas « à zéro ».
      creditBalanceXof: soldeCredit,
      // `refused` : le client doit retirer son code (il paie plein tarif).
      // `unavailable` : le calculateur du site n'a pas répondu — le dire est
      // plus honnête que d'afficher un total qui bougera peut-être.
      remiseStatus:
        remise.status === 'refused'
          ? ('refused' as const)
          : remise.siteAvailable || remise.local
            ? ('ok' as const)
            : ('unavailable' as const),
      promoCode:
        remise.status === 'ok' ? remise.code : (dto.codePromo?.trim() ?? null),
      // Message du refus (motif précis) ou confirmation du rabais appliqué.
      promoMessage: remise.message,
      // Toujours 0 : aucun frais n'est encaissé en ligne (voir contracts).
      deliveryFee: totals.deliveryFee,
      total: totals.total,
      currency: 'XOF',
    };
  }
}
