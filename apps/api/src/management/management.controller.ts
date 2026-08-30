import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  ORDER_STATUSES,
  STOCK_MOVEMENT_TYPES,
  type OrderStatus,
  type StockMovementType,
} from '@agrim/contracts';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { ManagementService } from './management.service';

/**
 * Back-office opérationnel.
 *
 * Réservé à GESTIONNAIRE, ADMIN et DG. Contrairement aux espaces client,
 * livreur ou producteur, ces routes voient toutes les commandes : c'est le
 * rôle qui borne l'accès, pas l'appartenance des données.
 */
@ApiTags('management')
@ApiBearerAuth()
@Roles('GESTIONNAIRE', 'ADMIN', 'DG')
@Controller('management')
export class ManagementController {
  constructor(private readonly management: ManagementService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Indicateurs du jour' })
  dashboard() {
    return this.management.dashboard();
  }

  @Get('orders')
  @ApiOperation({ summary: 'File de préparation' })
  @ApiQuery({ name: 'status', required: false, enum: ORDER_STATUSES })
  @ApiQuery({ name: 'search', required: false, type: String })
  listOrders(
    @Query('status') status?: OrderStatus,
    @Query('search') search?: string,
  ) {
    return this.management.listOrders({ status, search });
  }

  @Get('orders/:reference')
  @ApiOperation({ summary: 'Détail complet d’une commande' })
  getOrder(@Param('reference') reference: string) {
    return this.management.getOrder(reference);
  }

  @Patch('orders/:reference/status')
  @ApiOperation({ summary: 'Faire avancer une commande' })
  updateOrderStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.management.updateOrderStatus(user.id, reference, dto);
  }

  @Get('stock')
  @ApiOperation({ summary: 'Stocks par variante' })
  @ApiQuery({ name: 'onlyAlerts', required: false, type: Boolean })
  listStock(
    @Query('onlyAlerts', new DefaultValuePipe(false), ParseBoolPipe)
    onlyAlerts = false,
  ) {
    return this.management.listStock(onlyAlerts);
  }

  @Patch('stock/:variantId')
  @ApiOperation({ summary: 'Réapprovisionner, corriger ou régler le seuil' })
  adjustStock(
    @Param('variantId', new ParseUUIDPipe({ version: '4' }))
    variantId: string,
    @Body() dto: AdjustStockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // L'auteur vient du jeton, jamais du corps de la requête : c'est ce qui
    // rend le journal opposable.
    return this.management.adjustStock(variantId, dto, user.id);
  }

  @Get('stock/:variantId/movements')
  @ApiOperation({ summary: 'Historique des mouvements d’une variante' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'type', required: false, enum: STOCK_MOVEMENT_TYPES })
  listStockMovements(
    @Param('variantId', new ParseUUIDPipe({ version: '4' }))
    variantId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('type') type?: StockMovementType,
  ) {
    return this.management.listStockMovements(
      variantId,
      Math.max(1, page),
      // Borné : une page de mille lignes ne sert personne et charge la base.
      Math.min(100, Math.max(1, limit)),
      { type: STOCK_MOVEMENT_TYPES.includes(type!) ? type : undefined },
    );
  }

  @Get('couriers')
  @ApiOperation({ summary: 'Livreurs et charge en cours' })
  listCouriers() {
    return this.management.listCouriers();
  }
}
