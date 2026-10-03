import { Module } from '@nestjs/common';

import { SieveController } from './controller';
import { SieveSession } from './model';
import { SieveDeviceLogin, SieveScrapeService } from './sieve.service';

/**
 * Intégration Sieve scrape.
 *
 * Le module reste inerte tant que `SIEVE_API_KEY` est absente : les endpoints
 * `/sieve/*` répondent 503 et aucun appel sortant n'est émis. `PrismaModule`
 * est global, donc `SieveSession` reçoit `PrismaService` sans import explicite.
 */
@Module({
  controllers: [SieveController],
  providers: [SieveDeviceLogin, SieveScrapeService, SieveSession],
  exports: [SieveSession, SieveScrapeService, SieveDeviceLogin],
})
export class SieveModule {}