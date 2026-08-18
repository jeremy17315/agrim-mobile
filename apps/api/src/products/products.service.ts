import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

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
      stock: true,
      isAvailable: true,
    },
  },
} as const;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

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

    return { data, pagination: { page, limit, total } };
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
    return product;
  }
}
