import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  canTransition,
  isCancellableByManager,
  MANAGER_QUEUE_STATUSES,
  managerActionFor,
  type DeliveryStatus,
  type OrderStatus,
  type StockMovementType,
} from '@agrim/contracts';

import { CatalogSyncService } from '../catalog-sync/catalog-sync.service';
import { cancelOrderAndReleaseStock } from '../common/stock/order-stock';
import { applyStockChange } from '../common/stock/stock-movement';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AdjustStockDto } from './dto/adjust-stock.dto';
import type { UpdateOrderStatusDto } from './dto/update-order-status.dto';

/**
 * Motif d'un mouvement saisi à la main.
 *
 * Le signe suffit dans le cas courant — on ajoute, on retire. Il ne suffit
 * PAS à distinguer une sortie réelle de marchandise (casse, don) d'une
 * correction d'inventaire : les deux sont des `−3`, et confondre les deux
 * rendrait l'historique inexploitable pour comprendre une démarque.
 */
function movementTypeFor(dto: AdjustStockDto): StockMovementType {
  if (dto.type) return dto.type;
  return (dto.delta ?? 0) >= 0 ? 'ENTREE' : 'SORTIE';
}

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
  // `status` et `failureReason` servent à distinguer une commande qui n'est
  // jamais partie d'une commande REVENUE après une tentative infructueuse.
  // Les deux sont à `READY` et se ressemblent à l'écran ; seule la seconde
  // demande au gestionnaire de décider — relancer ou annuler.
  delivery: {
    select: { courierId: true, status: true, failureReason: true },
  },
} as const;

type ManagedOrderRow = {
  user: { firstName: string; lastName: string; phone: string };
  address: { city: string | null } | null;
  items: { quantity: number }[];
  delivery: {
    courierId: string | null;
    status: DeliveryStatus;
    failureReason: string | null;
  } | null;
} & Record<string, unknown>;

/** Aplatit les relations pour coller au contrat partagé. */
function toManagedOrder(row: ManagedOrderRow) {
  const { user, address, items, delivery, ...rest } = row;
  const deliveryFailed = delivery?.status === 'FAILED';
  return {
    ...rest,
    customerName: `${user.firstName} ${user.lastName}`,
    customerPhone: user.phone,
    city: address?.city ?? null,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    // Une course échouée conserve son `courierId` — c'est la trace de qui a
    // tenté. Mais la commande attend bel et bien une NOUVELLE affectation :
    // laisser `hasCourier` à vrai masquerait le bouton « assigner » et la
    // commande resterait immobile, ce qui reproduirait en surface le blocage
    // que ce lot corrige en profondeur.
    hasCourier: Boolean(delivery?.courierId) && !deliveryFailed,
    /** Vrai quand la commande revient d'une tentative infructueuse. */
    awaitingRetry: deliveryFailed,
    /** Motif de l'échec, à afficher au gestionnaire qui doit trancher. */
    deliveryFailureReason: deliveryFailed
      ? (delivery?.failureReason ?? null)
      : null,
  };
}

@Injectable()
export class ManagementService {
  private readonly logger = new Logger(ManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly catalog: CatalogSyncService,
  ) {}

  /* ------------------------------ Tableau -------------------------------- */

  async dashboard() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const staleBefore = new Date(Date.now() - STALE_PENDING_MINUTES * 60_000);

