import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { prixEffectif, promosActives } from '../common/pricing/effective-price';
import { PrismaService } from '../prisma/prisma.service';

function resolveImageUrl(
  raw: string | null | undefined,
  siteBase: string,
): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (!siteBase) return null;
  const base = siteBase.replace(/\/+$/, '');
  return value.startsWith('/') ? `${base}${value}` : `${base}/${value}`;
}

export interface ListProductsParams {
  search?: string;
  category?: string;
  featured?: boolean;
  page: number;
  limit: number;
}

/** Sélection commune : jamais de SELECT * vers le mobile. */
const productSelect = {
  id: true,
  slug: true,
  name: true,
  shortDescription: true,
  description: true,
  brand: true,
  imageUrl: true,
  isFeatured: true,
  isActive: true,
  category: { select: { id: true, slug: true, name: true } },
  variants: {
    where: { isAvailable: true },
    orderBy: { weightGrams: 'asc' },
    select: {
      id: true,
      sku: true,
      label: true,
      weightGrams: true,
      price: true,
      originalPrice: true,
      stock: true,
      isAvailable: true,
      promotions: {
        where: { isActive: true },
        select: { isActive: true, priceXof: true, label: true, startsAt: true, endsAt: true },
      },
    },
  },
} as const;

/** Projection publique d'une variante : le prix AFFICHÉ est le prix
 * FACTURÉ — même règle que le checkout (common/pricing). Sans cela, le
 * site vendrait au prix normal pendant que la commande partirait au prix
 * promotionnel. */
function projetteVariante<
  V extends {
    id: string;
    sku: string;
    label: string;
    weightGrams: number;
    price: number;
    originalPrice: number | null;
    stock: number;
    isAvailable: boolean;
    promotions: {
      isActive: boolean;
      priceXof: number;
      label: string;
      startsAt: Date;
      endsAt: Date | null;
    }[];
  },
>(variante: V) {
  // Projection EXPLICITE : le payload public est un contrat, pas un
  // reflet de la base (même esprit que « jamais de SELECT * »).
  const promo = promosActives(variante.promotions)[0] ?? null;
  return {
    id: variante.id,
    sku: variante.sku,
    label: variante.label,
    weightGrams: variante.weightGrams,
    price: variante.price,
    originalPrice: variante.originalPrice,
    stock: variante.stock,
    isAvailable: variante.isAvailable,
    effectivePrice: prixEffectif(variante.price, promo),
    promotion: promo
      ? { label: promo.label, priceXof: promo.priceXof, endsAt: promo.endsAt }
      : null,
  };
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private withPublicImage<T extends { imageUrl: string | null }>(row: T): T {
    const site = this.config.get<string>('SITE_INTEGRATION_URL') ?? '';
    return { ...row, imageUrl: resolveImageUrl(row.imageUrl, site) };
  }

  async list(params: ListProductsParams) {
    const { search, category, featured, page, limit } = params;

    const where = {
      isActive: true,
      ...(featured !== undefined ? { isFeatured: featured } : {}),
      ...(category ? { category: { slug: category } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              {
                shortDescription: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.db.product.findMany({
        where,
        select: productSelect,
        orderBy: [{ isFeatured: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.db.product.count({ where }),
    ]);

    return {
      data: data.map((p) => ({
        ...this.withPublicImage(p),
        variants: p.variants.map(projetteVariante),
      })),
      pagination: { page, limit, total },
    };
  }

  async findBySlug(slug: string) {
    const product = await this.prisma.db.product.findFirst({
      where: { slug, isActive: true },
      select: productSelect,
    });
    if (!product) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Ce produit est introuvable.',
      });
    }
    return {
      ...this.withPublicImage(product),
      variants: product.variants.map(projetteVariante),
    };
  }
}
