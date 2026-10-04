import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { GuestPaymentTokenService } from './guest-payment-token.service';

function makeService() {
  const config = {
    get: jest
      .fn()
      .mockReturnValue('une-cle-de-chiffrement-de-test-tres-longue'),
  } as unknown as ConfigService;
  return new GuestPaymentTokenService(config);
}

describe('GuestPaymentTokenService', () => {
  it('autorise uniquement la référence pour laquelle la capacité a été émise', () => {
    const service = makeService();
    const token = service.issue('AGR-2026-0042');

    expect(() => service.assertValid(token, 'AGR-2026-0042')).not.toThrow();
    expect(() => service.assertValid(token, 'AGR-2026-0043')).toThrow(
      UnauthorizedException,
    );
  });

  it('rejette toute capacité altérée', () => {
    const service = makeService();
    const token = service.issue('AGR-2026-0042');

    expect(() => service.assertValid(`${token}x`, 'AGR-2026-0042')).toThrow(
      UnauthorizedException,
    );
  });
});
