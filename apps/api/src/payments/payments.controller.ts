import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '../common/decorators/public.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';

/**
 * Paiement mobile money.
 *
 * L'identité vient du JWT pour tout ce qui touche à une commande : aucune
 * route n'accepte un userId en paramètre. Seul le callback est public — c'est
 * l'opérateur qui appelle, il n'a pas de compte chez nous.
 */
@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('provider')
  @Public()
  @ApiOperation({
    summary: 'Fournisseur de paiement actif et son état de configuration',
  })
  provider() {
    return this.payments.activeProvider();
  }

  @Post('orders/:reference/initiate')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Ouvrir une transaction pour une de mes commandes' })
  initiate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
  ) {
    return this.payments.initiate(user.id, reference);
  }

  @Get('orders/:reference')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "État du paiement, avec vérification auprès de l'opérateur",
  })
  status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
  ) {
    return this.payments.status(user.id, reference);
  }

  /**
   * Appel entrant de l'opérateur.
   *
   * `@Public` parce que l'appelant n'a pas de JWT ; l'authenticité est établie
   * par la signature du message, vérifiée dans le pilote.
   *
   * `@SkipThrottle` parce qu'un opérateur qui se fait limiter rejoue en
   * boucle, et qu'un rejeu bloqué laisse une commande payée non confirmée.
   *
   * Toujours 200 : une erreur renvoyée à l'opérateur déclenche une tempête de
   * rejeux. Les anomalies partent dans les journaux, pas dans la réponse.
   */
  @Post('callback/:provider')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @ApiOperation({ summary: "Webhook de l'agrégateur (usage interne)" })
  callback(
    @Param('provider') provider: string,
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    return this.payments.handleCallback(provider, body ?? {}, headers);
  }
}
