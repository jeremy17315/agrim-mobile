import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CatalogService } from './catalog.service';
import {
  CreateCategoryDto,
  CreateProductDto,
  CreateVariantDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './dto/catalog.dto';
import { CreatePromotionDto, UpdatePromotionDto } from './dto/promotion.dto';
import { PromotionsService } from './promotions.service';

/**
 * Administration du catalogue — back-office uniquement.
 *
 * Le public lit ailleurs (`/products`, `/categories`, modules existants) ;
 * ICI on écrit, et seuls les rôles de gestion le font — vérifiés côté
 * serveur par le `RolesGuard`, jamais par l'interface. Toute écriture est
 * verrouillée jusqu'à la bascule (`CatalogService.assertWritesAllowed`) :
 * tant que le site possède le catalogue, ces routes répondent 503 au lieu
 * de faire croire à une modification qui serait écrasée par la synchro.
 */
@ApiTags('catalog')
@ApiBearerAuth()
@Roles('GESTIONNAIRE', 'ADMIN', 'DG')
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly promotions: PromotionsService,
  ) {}

  // ── Catégories ─────────────────────────────────────────────────────

  @Post('categories')
  @ApiOperation({ summary: 'Créer une catégorie (gamme)' })
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(dto);
  }

  @Patch('categories/:id')
  @ApiOperation({ summary: 'Modifier une catégorie' })
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.catalog.updateCategory(id, dto);
  }

  // ── Produits & variantes ───────────────────────────────────────────

  @Post('products')
  @ApiOperation({ summary: 'Créer un produit et ses variantes (formats)' })
  createProduct(@Body() dto: CreateProductDto) {
    return this.catalog.createProduct(dto);
  }

  @Patch('products/:id')
  @ApiOperation({ summary: 'Modifier un produit (désactiver retire tout le rayon)' })
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.catalog.updateProduct(id, dto);
  }

  @Delete('products/:id')
  @ApiOperation({ summary: 'Retirer un produit du rayon (jamais physique)' })
  deleteProduct(@Param('id') id: string) {
    return this.catalog.deleteProduct(id);
  }

  @Post('products/:id/variants')
  @ApiOperation({ summary: 'Ajouter un format (variante) à un produit' })
  createVariant(@Param('id') id: string, @Body() dto: CreateVariantDto) {
    return this.catalog.createVariant(id, dto);
  }

  @Patch('variants/:id')
  @ApiOperation({ summary: 'Modifier une variante (prix de base, poids, seuil…)' })
  updateVariant(@Param('id') id: string, @Body() dto: UpdateVariantDto) {
    return this.catalog.updateVariant(id, dto);
  }

  @Get('variants/:id')
  @ApiOperation({ summary: 'État complet d’une variante (stock, prix effectif, promo)' })
  variantDetail(@Param('id') id: string) {
    return this.catalog.variantDetail(id);
  }

  // ── Promotions ─────────────────────────────────────────────────────

  @Post('promotions')
  @ApiOperation({ summary: 'Poser un prix promotionnel (remplace l’active de la variante)' })
  createPromotion(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePromotionDto,
  ) {
    return this.promotions.create(dto, user.id);
  }

  @Patch('promotions/:id')
  @ApiOperation({ summary: 'Désactiver une promotion ou modifier sa fin' })
  updatePromotion(@Param('id') id: string, @Body() dto: UpdatePromotionDto) {
    return this.promotions.update(id, dto);
  }

  @Get('promotions')
  @ApiOperation({ summary: 'Lister les promotions (par variante, ou actives)' })
  @ApiQuery({ name: 'variantId', required: false })
  @ApiQuery({ name: 'active', required: false })
  listPromotions(
    @Query('variantId') variantId?: string,
    @Query('active') active?: string,
  ) {
    return this.promotions.list({
      variantId: variantId || undefined,
      active: active === 'true',
    });
  }
}
