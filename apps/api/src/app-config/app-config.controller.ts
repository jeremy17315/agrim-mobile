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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AppConfigService } from './app-config.service';
import {
  UpdateAnnouncementDto,
  UpdateDeliveryInfoDto,
  UpdateFaqDto,
  UpdateSupportDto,
  UpsertPointOfSaleDto,
} from './dto/app-config.dto';

/**
 * Configuration commerciale — LECTURE PUBLIQUE, ÉCRITURE RESTREINTE.
 *
 * Les coordonnées et les points de vente sont publics par nature : le client
 * doit pouvoir appeler AGRIM et se rendre à la boutique sans compte. La
 * modification, en revanche, est réservée aux ADMIN et DG : changer le numéro
 * de contact ou publier une adresse engage la société.
 */
@ApiTags('config')
@Controller('config')
export class AppConfigController {
  constructor(private readonly config: AppConfigService) {}

  @Public()
  @Get('app')
  @ApiOperation({
    summary: 'Coordonnées, points de vente, livraison et FAQ publiés par AGRIM',
  })
  appConfig() {
    return this.config.publicConfig();
  }
}

/** Administration de la même configuration. */
@ApiTags('management')
@ApiBearerAuth()
@Roles('ADMIN', 'DG')
@Controller('management/config')
export class AppConfigAdminController {
  constructor(private readonly config: AppConfigService) {}

  @Get('points-of-sale')
  @ApiOperation({ summary: 'Points de vente (actifs et inactifs)' })
  listPointsOfSale() {
    return this.config.listPointsOfSale();
  }

  @Post('points-of-sale')
  @ApiOperation({ summary: 'Créer un point de vente (non publié par défaut)' })
  createPointOfSale(@Body() dto: UpsertPointOfSaleDto) {
    return this.config.upsertPointOfSale(dto);
  }

  @Patch('points-of-sale/:id')
  @ApiOperation({ summary: 'Modifier un point de vente' })
  updatePointOfSale(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpsertPointOfSaleDto,
  ) {
    return this.config.upsertPointOfSale(dto, id);
  }

  @Delete('points-of-sale/:id')
  @ApiOperation({ summary: 'Retirer un point de vente de la liste publique' })
  deactivatePointOfSale(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.config.deactivatePointOfSale(id);
  }

  @Put('support')
  @ApiOperation({ summary: 'Coordonnées du service client' })
  updateSupport(@Body() dto: UpdateSupportDto) {
    return this.config.updateSupport(dto);
  }

  @Put('delivery')
  @ApiOperation({ summary: 'Textes de livraison et de retrait' })
  updateDelivery(@Body() dto: UpdateDeliveryInfoDto) {
    return this.config.updateDelivery(dto);
  }

  @Put('faq')
  @ApiOperation({ summary: 'Questions fréquentes' })
  updateFaq(@Body() dto: UpdateFaqDto) {
    return this.config.updateFaq(dto.entries);
  }

  @Put('announcement')
  @ApiOperation({ summary: 'Annonce affichée en haut du catalogue' })
  updateAnnouncement(@Body() dto: UpdateAnnouncementDto) {
    return this.config.updateAnnouncement(dto.message ?? null);
  }
}
