import { Module } from '@nestjs/common';

import { ReferralCreditService } from './referral-credit.service';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

@Module({
  controllers: [ReferralsController],
  providers: [ReferralsService, ReferralCreditService],
  // Le crédit est consommé par le tunnel de commande (devis + checkout), qui
  // vit dans un autre module : il est donc exporté.
  exports: [ReferralsService, ReferralCreditService],
})
export class ReferralsModule {}