    const [
      revenue,
      ordersToday,
      ordersByStatus,
      activeDeliveries,
      variants,
      stalePendingCount,
      customerCount,
      productCount,
      couriers,
    ] = await Promise.all([
      // Une commande annulée n'a jamais produit de chiffre d'affaires.
      this.prisma.db.order.aggregate({
        where: { createdAt: { gte: startOfDay }, status: { not: 'CANCELLED' } },
        _sum: { total: true },
      }),
      this.prisma.db.order.count({
        where: { createdAt: { gte: startOfDay } },
      }),
      // UNE agrégation pour les sept statuts, au lieu de sept comptages : le
      // tableau de bord est la page la plus ouverte de l'administration, et
      // c'est PostgreSQL qui compte, pas nous.
      this.prisma.db.order.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.db.delivery.count({
        where: { status: { notIn: ['DELIVERED', 'FAILED', 'UNASSIGNED'] } },
      }),
      // Le seuil variant d'une ligne à l'autre, la comparaison se fait en
      // mémoire : Prisma ne sait pas comparer deux colonnes entre elles, et le
      // catalogue tient en quelques dizaines de lignes. À revoir en SQL brut
      // le jour où il en compterait des milliers.
      this.prisma.db.productVariant.findMany({
        where: { isAvailable: true },
        select: { stock: true, lowStockThreshold: true },
      }),
      this.prisma.db.order.count({
        where: { status: 'PENDING', createdAt: { lt: staleBefore } },
      }),
      this.prisma.db.user.count({ where: { role: 'CLIENT', isActive: true } }),
      this.prisma.db.product.count({ where: { isActive: true } }),
      // Les livreurs actifs et leur charge : « disponible » se déduit de
      // l'absence de course en cours, il ne se déclare pas.
      this.prisma.db.user.findMany({
        where: { role: 'LIVREUR', isActive: true },
        select: {
          _count: {
            select: {
              deliveries: {
                where: {
                  status: { notIn: ['DELIVERED', 'FAILED', 'UNASSIGNED'] },
                },
              },
            },
          },
        },
      }),
    ]);

    const parStatut = (statut: OrderStatus) =>
      ordersByStatus.find((r) => r.status === statut)?._count._all ?? 0;

