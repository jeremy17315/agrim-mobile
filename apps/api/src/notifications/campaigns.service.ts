import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto } from './dto/campaign.dto';
import { NotificationsService } from './notifications.service';

/**
 * Campagnes de notifications.
 *
 * Règles :
 *  - le test ne part QUE vers les appareils de l'administrateur ;
 *  - l'envoi général exige `confirm: true` et ne touche que les appareils qui
 *    ont accepté les promotions ;
 *  - les compteurs disent ce que le service d'envoi a ACCEPTÉ (`sentCount`) ou
 *    REFUSÉ (`failedCount`). Aucun compteur « lu » : il n'existe pas.
 *  - rien de sensible dans le message : il s'affiche sur l'écran verrouillé.
 */
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async send(adminId: string, dto: CreateCampaignDto) {
    if (dto.audience === 'ALL_OPTED_IN' && dto.confirm !== true) {
      throw new BadRequestException({
        code: 'CONFIRMATION_REQUIRED',
        message: 'Confirmez l’envoi à tous les clients avant de continuer.',
      });
    }
    if (dto.linkTarget && dto.linkTarget !== 'information' && !dto.linkValue) {
      throw new BadRequestException({
        code: 'LINK_VALUE_REQUIRED',
        message: 'Indiquez la destination du lien.',
      });
    }

    const tokens = await this.recipientTokens(dto.audience, adminId);

    const campaign = await this.prisma.db.notificationCampaign.create({
      data: {
        title: dto.title,
        body: dto.body,
        category: dto.category,
        imageUrl: dto.imageUrl ?? null,
        linkTarget: dto.linkTarget ?? 'information',
        linkValue: dto.linkValue ?? null,
        audience: dto.audience,
        status: 'SENDING',
        sendingAt: new Date(),
        targetCount: tokens.length,
        createdById: adminId,
      },
      select: { id: true },
    });

    if (tokens.length === 0) {
      return this.close(campaign.id, {
        status: 'SENT',
        sentCount: 0,
        failedCount: 0,
        invalidCount: 0,
        lastError: 'Aucun appareil ne correspond à cette audience.',
      });
    }

    try {
      const result = await this.notifications.pushToTokens(
        tokens,
        dto.title,
        dto.body,
        {
          reference: '',
          target: dto.linkTarget ?? 'information',
          value: dto.linkValue ?? '',
          campaign: campaign.id,
        },
        { channelId: 'promotions', imageUrl: dto.imageUrl },
      );
      const failed = tokens.length - result.sent;
      return this.close(campaign.id, {
        status: result.sent > 0 ? 'SENT' : 'FAILED',
        sentCount: result.sent,
        failedCount: failed,
        invalidCount: result.invalid,
        lastError: result.error ?? null,
      });
    } catch {
      this.logger.warn(`Campagne ${campaign.id} : envoi interrompu.`);
      return this.close(campaign.id, {
        status: 'FAILED',
        sentCount: 0,
        failedCount: tokens.length,
        invalidCount: 0,
        lastError: 'Envoi interrompu.',
      });
    }
  }

  async list(limit = 20) {
    return this.prisma.db.notificationCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        category: true,
        audience: true,
        status: true,
        targetCount: true,
        sentCount: true,
        failedCount: true,
        invalidCount: true,
        lastError: true,
        sentAt: true,
        createdAt: true,
      },
    });
  }

  /** Jetons destinataires selon l'audience, dédoublonnés. */
  private async recipientTokens(
    audience: CreateCampaignDto['audience'],
    adminId: string,
  ): Promise<string[]> {
    const where =
      audience === 'TEST'
        ? { userId: adminId, isActive: true }
        : { isActive: true, promoOptIn: true };
    const devices = await this.prisma.db.pushDevice.findMany({
      where,
      select: { token: true },
    });
    return [...new Set(devices.map((d) => d.token))];
  }

  private async close(
    id: string,
    result: {
      status: 'SENT' | 'FAILED';
      sentCount: number;
      failedCount: number;
      invalidCount: number;
      lastError: string | null;
    },
  ) {
    return this.prisma.db.notificationCampaign.update({
      where: { id },
      data: {
        ...result,
        lastError: result.lastError?.slice(0, 500) ?? null,
        sentAt: new Date(),
      },
      select: {
        id: true,
        status: true,
        targetCount: true,
        sentCount: true,
        failedCount: true,
        invalidCount: true,
        lastError: true,
      },
    });
  }
}
