import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

import { currentStockMode } from '../config/stock-mode';
import { prisma } from '../prisma/prisma.client';
import type {
  CreateCategoryDto,
  CreateProductDto,
  CreateVariantDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './dto/catalog.dto';

/**
 * Administration du catalogue — l'API devient PROPRIÉTAIRE (fin de la copie).
 *
 * ── Le verrou de bascule ───────────────────────────────────────────────
 * Tant que `STOCK_MODE=site` (transition), le site est propriétaire du
 * catalogue : sa synchronisation (`catalog-sync`) réécrit prix, stocks et
 * disponibilités toutes les 15 minutes. Écrire ici maintenant produirait
 * des modifications silencieusement écrasées — la pire divergence qui soit,
 * celle qu'on ne voit pas.
 *
 * Chaque écriture exige donc le mode `local` (post-bascule, phase 4 de la
 * migration — docs/refonte/08). Avant : 503 `CATALOG_WRITES_ON_SITE`,
 * explicite, jamais une écriture perdue. À la bascule, couper AUSSI la
 * synchronisation (`SITE_INTEGRATION_URL` vide) — une sync qui tournerait
 * encore se battrrait avec ces écritures.
 *
 * ── Règles de suppression ──────────────────────────────────────────────
 * Jamais physique : des commandes référencent produits et variantes, leurs
 * lignes figées suffisent à l'historique mais les clés doivent continuer de
 * résoudre. « Retirer du rayon » = `isActive`/`isAvailable` à faux.
 */
@Injectable()
export class CatalogService {
  /**
   * Verrou de bascule — partagé par toutes les écritures du module.
   * (La lecture reste libre : elle sert, même avant la bascule.)
   */
  assertWritesAllowed(): void {
    if (currentStockMode() !== 'local') {
      throw new ServiceUnavailableException({
        code: 'CATALOG_WRITES_ON_SITE',
        message:
          'Le catalogue est encore géré côté site (STOCK_MODE=site). Les écritures ici seraient écrasées par la synchronisation — elles ouvrent à la bascule (docs/refonte/08, phase 4).',
      });
    }
  }

  /** Traduit les violations d'unicité en erreurs métier lisibles. */
  private mapUniqueness(error: unknown, code: string, message: string): never | void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException({ code, message });
    }
  }

  // ── Catégories ─────────────────────────────────────────────────────

  async createCategory(dto: CreateCategoryDto) {
    this.assertWritesAllowed();
    try {
      return await prisma.category.create({
        data: {
          slug: dto.slug,
          name: dto.name,
          description: dto.description ?? null,
          imageUrl: dto.imageUrl ?? null,
          sortOrder: dto.sortOrder ?? 0,
        },
        select: { id: true, slug: true, name: true, sortOrder: true },
      });
    } catch (error) {
      this.mapUniqueness(
        error,
        'CATALOG_SLUG_CONFLICT',
        'Une catégorie utilise déjà ce slug.',
      );
      throw error;
    }
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    this.assertWritesAllowed();
    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException({
        code: 'CATEGORY_NOT_FOUND',
        message: 'Catégorie introuvable.',
      });
    }
    return prisma.category.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
      select: { id: true, slug: true, name: true, sortOrder: true },
    });
  }

  // ── Produits & variantes ───────────────────────────────────────────

  async createProduct(dto: CreateProductDto) {
    this.assertWritesAllowed();
    try {
      return await prisma.$transaction(async (tx) => {
        const category = await tx.category.findUnique({
          where: { id: dto.categoryId },
          select: { id: true },
        });
        if (!category) {
          throw new NotFoundException({
            code: 'CATEGORY_NOT_FOUND',
            message: 'La catégorie cible est introuvable.',
          });
        }
        return tx.product.create({
          data: {
            categoryId: dto.categoryId,
            slug: dto.slug,
            name: dto.name,
            shortDescription: dto.shortDescription ?? null,
            description: dto.description ?? null,
            imageUrl: dto.imageUrl ?? null,
            isFeatured: dto.isFeatured ?? false,
            variants: {
              create: dto.variants.map((v) => ({
                sku: v.sku,
                label: v.label,
                weightGrams: v.weightGrams,
                price: v.price,
                stock: v.stock ?? 0,
                lowStockThreshold: v.lowStockThreshold ?? 20,
                isAvailable: v.isAvailable ?? true,
              })),
            },
          },
          select: {
            id: true,
            slug: true,
            name: true,
            variants: { select: { id: true, sku: true, label: true, price: true } },
          },
        });
      });
    } catch (error) {
      this.mapUniqueness(
        error,
        'CATALOG_REFERENCE_CONFLICT',
        'Un produit ou une variante utilise déjà ce slug ou ce SKU.',
      );
      throw error;
    }
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    this.assertWritesAllowed();
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Produit introuvable.',
      });
    }

    // Désactiver un produit le retire TOUT entier du rayon : les variantes
    // cessent d'être vendables avec lui. La réactivation, elle, est
    // délibérément sans effet sur les variantes — on ne remet pas en vente
    // en bloc ce qu'on avait retiré : c'est un geste explicite, variante par
    // variante.
    const deactivateVariants = dto.isActive === false && product.isActive;

    return prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.shortDescription !== undefined
            ? { shortDescription: dto.shortDescription }
            : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
          ...(dto.isFeatured !== undefined ? { isFeatured: dto.isFeatured } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        select: { id: true, slug: true, name: true, isActive: true },
      });
      if (deactivateVariants) {
        await tx.productVariant.updateMany({
          where: { productId: id },
          data: { isAvailable: false },
        });
      }
      return updated;
    });
  }

  /** « Suppression » = retrait du rayon (jamais physique — voir l'en-tête). */
  async deleteProduct(id: string) {
    this.assertWritesAllowed();
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Produit introuvable.',
      });
    }
    return prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: { isActive: false },
      });
      await tx.productVariant.updateMany({
        where: { productId: id },
        data: { isAvailable: false },
      });
      return { id, isActive: false };
    });
  }

  async createVariant(productId: string, dto: CreateVariantDto) {
    this.assertWritesAllowed();
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Produit introuvable.',
      });
    }
    try {
      return await prisma.productVariant.create({
        data: {
          productId,
          sku: dto.sku,
          label: dto.label,
          weightGrams: dto.weightGrams,
          price: dto.price,
          stock: dto.stock ?? 0,
          lowStockThreshold: dto.lowStockThreshold ?? 20,
          isAvailable: dto.isAvailable ?? true,
        },
        select: { id: true, sku: true, label: true, price: true },
      });
    } catch (error) {
      this.mapUniqueness(
        error,
        'CATALOG_REFERENCE_CONFLICT',
        'Ce SKU est déjà utilisé.',
      );
      throw error;
    }
  }

  async updateVariant(id: string, dto: UpdateVariantDto) {
    this.assertWritesAllowed();
    const variant = await prisma.productVariant.findUnique({ where: { id } });
    if (!variant) {
      throw new NotFoundException({
        code: 'VARIANT_NOT_FOUND',
        message: 'Variante introuvable.',
      });
    }
    return prisma.productVariant.update({
      where: { id },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.price !== undefined ? { price: dto.price } : {}),
        ...(dto.weightGrams !== undefined ? { weightGrams: dto.weightGrams } : {}),
        ...(dto.lowStockThreshold !== undefined
          ? { lowStockThreshold: dto.lowStockThreshold }
          : {}),
        ...(dto.isAvailable !== undefined ? { isAvailable: dto.isAvailable } : {}),
      },
      select: {
        id: true,
        sku: true,
        label: true,
        price: true,
        isAvailable: true,
      },
    });
  }

  /** État courant d'une variante pour l'écran back-office (stock, promo…). */
  async variantDetail(id: string) {
    const variant = await prisma.productVariant.findUnique({
      where: { id },
      select: {
        id: true,
        sku: true,
        label: true,
        price: true,
        stock: true,
        lowStockThreshold: true,
        isAvailable: true,
        weightGrams: true,
        product: { select: { id: true, name: true, isActive: true } },
        promotions: {
          where: { isActive: true },
          select: { id: true, priceXof: true, label: true, startsAt: true, endsAt: true },
        },
      },
    });
    if (!variant) {
      throw new NotFoundException({
        code: 'VARIANT_NOT_FOUND',
        message: 'Variante introuvable.',
      });
    }
    const promo = variant.promotions[0] ?? null;
    return {
      ...variant,
      effectivePrice: promo ? Math.min(promo.priceXof, variant.price) : variant.price,
      promotion: promo,
    };
  }
}

/** Garde-fou commun aux dates d'une promotion. */
export function assertPromotionDates(startsAt: Date, endsAt: Date | null): void {
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new BadRequestException({
      code: 'PROMOTION_DATES_INVALID',
      message: 'La fin d’une promotion doit suivre son début.',
    });
  }
}
