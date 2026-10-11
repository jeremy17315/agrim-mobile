import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CatalogSyncModule } from '../catalog-sync/catalog-sync.module';
import { OrdersModule } from '../orders/orders.module';
import { DirectPaymentsController } from './direct-payments.controller';
import { DirectPaymentsService } from './direct-payments.service';
import { PaymentAdminController } from './payment-admin.controller';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment.provider';
import { CinetPayProvider } from './providers/cinetpay.provider';
import { PayDunyaProvider } from './providers/paydunya.provider';
import { SimulationPaymentProvider } from './providers/simulation.provider';

/**
 * Paiement — DEUX régimes qui ne se mélangent pas.
 *
 * **1. Paiement direct manuel (régime en vigueur, décision du 11 octobre 2026).**
 *    Le client transfère vers le numéro officiel d'AGRIM, déclare sa
 *    transaction, un responsable vérifie puis confirme. Aucun agrégateur,
 *    donc aucune commission. C'est ce que servent `DirectPaymentsController`,
 *    `DirectPaymentsService` et `PaymentAdminController`.
 *
 * **2. Agrégateur (régime HISTORIQUE, fermé aux nouvelles commandes).**
 *    Les pilotes CinetPay / PayDunya restent branchés pour une seule raison :
 *    les commandes passées AVANT la bascule doivent pouvoir être vérifiées,
 *    rapprochées et closes. Les retirer ferait de ces paiements des dossiers
 *    orphelins — de l'argent encaissé que plus rien ne saurait expliquer.
 *
 *    La garantie qui compte est ailleurs, et elle est structurelle :
 *    `NEW_ORDER_PAYMENT_METHODS` (contrat partagé) ne contient QUE
 *    `DIRECT_MOBILE_MONEY` et `CASH_ON_DELIVERY`, et `guestOrderSchema` les
 *    refuse explicitement. Aucune commande nouvelle ne peut donc naître avec
 *    `MOBILE_MONEY` — le pilote ne sert plus qu'aux commandes anciennes, et
 *    `POST /payments/orders/:reference/initiate` refuse désormais les
 *    commandes créées après la bascule.
 */
@Module({
  // La libération du stock passe par le SITE : ce module en a besoin depuis
  // qu'un paiement échoué ne recrédite plus de compteur local.
  imports: [CatalogSyncModule, OrdersModule],
  controllers: [
    PaymentsController,
    DirectPaymentsController,
    PaymentAdminController,
  ],
  providers: [
    SimulationPaymentProvider,
    CinetPayProvider,
    PayDunyaProvider,
    {
      provide: PAYMENT_PROVIDER,
      inject: [
        ConfigService,
        SimulationPaymentProvider,
        CinetPayProvider,
        PayDunyaProvider,
      ],
      useFactory: (
        config: ConfigService,
        simulation: SimulationPaymentProvider,
        cinetpay: CinetPayProvider,
        paydunya: PayDunyaProvider,
      ): PaymentProvider => {
        const name = (
          config.get<string>('PAYMENT_PROVIDER') ?? 'simulation'
        ).toLowerCase();

        const chosen =
          { simulation, cinetpay, paydunya }[name] ??
          (() => {
            new Logger('PaymentsModule').warn(
              `Fournisseur de paiement « ${name} » inconnu : repli sur la simulation.`,
            );
            return simulation;
          })();

        // GARDE-FOU DE PRODUCTION.
        //
        // Le pilote de simulation valide les paiements sans jamais appeler
        // d'opérateur : c'est ce qu'on veut en développement, et c'est une
        // fraude ouverte en production — n'importe qui ferait passer sa
        // commande en « payée » sans débourser un franc.
        //
        // On ne refuse PAS le démarrage : couper l'API entière pour une
        // variable oubliée serait pire que le mal. On rend simplement la
        // passerelle « non configurée », ce qui laisse la vérification des
        // anciennes commandes inerte et le paiement à la livraison fonctionner.
        const enProduction =
          (config.get<string>('NODE_ENV') ?? '') === 'production';
        const simulationAutorisee =
          (config.get<string>('PAYMENT_SIMULATION_ALLOW_PRODUCTION') ?? '') ===
          'true';

        if (enProduction && chosen === simulation && !simulationAutorisee) {
          new Logger('PaymentsModule').error(
            'PAYMENT_PROVIDER vaut « simulation » en PRODUCTION : l’ancien ' +
              'paiement par agrégateur est DÉSACTIVÉ. C’est sans effet sur les ' +
              'nouvelles commandes, qui se règlent par transfert direct ' +
              '(GET /payments/methods).',
          );
          return new (class extends PaymentProvider {
            readonly name = 'simulation-refusee';
            readonly callbackIsProof = false;
            isConfigured(): boolean {
              return false;
            }
            initiate: PaymentProvider['initiate'] = () => {
              throw new Error('Paiement simulé interdit en production.');
            };
            verify: PaymentProvider['verify'] = () => {
              throw new Error('Paiement simulé interdit en production.');
            };
            readCallback: PaymentProvider['readCallback'] = () => {
              throw new Error('Paiement simulé interdit en production.');
            };
          })();
        }

        if (!chosen.isConfigured()) {
          new Logger('PaymentsModule').warn(
            `Fournisseur « ${chosen.name} » sélectionné mais identifiants incomplets : la vérification des commandes antérieures répondra 503.`,
          );
        }

        return chosen;
      },
    },
    PaymentsService,
    PaymentMethodsService,
    DirectPaymentsService,
  ],
  exports: [PaymentsService, PaymentMethodsService],
})
export class PaymentsModule {}
