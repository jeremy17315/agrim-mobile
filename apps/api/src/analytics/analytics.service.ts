import { Injectable } from '@nestjs/common';
import {
  averageBasket,
  DELIVERY_SLA_HOURS,
  distributionShares,
  growthRate,
  MONTH_LABELS,
  SALES_HISTORY_MONTHS,
} from '@agrim/contracts';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Indicateurs consolidés de la direction générale.
 *
 * Lecture seule et agrégée côté serveur : le mobile n'additionne rien. Deux
 * conséquences voulues — aucun montant ne peut diverger entre deux écrans, et
 * l'application ne télécharge pas l'historique des commandes pour en faire la
 * somme sur un réseau mobile.
 *
 * Le chiffre d'affaires exclut partout les commandes annulées : elles n'ont
 * jamais produit de recette.
 */

/** Début du mois calendaire contenant `date`, à minuit. */
function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

/** Mois suivant, borne haute exclusive. */
function nextMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0);
}

function monthKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}`;
}

function monthLabel(date: Date): string {
  return MONTH_LABELS[date.getMonth()]!;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async executiveDashboard() {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = nextMonth(now);
    const previousStart = startOfMonth(
      new Date(now.getFullYear(), now.getMonth() - 1, 1),
    );

    // Borne basse de l'historique : SALES_HISTORY_MONTHS mois glissants,
    // celui en cours compris.
    const historyStart = startOfMonth(
      new Date(
        now.getFullYear(),
        now.getMonth() - (SALES_HISTORY_MONTHS - 1),
        1,
      ),
    );

    const lateBefore = new Date(Date.now() - DELIVERY_SLA_HOURS * 3_600_000);

    const [
      currentRevenue,
      currentOrders,
      previousRevenue,
      previousOrders,
      newCustomers,
      lateDeliveries,
      manualClosures,
      deliveredMonth,
      variants,
      productionReceived,
      pendingProductionReviews,
      history,
      categoryRows,
    ] = await Promise.all([
      this.prisma.db.order.aggregate({
        where: {
          createdAt: { gte: monthStart, lt: monthEnd },
          status: { not: 'CANCELLED' },
        },
        _sum: { total: true },
      }),
      this.prisma.db.order.count({
        where: {
          createdAt: { gte: monthStart, lt: monthEnd },
          status: { not: 'CANCELLED' },
        },
      }),
      this.prisma.db.order.aggregate({
        where: {
          createdAt: { gte: previousStart, lt: monthStart },
          status: { not: 'CANCELLED' },
        },
        _sum: { total: true },
      }),
      this.prisma.db.order.count({
        where: {
          createdAt: { gte: previousStart, lt: monthStart },
          status: { not: 'CANCELLED' },
        },
      }),
      this.prisma.db.user.count({
        where: {
          createdAt: { gte: monthStart, lt: monthEnd },
          role: 'CLIENT',
        },
      }),
      // Course engagée depuis trop longtemps et toujours pas conclue.
      this.prisma.db.delivery.count({
        where: {
          status: { notIn: ['DELIVERED', 'FAILED', 'UNASSIGNED'] },
          assignedAt: { lt: lateBefore },
        },
      }),
      // Clôtures d'exception du mois : une remise validée sans code client.
      // Suivi explicitement, car c'est le signal qui dira si le parcours par
      // code tient sur le terrain ou si les gestionnaires le contournent.
      this.prisma.db.delivery.count({
        where: {
          closureMode: 'MANAGER_OVERRIDE',
          deliveredAt: { gte: monthStart, lt: monthEnd },
        },
      }),
      this.prisma.db.delivery.count({
        where: { deliveredAt: { gte: monthStart, lt: monthEnd } },
      }),
      this.prisma.db.productVariant.findMany({
        where: { isAvailable: true },
        select: { stock: true, lowStockThreshold: true },
      }),
      // Seules les récoltes réceptionnées comptent : une déclaration en attente
      // n'est pas un tonnage acquis.
      this.prisma.db.production.aggregate({
        where: {
          status: 'RECEIVED',
          reviewedAt: { gte: monthStart, lt: monthEnd },
        },
        _sum: { quantityKg: true },
      }),
      this.prisma.db.production.count({
        where: { status: { in: ['DECLARED', 'CONFIRMED'] } },
      }),
      this.salesHistory(historyStart, monthEnd),
      this.categoryBreakdown(monthStart, monthEnd),
    ]);

    const revenueMonth = currentRevenue._sum.total ?? 0;
    const previousRevenueTotal = previousRevenue._sum.total ?? 0;

    return {
      month: monthKey(now),
      monthLabel: monthLabel(now),

      revenueMonth,
      revenueGrowth: growthRate(revenueMonth, previousRevenueTotal),

      ordersMonth: currentOrders,
      ordersGrowth: growthRate(currentOrders, previousOrders),

      newCustomers,
      averageBasket: averageBasket(revenueMonth, currentOrders),

      lateDeliveries,
      manualClosures,
      manualClosureRate:
        deliveredMonth > 0
          ? Math.round((manualClosures / deliveredMonth) * 100)
          : 0,
      lowStockCount: variants.filter((v) => v.stock <= v.lowStockThreshold)
        .length,

      productionReceivedKg: productionReceived._sum.quantityKg ?? 0,
      pendingProductionReviews,

      sales: history,
      categories: categoryRows,
    };
  }

  /**
   * Ventes mois par mois.
   *
   * Les mois sans commande sont produits à zéro plutôt qu'omis : un trou dans
   * l'historique se lirait comme une absence de donnée, alors qu'il s'agit
   * d'une absence de vente.
   */
  private async salesHistory(from: Date, to: Date) {
    const orders = await this.prisma.db.order.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        status: { not: 'CANCELLED' },
      },
      select: { total: true, createdAt: true },
    });

    const buckets = new Map<string, { revenue: number; orders: number }>();
    for (let i = 0; i < SALES_HISTORY_MONTHS; i += 1) {
      const cursor = new Date(from.getFullYear(), from.getMonth() + i, 1);
      buckets.set(monthKey(cursor), { revenue: 0, orders: 0 });
    }

    for (const order of orders) {
      const bucket = buckets.get(monthKey(order.createdAt));
      if (!bucket) continue;
      bucket.revenue += order.total;
      bucket.orders += 1;
    }

    return Array.from(buckets.entries()).map(([key, value]) => {
      const [year, month] = key.split('-');
      const date = new Date(Number(year), Number(month) - 1, 1);
      return {
        month: key,
        label: monthLabel(date),
        revenue: value.revenue,
        orders: value.orders,
      };
    });
  }

  /**
   * Répartition du chiffre d'affaires par gamme.
   *
   * Le rattachement se fait par la catégorie du produit au moment de la
   * lecture. Les lignes de commande stockent le nom du produit mais pas sa
   * catégorie : on repasse donc par la variante.
   */
  private async categoryBreakdown(from: Date, to: Date) {
    const items = await this.prisma.db.orderItem.findMany({
      where: {
        order: {
          createdAt: { gte: from, lt: to },
          status: { not: 'CANCELLED' },
        },
      },
      select: {
        lineTotal: true,
        variant: {
          select: {
            product: {
              select: { category: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });

    const totals = new Map<string, { name: string; revenue: number }>();
    for (const item of items) {
      const category = item.variant.product.category;
      const current = totals.get(category.id);
      if (current) current.revenue += item.lineTotal;
      else
        totals.set(category.id, {
          name: category.name,
          revenue: item.lineTotal,
        });
    }

    const rows = Array.from(totals.entries())
      .map(([categoryId, value]) => ({
        categoryId,
        name: value.name,
        revenue: value.revenue,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    return distributionShares(rows);
  }
}
