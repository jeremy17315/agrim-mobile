import { createHash, timingSafeEqual } from 'node:crypto';

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Authentifie un appel de Cron cPanel : en-tête `X-Cron-Secret`.
 *
 * Fail-closed : sans `CRON_SECRET` configuré, TOUT job est refusé (503) —
 * un endpoint de jobs ouvert par oubli de configuration est un endpoint
 * d'administration anonyme, inacceptable.
 *
 * La comparaison passe par des empreintes SHA-256 et `timingSafeEqual` :
 * comparer directement des secrets de longueurs différentes fuit leur
 * longueur au système de mesure du temps (même règle que le jeton de
 * synchronisation de l'ancienne architecture).
 */
@Injectable()
export class CronSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('CRON_SECRET') ?? '';
    if (!expected) {
      throw new ServiceUnavailableException({
        code: 'JOBS_DISABLED',
        message:
          'Les tâches planifiées sont désactivées : CRON_SECRET est absent.',
      });
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = String(request.headers['x-cron-secret'] ?? '');

    const expectedHash = createHash('sha256').update(expected).digest();
    const providedHash = createHash('sha256').update(provided).digest();
    if (timingSafeEqual(expectedHash, providedHash)) return true;

    throw new UnauthorizedException({
      code: 'CRON_UNAUTHORIZED',
      message: 'Secret de cron invalide.',
    });
  }
}
