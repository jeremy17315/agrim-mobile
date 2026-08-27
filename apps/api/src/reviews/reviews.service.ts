import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(slug: string) {
    const product = await this.findActiveProduct(slug);

    const where = { productId: product.id, user: { isActive: true } };

    const [rows, count, agg] = await Promise.all([
      this.prisma.db.productReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          user: { select: { firstName: true } },
        },
      }),
      this.prisma.db.productReview.count({ where }),
      this.prisma.db.productReview.aggregate({
        where,
        _avg: { rating: true },
      }),
    ]);

    const average =
      agg._avg.rating === null
        ? null
        : Math.round(agg._avg.rating * 10) / 10;

    return {
      average,
      count,
      data: rows.map((row) => ({
        id: row.id,
        authorFirstName: row.user.firstName,
        rating: row.rating,
        comment: row.comment,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async upsert(userId: string, slug: string, dto: CreateReviewDto) {
    const product = await this.findActiveProduct(slug);
    const comment = dto.comment.trim();

    const row = await this.prisma.db.productReview.upsert({
      where: { productId_userId: { productId: product.id, userId } },
      create: {
        productId: product.id,
        userId,
        rating: dto.rating,
        comment,
      },
      update: { rating: dto.rating, comment },
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        user: { select: { firstName: true } },
      },
    });

    return {
      id: row.id,
      authorFirstName: row.user.firstName,
      rating: row.rating,
      comment: row.comment,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async findActiveProduct(slug: string) {
    const product = await this.prisma.db.product.findFirst({
      where: { slug, isActive: true },
      select: { id: true },
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
