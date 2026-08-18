import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { PRODUCTION_STATUSES, type ProductionStatus } from '@agrim/contracts';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateFarmDto } from './dto/create-farm.dto';
import { CreateProductionDto } from './dto/create-production.dto';
import { ReviewProductionDto } from './dto/review-production.dto';
import { UpdateFarmDto } from './dto/update-farm.dto';
import { UpdateProductionDto } from './dto/update-production.dto';
import { ProducersService } from './producers.service';

/**
 * Espace producteur.
 *
 * Toutes les routes de consultation et de saisie sont réservées au rôle
 * PRODUCTEUR et résolues à partir du JWT : aucun identifiant de producteur ne
 * transite dans l'URL, donc rien à deviner pour accéder à l'exploitation d'un
 * autre. Seule la revue relève de la coopérative.
 */
@ApiTags('producers')
@ApiBearerAuth()
@Controller('producers')
export class ProducersController {
  constructor(private readonly producers: ProducersService) {}

  @Roles('PRODUCTEUR')
  @Get('me')
  @ApiOperation({ summary: 'Synthèse de mon exploitation' })
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.producers.overview(user.id);
  }

  /* ------------------------------ Parcelles ------------------------------ */

  @Roles('PRODUCTEUR')
  @Get('me/farms')
  @ApiOperation({ summary: 'Mes parcelles' })
  listFarms(@CurrentUser() user: AuthenticatedUser) {
    return this.producers.listFarms(user.id);
  }

  @Roles('PRODUCTEUR')
  @Post('me/farms')
  @ApiOperation({ summary: 'Ajouter une parcelle' })
  createFarm(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFarmDto,
  ) {
    return this.producers.createFarm(user.id, dto);
  }

  @Roles('PRODUCTEUR')
  @Put('me/farms/:id')
  @ApiOperation({ summary: 'Modifier une parcelle' })
  updateFarm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateFarmDto,
  ) {
    return this.producers.updateFarm(user.id, id, dto);
  }

  @Roles('PRODUCTEUR')
  @Delete('me/farms/:id')
  @ApiOperation({
    summary: 'Retirer une parcelle (désactivée si elle porte un historique)',
  })
  deleteFarm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.producers.deleteFarm(user.id, id);
  }

  /* ----------------------------- Productions ----------------------------- */

  @Roles('PRODUCTEUR')
  @Get('me/productions')
  @ApiOperation({ summary: 'Mes déclarations de production' })
  @ApiQuery({ name: 'farmId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: PRODUCTION_STATUSES })
  listProductions(
    @CurrentUser() user: AuthenticatedUser,
    @Query('farmId') farmId?: string,
    @Query('status') status?: ProductionStatus,
  ) {
    return this.producers.listProductions(user.id, { farmId, status });
  }

  @Roles('PRODUCTEUR')
  @Post('me/productions')
  @ApiOperation({ summary: 'Déclarer une production' })
  createProduction(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProductionDto,
  ) {
    return this.producers.createProduction(user.id, dto);
  }

  @Roles('PRODUCTEUR')
  @Put('me/productions/:id')
  @ApiOperation({ summary: 'Corriger une déclaration non examinée' })
  updateProduction(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateProductionDto,
  ) {
    return this.producers.updateProduction(user.id, id, dto);
  }

  @Roles('PRODUCTEUR')
  @Delete('me/productions/:id')
  @ApiOperation({ summary: 'Supprimer une déclaration non examinée' })
  deleteProduction(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.producers.deleteProduction(user.id, id);
  }

  /* ------------------------------- Revue --------------------------------- */

  @Roles('GESTIONNAIRE', 'ADMIN', 'DG')
  @Get('productions/review')
  @ApiOperation({ summary: 'Déclarations à examiner (coopérative)' })
  @ApiQuery({ name: 'status', required: false, enum: PRODUCTION_STATUSES })
  listReviewableProductions(@Query('status') status?: string) {
    const parsed = PRODUCTION_STATUSES.includes(status as ProductionStatus)
      ? (status as ProductionStatus)
      : undefined;

    return this.producers.listReviewableProductions({ status: parsed });
  }

  @Roles('GESTIONNAIRE', 'ADMIN', 'DG')
  @Patch('productions/:id/review')
  @ApiOperation({ summary: 'Vérifier une déclaration (coopérative)' })
  reviewProduction(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ReviewProductionDto,
  ) {
    return this.producers.reviewProduction(id, dto);
  }
}
