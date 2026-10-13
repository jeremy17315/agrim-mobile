import { Body, Controller, Get, Post, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateCampaignDto } from './dto/campaign.dto';
import { CampaignsService } from './campaigns.service';

/** Campagnes de notifications — administrateur uniquement. */
@ApiTags('admin · campagnes')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Post()
  @ApiOperation({ summary: 'Envoyer une campagne (test ou général, confirmé)' })
  send(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCampaignDto) {
    return this.campaigns.send(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Historique des campagnes' })
  list(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.campaigns.list(Math.min(limit, 50));
  }
}
