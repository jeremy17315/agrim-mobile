import { Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';

import { REFERRAL_CODE_LENGTH } from '@agrim/contracts';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Charset volontairement privé des caractères ambigus à l'oral/à l'écrit
 * (0/O, 1/I) : un code de parrainage se dicte et se recopie à la main.
 */
const REFERRAL_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Génère un code aléatoire ; l'unicité est garantie par l'appelant (retry sur conflit). */
export function generateReferralCode(): string {
  let code = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    code += REFERRAL_CODE_CHARSET[randomInt(REFERRAL_CODE_CHARSET.length)];
  }
  return code;
}

@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(userId: string) {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: {
        referralCode: true,
        creditBalanceXof: true,
        _count: { select: { referrals: true } },
      },
    });
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'Compte introuvable.',
      });
    }
    return {
      code: user.referralCode,
      creditBalanceXof: user.creditBalanceXof,
      referralsCount: user._count.referrals,
    };
  }
}
