import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('reviews')
@Controller('products')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Get(':slug/reviews')
  @ApiOperation({ summary: 'Avis publiés d’un produit' })
  list(@Param('slug') slug: string) {
    return this.reviews.list(slug);
  }

  @Post(':slug/reviews')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 8, ttl: 300_000 } })
  @ApiOperation({ summary: 'Noter un produit (étoiles + commentaire)' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviews.upsert(user.id, slug, dto);
  }
}
