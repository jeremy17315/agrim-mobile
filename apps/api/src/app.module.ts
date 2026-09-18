import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AddressesModule } from './addresses/addresses.module';
import { AuthModule } from './auth/auth.module';
import { CatalogSyncModule } from './catalog-sync/catalog-sync.module';
import { CatalogModule } from './catalog/catalog.module';
import { CategoriesModule } from './categories/categories.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { validateEnv } from './config/env.validation';
import { DeliveriesModule } from './deliveries/deliveries.module';
import { HealthModule } from './health/health.module';
import { LegalModule } from './legal/legal.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { ManagementModule } from './management/management.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ProducersModule } from './producers/producers.module';
import { ReferralsModule } from './referrals/referrals.module';
import { StorageModule } from './storage/storage.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { JobsModule } from './jobs/jobs.module';
import { ReviewsModule } from './reviews/reviews.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Rate limiting global (section 40).
    // `skipIf` permet aux suites de tests fonctionnels de s'exécuter sans être
    // limitées ; le rate limiting lui-même a sa propre suite dédiée.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
      skipIf: () => process.env.THROTTLE_DISABLED === '1',
    }),
    PrismaModule,
    AuthModule,
    ProductsModule,
    ReviewsModule,
    CategoriesModule,
    // Le catalogue vient du site : cette API en tient une copie, elle ne
    // l'invente plus (voir catalog-sync.service).
    CatalogSyncModule,
    // Administration du catalogue (back-office) : écritures verrouillées
    // jusqu'à la bascule STOCK_MODE=local — voir catalog/catalog.service.
    CatalogModule,
    AddressesModule,
    OrdersModule,
    PaymentsModule,
    DeliveriesModule,
    StorageModule,
    NotificationsModule,
    AnalyticsModule,
    ManagementModule,
    ProducersModule,
    ReferralsModule,
    // Garantit qu'aucune commande ne reste en suspens : paiements abandonnés
    // réglés, stock rendu, données de rétention purgées. Sans lui, seule la
    // réouverture de l'écran par le client déclenchait ces traitements.
    ReconciliationModule,
    // Endpoints des tâches planifiées pour les Cron Jobs cPanel : le crontab
    // ne contient aucune logique, il réveille l'API (docs/refonte/07 § 4).
    JobsModule,
    HealthModule,
    LegalModule,
  ],
  providers: [
    // Ordre important : authentification, puis rôles, puis débit.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
