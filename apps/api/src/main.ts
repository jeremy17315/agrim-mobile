// dotenv AVANT tout import applicatif : prisma.client lit process.env au chargement.
import 'dotenv/config';
import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { resolve } from 'node:path';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);

  const port = config.getOrThrow<number>('API_PORT');
  const prefix = config.getOrThrow<string>('API_GLOBAL_PREFIX');
  const isProd = config.get<string>('NODE_ENV') === 'production';

  app.setGlobalPrefix(prefix);
  app.use(helmet({ contentSecurityPolicy: isProd }));

  // CORS ouvert en développement uniquement ; à restreindre en production.
  app.enableCors({ origin: isProd ? [] : true, credentials: true });

  // Les fichiers déposés (preuves de livraison) sont servis en statique par le
  // pilote local. Avec un stockage S3-compatible, cette ligne disparaît au
  // profit des URL du fournisseur.
  app.useStaticAssets(
    resolve(config.get<string>('STORAGE_LOCAL_ROOT') ?? 'storage'),
    {
      prefix: '/files/',
    },
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

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
