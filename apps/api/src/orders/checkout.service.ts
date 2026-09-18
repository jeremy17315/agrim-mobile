import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  computeCartTotals,
  computeDeliveryFee,
  resolveDeliveryZone,
  type DeliveryGrid,
} from '@agrim/contracts';
import { Prisma } from '../../generated/prisma/client';

import {
  lockVariantsForOrder,
  reserveStockForOrder,
  StockReservationError,
} from '../common/stock/reserve-stock';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateOrderDto } from './dto/create-order.dto';
import { formatOrderReference } from './order-reference';

/** Projection publique d'une commande (identique au service actuel). */
const orderSelect = {
  id: true,
  reference: true,
  status: true,
  subtotal: true,
  deliveryFee: true,
  total: true,
  note: true,
  createdAt: true,
  items: {
    select: {
      id: true,
      productName: true,
      variantLabel: true,
      unitPrice: true,
      quantity: true,
      lineTotal: true,
    },
  },
  payment: { select: { method: true, status: true } },
} as const;

/** Clé du paramètre société portant la grille officielle de livraison. */
const DELIVERY_GRID_KEY = 'deliveryGrid';

/** Durée de conservation d'une clé d'idempotence consommée. */
const IDEMPOTENCY_TTL_DAYS = 7;

/**
 * Création de commande — IMPLÉMENTATION DE RÉFÉRENCE SSOT (refonte).
 *
 * Remplace progressivement `OrdersService.create` : le contrôleur actuel
 * reste sur l'ancienne voie (réservation du stock CHEZ LE SITE) tant que le
 * site n'est pas décommissionné ; à l'itération « orders » de la refonte,
 * cette classe prend la route et `catalog-sync` disparaît.
 *
 * ── Les garanties, toutes serveur, dans UNE transaction ────────────────
 *  1. Le client ne fournit AUCUN montant : prix effectifs (promotion
 *     active lue en base), frais de livraison (grille `CompanySetting`),
 *     total — tout est recalculé ici.
 *  2. Le stock est verrouillé (`FOR UPDATE`) puis décrémenté
 *     conditionnellement — le dernier article ne part qu'une fois
 *     (docs/refonte/10 § 2).
 *  3. `idempotencyKey` rend l'appel rejouable : même clé + même corps ⇒
 *     la même commande ; même clé + corps différent ⇒ 409. Deux appels
 *     simultanés avec la même clé : l'unicité en base tranche, le perdant
 *     rejoue la commande du gagnant.
 *  4. L'événement métier part dans l'outbox, dans la même transaction —
 *     la diffusion des notifications ne peut ni bloquer, ni manquer.
 */
@Injectable()
export class CheckoutService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateOrderDto) {
    const requestHash = this.fingerprint(userId, dto);

    return this.prisma.db.$transaction(async (tx) => {
      // ── Idempotence : le rejeu AVANT tout effet ──────────────────────
      const existing = await tx.idempotencyRecord.findUnique({
        where: { scope_key: { scope: 'orders', key: dto.idempotencyKey } },
        select: { requestHash: true },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_KEY_CONFLICT',
            message: 'Cette clé d’idempotence a déjà servi pour autre chose.',
          });
        }
        return this.replay(tx, dto.idempotencyKey, userId);
      }

      if (dto.paymentMethod === 'MOBILE_MONEY' && !dto.mobileMoneyProvider) {
        throw new BadRequestException({
          code: 'PAYMENT_PROVIDER_REQUIRED',
          message: 'Choisissez un opérateur Mobile Money.',
        });
      }

      // Une même variante deux fois = fusion, sinon le contrôle de stock se
      // ferait ligne par ligne et laisserait passer un dépassement.
      const merged = new Map<string, number>();
      for (const item of dto.items) {
        merged.set(item.variantId, (merged.get(item.variantId) ?? 0) + item.quantity);
      }

      // ── Livraison : l'adresse appartient au client, la grille à la maison ──
      const address = await tx.address.findFirst({
        where: { id: dto.addressId, userId },
        select: { id: true, city: true },
      });
      if (!address) {
        throw new NotFoundException({
          code: 'ADDRESS_NOT_FOUND',
          message: 'Cette adresse de livraison est introuvable.',
        });
      }

      // ── Verrou + réservation du stock (primitive SSOT) ────────────────
      const locked = await lockVariantsForOrder(tx, [...merged.keys()]);
      if (locked.size !== merged.size) {
        throw new BadRequestException({
          code: 'VARIANT_NOT_FOUND',
          message: 'Un article de votre panier n’existe plus.',
        });
      }

      // L'état lu SOUS VERROU fait foi pour les prix aussi : pas de
      // relecture entre-temps qui pourrait voir un autre monde que le verrou.
      const promotions = await tx.promotion.findMany({
        where: { variantId: { in: [...merged.keys()] }, isActive: true },
        select: { variantId: true, priceXof: true, startsAt: true, endsAt: true },
      });
      const now = new Date();
      const effective = new Map<string, number>();
      for (const promo of promotions) {
        const starts = promo.startsAt <= now;
        const notEnded = !promo.endsAt || promo.endsAt >= now;
        if (starts && notEnded) effective.set(promo.variantId, promo.priceXof);
      }

      const lines = [...merged.entries()].map(([variantId, quantity]) => {
        const variant = locked.get(variantId)!;
        const unitPrice = effective.get(variantId) ?? variant.price;
        return {
          variantId,
          productName: variant.productName,
          variantLabel: variant.label,
          unitPrice,
          quantity,
          weightGrams: variant.weightGrams,
        };
      });

