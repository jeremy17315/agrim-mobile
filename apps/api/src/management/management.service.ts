import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  canTransition,
  isCancellableByManager,
  MANAGER_QUEUE_STATUSES,
  managerActionFor,
  type OrderStatus,
} from '@agrim/contracts';

import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AdjustStockDto } from './dto/adjust-stock.dto';
import type { UpdateOrderStatusDto } from './dto/update-order-status.dto';

/**
 * Espace gestionnaire.
 *
 * Périmètre volontairement borné : le gestionnaire pilote la commande jusqu'à
 * la remise au livreur. `OUT_FOR_DELIVERY` et `DELIVERED` restent produits par
 * la course elle-même — les poser à la main ferait mentir le suivi client.
 */

/** Fenêtre au-delà de laquelle une commande non traitée est signalée. */
const STALE_PENDING_MINUTES = 60;

const managedOrderSelect = {
  id: true,
  reference: true,
  status: true,
  total: true,
  createdAt: true,
  user: { select: { firstName: true, lastName: true, phone: true } },
  address: { select: { city: true } },
  items: { select: { quantity: true } },
  delivery: { select: { courierId: true } },
} as const;

type ManagedOrderRow = {
  user: { firstName: string; lastName: string; phone: string };
  address: { city: string | null } | null;
  items: { quantity: number }[];
  delivery: { courierId: string | null } | null;
} & Record<string, unknown>;

/** Aplatit les relations pour coller au contrat partagé. */
function toManagedOrder(row: ManagedOrderRow) {
  const { user, address, items, delivery, ...rest } = row;
  return {
    ...rest,
    customerName: `${user.firstName} ${user.lastName}`,
    customerPhone: user.phone,
    city: address?.city ?? null,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    hasCourier: Boolean(delivery?.courierId),
  };
}

