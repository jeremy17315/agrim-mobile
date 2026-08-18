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
import { MarkReadDto } from './dto/mark-read.dto';
import { RegisterTokenDto } from './dto/register-token.dto';
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

  @Post('tokens')
  @ApiOperation({ summary: 'Enregistrer un appareil' })
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
