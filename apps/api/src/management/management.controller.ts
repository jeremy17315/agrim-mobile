import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseBoolPipe,
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
import { ORDER_STATUSES, type OrderStatus } from '@agrim/contracts';

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
  @ApiOperation({ summary: 'Réapprovisionner ou régler le seuil' })
  adjustStock(
    @Param('variantId', new ParseUUIDPipe({ version: '4' }))
    variantId: string,
    @Body() dto: AdjustStockDto,
  ) {
    return this.management.adjustStock(variantId, dto);
  }

  @Get('couriers')
  @ApiOperation({ summary: 'Livreurs et charge en cours' })
  listCouriers() {
    return this.management.listCouriers();
  }
}
