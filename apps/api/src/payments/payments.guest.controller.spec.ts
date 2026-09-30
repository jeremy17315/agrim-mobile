import { UnauthorizedException } from '@nestjs/common';

import type { GuestPaymentTokenService } from '../orders/guest-payment-token.service';
import { PaymentsController } from './payments.controller';
import type { PaymentsService } from './payments.service';

describe('PaymentsController — paiement invité', () => {
  function makeHarness() {
    const payments = {
      initiateGuest: jest.fn().mockResolvedValue({
        reference: 'AGR-2026-0042',
        status: 'PENDING',
      }),
      statusGuest: jest.fn().mockResolvedValue({
        reference: 'AGR-2026-0042',
        status: 'AWAITING_CONFIRMATION',
      }),
    } as unknown as PaymentsService;
    const guestTokens = {
      assertValid: jest.fn(),
    } as unknown as GuestPaymentTokenService;

    return {
      controller: new PaymentsController(payments, guestTokens),
      payments,
      guestTokens,
    };
  }

  it('vérifie la capacité liée à la référence avant toute initiation', async () => {
    const { controller, payments, guestTokens } = makeHarness();

    await expect(
      controller.initiateGuest('AGR-2026-0042', 'capabilite-valide'),
    ).resolves.toMatchObject({ status: 'PENDING' });

    expect(guestTokens.assertValid).toHaveBeenCalledWith(
      'capabilite-valide',
      'AGR-2026-0042',
    );
    expect(payments.initiateGuest).toHaveBeenCalledWith('AGR-2026-0042');
  });

  it('ne consulte jamais une commande quand la capacité est invalide', () => {
    const { controller, payments, guestTokens } = makeHarness();
    (guestTokens.assertValid as jest.Mock).mockImplementation(() => {
      throw new UnauthorizedException();
    });

    expect(() => controller.guestStatus('AGR-2026-0042', undefined)).toThrow(
      UnauthorizedException,
    );
    expect(payments.statusGuest).not.toHaveBeenCalled();
  });
});
