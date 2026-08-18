import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../common/decorators/roles.decorator';
import { AnalyticsService } from './analytics.service';

/**
 * Direction générale.
 *
 * Réservé à DG et ADMIN — pas au gestionnaire : ces agrégats portent sur toute
 * l'entreprise, alors que l'espace gestionnaire est une file de travail.
 *
 * Lecture seule, volontairement : aucune décision opérationnelle ne se prend
 * depuis un écran d'indicateurs, sans quoi les contrôles métier des autres
 * espaces seraient contournés.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@Roles('DG', 'ADMIN')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Indicateurs consolidés de la direction' })
  executiveDashboard() {
    return this.analytics.executiveDashboard();
  }
}
