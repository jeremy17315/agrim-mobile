import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import {
  CurrentUser,
  OptionalUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { MarkReadDto } from './dto/mark-read.dto';
import { RegisterTokenDto } from './dto/register-token.dto';
import {
  RegisterDeviceDto,
  UnregisterDeviceDto,
  UpdateDeviceDto,
} from './dto/register-device.dto';
import { NotificationsService } from './notifications.service';

/**
 * Notifications de l'utilisateur courant.
 *
 * Aucune route n'accepte d'identifiant d'utilisateur en paramètre : le JWT
 * est la seule source. On ne consulte ni ne modifie les notifications d'autrui.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Mes notifications' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.notifications.list(user.id, page, Math.min(limit, 50));
  }

  @Patch('read')
  @ApiOperation({ summary: 'Marquer comme lues' })
  markRead(@CurrentUser() user: AuthenticatedUser, @Body() dto: MarkReadDto) {
    return this.notifications.markRead(user.id, dto.ids);
  }

  /**
   * Enregistrement d'un appareil, avec ou sans compte.
   *
   * Route PUBLIQUE à dessein : un client qui commande en invité doit pouvoir
   * être prévenu (confirmation de paiement, arrivée du livreur) sans créer de
   * compte. Si une session est présente, son compte est rattaché à
   * l'installation ; sinon l'appareil reste identifié par son installation et
   * son numéro.
   */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('devices')
  @ApiOperation({ summary: 'Enregistrer un appareil (compte ou invité)' })
  registerDevice(
    @OptionalUser() user: AuthenticatedUser | null,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.notifications.registerDevice({
      installationId: dto.installationId,
      token: dto.token,
      platform: dto.platform,
      // Le compte vient de la SESSION, jamais du corps de la requête : sinon
      // n'importe qui rattacherait l'appareil d'un autre à son compte.
      userId: user?.id ?? null,
      phone: dto.phone ?? null,
      appVersion: dto.appVersion ?? null,
      promoOptIn: dto.promoOptIn,
    });
  }

  /**
   * Mise à jour d'un appareil enregistré.
   *
   * Publique elle aussi : c'est un invité qui saisit son numéro à la commande,
   * et c'est ce numéro qui permet de le prévenir. L'installation suffit à
   * identifier l'appareil ; aucun identifiant de compte n'est accepté.
   */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Patch('devices')
  @ApiOperation({ summary: 'Mettre à jour un appareil (numéro, promotions)' })
  updateDevice(@Body() dto: UpdateDeviceDto) {
    return this.notifications.updateDevice({
      installationId: dto.installationId,
      phone: dto.phone,
      promoOptIn: dto.promoOptIn,
    });
  }

  /** Déconnexion : l'appareil cesse d'être rattaché au compte, reste joignable. */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Delete('devices')
  @ApiOperation({ summary: 'Détacher un appareil du compte' })
  unregisterDevice(@Body() dto: UnregisterDeviceDto) {
    return this.notifications.unlinkDevice(dto.installationId, dto.token);
  }

  @Post('tokens')
  @ApiOperation({ summary: 'Enregistrer un appareil (ancienne route)' })
  registerToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterTokenDto,
  ) {
    return this.notifications.registerToken(user.id, dto.token, dto.platform);
  }

  @Delete('tokens')
  @ApiOperation({ summary: 'Retirer un appareil' })
  removeToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterTokenDto,
  ) {
    return this.notifications.removeToken(user.id, dto.token);
  }
}
