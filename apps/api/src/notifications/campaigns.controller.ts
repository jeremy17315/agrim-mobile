import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';

/**
 * Campagnes de notifications.
 *
 * Réservées à ADMIN et DG, comme les codes promo : une campagne part vers tous
 * les appareils d'un coup, c'est un geste commercial qui engage AGRIM.
 *
 * L'envoi est une route À PART de la rédaction : on écrit un brouillon, on le
 * relit, puis on l'envoie. Un unique bouton « publier » inviterait à envoyer
 * une faute de frappe à tout le monde.
 */
@ApiTags('campagnes')
@ApiBearerAuth()
@Roles('ADMIN', 'DG')
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @ApiOperation({ summary: 'Lister les campagnes' })
  list() {
    return this.campaigns.list();
  }

  @Post()
  @ApiOperation({ summary: 'Rédiger un brouillon de campagne' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.campaigns.create({
      title: dto.title,
      body: dto.body,
      category: dto.category,
      linkTarget: dto.linkTarget,
      linkValue: dto.linkValue,
      audience: dto.audience,
      createdById: user.id,
    });
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'Envoyer une campagne rédigée' })
  send(@Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.send(id);
  }
}
