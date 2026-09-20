import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { CronSecretGuard } from '../common/guards/cron-secret.guard';
import { JobSummary, JobsService } from './jobs.service';

/**
 * Endpoints des tâches planifiées — appelés par les Cron Jobs cPanel.
 *
 * `@Public` parce que curl n'a pas de JWT ; l'authentification passe par le
 * garde `CronSecretGuard` (en-tête `X-Cron-Secret`, fail-closed). La route
 * de liste est volontairement inoffensive : des noms de jobs ne révèlent
 * rien, et l'exploitation y gagne un moyen simple de vérifier ce qui est
 * câblé sur un hébergement.
 */
@ApiTags('jobs')
@ApiSecurity('cron-secret')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  /** Introspection : les jobs câblés sur cet environnement. */
  @Get()
  @Public()
  @ApiOperation({ summary: 'Liste des tâches planifiées disponibles' })
  list(): { jobs: string[] } {
    return { jobs: this.jobs.list() };
  }

  /**
   * Exécute une tâche sous verrou. Réponses :
   *  - `200` : le job a tourné ;
   *  - `409 JOB_ALREADY_RUNNING` : un verrou actif existe — normal ;
   *  - `404 JOB_NOT_FOUND` : nom inconnu du registre ;
   *  - `401/503` : secret absent ou invalide (garde fail-closed).
   */
  @Post('run/:job')
  @Public()
  @UseGuards(CronSecretGuard)
  @ApiOperation({ summary: 'Exécute une tâche planifiée (usage cPanel)' })
  async run(@Param('job') job: string): Promise<JobSummary> {
    return this.jobs.run(job);
  }
}