@Injectable()
export class ManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ------------------------------ Tableau -------------------------------- */

  async dashboard() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const staleBefore = new Date(Date.now() - STALE_PENDING_MINUTES * 60_000);

    const [
      revenue,
      ordersToday,
      toPrepare,
      activeDeliveries,
      variants,
      stalePendingCount,
    ] = await Promise.all([
      // Une commande annulée n'a jamais produit de chiffre d'affaires.
      this.prisma.db.order.aggregate({
        where: { createdAt: { gte: startOfDay }, status: { not: 'CANCELLED' } },
        _sum: { total: true },
      }),
      this.prisma.db.order.count({
        where: { createdAt: { gte: startOfDay } },
      }),
      this.prisma.db.order.count({
        where: { status: { in: ['CONFIRMED', 'PREPARING'] } },
      }),
      this.prisma.db.delivery.count({
        where: { status: { notIn: ['DELIVERED', 'FAILED', 'UNASSIGNED'] } },
      }),
      // Le seuil variant d'une ligne à l'autre, le comptage se fait en mémoire
      // plutôt qu'avec une comparaison colonne à colonne.
      this.prisma.db.productVariant.findMany({
        where: { isAvailable: true },
        select: { stock: true, lowStockThreshold: true },
      }),
      this.prisma.db.order.count({
        where: { status: 'PENDING', createdAt: { lt: staleBefore } },
      }),
    ]);

    return {
      revenueToday: revenue._sum.total ?? 0,
      ordersToday,
      toPrepare,
      activeDeliveries,
      lowStockCount: variants.filter((v) => v.stock <= v.lowStockThreshold)
        .length,
      stalePendingCount,
    };
  }

  /* ------------------------------ Commandes ------------------------------ */

  /**
   * File de travail. Par défaut, seules les commandes qui demandent une action
   * sont renvoyées : afficher l'historique complet noierait l'essentiel.
   */
  async listOrders(filters: { status?: OrderStatus; search?: string } = {}) {
    const rows = await this.prisma.db.order.findMany({
      where: {
        ...(filters.status
          ? { status: filters.status }
          : { status: { in: [...MANAGER_QUEUE_STATUSES] } }),
        ...(filters.search
          ? {
              reference: {
                contains: filters.search.trim(),
                mode: 'insensitive' as const,
              },
            }
          : {}),
      },
      // Les plus anciennes d'abord : c'est la file d'attente réelle du client.
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: managedOrderSelect,
    });

    return rows.map(toManagedOrder);
  }

  async getOrder(reference: string) {
    const order = await this.prisma.db.order.findUnique({
      where: { reference },
      select: {
        ...managedOrderSelect,
        subtotal: true,
        deliveryFee: true,
        note: true,
        items: {
          select: {
            id: true,
            productName: true,
            variantLabel: true,
            quantity: true,
            unitPrice: true,
          },
        },
        address: {
          select: {
            label: true,
            city: true,
            commune: true,
            district: true,
            landmark: true,
            instructions: true,
            contactPhone: true,
          },
        },
        payment: { select: { method: true, status: true } },
        events: {
          select: { status: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Cette commande est introuvable.',
      });
    }

    const { user, address, items, delivery, ...rest } = order;
    return {
      ...rest,
      items,
      address,
      customerName: `${user.firstName} ${user.lastName}`,
      customerPhone: user.phone,
      city: address?.city ?? null,
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
      hasCourier: Boolean(delivery?.courierId),
    };
  }

  /**
   * Avancement d'une commande.
   *
   * Deux garde-fous : la transition doit exister dans la machine à états, et
   * elle doit relever du gestionnaire. Sans le second, une commande pourrait
   * être déclarée livrée depuis un bureau, sans que personne ne l'ait portée.
   */
  async updateOrderStatus(
    actorId: string,
    reference: string,
    dto: UpdateOrderStatusDto,
  ) {
    const order = await this.prisma.db.order.findUnique({
      where: { reference },
      select: { id: true, status: true, userId: true, reference: true },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Cette commande est introuvable.',
      });
    }

    if (!canTransition(order.status, dto.status)) {
      throw new ConflictException({
        code: 'INVALID_ORDER_TRANSITION',
        message: 'Cette étape n’est pas possible depuis l’état actuel.',
        details: { from: order.status, to: dto.status },
      });
    }

    if (dto.status === 'CANCELLED') {
      if (!isCancellableByManager(order.status)) {
        throw new ConflictException({
          code: 'ORDER_NOT_CANCELLABLE',
          message: 'Cette commande ne peut plus être annulée.',
        });
      }
      return this.cancelOrder(actorId, order.id, order.userId, order.reference);
    }

    const allowed = managerActionFor(order.status);
    if (!allowed || allowed.next !== dto.status) {
      throw new ConflictException({
        code: 'MANAGER_ACTION_NOT_ALLOWED',
        message: 'Cette étape dépend de la livraison, pas de la gestion.',
        details: { from: order.status, to: dto.status },
      });
    }

    const updated = await this.prisma.db.$transaction(async (tx) => {
      const result = await tx.order.update({
        where: { id: order.id },
        data: { status: dto.status },
        select: managedOrderSelect,
      });
      await tx.orderEvent.create({
        data: { orderId: order.id, status: dto.status, actorId },
      });
      return result;
    });

    // Hors transaction : un service de notification lent ne doit pas retarder
    // la file de préparation.
    await this.notifications.notifyOrderStatus({
      userId: order.userId,
      status: dto.status,
      reference: order.reference,
      orderId: order.id,
    });

    return toManagedOrder(updated);
  }

  /** Annulation côté gestion : le stock réservé doit revenir en rayon. */
  private async cancelOrder(
    actorId: string,
    orderId: string,
    customerId: string,
    reference: string,
  ) {
    const cancelled = await this.prisma.db.$transaction(async (tx) => {
      const items = await tx.orderItem.findMany({
        where: { orderId },
        select: { variantId: true, quantity: true },
      });

      for (const item of items) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { increment: item.quantity } },
        });
      }

      await tx.orderEvent.create({
        data: { orderId, status: 'CANCELLED', actorId },
      });

      return tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED' },
        select: managedOrderSelect,
      });
    });

    await this.notifications.notifyOrderStatus({
      userId: customerId,
      status: 'CANCELLED',
      reference,
      orderId,
    });

    return toManagedOrder(cancelled);
  }

  /* -------------------------------- Stocks ------------------------------- */

  async listStock(onlyAlerts = false) {
    const variants = await this.prisma.db.productVariant.findMany({
      orderBy: [{ product: { name: 'asc' } }, { weightGrams: 'asc' }],
      select: {
        id: true,
        sku: true,
        label: true,
        weightGrams: true,
        stock: true,
        lowStockThreshold: true,
        isAvailable: true,
        product: { select: { name: true } },
      },
    });

    const items = variants.map((v) => ({
      variantId: v.id,
      sku: v.sku,
      productName: v.product.name,
      label: v.label,
      weightGrams: v.weightGrams,
      stock: v.stock,
      lowStockThreshold: v.lowStockThreshold,
      isAvailable: v.isAvailable,
    }));

    return onlyAlerts
      ? items.filter((i) => i.stock <= i.lowStockThreshold)
      : items;
  }

  /**
   * Réapprovisionnement et réglage du seuil.
   *
   * `delta` plutôt qu'une valeur absolue : deux gestionnaires qui saisissent
   * en même temps ajoutent chacun leur apport au lieu d'écraser celui de
   * l'autre. L'incrément est atomique côté base.
   */
  async adjustStock(variantId: string, dto: AdjustStockDto) {
    const variant = await this.prisma.db.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true, stock: true },
    });
    if (!variant) {
      throw new NotFoundException({
        code: 'VARIANT_NOT_FOUND',
        message: 'Cette variante est introuvable.',
      });
    }

    if (dto.delta === undefined && dto.lowStockThreshold === undefined) {
      throw new BadRequestException({
        code: 'NOTHING_TO_UPDATE',
        message: 'Indiquez un apport ou un seuil.',
      });
    }

    // Un stock négatif n'existe pas physiquement.
    if (dto.delta !== undefined && variant.stock + dto.delta < 0) {
      throw new BadRequestException({
        code: 'STOCK_CANNOT_BE_NEGATIVE',
        message: 'Le retrait dépasse le stock disponible.',
        details: { stock: variant.stock, delta: dto.delta },
      });
    }

    const updated = await this.prisma.db.productVariant.update({
      where: { id: variantId },
      data: {
        ...(dto.delta !== undefined ? { stock: { increment: dto.delta } } : {}),
        ...(dto.lowStockThreshold !== undefined
          ? { lowStockThreshold: dto.lowStockThreshold }
          : {}),
      },
      select: {
        id: true,
        sku: true,
        label: true,
        weightGrams: true,
        stock: true,
        lowStockThreshold: true,
        isAvailable: true,
        product: { select: { name: true } },
      },
    });

    return {
      variantId: updated.id,
      sku: updated.sku,
      productName: updated.product.name,
      label: updated.label,
      weightGrams: updated.weightGrams,
      stock: updated.stock,
      lowStockThreshold: updated.lowStockThreshold,
      isAvailable: updated.isAvailable,
    };
  }

  /* ------------------------------- Livreurs ------------------------------ */

  /** Liste des livreurs avec leur charge, pour assigner en connaissance. */
  async listCouriers() {
    const couriers = await this.prisma.db.user.findMany({
      where: { role: 'LIVREUR', isActive: true },
      orderBy: { firstName: 'asc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        _count: {
          select: {
            deliveries: {
              where: { status: { notIn: ['DELIVERED', 'FAILED'] } },
            },
          },
        },
      },
    });

    return couriers.map(({ _count, ...courier }) => ({
      ...courier,
      activeDeliveries: _count.deliveries,
    }));
  }
}
