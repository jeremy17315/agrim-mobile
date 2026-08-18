import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { computeCartTotals, PROVISIONAL_DELIVERY } from '@agrim/contracts';
import type { OrderStatus } from '@agrim/contracts';

import { PrismaService } from '../prisma/prisma.service';
import type { CreateOrderDto } from './dto/create-order.dto';
import { formatOrderReference } from './order-reference';

/** Projection commune : l'historique doit être lisible sans jointure côté client. */
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
  address: {
    select: {
      id: true,
      label: true,
      city: true,
      commune: true,
      district: true,
      landmark: true,
      instructions: true,
      contactPhone: true,
      latitude: true,
      longitude: true,
    },
  },
  payment: { select: { method: true, status: true } },
} as const;

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crée une commande.
   *
   * Trois garanties non négociables :
   *  1. Les PRIX viennent de la base, jamais du client.
   *  2. Tout se passe dans une transaction : stock, compteur, commande et
   *     paiement sont écrits ensemble ou pas du tout.
   *  3. `idempotencyKey` rend l'opération rejouable sans doublon.
   */
  async create(userId: string, dto: CreateOrderDto) {
    // Rejouer une requête perdue ne doit jamais créer une seconde commande.
    const replayed = await this.prisma.db.order.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      select: { id: true, userId: true },
    });
    if (replayed) {
      if (replayed.userId !== userId) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          message: 'Cette commande ne peut pas être rejouée.',
        });
      }
      // Relecture avec la projection publique : le userId ne fuit pas dans la
      // réponse.
      return this.prisma.db.order.findUniqueOrThrow({
        where: { id: replayed.id },
        select: orderSelect,
      });
    }

    if (dto.paymentMethod === 'MOBILE_MONEY' && !dto.mobileMoneyProvider) {
      throw new BadRequestException({
        code: 'PAYMENT_PROVIDER_REQUIRED',
        message: 'Choisissez un opérateur Mobile Money.',
      });
    }

    // Une même variante ne doit pas apparaître deux fois : sinon le contrôle
    // de stock se ferait ligne par ligne et laisserait passer un dépassement.
    const merged = new Map<string, number>();
    for (const item of dto.items) {
      merged.set(
        item.variantId,
        (merged.get(item.variantId) ?? 0) + item.quantity,
      );
    }

    const address = await this.prisma.db.address.findFirst({
      where: { id: dto.addressId, userId },
      select: { id: true },
    });
    if (!address) {
      throw new NotFoundException({
        code: 'ADDRESS_NOT_FOUND',
        message: 'Cette adresse de livraison est introuvable.',
      });
    }

    const variantIds = [...merged.keys()];
    const variants = await this.prisma.db.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true,
        label: true,
        price: true,
        stock: true,
        isAvailable: true,
        product: { select: { name: true, isActive: true } },
      },
    });

    if (variants.length !== variantIds.length) {
      throw new BadRequestException({
        code: 'VARIANT_NOT_FOUND',
        message: 'Un article de votre panier n’existe plus.',
      });
    }

    // Le panier est local et peut dater : on revérifie disponibilité et stock
    // au moment de commander, pas au moment de l'ajout.
    const unavailable = variants.filter(
      (v) => !v.isAvailable || !v.product.isActive,
    );
    if (unavailable.length > 0) {
      throw new BadRequestException({
        code: 'VARIANT_UNAVAILABLE',
        message: 'Un article de votre panier n’est plus disponible.',
        details: unavailable.map((v) => ({
          variantId: v.id,
          productName: v.product.name,
        })),
      });
    }

    const insufficient = variants
      .filter((v) => v.stock < (merged.get(v.id) ?? 0))
      .map((v) => ({
        variantId: v.id,
        productName: v.product.name,
        variantLabel: v.label,
        requested: merged.get(v.id) ?? 0,
        available: v.stock,
      }));
    if (insufficient.length > 0) {
      throw new ConflictException({
        code: 'INSUFFICIENT_STOCK',
        message: 'Le stock disponible ne couvre plus votre panier.',
        details: insufficient,
      });
    }

    // Prix issus de la base, et totaux calculés par la fonction PARTAGÉE avec
    // le mobile : les deux côtés ne peuvent pas diverger.
    const lines = variants.map((v) => ({
      variantId: v.id,
      productName: v.product.name,
      variantLabel: v.label,
      unitPrice: v.price,
      quantity: merged.get(v.id) ?? 0,
    }));

    const totals = computeCartTotals(
      lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })),
      PROVISIONAL_DELIVERY,
    );

    const year = new Date().getFullYear();

    return this.prisma.db.$transaction(async (tx) => {
      // Compteur annuel atomique : deux commandes simultanées obtiennent des
      // séquences distinctes, donc jamais la même référence.
      const counter = await tx.orderCounter.upsert({
        where: { year },
        create: { year, current: 1 },
        update: { current: { increment: 1 } },
        select: { current: true },
      });

      // Décrément conditionnel : `stock: { gte: q }` fait échouer la mise à
      // jour si un autre client a vidé le stock entre-temps.
      for (const line of lines) {
        const updated = await tx.productVariant.updateMany({
          where: { id: line.variantId, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity } },
        });
        if (updated.count === 0) {
          throw new ConflictException({
            code: 'INSUFFICIENT_STOCK',
            message: 'Le stock disponible ne couvre plus votre panier.',
            details: [
              { variantId: line.variantId, productName: line.productName },
            ],
          });
        }
      }

      const order = await tx.order.create({
        data: {
          reference: formatOrderReference(year, counter.current),
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
          events: {
            create: { status: 'PENDING', actorId: userId },
          },
          payment: {
            create: {
              method: dto.paymentMethod,
              provider: dto.mobileMoneyProvider ?? null,
              amount: totals.total,
              // Le paiement à la livraison est en attente jusqu'à la remise ;
              // aucun statut ne peut être décidé par le client.
              status: 'PENDING',
            },
          },
        },
        select: orderSelect,
      });

      return order;
    });
  }

  /** Historique du client : liste allégée, sans les lignes. */
  async list(userId: string, page: number, limit: number) {
    const where = { userId };

    const [data, total] = await Promise.all([
      this.prisma.db.order.findMany({
        where,
        select: {
          id: true,
          reference: true,
          status: true,
          total: true,
          createdAt: true,
          items: { select: { quantity: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.db.order.count({ where }),
    ]);

    return {
      data: data.map(({ items, ...order }) => ({
        ...order,
        itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
      })),
      pagination: { page, limit, total },
    };
  }

  async findOne(userId: string, reference: string) {
    const order = await this.prisma.db.order.findFirst({
      where: { reference, userId },
      select: orderSelect,
    });
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Cette commande est introuvable.',
      });
    }
    return order;
  }

  /**
   * Annulation par le client. Autorisée jusqu'à OUT_FOR_DELIVERY inclus.
   * Le stock réservé est restitué : sinon un panier annulé assécherait le
   * catalogue.
   */
  async cancel(userId: string, reference: string) {
    const order = await this.prisma.db.order.findFirst({
      where: { reference, userId },
      select: {
        id: true,
        status: true,
        items: { select: { variantId: true, quantity: true } },
      },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Cette commande est introuvable.',
      });
    }

    const cancellable: OrderStatus[] = [
      'PENDING',
      'CONFIRMED',
      'PREPARING',
      'READY',
      'OUT_FOR_DELIVERY',
    ];
    if (!cancellable.includes(order.status)) {
      throw new ConflictException({
        code: 'ORDER_NOT_CANCELLABLE',
        message: 'Cette commande ne peut plus être annulée.',
      });
    }

    return this.prisma.db.$transaction(async (tx) => {
      for (const item of order.items) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { increment: item.quantity } },
        });
      }

      await tx.orderEvent.create({
        data: { orderId: order.id, status: 'CANCELLED', actorId: userId },
      });

      return tx.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
        select: orderSelect,
      });
    });
  }
}
