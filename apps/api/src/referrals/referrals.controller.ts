import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { ReferralsService } from './referrals.service';

/**
 * Parrainage de l'utilisateur connecté.
 *
 * Aucune route ne prend d'identifiant en paramètre : le compte vient
 * toujours du JWT, comme pour les adresses.
 */
@ApiTags('referrals')
@ApiBearerAuth()
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Mon code de parrainage, mon crédit et mes filleuls' })
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.referrals.summary(user.id);
  }
}
