import { createHash, timingSafeEqual } from 'node:crypto';

import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { CatalogSyncService } from './catalog-sync.service';

/**
 * Déclenchement immédiat de la synchronisation, appelé PAR LE SITE.
 *
 * Le site appelle cette route dès qu'AGRIM enregistre un produit, un prix ou
 * une photo. L'API répond tout de suite (202) et recopie en arrière-plan ;
 * le cron de 5 min reste le filet de rattrapage.
 *
 * Authentification : en-tête `X-Integration-Token`, qui doit valoir
 * `SITE_INTEGRATION_TOKEN` (le même jeton que les autres appels d'intégration).
 * Fail-closed : sans jeton configuré, la route répond 503 et ne fait rien.
 */
@ApiTags('integration')
@Controller('integration')
export class IntegrationController {
  private readonly logger = new Logger(IntegrationController.name);

  constructor(
    private readonly sync: CatalogSyncService,
    private readonly config: ConfigService,
  ) {}

  @Post('catalogue-changed')
  @Public()
  @HttpCode(202)
  @ApiOperation({
    summary: 'Le site signale un changement de catalogue : synchronisation immédiate',
  })
  changed(@Headers('x-integration-token') provided?: string): { accepted: true } {
    const expected = this.config.get<string>('SITE_INTEGRATION_TOKEN') ?? '';
    if (!expected) {
      throw new ServiceUnavailableException({
        code: 'INTEGRATION_DISABLED',
        message: "Le jeton d'intégration n'est pas configuré.",
      });
    }
    if (!sameSecret(expected, provided ?? '')) {
      throw new UnauthorizedException({
        code: 'INTEGRATION_UNAUTHORIZED',
        message: "Jeton d'intégration invalide.",
      });
    }

    // Sans attendre : le site ne doit pas patienter pendant la recopie.
    this.sync.sync().catch((erreur: Error) =>
      this.logger.error(`Synchronisation immédiate en échec : ${erreur.message}`),
    );
    return { accepted: true };
  }
}

/** Comparaison à temps constant de deux secrets (empreintes SHA-256). */
function sameSecret(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
