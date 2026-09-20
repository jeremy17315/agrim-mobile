import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  computeCartTotals,
  computeDeliveryFee,
  isCancellableByClient,
  resolveDeliveryZone,
} from '@agrim/contracts';

import { currentStockMode } from '../config/stock-mode';
import { estP2002 } from '../common/prisma/prisma-erreur';
import { cancelOrderAndReleaseStock } from '../common/stock/order-stock';
import { recordStockMovement } from '../common/stock/stock-movement';
import { CatalogSyncService } from '../catalog-sync/catalog-sync.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateOrderDto } from './dto/create-order.dto';
import { formatOrderReference } from './order-reference';
import { CheckoutService } from './checkout.service';

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
  // Chronologie : le client veut savoir où en est sa commande, pas seulement
  // son statut courant.
  events: {
    select: { id: true, status: true, comment: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
} as const;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly catalog: CatalogSyncService,
    private readonly checkout: CheckoutService,
  ) {}

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
    // Bascule SSOT (docs/refonte/08, phase 4) : quand cette base possède le
    // stock, la création passe par le checkout transactionnel local — plus
    // aucune réservation distante. Défaut `site` : le comportement établi
    // ci-dessous reste seul en production jusqu'à la bascule assumée.
    if (currentStockMode() === 'local') {
      return this.checkout.create(userId, dto);
    }

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
      // La VILLE sert au tarif de livraison : c'est elle qui décide de la
      // zone, donc du montant facturé. Voir `@agrim/contracts/delivery`.
      select: { id: true, city: true },
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
        originalPrice: true,
        sourceRef: true,
        stock: true,
        isAvailable: true,
        // Le poids commande la gratuité au-delà du seuil du site.
        weightGrams: true,
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
    const refs = variants
      .map((v) => v.sourceRef)
      .filter((r): r is string => Boolean(r));
    const cotation = await this.catalog.quote(refs);

    // Le site est propriétaire du catalogue : s'il vient de retirer une
    // référence de la vente, elle ne doit pas partir ici parce que notre copie
    // date de quelques minutes. On ne bloque QUE sur une réponse explicite —
    // site injoignable ou intégration désactivée laissent la vente passer,
    // sans quoi une panne du site fermerait la boutique de l'application.
    if (cotation.status === 'ok') {
      const retirees = variants.filter(
        (v) => v.sourceRef && cotation.prices.get(v.sourceRef)?.vendable === false,
      );
      if (retirees.length > 0) {
        throw new BadRequestException({
          code: 'VARIANT_UNAVAILABLE',
          message: 'Un article de votre panier n’est plus disponible.',
          details: retirees.map((v) => ({
            variantId: v.id,
            productName: v.product.name,
          })),
        });
      }
    }

    const lines = variants.map((v) => {
      const cote =
        cotation.status === 'ok' && v.sourceRef
          ? cotation.prices.get(v.sourceRef)
          : undefined;
      let unitPrice = v.price;
      if (cote) unitPrice = cote.prix;
      else if (
        cotation.status === 'unavailable' &&
        v.originalPrice &&
        v.originalPrice > v.price
      ) {
        unitPrice = v.originalPrice;
      }
      return {
        variantId: v.id,
        productName: v.product.name,
        variantLabel: v.label,
        unitPrice,
        quantity: merged.get(v.id) ?? 0,
        weightGrams: v.weightGrams,
      };
    });

    // ── Frais de livraison : la grille du SITE fait foi ────────────────────
    //
    // Décision métier du 29 août 2026. Avant, cette API appliquait un forfait
    // de 1 000 F écrit en dur, quand le site facturait 3 500 F pour Abidjan :
    // le même trajet coûtait deux prix selon l'écran ouvert par le client.
    //
    // Rien n'est calculé ici : la zone, le tarif et le seuil de gratuité
    // viennent tous du site. C'est le seul moyen qu'un changement de tarif
    // n'ait qu'un endroit où se faire.
    const grid = await this.catalog.deliveryGrid();
    if (!grid) {
      // On ne devine pas un montant. Facturer un tarif inventé serait pire
      // qu'un refus : le client paierait un prix qui n'est celui de personne.
      throw new ServiceUnavailableException({
        code: 'DELIVERY_GRID_UNAVAILABLE',
        message:
          'Les frais de livraison sont momentanément indisponibles. Réessayez dans un instant.',
      });
    }

    const weightKg =
      lines.reduce((sum, l) => sum + l.weightGrams * l.quantity, 0) / 1000;

    const deliveryFee = computeDeliveryFee(
      {
        zone: resolveDeliveryZone(address.city, grid),
        // Le retrait sur place n'est pas encore proposé par l'application :
        // toute commande mobile est une livraison à domicile. Le jour où il
        // le sera, c'est ce paramètre qui changera, pas le calcul.
        mode: 'domicile',
        weightKg,
      },
      grid,
    );

    const totals = computeCartTotals(
      lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })),
      { deliveryFee },
    );

    // ── Réservation du stock auprès du SITE ───────────────────────────────
    //
    // Cette API ne décrémente plus de compteur local. Le site possède le
    // stock ; deux compteurs, c'est le même sac vendu deux fois.
    //
    // La réservation a lieu AVANT la transaction, et volontairement : un
    // appel réseau tenu à l'intérieur retiendrait des verrous PostgreSQL
    // pendant tout le temps de latence du site.
    //
    // La clé de réservation est `idempotencyKey`, pas la référence de
    // commande — celle-ci n'existe qu'une fois le compteur incrémenté, donc
    // trop tard. Cette clé vient du client, elle est unique par tentative, et
    // c'est déjà elle qui empêche le doublon de commande : la rejouer donne
    // la même réservation au lieu d'une seconde.
    const reservables = variants.filter((v) => v.sourceRef);
    if (reservables.length !== variants.length) {
      // Une variante sans `sourceRef` n'est pas connue du site : elle vient du
      // catalogue d'amorçage et ne devrait plus être vendable. La vendre
      // signifierait décider du stock ici — précisément ce qu'on supprime.
      throw new ConflictException({
        code: 'VARIANT_NOT_SYNCED',
        message: 'Un article de votre panier n’est pas encore synchronisé.',
        details: variants
          .filter((v) => !v.sourceRef)
          .map((v) => ({ variantId: v.id, productName: v.product.name })),
      });
    }

    const reservation = await this.catalog.reserveStock(
      dto.idempotencyKey,
      variants.map((v) => ({
        sourceRef: v.sourceRef as string,
        quantity: merged.get(v.id) ?? 0,
      })),
    );

    if (reservation.status === 'refused') {
      throw new ConflictException({
        code: 'INSUFFICIENT_STOCK',
        message: reservation.message,
        details: reservation.details,
      });
    }
    if (reservation.status === 'unavailable') {
      // On ne vend pas un stock qu'aucun système ne nous a accordé. Refuser
      // une commande est réparable ; vendre deux fois le même sac ne l'est pas.
      throw new ServiceUnavailableException({
        code: 'STOCK_SERVICE_UNAVAILABLE',
        message:
          'La disponibilité ne peut pas être confirmée pour le moment. Réessayez dans un instant.',
      });
    }

    const year = new Date().getFullYear();

    let created;
    try {
      created = await this.prisma.db.$transaction(async (tx) => {
        // Compteur annuel atomique : deux commandes simultanées obtiennent des
        // séquences distinctes, donc jamais la même référence.
        const counter = await tx.orderCounter.upsert({
          where: { year },
          create: { year, current: 1 },
          update: { current: { increment: 1 } },
          select: { current: true },
        });

        const reference = formatOrderReference(year, counter.current);

        // Le stock est déjà retiré du rayon CHEZ LE SITE. On n'écrit ici que
        // le journal, pour que l'inventaire local reste explicable — sans
        // toucher au compteur, qui n'est plus une source de vérité mais une
        // copie rafraîchie par la synchronisation.
        for (const line of lines) {
          await recordStockMovement(tx, {
            variantId: line.variantId,
            quantity: -line.quantity,
            type: 'COMMANDE',
            reference,
            actorId: null,
          });
        }

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
    } catch (erreur) {
      if (estP2002(erreur)) {
        // Double-clic concurrent : les deux requêtes ont lu « absente » avant
        // qu'aucune n'écrive ; l'index unique tranche, le perdant relit et
        // renvoie la commande du GAGNANT. Surtout PAS de compensation ici :
        // la réservation porte la MÊME clé idempotente que la commande
        // gagnante — la libérer rendrait au rayon le stock d'une vente réelle.
        const gagnante = await this.prisma.db.order.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
          select: { id: true, userId: true },
        });
        if (gagnante && gagnante.userId === userId) {
          return this.prisma.db.order.findUniqueOrThrow({
            where: { id: gagnante.id },
            select: orderSelect,
          });
        }
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          message: 'Cette commande ne peut pas être rejouée.',
        });
      }
      // Compensation : la réservation est prise mais la commande n'existe pas.
      // Sans ce rattrapage, le stock resterait immobilisé jusqu'à l'expiration
      // — trente minutes de rayon fermé pour rien.
      await this.catalog.releaseStock(dto.idempotencyKey, 'echec_creation');
      throw erreur;
    }

    // La vente est actée : la réservation devient définitive. Sans cet appel,
    // l'expiration finirait par rendre au rayon la marchandise d'une commande
    // bien réelle — le cas du paiement à la livraison, qui reste « en attente »
    // jusqu'à la remise.
    //
    // Hors transaction et sans `await` bloquant l'échec : si le site ne répond
    // pas, la commande reste valide et la réservation expirera. C'est un écart
    // à rattraper par la réconciliation, pas une raison d'annuler une vente.
    const confirmation = await this.catalog.confirmStock(dto.idempotencyKey);
    if (confirmation.status !== 'ok') {
      this.logger.warn(
        `Réservation non confirmée pour ${created.reference} : le stock du site expirera.`,
      );
    }

    // Hors transaction, pour la même raison que l'annulation.
    await this.notifications.notify({
      userId,
      type: 'ORDER_CREATED',
      reference: created.reference,
      orderId: created.id,
    });

    return created;
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

    // La règle vit dans le contrat partagé : la dupliquer ici les ferait
    // diverger, et c'est exactement ce qui s'était produit.
    if (!isCancellableByClient(order.status)) {
      throw new ConflictException({
        code: 'ORDER_NOT_CANCELLABLE',
        message: 'Cette commande ne peut plus être annulée.',
      });
    }

    let refReservation: string | null = null;

    const cancelled = await this.prisma.db.$transaction(async (tx) => {
      // Le statut lu plus haut date d'avant la transaction. La bascule
      // conditionnelle tranche : si le bureau ou l'expiration du paiement
      // vient d'annuler cette commande, on ne libère pas le stock une seconde
      // fois. Voir `common/stock/order-stock.ts`.
      const { released, reservationRef } = await cancelOrderAndReleaseStock(
        tx,
        order.id,
        userId,
      );
      if (!released) {
        throw new ConflictException({
          code: 'ORDER_NOT_CANCELLABLE',
          message: 'Cette commande ne peut plus être annulée.',
        });
      }
      refReservation = reservationRef ?? null;

      await tx.orderEvent.create({
        data: { orderId: order.id, status: 'CANCELLED', actorId: userId },
      });

      return tx.order.findUniqueOrThrow({
        where: { id: order.id },
        select: orderSelect,
      });
    });

    // Libération chez le site, HORS transaction : c'est un appel réseau, et le
    // retenir dedans immobiliserait des verrous PostgreSQL.
    //
    // Seul le gagnant de la bascule arrive ici, et le site est lui-même
    // idempotent : une réservation déjà réglée n'est pas rendue deux fois.
    // Double garde, parce qu'un stock rendu en trop est du stock inventé.
    await this.releaseReservation(refReservation, cancelled.reference);

    // Notification hors transaction : un service de push lent ne doit pas
    // maintenir un verrou sur les lignes de stock.
    await this.notifications.notifyOrderStatus({
      userId,
      status: 'CANCELLED',
      reference: cancelled.reference,
      orderId: cancelled.id,
    });

    return cancelled;
  }

  /**
   * Rend au site le stock d'une commande annulée.
   *
   * Ne lève jamais : l'annulation est DÉJÀ écrite en base quand on arrive ici.
   * Échouer maintenant rendrait la commande annulée pour le client tout en
   * lui renvoyant une erreur — le pire des deux mondes. Un échec laisse la
   * réservation expirer d'elle-même (trente minutes), et il est journalisé
   * pour que l'écart soit visible.
   */
  private async releaseReservation(
    reservationRef: string | null,
    orderReference: string,
  ): Promise<void> {
    // Commande antérieure à la réservation centralisée : rien à libérer.
    if (!reservationRef) return;

    const resultat = await this.catalog.releaseStock(reservationRef);
    if (resultat.status !== 'ok') {
      this.logger.warn(
        `Réservation non libérée pour ${orderReference} : elle expirera d'elle-même.`,
      );
    }
  }
}
