/**
 * Pilote de démonstration : aucun appel réseau.
 *
 * C'est le pilote par défaut. Il rend le parcours de paiement jouable en
 * développement, en test et en démonstration commerciale sans identifiant
 * d'agrégateur ni argent réel.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { buildTransactionReference } from '../transaction-reference';
import {
  PaymentProvider,
  type GatewayCallback,
  type GatewayInitiation,
  type GatewayVerification,
  type PaymentIntent,
} from '../payment.provider';

@Injectable()
export class SimulationPaymentProvider extends PaymentProvider {
  readonly name = 'simulation';

  /** Rien à reconfirmer : aucun argent ne circule. */
  readonly callbackIsProof = true;

  constructor(private readonly config: ConfigService) {
    super();
  }

  isConfigured(): boolean {
    return true;
  }

  /**
   * Taux d'échec simulé, entre 0 et 1. Sert à éprouver le parcours de refus,
   * qui est celui que personne ne teste jamais et qui casse en production.
   */
  private get failureRate(): number {
    const raw = Number.parseFloat(
      this.config.get<string>('PAYMENT_SIMULATION_FAILURE_RATE') ?? '0',
    );
    if (Number.isNaN(raw)) return 0;
    return Math.min(1, Math.max(0, raw));
  }

  /** Exiger une confirmation par webhook plutôt qu'un encaissement immédiat. */
  private get asynchronous(): boolean {
    return this.config.get<string>('PAYMENT_SIMULATION_ASYNC') === 'true';
  }

  initiate(intent: PaymentIntent): Promise<GatewayInitiation> {
    const providerReference = buildTransactionReference(intent.orderReference);

    if (Math.random() < this.failureRate) {
      return Promise.resolve({
        status: 'FAILED',
        providerReference,
        checkoutUrl: '',
        message: "Paiement refusé par l'opérateur (solde insuffisant).",
      });
    }

    if (this.asynchronous) {
      return Promise.resolve({
        status: 'PENDING',
        providerReference,
        checkoutUrl: '',
        message: 'Validez la demande de paiement sur votre téléphone.',
      });
    }

    const amount = intent.amountXof.toLocaleString('fr-FR').replace(/\u202F/g, ' ');
    return Promise.resolve({
      status: 'PAID',
      providerReference,
      checkoutUrl: '',
      message: `Paiement de ${amount} F confirmé.`,
    });
  }

  verify(): Promise<GatewayVerification> {
    return Promise.resolve({
      status: 'PENDING',
      message: 'Transaction en attente (simulation).',
    });
  }

  readCallback(body: Record<string, unknown>): GatewayCallback {
    const status = String(body.status ?? 'PAID').toUpperCase();
    return {
      providerReference: String(body.providerReference ?? ''),
      orderReference: String(body.orderReference ?? ''),
      status: status === 'FAILED' || status === 'PENDING' ? status : 'PAID',
    };
  }
}
