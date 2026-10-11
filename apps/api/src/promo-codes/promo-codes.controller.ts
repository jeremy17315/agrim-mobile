import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreatePromoCodeDto, UpdatePromoCodeDto } from './dto/promo-code.dto';
import { PromoCodesService } from './promo-codes.service';

/**
 * Administration des codes promo.
 *
 * Réservée à ADMIN et DG : un code promo est de l'argent offert. Le
 * gestionnaire, lui, exécute des opérations ; il ne fixe pas les remises.
 * Une promotion diffusée sans validation est une perte sèche, et la règle
 * « les promotions doivent être validées par AGRIM » se traduit ici par un
 * droit d'écriture restreint.
 */
@ApiTags('promo-codes')
@ApiBearerAuth()
@Roles('ADMIN', 'DG')
@Controller('promo-codes')
export class PromoCodesController {
  constructor(private readonly promos: PromoCodesService) {}

  @Get()
  @ApiOperation({ summary: 'Lister les codes promo' })
  list() {
    return this.promos.list();
  }

  @Post()
  @ApiOperation({ summary: 'Créer un code promo' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePromoCodeDto,
  ) {
    return this.promos.create(dto, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifier un code promo' })
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdatePromoCodeDto,
  ) {
    return this.promos.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Désactiver un code promo (jamais supprimé)' })
  deactivate(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.promos.deactivate(id);
  }

  @Get(':id/utilisations')
  @ApiOperation({ summary: 'Historique d’utilisation d’un code' })
  redemptions(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ) {
    return this.promos.redemptions(id, limit);
  }
}
