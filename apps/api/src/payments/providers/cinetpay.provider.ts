/**
 * CinetPay — agrégateur Wave / Orange / MTN / Moov (Côte d'Ivoire).
 *
 * Portage fidèle de `paiement.py` du site web, corrections de production
 * comprises. Les commentaires « Leçon » signalent un bug réel déjà payé.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

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

const INIT_URL = 'https://api-checkout.cinetpay.com/v2/payment';
const CHECK_URL = 'https://api-checkout.cinetpay.com/v2/payment/check';

/** Correspondance entre nos opérateurs et les canaux CinetPay. */
const CHANNELS: Record<string, string> = {
  WAVE: 'WALLET',
  ORANGE_MONEY: 'MOBILE_MONEY',
  MTN_MOMO: 'MOBILE_MONEY',
  MOOV_MONEY: 'MOBILE_MONEY',
};

/**
 * Champs signés par CinetPay, dans cet ordre exact. L'ordre fait partie du
 * protocole : une permutation invalide toutes les signatures.
 */
const SIGNED_FIELDS = [
  'cpm_site_id',
  'cpm_trans_id',
  'cpm_trans_date',
  'cpm_amount',
  'cpm_currency',
  'signature',
  'payment_method',
  'cel_phone_num',
  'cpm_phone_prefixe',
  'cpm_language',
  'cpm_version',
  'cpm_payment_config',
  'cpm_page_action',
  'cpm_custom',
  'cpm_designation',
  'cpm_error_message',
] as const;

@Injectable()
export class CinetPayProvider extends PaymentProvider {
  readonly name = 'cinetpay';

  constructor(private readonly config: ConfigService) {
    super();
  }

  private get apiKey(): string {
    return this.config.get<string>('CINETPAY_API_KEY') ?? '';
  }

  private get siteId(): string {
    return this.config.get<string>('CINETPAY_SITE_ID') ?? '';
  }

  private get secret(): string {
    return this.config.get<string>('CINETPAY_SECRET') ?? '';
  }

  private get timeout(): number {
    return boundedTimeout(this.config.get<string>('PAYMENT_TIMEOUT_SECONDS'));
  }

  /**
   * Le secret est requis au même titre que la clé et l'identifiant de site.
   *
   * Leçon : sans lui, la configuration passait pour valide mais la
   * vérification de signature rejetait 100 % des callbacks. Les clients
   * payaient, les commandes restaient « en attente » pour toujours.
   */
  isConfigured(): boolean {
    return Boolean(this.apiKey && this.siteId && this.secret);
  }

  async initiate(intent: PaymentIntent): Promise<GatewayInitiation> {
    const providerReference = buildTransactionReference(intent.orderReference);
    const apiUrl = this.requirePublicUrl('PUBLIC_API_URL');
    const webUrl = this.config.get<string>('PUBLIC_WEB_URL') || apiUrl;
    const trackingUrl = `${webUrl.replace(/\/+$/, '')}/suivi?ref=${encodeURIComponent(intent.orderReference)}`;

    const response = await postJson(
      INIT_URL,
      {
        apikey: this.apiKey,
        site_id: this.siteId,
        transaction_id: providerReference,
        amount: intent.amountXof,
        currency: 'XOF',
        description: `Commande ${intent.orderReference} - Riz Boagni`,
        customer_name: intent.customerName || 'Client',
        customer_phone_number: intent.customerPhone,
        channels: intent.provider ? (CHANNELS[intent.provider] ?? 'ALL') : 'ALL',
        notify_url: `${apiUrl}/payments/callback/cinetpay`,
        return_url: trackingUrl,
        metadata: intent.orderReference,
      },
      {},
      this.timeout,
    );

    if (readString(response, 'code') === '201') {
      return {
        status: 'PENDING',
        providerReference,
        checkoutUrl: readString(readObject(response, 'data'), 'payment_url'),
        message: 'Validez la demande de paiement sur votre téléphone.',
      };
    }

    return {
      status: 'FAILED',
      providerReference,
      checkoutUrl: '',
      message:
        readString(response, 'description') ||
        "Le paiement n'a pas pu être initié.",
    };
  }

  async verify(providerReference: string): Promise<GatewayVerification> {
    const response = await postJson(
      CHECK_URL,
      {
        apikey: this.apiKey,
        site_id: this.siteId,
        transaction_id: providerReference,
      },
      {},
      this.timeout,
    );

    const code = readString(response, 'code');
    const operatorStatus = readString(readObject(response, 'data'), 'status');

    if (code === '00' && operatorStatus === 'ACCEPTED') {
      return { status: 'PAID', message: 'Paiement confirmé.' };
    }
    if (['REFUSED', 'CANCELED', 'EXPIRED'].includes(operatorStatus)) {
      return {
        status: 'FAILED',
        message: `Paiement ${operatorStatus.toLowerCase()}.`,
      };
    }
    return { status: 'PENDING', message: 'Paiement en cours de validation.' };
  }

  readCallback(
    body: Record<string, unknown>,
    headers: Record<string, string | undefined>,
  ): GatewayCallback {
    if (!this.signatureIsValid(body, headers)) {
      throw new PaymentGatewayError('Signature du callback invalide.');
    }

    const result = (
      readString(body, 'cpm_result') || readString(body, 'cpm_error_message')
    ).toUpperCase();

    let status: GatewayCallback['status'];
    if (['00', 'SUCCES', 'SUCCESS'].includes(result)) {
      status = 'PAID';
    } else if (result) {
      // Un échec explicite : la commande doit être annulée et le stock rendu,
      // pas laissée en attente indéfiniment.
      status = 'FAILED';
    } else {
      status = 'PENDING';
    }

    return {
      providerReference: readString(body, 'cpm_trans_id'),
      orderReference: readString(body, 'metadata'),
      status,
    };
  }

  /**
   * Contrôle du jeton HMAC-SHA256. Le jeton arrive dans l'en-tête `x-token`
   * ou dans le champ `signature` du corps, selon la configuration du marchand.
   */
  private signatureIsValid(
    body: Record<string, unknown>,
    headers: Record<string, string | undefined>,
  ): boolean {
    if (!this.secret) {
      // Sans secret, la vérification est impossible : on REFUSE. Mieux vaut
      // une commande bloquée qu'un faux paiement accepté.
      return false;
    }

    const received =
      headers['x-token'] ?? headers['X-Token'] ?? readString(body, 'signature');
    if (!received) return false;

    const payload = SIGNED_FIELDS.map((field) =>
      readString(body, field),
    ).join('');
    const expected = createHmac('sha256', this.secret)
      .update(payload)
      .digest('hex');

    // `timingSafeEqual` exige des tampons de même longueur : comparer la
    // taille d'abord évite l'exception, et un jeton de longueur différente
    // est de toute façon invalide.
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(received, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Leçon : un repli sur `http://127.0.0.1` envoyait les URL de notification
   * vers la machine locale en production. Le webhook ne revenait jamais et
   * chaque paiement restait « en attente » pour toujours. Un paiement réel
   * sans URL publique est désormais refusé.
   */
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
