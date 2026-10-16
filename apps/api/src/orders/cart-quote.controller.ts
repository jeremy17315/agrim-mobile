import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  OptionalUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { CartQuoteService } from './cart-quote.service';
import { CartQuoteDto } from './dto/cart-quote.dto';

/**
 * Devis panier public — le point d'entrée des FRONTAUX (site FastAPI en
 * transition, mobile) pour afficher UN montant cohérent avec ce que la
 * commande facturera réellement.
 *
 * Public parce qu'un visiteur non connecté remplit son panier ; protégé
 * par le throttle global (le devis est gratuit en calcul mais il lit la
 * base). Le payload ne porte AUCUN montant : des identifiants, une
 * quantité, une ville — le reste est recalculé ici (SSOT).
 */
@ApiTags('cart')
@Controller('cart')
export class CartQuoteController {
  constructor(private readonly quotes: CartQuoteService) {}

  @Public()
  @Get('delivery-zones')
  @ApiOperation({
    summary: 'Zones de livraison proposées, telles que le site les publie',
  })
  deliveryZones() {
    return this.quotes.zones();
  }

  /**
   * Public, mais le jeton est lu quand il est présent : c'est ce qui permet de
   * déduire le crédit de parrainage du compte connecté SANS jamais le déduire
   * d'un numéro déclaré dans le corps de la requête.
   */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('quote')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Recalcule un panier côté serveur (prix effectifs, poids, frais, total)',
  })
  quote(
    @OptionalUser() user: AuthenticatedUser | null,
    @Body() dto: CartQuoteDto,
  ) {
    return this.quotes.quote(dto, user?.id ?? null);
  }
}
