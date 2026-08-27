import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
    },
  },
} as const;

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
      data: data.map((p) => this.withPublicImage(p)),
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
    return this.withPublicImage(product);
  }
}
