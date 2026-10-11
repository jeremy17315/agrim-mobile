import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Filtre global : aucune erreur technique brute ne doit atteindre le client
 * (section 42). Format de réponse unique, aligné sur apiErrorSchema.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = 'Une erreur inattendue est survenue.';
    let code = 'INTERNAL_ERROR';
    let details: Record<string, unknown> | undefined;

    if (isHttp) {
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        message = payload;
      } else if (payload && typeof payload === 'object') {
        const body = payload as Record<string, unknown>;
        const raw = body.message;
        message = Array.isArray(raw)
          ? raw.join(', ')
          : typeof raw === 'string'
            ? raw
            : exception.message;
        if (typeof body.code === 'string') code = body.code;
        // `details` est posé EXPLICITEMENT par nos services (motif d'un refus
        // de code promo, champ fautif…). Il était jusqu'ici ignoré : le client
        // recevait un code d'erreur sans la raison, donc sans moyen de
        // corriger. On le transmet tel quel, sans jamais y mettre de données
        // techniques (les services n'y placent que des valeurs métier).
        if (body.details && typeof body.details === 'object') {
          details = body.details as Record<string, unknown>;
        }
        if (Array.isArray(raw)) {
          details = { ...(details ?? {}), validation: raw };
        }
      }
      if (code === 'INTERNAL_ERROR') code = HttpStatus[status] ?? 'ERROR';
    }

    // Les 5xx sont journalisées avec la stack ; jamais renvoyée au client.
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response
      .status(status)
      .json({ statusCode: status, code, message, details });
  }
}
