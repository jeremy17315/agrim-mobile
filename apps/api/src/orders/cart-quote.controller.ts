import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
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
  @Post('quote')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Recalcule un panier côté serveur (prix effectifs, poids, frais, total)',
  })
  quote(@Body() dto: CartQuoteDto) {
    return this.quotes.quote(dto);
  }
}
