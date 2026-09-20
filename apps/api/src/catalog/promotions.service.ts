import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { estP2002 } from '../common/prisma/prisma-erreur';

import { prisma } from '../prisma/prisma.client';
import { CatalogService, assertPromotionDates } from './catalog.service';
import type { CreatePromotionDto, UpdatePromotionDto } from './dto/promotion.dto';

/**
 * Prix promotionnels — un état DATÉ, plus une colonne figée.
 *
 * L'ancien monde portait le prix barré en colonne (`originalPrice`),
 * recalé par la synchronisation du site : un prix « promo » sans début,
 * sans fin, sans auteur. Le modèle cible (`Promotion`) est un état daté,
 * posé ici par le back-office, que le checkout lit sous verrou
 * (`checkout.service.ts`) : `prix effectif = promo active sinon prix de base`.
 *
 * ── La contrainte d'exclusivité ────────────────────────────────────────
 * UN SEUL prix actif par variante — l'index partiel unique
 * `promotion_active_par_variante` l'impose en base. La création désactive
 * donc l'active existante DANS la même transaction ; si deux créations
 * concurrentes se disputent la place, l'index tranche et la perdante est
 * renvoyée en 409 — jamais deux promos actives, jamais un prix ambigu.
 */
@Injectable()
export class PromotionsService {
  constructor(private readonly catalog: CatalogService) {}

  async create(dto: CreatePromotionDto, _actorId: string) {
    this.catalog.assertWritesAllowed();

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    assertPromotionDates(startsAt, endsAt);

    try {
      return await prisma.$transaction(async (tx) => {
        const variant = await tx.productVariant.findUnique({
          where: { id: dto.variantId },
          select: { id: true, sku: true, label: true, price: true },
        });
        if (!variant) {
          throw new NotFoundException({
            code: 'VARIANT_NOT_FOUND',
            message: 'Variante introuvable.',
          });
        }
        // Une promotion au-dessus (ou à égalité) du prix de base n'est pas
        // une promotion : la refuser plutôt que d'afficher un faux rabais.
        if (dto.priceXof >= variant.price) {
          throw new BadRequestException({
            code: 'PROMOTION_PRICE_INVALID',
            message: `Le prix promotionnel doit être inférieur au prix de base (${variant.price} F).`,
            details: { basePrice: variant.price, proposed: dto.priceXof },
          });
        }

        // La place se libère d'abord : l'index partiel n'accepte qu'une
        // active par variante.
        await tx.promotion.updateMany({
          where: { variantId: dto.variantId, isActive: true },
          data: { isActive: false },
        });

        return tx.promotion.create({
          data: {
            variantId: dto.variantId,
            priceXof: dto.priceXof,
            label: dto.label,
            startsAt,
            endsAt,
          },
          select: {
            id: true,
            variantId: true,
            priceXof: true,
            label: true,
            startsAt: true,
            endsAt: true,
            isActive: true,
          },
        });
      });
    } catch (error) {
      // Course entre deux créations : l'index partiel tranche. La perdante
      // sait qu'une autre promo vient d'être posée — à elle de relire.
      if (estP2002(error)) {
        throw new ConflictException({
          code: 'PROMOTION_ALREADY_ACTIVE',
          message: 'Une promotion active existe déjà pour cette variante (création concurrente).',
        });
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdatePromotionDto) {
    this.catalog.assertWritesAllowed();

    const promo = await prisma.promotion.findUnique({ where: { id } });
    if (!promo) {
      throw new NotFoundException({
        code: 'PROMOTION_NOT_FOUND',
        message: 'Promotion introuvable.',
      });
    }

    const endsAt = dto.endsAt ? new Date(dto.endsAt) : promo.endsAt;
    if (dto.endsAt || dto.isActive !== undefined) {
      assertPromotionDates(promo.startsAt, endsAt);
    }

    return prisma.promotion.update({
      where: { id },
      data: {
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.endsAt !== undefined ? { endsAt } : {}),
      },
      select: {
        id: true,
        variantId: true,
        priceXof: true,
        label: true,
        startsAt: true,
        endsAt: true,
        isActive: true,
      },
    });
  }

  /** Liste pour le back-office : par variante, ou actives partout. */
  async list(query: { variantId?: string; active?: boolean }) {
    const promotions = await prisma.promotion.findMany({
      where: {
        ...(query.variantId ? { variantId: query.variantId } : {}),
        ...(query.active ? { isActive: true } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        variantId: true,
        priceXof: true,
        label: true,
        startsAt: true,
        endsAt: true,
        isActive: true,
      },
    });
    return { data: promotions };
  }
}
