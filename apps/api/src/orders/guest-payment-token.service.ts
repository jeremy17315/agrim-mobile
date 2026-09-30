import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Capacité temporaire liée à UNE commande invitée, jamais à un compte. */
type GuestPaymentPayload = {
  purpose: 'guest-payment';
  reference: string;
  expiresAt: number;
};

/** Durée suffisamment longue pour finir une validation Mobile Money, courte
 * pour qu'un lien perdu ne devienne jamais un accès durable à la commande. */
const TOKEN_TTL_MS = 45 * 60_000;

/**
 * Autorise un invité à ouvrir / relire SON paiement sans lui donner de JWT,
 * sans compte ni mot de passe. Ce jeton est une capacité opaque signée HMAC :
 * il n'est ni un access token ni utilisable sur les routes authentifiées.
 */
@Injectable()
export class GuestPaymentTokenService {
  constructor(private readonly config: ConfigService) {}

  issue(reference: string): string {
    const payload: GuestPaymentPayload = {
      purpose: 'guest-payment',
      reference,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encoded}.${this.sign(encoded)}`;
  }

  assertValid(token: string | undefined, expectedReference: string): void {
    if (!token) throw this.invalidToken();

    const [encoded, signature, ...rest] = token.split('.');
    if (
      !encoded ||
      !signature ||
      rest.length > 0 ||
      !this.signatureMatches(encoded, signature)
    ) {
      throw this.invalidToken();
    }

    let payload: GuestPaymentPayload;
    try {
      payload = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      ) as GuestPaymentPayload;
    } catch {
      throw this.invalidToken();
    }

    if (
      payload.purpose !== 'guest-payment' ||
      payload.reference !== expectedReference ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.expiresAt <= Date.now()
    ) {
      throw this.invalidToken();
    }
  }

  private sign(value: string): string {
    const secret = this.config.get<string>('ENCRYPTION_KEY');
    if (!secret) {
      throw new ServiceUnavailableException({
        code: 'PAYMENT_UNAVAILABLE',
        message: 'Le paiement en ligne est momentanément indisponible.',
      });
    }
    return createHmac('sha256', secret).update(value).digest('base64url');
  }

  private signatureMatches(value: string, received: string): boolean {
    const expected = this.sign(value);
    const expectedBytes = Buffer.from(expected, 'base64url');
    const receivedBytes = Buffer.from(received, 'base64url');
    return (
      expectedBytes.length === receivedBytes.length &&
      timingSafeEqual(expectedBytes, receivedBytes)
    );
  }

  private invalidToken(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'GUEST_PAYMENT_ACCESS_INVALID',
      message: 'Cette session de paiement a expiré. Recommencez la commande.',
    });
  }
}
