/**
 * PayDunya — agrégateur alternatif (Afrique de l'Ouest).
 *
 * Sert de second fournisseur : quand CinetPay est indisponible, une bascule de
 * variable d'environnement suffit à continuer d'encaisser.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { boundedTimeout, postJson, readObject, readString } from '../http-json';
import { buildTransactionReference } from '../transaction-reference';
import {
  PaymentGatewayError,
  PaymentProvider,
  type GatewayCallback,
  type GatewayInitiation,
  type GatewayVerification,
  type PaymentIntent,
} from '../payment.provider';

const INIT_URL = 'https://app.paydunya.com/api/v1/checkout-invoice/create';
const CONFIRM_URL = 'https://app.paydunya.com/api/v1/checkout-invoice/confirm';

@Injectable()
export class PayDunyaProvider extends PaymentProvider {
  readonly name = 'paydunya';

  constructor(private readonly config: ConfigService) {
    super();
  }

  private get credentials(): Record<string, string> {
    return {
      'PAYDUNYA-MASTER-KEY':
        this.config.get<string>('PAYDUNYA_MASTER_KEY') ?? '',
      'PAYDUNYA-PRIVATE-KEY':
        this.config.get<string>('PAYDUNYA_PRIVATE_KEY') ?? '',
      'PAYDUNYA-TOKEN': this.config.get<string>('PAYDUNYA_TOKEN') ?? '',
    };
  }

  private get timeout(): number {
    return boundedTimeout(this.config.get<string>('PAYMENT_TIMEOUT_SECONDS'));
  }

  /**
   * La clé privée est requise, pas seulement la clé maître et le jeton.
   * Même leçon que CinetPay : une configuration partielle qui se déclare
   * valide encaisse sans jamais confirmer.
   */
  isConfigured(): boolean {
    const c = this.credentials;
    return Boolean(
      c['PAYDUNYA-MASTER-KEY'] &&
        c['PAYDUNYA-PRIVATE-KEY'] &&
        c['PAYDUNYA-TOKEN'],
    );
  }

  async initiate(intent: PaymentIntent): Promise<GatewayInitiation> {
    const providerReference = buildTransactionReference(intent.orderReference);
    const apiUrl = this.requirePublicUrl('PUBLIC_API_URL');
    const webUrl = this.config.get<string>('PUBLIC_WEB_URL') || apiUrl;
    const trackingUrl = `${webUrl.replace(/\/+$/, '')}/suivi?ref=${encodeURIComponent(intent.orderReference)}`;

    const response = await postJson(
      INIT_URL,
      {
        invoice: {
          total_amount: intent.amountXof,
          description: `Commande ${intent.orderReference} - Riz Boagni`,
        },
        store: { name: 'Riz Boagni' },
        custom_data: {
          reference: intent.orderReference,
          transaction: providerReference,
        },
        actions: {
          callback_url: `${apiUrl}/payments/callback/paydunya`,
          return_url: trackingUrl,
        },
      },
      this.credentials,
      this.timeout,
    );

    if (readString(response, 'response_code') === '00') {
      return {
        status: 'PENDING',
        // PayDunya identifie la transaction par son jeton de facture, pas par
        // l'identifiant que nous avons proposé : c'est le sien qu'il faut
        // conserver pour pouvoir vérifier ensuite.
        providerReference: readString(response, 'token') || providerReference,
        // L'URL de paiement est « invoice_url ». « response_text » est un
        // message, pas une URL — la confusion coûtait un parcours cassé.
        checkoutUrl: readString(response, 'invoice_url'),
        message: readString(response, 'response_text') || 'Validez le paiement.',
      };
    }

    return {
      status: 'FAILED',
      providerReference,
      checkoutUrl: '',
      message:
        readString(response, 'response_text') ||
        "Le paiement n'a pas pu être initié.",
    };
  }

  async verify(providerReference: string): Promise<GatewayVerification> {
    const response = await postJson(
      `${CONFIRM_URL}/${encodeURIComponent(providerReference)}`,
      {},
      this.credentials,
      this.timeout,
    );

    const status = readString(response, 'status').toLowerCase();
    if (status === 'completed') {
      return { status: 'PAID', message: 'Paiement confirmé.' };
    }
    if (status === 'cancelled' || status === 'failed') {
      return { status: 'FAILED', message: 'Paiement annulé.' };
    }
    return { status: 'PENDING', message: 'Paiement en cours de validation.' };
  }

  /**
   * PayDunya ne signe pas ses callbacks. Ce corps n'est donc **aucune preuve**
   * de paiement : il ne sert qu'à savoir quelle transaction regarder. La
   * confirmation vient de `verify()`, que le service appelle systématiquement.
   */
  readCallback(body: Record<string, unknown>): GatewayCallback {
    const data = Object.keys(readObject(body, 'data')).length
      ? readObject(body, 'data')
      : body;
    const custom = readObject(data, 'custom_data');
    const status = readString(data, 'status').toLowerCase();

    return {
      providerReference: readString(data, 'token'),
      orderReference: readString(custom, 'reference'),
      status:
        status === 'completed'
          ? 'PAID'
          : status === 'cancelled' || status === 'failed'
            ? 'FAILED'
            : 'PENDING',
    };
  }

  private requirePublicUrl(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new PaymentGatewayError(
        `${key} est requis pour un paiement réel (URL de notification du fournisseur).`,
      );
    }
    return value.replace(/\/+$/, '');
  }
}
