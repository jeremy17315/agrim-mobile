// dotenv AVANT tout import applicatif : prisma.client lit process.env au chargement.
import 'dotenv/config';
import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);

  const port = config.getOrThrow<number>('API_PORT');
  const prefix = config.getOrThrow<string>('API_GLOBAL_PREFIX');
  const isProd = config.get<string>('NODE_ENV') === 'production';

  app.setGlobalPrefix(prefix);

  // Réglages partagés avec les tests d'intégration : voir `bootstrap.ts`.
  configureApp(app, { isProd });

  // CORS. L'application mobile n'est pas un navigateur : elle n'envoie pas
  // d'Origin et n'est donc pas concernée. La liste ne sert qu'à un éventuel
  // client web (back-office). Vide en production = aucun navigateur autorisé,
  // ce qui est le bon défaut tant qu'aucun front web n'existe.
  const corsOrigins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: isProd ? corsOrigins : true,
    // Pas de cookie de session : l'authentification passe par un en-tête
    // Bearer. Autoriser les credentials élargirait la surface sans usage.
    credentials: false,
  });

  // Les preuves de livraison NE SONT PAS servies en statique : une signature
  // manuscrite est une donnée personnelle. La lecture passe par
  // Plus aucun fichier n'est déposé par les utilisateurs depuis le passage à la
  // validation par OTP : le module de stockage n'expose plus de route HTTP.

  // Swagger désactivé en production : ne pas exposer la surface d'API.
  if (!isProd) {
    const swagger = new DocumentBuilder()
      .setTitle('AGRIM-Mobile API')
      .setDescription(
        'API REST AGRIM — RIZ BOAGNI. Montants en XOF (entiers, sans décimales).',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      `${prefix}/docs`,
      app,
      SwaggerModule.createDocument(app, swagger),
    );
  }

  // 0.0.0.0 : joignable depuis un appareil physique / la preview.
  await app.listen(port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`AGRIM API → http://0.0.0.0:${port}/${prefix}`);
  if (!isProd) logger.log(`Swagger  → http://0.0.0.0:${port}/${prefix}/docs`);
}

void bootstrap();
