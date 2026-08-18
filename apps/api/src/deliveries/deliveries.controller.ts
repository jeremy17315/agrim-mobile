import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DeliveriesService } from './deliveries.service';
import { TrackingService } from './tracking.service';
import { AssignDeliveryDto } from './dto/assign-delivery.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { PushLocationsDto } from './dto/push-locations.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';

/**
 * Espace livreur.
 *
 * Chaque route est restreinte au rôle LIVREUR et filtrée sur l'identifiant du
 * JWT : un livreur ne voit et ne modifie que SES courses. L'affectation, elle,
 * relève du gestionnaire.
 */
@ApiTags('deliveries')
@ApiBearerAuth()
@Controller('deliveries')
export class DeliveriesController {
  constructor(
    private readonly deliveries: DeliveriesService,
    private readonly tracking: TrackingService,
  ) {}

  @Roles('LIVREUR')
  @Get('mine')
  @ApiOperation({ summary: 'Ma tournée' })
  @ApiQuery({ name: 'includeDone', required: false, type: Boolean })
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeDone', new DefaultValuePipe(false), ParseBoolPipe)
    includeDone = false,
  ) {
    return this.deliveries.listMine(user.id, includeDone);
  }

  @Roles('LIVREUR')
  @Get(':id')
  @ApiOperation({ summary: 'Détail d’une course' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.deliveries.findOne(user.id, id);
  }

  @Roles('LIVREUR')
  @Patch(':id/status')
  @ApiOperation({ summary: 'Faire avancer la course' })
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeliveryStatusDto,
  ) {
    return this.deliveries.updateStatus(user.id, id, dto);
  }

  @Roles('LIVREUR')
  @Post(':id/verify-otp')
  @ApiOperation({
    summary: 'Valider la livraison avec le code du client',
    description:
      'Seul chemin menant à DELIVERED. Le code est vérifié par le backend ; ' +
      'le livreur ne peut pas clôturer une course autrement.',
  })
  verifyOtp(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyOtpDto,
  ) {
    return this.deliveries.verifyOtp(user.id, id, dto);
  }

  @Roles('LIVREUR')
  @Get(':id/otp-status')
  @ApiOperation({
    summary: 'État du code de validation',
    description:
      'Indique si un code est actif, expiré ou épuisé. Ne renvoie JAMAIS le ' +
      'code lui-même : le livreur le reçoit du client, de vive voix.',
  })
  otpStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.deliveries.otpStatus(user.id, id);
  }

  @Roles('CLIENT')
  @Post('orders/:reference/otp/resend')
  @ApiOperation({
    summary: 'Faire renvoyer mon code de livraison',
    description:
      'Réservé au propriétaire de la commande. Soumis à un délai entre deux ' +
      'envois et à un nombre maximum de renvois.',
  })
  resendOtp(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
  ) {
    return this.deliveries.resendOtp(user.id, reference);
  }

  @Roles('LIVREUR')
  @Post('locations')
  @ApiOperation({ summary: 'Émettre un lot de positions GPS' })
  pushLocations(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PushLocationsDto,
  ) {
    return this.tracking.pushLocations(user.id, dto);
  }

  @Roles('LIVREUR')
  @Get(':id/route')
  @ApiOperation({ summary: 'Trajet parcouru sur cette course' })
  getRoute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tracking.getRoute(user.id, id);
  }

  @Roles('GESTIONNAIRE', 'ADMIN', 'DG')
  @Post('orders/:reference/assign')
  @ApiOperation({ summary: 'Affecter un livreur à une commande' })
  assign(
    @Param('reference') reference: string,
    @Body() dto: AssignDeliveryDto,
  ) {
    return this.deliveries.assign(reference, dto.courierId);
  }
}
