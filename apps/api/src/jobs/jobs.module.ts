import { Module } from '@nestjs/common';

import { CronLocksService } from '../common/cron/cron-locks.service';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { MessagingModule } from '../messaging/messaging.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  // MessagingModule fournit le dispatcher sous le jeton OUTBOX_HANDLERS :
  // le drain de `outbox-drain` le résout et diffuse sur les canaux configurés.
  imports: [ReconciliationModule, MessagingModule.register()],
  controllers: [JobsController],
  providers: [CronLocksService, JobsService],
  exports: [JobsService, CronLocksService],
})
export class JobsModule {}
