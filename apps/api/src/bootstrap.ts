import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

/**
 * Configuration commune de l'application HTTP.
 *
 * Elle vit ici, et non dans `main.ts`, pour une raison précise : les tests
 * d'intégration créent l'application eux-mêmes. Tant que ces réglages
 * n'existaient que dans `main.ts`, ils n'étaient jamais exercés — une suite
 * avait même divergé (validation sans `forbidNonWhitelisted`), donnant
 * l'illusion de tester la configuration réelle.
 *
 * Toute règle de sécurité globale doit être ajoutée ici, jamais dans `main.ts`.
 */
export function configureApp(
  app: INestApplication,
  options: { isProd: boolean },
): void {
  const express = app as NestExpressApplication;

  // En-têtes de sécurité. La CSP n'est active qu'en production : en
  // développement, elle bloquerait Swagger.
  express.use(helmet({ contentSecurityPolicy: options.isProd }));

  // Ne pas annoncer la pile technique à un attaquant.
  express.getHttpAdapter().getInstance().disable('x-powered-by');

  app.useGlobalPipes(
    new ValidationPipe({
      // Retire les champs non déclarés…
      whitelist: true,
      // …et refuse la requête plutôt que de les ignorer en silence : une
      // tentative d'écrire un champ interdit doit être visible, pas absorbée.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
}
