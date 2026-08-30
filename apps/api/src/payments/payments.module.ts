import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CatalogSyncModule } from '../catalog-sync/catalog-sync.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment.provider';
import { CinetPayProvider } from './providers/cinetpay.provider';
import { PayDunyaProvider } from './providers/paydunya.provider';
import { SimulationPaymentProvider } from './providers/simulation.provider';

/**
 * Paiement mobile money.
 *
 * Le pilote est choisi en un seul point, par `PAYMENT_PROVIDER`. Le défaut est
 * la simulation : une installation neuve doit pouvoir jouer le parcours de
 * commande de bout en bout sans identifiant d'agrégateur.
 *
 * Un fournisseur réel sélectionné mais mal configuré n'empêche pas l'API de
 * démarrer — la vente à la livraison doit continuer de fonctionner. Il se
 * signale par un avertissement au démarrage, et `POST /payments/…/initiate`
 * répond 503 plutôt que d'ouvrir une transaction qui n'aboutira jamais.
 */
@Module({
  // La libération du stock passe par le SITE : ce module en a besoin depuis
  // qu'un paiement échoué ne recrédite plus de compteur local.
  imports: [CatalogSyncModule],
  controllers: [PaymentsController],
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
        // passerelle « non configurée », ce qui fait répondre 503 aux
        // tentatives de paiement (voir PaymentsService.initiate) et laisse
        // le paiement à la livraison fonctionner.
        const enProduction =
          (config.get<string>('NODE_ENV') ?? '') === 'production';
        const simulationAutorisee =
          (config.get<string>('PAYMENT_SIMULATION_ALLOW_PRODUCTION') ?? '') ===
          'true';

        if (enProduction && chosen === simulation && !simulationAutorisee) {
          new Logger('PaymentsModule').error(
            'PAYMENT_PROVIDER vaut « simulation » en PRODUCTION : le paiement ' +
              'en ligne est DÉSACTIVÉ (503). Renseignez un vrai fournisseur ' +
              '(cinetpay, paydunya) et ses identifiants.',
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
            `Fournisseur « ${chosen.name} » sélectionné mais identifiants incomplets : le paiement en ligne répondra 503.`,
          );
        }

        return chosen;
      },
    },
    PaymentsService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
