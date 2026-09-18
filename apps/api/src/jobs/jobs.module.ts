import { Module, Provider } from '@nestjs/common';

import { CronLocksService } from '../common/cron/cron-locks.service';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { OUTBOX_HANDLERS } from './outbox.handler';

/**
 * Aucun handler d'outbox n'existe encore : le module notifications apportera
 * les siens en étendant ce tableau (et non en appelant le métier). Le token
 * est fourni ici pour que l'injection reste obligatoire et explicite.
 */
const OUTBOX_HANDLER_PROVIDERS: Provider[] = [{ provide: OUTBOX_HANDLERS, useValue: [] }];

@Module({
  imports: [ReconciliationModule],
  controllers: [JobsController],
  providers: [CronLocksService, JobsService, ...OUTBOX_HANDLER_PROVIDERS],
  exports: [JobsService, CronLocksService],
})
export class JobsModule {}
