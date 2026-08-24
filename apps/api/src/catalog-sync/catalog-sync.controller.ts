import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { Roles } from '../common/decorators/roles.decorator';
import { CatalogSyncService } from './catalog-sync.service';

/**
 * Synchronisation du catalogue depuis le site.
 *
 * Réservé à ADMIN et DG : ces routes réécrivent le catalogue entier. Le
 * GESTIONNAIRE en est volontairement exclu — son travail est d'ajuster un
 * stock ou un statut, pas de rejouer un import de masse.
 *
 * La tâche de fond (voir catalog-sync.module) fait déjà le travail seule ;
 * ces routes servent à ne pas attendre, et à vérifier avant d'écrire.
 */
@ApiTags('catalog-sync')
@ApiBearerAuth()
@Roles('ADMIN', 'DG')
@Controller('catalog-sync')
export class CatalogSyncController {
  constructor(private readonly sync: CatalogSyncService) {}

  @Get('diff')
  @ApiOperation({
    summary:
      "Compare le catalogue du site et celui de l'application, sans rien écrire",
  })
  diff() {
    return this.sync.diff();
  }

  @Post()
  @ApiOperation({ summary: 'Recopie le catalogue du site dans cette base' })
  @ApiQuery({
    name: 'stock',
    required: false,
    description:
      "Recopier aussi les quantités. Faux par défaut : tant que les deux " +
      'plateformes tiennent chacune leur stock, écraser efface des ventes.',
  })
  run(@Query('stock') stock?: string) {
    return this.sync.sync({ syncStock: stock === 'true' });
  }
}
