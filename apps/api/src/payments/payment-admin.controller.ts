import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Header,
  Ip,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  ReviewPaymentDto,
  UpsertPaymentMethodDto,
} from './dto/direct-payment.dto';
import { DirectPaymentsService } from './direct-payments.service';
import { PaymentMethodsService } from './payment-methods.service';

/**
 * Administration du paiement direct manuel.
 *
 * Deux niveaux de droit, et ce n'est pas un détail :
 *
 *  - **Vérifier un paiement** (GESTIONNAIRE, ADMIN, DG) : constater que
 *    l'argent est arrivé et confirmer la commande. C'est un acte de caisse
 *    quotidien, tracé à chaque fois.
 *  - **Changer un numéro de réception** (ADMIN, DG) : modifier la cible des
 *    transferts. Un gestionnaire ne doit pas pouvoir détourner les encaissements
 *    vers un autre numéro.
 */
@ApiTags('management')
@ApiBearerAuth()
@Controller('management/payments')
export class PaymentAdminController {
  constructor(
    private readonly direct: DirectPaymentsService,
    private readonly methods: PaymentMethodsService,
  ) {}

  /* ────────────────── File de vérification ─────────────────────────────── */

  @Roles('GESTIONNAIRE', 'ADMIN', 'DG')
  @Get('declarations')
  @ApiOperation({
    summary: 'Déclarations de paiement à vérifier (file d’attente)',
  })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  list(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
  ) {
    return this.direct.listDeclarations({ status, search, page });
  }

  @Roles('GESTIONNAIRE', 'ADMIN', 'DG')
  @Get('declarations/:id')
  @ApiOperation({ summary: 'Dossier complet d’une déclaration' })
  detail(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.direct.declarationDetail(id);
  }

  /**
   * Justificatif déposé par le client.
   *
   * `private, no-store` : une capture d'écran de transfert porte un numéro de
   * téléphone et une référence. Elle ne doit ni être mise en cache par un
   * intermédiaire, ni survivre dans l'historique d'un navigateur partagé.
   */
  @Roles('GESTIONNAIRE', 'ADMIN', 'DG')
  @Get('declarations/:id/justificatif')
  @Header('cache-control', 'private, no-store')
  @ApiOperation({ summary: 'Consulter le justificatif (contrôlé et non mis en cache)' })
  async proof(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.direct.proof(id);
    // Le fichier est SERVI, pas encodé en JSON : une capture d'écran de
    // plusieurs mégaoctets gonflerait inutilement la réponse, et le
    // gestionnaire veut l'ouvrir, pas lire une chaîne base64.
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="justificatif-${id}"`,
    );
    res.setHeader('Content-Length', String(file.sizeBytes));
    return new StreamableFile(file.buffer);
  }

  @Roles('GESTIONNAIRE', 'ADMIN', 'DG')
  @Post('declarations/:id/review')
  @ApiOperation({
    summary: 'Confirmer, rejeter ou maintenir en vérification un paiement',
  })
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ReviewPaymentDto,
    @Ip() ip: string,
  ) {
    return this.direct.review(id, dto, user, ip);
  }

  @Roles('GESTIONNAIRE', 'ADMIN', 'DG')
  @Get('orders/:reference')
  @ApiOperation({ summary: 'Historique complet du paiement d’une commande' })
  history(@Param('reference') reference: string) {
    return this.direct.historyForReference(reference);
  }

  /* ─────────────── Configuration des moyens de paiement ────────────────── */

  @Roles('GESTIONNAIRE', 'ADMIN', 'DG')
  @Get('methods')
  @ApiOperation({ summary: 'Moyens de paiement configurés (actifs ou non)' })
  listMethods() {
    return this.methods.listAll();
  }

  @Roles('ADMIN', 'DG')
  @Post('methods')
  @ApiOperation({ summary: 'Créer ou mettre à jour un moyen de paiement direct' })
  upsertMethod(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertPaymentMethodDto,
  ) {
    return this.methods.upsert(dto, user.id);
  }

  @Roles('ADMIN', 'DG')
  @Delete('methods/:id')
  @ApiOperation({ summary: 'Désactiver un moyen de paiement' })
  deactivateMethod(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.methods.deactivate(id, user.id);
  }
}
