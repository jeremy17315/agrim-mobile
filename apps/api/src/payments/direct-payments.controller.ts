import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { GuestPaymentTokenService } from '../orders/guest-payment-token.service';
import { DeclarePaymentDto } from './dto/direct-payment.dto';
import { DirectPaymentsService } from './direct-payments.service';
import { PaymentMethodsService } from './payment-methods.service';

/** Fichier reçu par multer, en mémoire : rien n'est écrit avant contrôle. */
type UploadedProof = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
} | undefined;

/**
 * Paiement direct manuel — parcours CLIENT.
 *
 * Deux façons d'être autorisé, aucune ne reposant sur un identifiant envoyé
 * par le téléphone :
 *  - un JWT, pour un client connecté (le service vérifie l'appartenance) ;
 *  - la capacité temporaire `x-guest-payment-token`, remise uniquement lors du
 *    checkout invité, pour une commande sans compte.
 *
 * Aucune route n'accepte de `userId` : un client ne peut donc pas lire ni
 * déclarer le paiement d'une autre personne.
 */
@ApiTags('payments')
@Controller('payments')
export class DirectPaymentsController {
  constructor(
    private readonly direct: DirectPaymentsService,
    private readonly methods: PaymentMethodsService,
    private readonly guestTokens: GuestPaymentTokenService,
  ) {}

  /**
   * Moyens de paiement ACTIFS, configurés par AGRIM.
   *
   * Public : le client doit les voir avant de commander, sans compte. La liste
   * peut être VIDE tant qu'AGRIM n'a rien configuré — l'application propose
   * alors le paiement à la livraison, et n'invente aucun numéro.
   */
  @Public()
  @Get('methods')
  @ApiOperation({ summary: 'Moyens de paiement directs activés par AGRIM' })
  async listMethods() {
    return { methods: await this.methods.listActive() };
  }

  /* ───────────────────────── Client connecté ──────────────────────────── */

  @ApiBearerAuth()
  @Get('orders/:reference/instructions')
  @ApiOperation({ summary: 'Instructions de transfert d’une de mes commandes' })
  instructions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
  ) {
    return this.direct.instructions(reference, { userId: user.id });
  }

  @ApiBearerAuth()
  @Get('orders/:reference/instructions/texte')
  @ApiOperation({ summary: 'Instructions prêtes à copier (numéro, montant, référence)' })
  instructionsText(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
  ) {
    return this.direct.instructionsText(reference, { userId: user.id });
  }

  /**
   * Déclaration d'un client connecté, avec justificatif FACULTATIF.
   *
   * Multipart accepté au même titre que le JSON : une capture d'écran n'est
   * jamais une preuve, mais elle aide le gestionnaire à retrouver la
   * transaction — et un client connecté mérite la même possibilité qu'un
   * invité. Le fichier est contrôlé (type, taille) avant tout dépôt.
   */
  @ApiBearerAuth()
  @Post('orders/:reference/declare')
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('proof'))
  @ApiOperation({ summary: 'Déclarer un transfert effectué' })
  declare(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
    @Body() dto: DeclarePaymentDto,
    @Ip() ip: string,
    @UploadedFile() proof: UploadedProof,
  ) {
    return this.direct.declare({
      reference,
      owner: { userId: user.id },
      dto,
      actorIp: ip,
      proof: proof
        ? {
            buffer: proof.buffer,
            mimeType: proof.mimetype,
            originalName: proof.originalname,
          }
        : undefined,
    });
  }

  /* ─────────────────────────── Commande invitée ────────────────────────── */

  @Public()
  @Get('guest/orders/:reference/instructions')
  @ApiOperation({ summary: 'Instructions de transfert d’une commande invitée' })
  guestInstructions(
    @Param('reference') reference: string,
    @Headers('x-guest-payment-token') token: string | undefined,
  ) {
    this.guestTokens.assertValid(token, reference);
    return this.direct.instructions(reference, { guest: true });
  }

  @Public()
  @Get('guest/orders/:reference/instructions/texte')
  @ApiOperation({ summary: 'Instructions invitée prêtes à copier' })
  guestInstructionsText(
    @Param('reference') reference: string,
    @Headers('x-guest-payment-token') token: string | undefined,
  ) {
    this.guestTokens.assertValid(token, reference);
    return this.direct.instructionsText(reference, { guest: true });
  }

  /**
   * Déclaration d'un invité, avec justificatif FACULTATIF.
   *
   * Le fichier est reçu en mémoire puis contrôlé (type MIME, 5 Mo) avant tout
   * dépôt : on n'écrit jamais un fichier qu'on n'a pas validé. La déclaration
   * elle-même ne confirme rien — elle ouvre une vérification humaine.
   */
  @Public()
  @Post('guest/orders/:reference/declare')
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('proof'))
  @HttpCode(200)
  @ApiOperation({ summary: 'Déclarer un transfert (commande invitée)' })
  guestDeclare(
    @Param('reference') reference: string,
    @Body() dto: DeclarePaymentDto,
    @Headers('x-guest-payment-token') token: string | undefined,
    @Ip() ip: string,
    @UploadedFile() proof: UploadedProof,
  ) {
    this.guestTokens.assertValid(token, reference);
    return this.direct.declare({
      reference,
      owner: { guest: true },
      dto,
      actorIp: ip,
      proof: proof
        ? {
            buffer: proof.buffer,
            mimeType: proof.mimetype,
            originalName: proof.originalname,
          }
        : undefined,
    });
  }
}