    return {
      revenueToday: revenue._sum.total ?? 0,
      ordersToday,
      // Conservé sous son nom d'origine : le mobile l'affiche déjà.
      toPrepare: parStatut('CONFIRMED') + parStatut('PREPARING'),
      activeDeliveries,
      lowStockCount: variants.filter((v) => v.stock <= v.lowStockThreshold)
        .length,
      stalePendingCount,

      // Le détail par statut, que le tableau de bord réclamait sans l'avoir.
      orders: {
        pending: parStatut('PENDING'),
        confirmed: parStatut('CONFIRMED'),
        preparing: parStatut('PREPARING'),
        ready: parStatut('READY'),
        outForDelivery: parStatut('OUT_FOR_DELIVERY'),
        delivered: parStatut('DELIVERED'),
        cancelled: parStatut('CANCELLED'),
      },

      catalog: {
        productCount,
        variantCount: variants.length,
        // Rupture et stock faible sont deux alertes distinctes : la première
        // fait perdre une vente maintenant, la seconde la fera perdre demain.
        outOfStockCount: variants.filter((v) => v.stock === 0).length,
        lowStockCount: variants.filter(
          (v) => v.stock > 0 && v.stock <= v.lowStockThreshold,
        ).length,
      },

      customers: { total: customerCount },

      couriers: {
        total: couriers.length,
        busy: couriers.filter((c) => c._count.deliveries > 0).length,
        available: couriers.filter((c) => c._count.deliveries === 0).length,
      },
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
    let refReservation: string | null = null;

    const cancelled = await this.prisma.db.$transaction(async (tx) => {
      // Bascule conditionnelle : le client peut avoir annulé lui-même, ou le
      // paiement avoir expiré, entre la lecture du statut et ici. Le perdant
      // ne libère pas le stock une seconde fois — voir
      // `common/stock/order-stock.ts`.
      const { released, reservationRef } = await cancelOrderAndReleaseStock(
        tx,
        orderId,
        actorId,
      );
      if (!released) {
        throw new ConflictException({
          code: 'ORDER_NOT_CANCELLABLE',
          message: 'Cette commande ne peut plus être annulée.',
        });
      }
      refReservation = reservationRef ?? null;

      await tx.orderEvent.create({
        data: { orderId, status: 'CANCELLED', actorId },
      });

      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: managedOrderSelect,
      });
    });

    // Le stock est retenu par le SITE : c'est à lui de le rendre. Hors
    // transaction (appel réseau), et seul le gagnant de la bascule arrive ici.
    if (refReservation) {
      const resultat = await this.catalog.releaseStock(refReservation);
      if (resultat.status !== 'ok') {
        this.logger.warn(
          `Réservation non libérée pour ${reference} : elle expirera d'elle-même.`,
        );
      }
    }

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
   * Réapprovisionnement, correction d'inventaire et réglage du seuil.
   *
   * `delta` plutôt qu'une valeur absolue : deux gestionnaires qui saisissent
   * en même temps ajoutent chacun leur apport au lieu d'écraser celui de
   * l'autre. L'incrément est atomique côté base.
   *
   * Tout mouvement laisse une ligne au journal, avec son auteur — voir
   * `common/stock/stock-movement.ts`. C'est ce qui rend un écart d'inventaire
   * explicable plutôt que subi.
   */
  async adjustStock(variantId: string, dto: AdjustStockDto, actorId: string) {
    const variant = await this.prisma.db.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true },
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

    // Une correction d'inventaire sans explication est précisément ce que ce
    // journal existe pour empêcher : c'est le seul mouvement dont le motif ne
    // se devine pas au signe.
    //
    // Exigé seulement si un mouvement a effectivement lieu : régler un seuil
    // d'alerte ne déplace pas de marchandise, et n'a donc rien à justifier.
    const type = movementTypeFor(dto);
    if (
      dto.delta !== undefined &&
      type === 'AJUSTEMENT' &&
      !dto.reason?.trim()
    ) {
      throw new BadRequestException({
        code: 'STOCK_REASON_REQUIRED',
        message: 'Expliquez la correction d’inventaire.',
      });
    }

    const updated = await this.prisma.db.$transaction(async (tx) => {
      if (dto.delta !== undefined) {
        const applique = await applyStockChange(tx, {
          variantId,
          delta: dto.delta,
          type,
          reason: dto.reason?.trim() || null,
          actorId,
        });
        // `null` = le retrait dépasse le stock. La condition a été évaluée par
        // PostgreSQL, pas par une lecture antérieure : un retrait concurrent
        // ne peut plus faire passer le compteur sous zéro.
        if (!applique) {
          throw new BadRequestException({
            code: 'STOCK_CANNOT_BE_NEGATIVE',
            message: 'Le retrait dépasse le stock disponible.',
            details: { delta: dto.delta },
          });
        }
      }

      return tx.productVariant.update({
        where: { id: variantId },
        data: {
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

  /**
   * Historique des mouvements d'une variante — « pourquoi ce chiffre ? ».
   *
   * Paginé et borné côté serveur : l'historique d'une référence qui tourne
   * bien se compte en milliers de lignes, et personne n'en lit plus de
   * quelques dizaines.
   */
  async listStockMovements(
    variantId: string,
    page: number,
    limit: number,
    filters: { type?: StockMovementType } = {},
  ) {
    const variant = await this.prisma.db.productVariant.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        sku: true,
        label: true,
        stock: true,
        product: { select: { name: true } },
      },
    });
    if (!variant) {
      throw new NotFoundException({
        code: 'VARIANT_NOT_FOUND',
        message: 'Cette variante est introuvable.',
      });
    }

    const where = {
      variantId,
      ...(filters.type ? { type: filters.type } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          type: true,
          quantity: true,
          stockBefore: true,
          stockAfter: true,
          reason: true,
          reference: true,
          createdAt: true,
          // Jointure explicite plutôt qu'une requête par ligne : c'est
          // exactement le N+1 que l'on veut éviter sur un historique.
          actor: { select: { firstName: true, lastName: true, role: true } },
        },
      }),
      this.prisma.db.stockMovement.count({ where }),
    ]);

    return {
      variant: {
        variantId: variant.id,
        sku: variant.sku,
        productName: variant.product.name,
        label: variant.label,
        stock: variant.stock,
      },
      data: rows.map((m) => ({
        id: m.id,
        type: m.type,
        quantity: m.quantity,
        stockBefore: m.stockBefore,
        stockAfter: m.stockAfter,
        reason: m.reason,
        reference: m.reference,
        createdAt: m.createdAt,
        // « Système » plutôt qu'un vide : l'absence d'auteur est une
        // information, pas une donnée manquante.
        actor: m.actor
          ? {
              name: `${m.actor.firstName} ${m.actor.lastName}`.trim(),
              role: m.actor.role,
            }
          : null,
      })),
      pagination: { page, limit, total },
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
