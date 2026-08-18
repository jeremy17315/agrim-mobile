import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { ProductsService } from './products.service';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Lister le catalogue (recherche, filtres, pagination)',
  })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'featured', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  list(
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query(
      'featured',
      new DefaultValuePipe(undefined),
      new ParseBoolPipe({ optional: true }),
    )
    featured?: boolean,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.products.list({
      search,
      category,
      featured,
      page,
      limit: Math.min(limit, 100),
    });
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Fiche produit' })
  findOne(@Param('slug') slug: string) {
    return this.products.findBySlug(slug);
  }
}
