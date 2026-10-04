import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { computeCartTotals, resolveDeliveryZone } from '@agrim/contracts';
import { Prisma } from '../../generated/prisma/client';
import { estP2002 } from '../common/prisma/prisma-erreur';
import { promosActives } from '../common/pricing/effective-price';
import { SitePricingService } from '../site-pricing/site-pricing.service';
import { readDeliveryGrid } from './delivery-grid';

import {
  lockVariantsForOrder,
  reserveStockForOrder,
  StockReservationError,
} from '../common/stock/reserve-stock';
import { kickOutboxDrain } from '../jobs/outbox-drain';
import { PrismaService } from '../prisma/prisma.service';
import { SieveSession } from '../sieve/model';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { GuestOrderCustomer } from './orders.service';
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
  guestName: true,
  guestPhone: true,
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: SitePricingService,
    private readonly sieveSession: SieveSession,
  ) {}

  /**
   * Préparation HORS transaction : adresse, zone, remises.
   *
   * Tout ce qui peut appeler le réseau — le calculateur du site — se passe
   * ici, avant d'ouvrir la transaction : un appel tenu sous verrou retiendrait
   * les verrous PostgreSQL pendant toute la latence du site.
   */
  private async prepare(
    userId: string,
    dto: CreateOrderDto,
    guest?: GuestOrderCustomer,
  ): Promise<{ remise: number }> {
    const address = await this.prisma.db.address.findFirst({
      where: { id: dto.addressId, userId },
      select: { id: true, city: true },
    });
    if (!address) {
      throw new NotFoundException({
        code: 'ADDRESS_NOT_FOUND',
        message: 'Cette adresse de livraison est introuvable.',
      });
    }

    // Grille du site : elle nomme la zone et son délai. Aucun montant n'en
    // est tiré — le site n'encaisse aucun frais en ligne.
    const grid = await readDeliveryGrid(this.prisma.db);
    const zone = resolveDeliveryZone(address.city, grid);

    // ── Scratch d'instructions de livraison (Sieve) ──────────────────────
    //
    // Un scrape Sieve prépare d'éventuelles instructions de livraison
    // (code postal, points de repère, accès particulier) avant que le
    // client ne les confirme. Le run est préservé et pollé par le
    // driver de commande ; au moment où la commande est validée,
    // `GET /sieve/scrapes/:session_id` donne la derniere état.
    //
    // Pilotage désactivé ⇒ pas d'appel : le driver renvoie une session
    // `error` et la commande continue avec la grille de zone du site,
    // sans aucune divergence avec la règle « le SITE fait foi ».
    if (this.sieveSession.hasKey()) {
      try {
        await this.sieveSession.create({
          instruction:
            `Récupérer les instructions de livraison pour la livraison à ${address.city}`,
          status: 'queued',
        });
      } catch {
        // La persistance de la session est un repli logique ; son échec
        // n'empêche pas la commande de passer — la grille de zone reste.
      }
    }

    const variants = await this.prisma.db.productVariant.findMany({
      where: { id: { in: dto.items.map((i) => i.variantId) } },
      select: { id: true, sourceRef: true },
    });
    const refs = new Map(variants.map((v) => [v.id, v.sourceRef]));

    const remise = await this.pricing.remise({
      items: dto.items.map((item) => ({
        sourceRef: refs.get(item.variantId) ?? null,
        quantity: item.quantity,
      })),
      zone,
      mode: 'domicile',
      codePromo: dto.codePromo,
      phone: guest?.phone,
    });

    return { remise: remise.status === 'ok' ? remise.remise : 0 };
  }

  async create(
    userId: string,
    dto: CreateOrderDto,
    guest?: GuestOrderCustomer,
  ) {
    const requestHash = this.fingerprint(userId, dto, guest);

    // Réseau AVANT verrous : voir `prepare`.
    const preflight = await this.prepare(userId, dto, guest);

    // `isReplay` distingue une création fraîche d'un rejeu : on ne notifie
    // qu'une fois, à la création — le rejeu renvoie la commande d'origine
    // sans renvoyer la notification (même règle que le mode `site`).
    let isReplay = false;
    const created = await this.prisma.db.$transaction(async (tx) => {
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
        isReplay = true;
        return this.replay(tx, dto.idempotencyKey, userId, guest);
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
        merged.set(
          item.variantId,
          (merged.get(item.variantId) ?? 0) + item.quantity,
        );
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
        select: {
          isActive: true,
          variantId: true,
          priceXof: true,
          startsAt: true,
          endsAt: true,
        },
      });
      // Règle de prix UNIQUE (common/pricing) : checkout, catalogue et
      // lectures publiques tranchent la promotion de la même façon — un
      // panier affiché ne peut jamais différer d'un panier facturé.
      const now = new Date();
      const effective = new Map<string, number>();
      for (const promo of promosActives(promotions, now)) {
        effective.set(promo.variantId, promo.priceXof);
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

      const totals = computeCartTotals(
        lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })),
        // Remise décidée par le site, lue avant la transaction. Les frais de
        // livraison, eux, ne sont JAMAIS additionnés : le site n'en facture
        // aucun en ligne.
        { remise: preflight.remise },
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
      // Course d'idempotence : deux requêtes simultanées avec la même clé
      // passent toutes deux le contrôle initial, l'unicité de
      // `Order.idempotencyKey` tranche. Le perdant est remis sur la voie du
      // rejeu (même commande, même réponse) au lieu d'un 500 brut — et sa
      // transaction entière est annulée : aucun stock décrémenté qui traîne.
      let order;
      try {
        order = await tx.order.create({
          data: {
            reference,
            userId,
            addressId: dto.addressId,
            status: 'PENDING',
            subtotal: totals.subtotal,
            deliveryFee: totals.deliveryFee,
            total: totals.total,
            note: dto.note ?? null,
            guestName: guest?.name ?? null,
            guestPhone: guest?.phone ?? null,
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
              create: { status: 'PENDING', actorId: guest ? null : userId },
            },
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
      } catch (erreur) {
        if (estP2002(erreur)) {
          isReplay = true;
          return this.replay(tx, dto.idempotencyKey, userId, guest);
        }
        throw erreur;
      }

      // L'événement naît AVEC la commande, dans la même transaction : aucun
      // ordre créé sans son événement, aucune notification perdue en silence.
      // (la diffusion elle-même reste post-commit — outbox, jamais en ligne)
      if (!guest) {
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
      }

      await tx.idempotencyRecord.create({
        data: {
          scope: 'orders',
          key: dto.idempotencyKey,
          requestHash,
          responseStatus: 201,
          responseBody: { reference: order.reference } as Prisma.InputJsonValue,
          expiresAt: new Date(
            now.getTime() + IDEMPOTENCY_TTL_DAYS * 86_400_000,
          ),
        },
      });

      return order;
    });

    // Diffusion AU PLUS TÔT, hors transaction : l'événement ORDER_CREATED
    // est déjà durablement en base (écrit DANS la transaction) — le kick
    // tente de le diffuser immédiatement sans jamais bloquer la réponse,
    // et le cron `outbox-drain` reste le filet. Un rejeu, lui, ne kick pas :
    // l'événement d'origine a déjà été diffusé.
    if (!isReplay && !guest) kickOutboxDrain();

    return created;
  }

  /** Le rejeu renvoie EXACTEMENT la commande d'origine, au centime. */
  private async replay(
    tx: Prisma.TransactionClient,
    idempotencyKey: string,
    userId: string,
    guest?: GuestOrderCustomer,
  ) {
    const order = await tx.order.findUnique({
      where: { idempotencyKey },
      select: { id: true, userId: true, guestPhone: true },
    });
    const belongsToCaller =
      order?.userId === userId ||
      (guest !== undefined && order?.guestPhone === guest.phone);
    if (!order || !belongsToCaller) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: 'Cette commande ne peut pas être rejouée.',
      });
    }
    return tx.order.findUniqueOrThrow({
      where: { id: order.id },
      select: orderSelect,
    });
  }

  /** Empreinte stable du couple (utilisateur, intention) : l'ordre des
   * lignes ne doit pas transformer un rejeu en conflit. */
  private fingerprint(
    userId: string,
    dto: CreateOrderDto,
    guest?: GuestOrderCustomer,
  ): string {
    const canonical = {
      // Un invité obtient un profil technique neuf à chaque tentative : son
      // identité métier est donc le téléphone, pas cet identifiant interne.
      customer: guest
        ? {
            guestName: guest.name,
            guestPhone: guest.phone,
            deliveryLocation: guest.deliveryLocation,
          }
        : { userId },
      addressId: guest ? null : dto.addressId,
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