      const grid = await this.readDeliveryGrid(tx);
      const weightKg =
        lines.reduce((sum, l) => sum + l.weightGrams * l.quantity, 0) / 1000;
      const deliveryFee = computeDeliveryFee(
        {
          zone: resolveDeliveryZone(address.city, grid),
          mode: 'domicile',
          weightKg,
        },
        grid,
      );
      const totals = computeCartTotals(
        lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })),
        { deliveryFee },
      );

      // Compteur annuel atomique AVANT la réservation : la référence existe
      // dès l'écriture du journal de stock.
      const year = now.getFullYear();
      const counter = await tx.orderCounter.upsert({
        where: { year },
        create: { year, current: 1 },
        update: { current: { increment: 1 } },
        select: { current: true },
      });
      const reference = formatOrderReference(year, counter.current);

      // Décrément conditionnel + journal de stock, sous verrous, dans CETTE
      // transaction. Les erreurs typées de la primitive sont traduites en
      // réponses HTTP ici — la couche stock ne connaît pas HTTP.
      try {
        await reserveStockForOrder(tx, locked, lines, reference);
      } catch (error) {
        if (error instanceof StockReservationError) {
          if (error.code === 'INSUFFICIENT_STOCK') {
            throw new ConflictException({
              code: error.code,
              message: error.message,
              details: error.details,
            });
          }
          throw new BadRequestException({
            code: error.code,
            message: error.message,
            details: error.details,
          });
        }
        throw error;
      }

      // ── Écritures métier : tout ou rien ───────────────────────────────
      const order = await tx.order.create({
        data: {
          reference,
          userId,
          addressId: dto.addressId,
          status: 'PENDING',
          subtotal: totals.subtotal,
          deliveryFee: totals.deliveryFee,
          total: totals.total,
          note: dto.note ?? null,
          idempotencyKey: dto.idempotencyKey,
          items: {
            create: lines.map((l) => ({
              variantId: l.variantId,
              productName: l.productName,
              variantLabel: l.variantLabel,
              unitPrice: l.unitPrice,
              quantity: l.quantity,
              lineTotal: l.unitPrice * l.quantity,
            })),
          },
          events: { create: { status: 'PENDING', actorId: userId } },
          payment: {
            create: {
              method: dto.paymentMethod,
              provider: dto.mobileMoneyProvider ?? null,
              amount: totals.total,
              status: 'PENDING',
            },
          },
        },
        select: orderSelect,
      });

      // L'événement naît AVEC la commande, dans la même transaction : aucun
      // ordre créé sans son événement, aucune notification perdue en silence.
      // (la diffusion elle-même reste post-commit — outbox, jamais en ligne)
      await tx.outboxEvent.create({
        data: {
          type: 'ORDER_CREATED',
          payload: {
            orderId: order.id,
            reference: order.reference,
            userId,
            total: order.total,
          } as Prisma.InputJsonValue,
        },
      });

      await tx.idempotencyRecord.create({
        data: {
          scope: 'orders',
          key: dto.idempotencyKey,
          requestHash,
          responseStatus: 201,
          responseBody: { reference: order.reference } as Prisma.InputJsonValue,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_DAYS * 86_400_000),
        },
      });

      return order;
    });
  }

  /** Le rejeu renvoie EXACTEMENT la commande d'origine, au centime. */
  private async replay(
    tx: Prisma.TransactionClient,
    idempotencyKey: string,
    userId: string,
  ) {
    const order = await tx.order.findUnique({
      where: { idempotencyKey },
      select: { id: true, userId: true },
    });
    if (!order || order.userId !== userId) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: 'Cette commande ne peut pas être rejouée.',
      });
    }
    return tx.order.findUniqueOrThrow({ where: { id: order.id }, select: orderSelect });
  }

  /** La grille de livraison vit dans `CompanySetting` — modifiable en
   * back-office sans redéploiement, et unique pour les trois clients.
   * On ne devine JAMAIS un tarif : grille absente ou illisible ⇒ refus de
   * commander (503), jamais un forfait inventé. */
  private async readDeliveryGrid(
    tx: Prisma.TransactionClient,
  ): Promise<DeliveryGrid> {
    const setting = await tx.companySetting.findUnique({
      where: { key: DELIVERY_GRID_KEY },
      select: { value: true },
    });
    if (!setting) {
      throw new ServiceUnavailableException({
        code: 'DELIVERY_GRID_UNAVAILABLE',
        message:
          'Les frais de livraison sont momentanément indisponibles. Réessayez dans un instant.',
      });
    }
    try {
      const grid = JSON.parse(setting.value) as DeliveryGrid;
      // Validation minimale de forme : une grille corrompue ne doit pas
      // produire un montant plausible mais faux.
      if (!grid.zones || typeof grid.zoneParDefaut !== 'string') {
        throw new Error('forme inattendue');
      }
      return grid;
    } catch {
      throw new ServiceUnavailableException({
        code: 'DELIVERY_GRID_UNAVAILABLE',
        message:
          'Les frais de livraison sont momentanément indisponibles. Réessayez dans un instant.',
      });
    }
  }

  /** Empreinte stable du couple (utilisateur, intention) : l'ordre des
   * lignes ne doit pas transformer un rejeu en conflit. */
  private fingerprint(userId: string, dto: CreateOrderDto): string {
    const canonical = {
      userId,
      addressId: dto.addressId,
      paymentMethod: dto.paymentMethod,
      mobileMoneyProvider: dto.mobileMoneyProvider ?? null,
      note: dto.note ?? null,
      items: dto.items
        .map((i) => ({ v: i.variantId, q: i.quantity }))
        .sort((a, b) => a.v.localeCompare(b.v)),
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }
}
