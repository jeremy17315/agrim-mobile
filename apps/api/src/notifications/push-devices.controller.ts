import { Body, Controller, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { PromoPreferenceDto, RegisterDeviceDto } from './dto/register-device.dto';
import { NotificationsService } from './notifications.service';

/**
 * Appareils SANS compte (client invité).
 *
 * Routes publiques par nécessité : une commande invitée doit pouvoir être
 * suivie sur notification sans authentification. La seule clé est
 * l'identifiant d'installation, généré sur l'appareil ; il n'est jamais
 * renvoyé. Aucune donnée personnelle n'est lue ici.
 */
@ApiTags('notifications')
@Controller('notifications/devices')
export class PushDevicesController {
  constructor(private readonly notifications: NotificationsService) {}

  @Public()
  @Post()
  @ApiOperation({ summary: 'Enregistrer un appareil (avec ou sans compte)' })
  register(@Body() dto: RegisterDeviceDto) {
    return this.notifications.registerDevice(dto);
  }

  @Public()
  @Patch('preferences')
  @ApiOperation({ summary: 'Régler la réception des promotions' })
  preferences(@Body() dto: PromoPreferenceDto) {
    return this.notifications.setPromoPreference(
      dto.installationId,
      dto.promoOptIn,
    );
  }
}
