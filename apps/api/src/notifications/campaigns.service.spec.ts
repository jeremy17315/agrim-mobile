import { BadRequestException } from '@nestjs/common';

import type { PrismaService } from '../prisma/prisma.service';
import { CampaignsService } from './campaigns.service';
import type { CreateCampaignDto } from './dto/campaign.dto';
import type { NotificationsService } from './notifications.service';

const ADMIN = '00000000-0000-4000-8000-000000000001';

type PushOutcome = { sent: number; invalid: number; error?: string };

function setup(tokens: string[], pushResult: PushOutcome = { sent: 0, invalid: 0 }) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    db: {
      pushDevice: {
        findMany: jest.fn().mockResolvedValue(tokens.map((token) => ({ token }))),
      },
      notificationCampaign: {
        create: jest.fn(async ({ data }) => {
          created.push(data);
          return { id: 'camp-1' };
        }),
        update: jest.fn(async ({ data }) => ({ id: 'camp-1', ...data })),
      },
    },
  } as unknown as PrismaService;
  const notifications = {
    pushToTokens: jest.fn().mockResolvedValue(pushResult),
  } as unknown as NotificationsService;
  return {
    service: new CampaignsService(prisma, notifications),
    prisma,
    notifications,
    created,
  };
}

const base: CreateCampaignDto = {
  category: 'PROMOTION',
  title: 'Riz noir disponible',
  body: 'Découvrez le riz noir Bélier d’Or.',
  audience: 'TEST',
};

describe('CampaignsService', () => {
  it('refuse l’envoi général sans confirmation explicite', async () => {
    const { service, notifications } = setup(['ExponentPushToken[a]']);
    await expect(
      service.send(ADMIN, { ...base, audience: 'ALL_OPTED_IN' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(notifications.pushToTokens).not.toHaveBeenCalled();
  });

  it('le test cible les appareils de l’administrateur, sans filtre promotionnel', async () => {
    const { service, prisma } = setup(['ExponentPushToken[a]']);
    await service.send(ADMIN, base);
    const where = (prisma.db.pushDevice.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where).toEqual({ userId: ADMIN, isActive: true });
  });

  it('l’envoi général ne vise que les appareils ayant accepté les promotions', async () => {
    const { service, prisma } = setup(['ExponentPushToken[a]']);
    await service.send(ADMIN, { ...base, audience: 'ALL_OPTED_IN', confirm: true });
    const where = (prisma.db.pushDevice.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where).toEqual({ isActive: true, promoOptIn: true });
  });

  it('envoie sur le canal promotions, avec la destination et l’image', async () => {
    const { service, notifications } = setup(['ExponentPushToken[a]'], { sent: 1, invalid: 0 });
    await service.send(ADMIN, {
      ...base,
      linkTarget: 'produit',
      linkValue: 'riz-noir',
      imageUrl: 'https://agrimsarl.ci/img/riz.jpg',
    });
    const args = (notifications.pushToTokens as jest.Mock).mock.calls[0];
    expect(args[4]).toEqual({ channelId: 'promotions', imageUrl: 'https://agrimsarl.ci/img/riz.jpg' });
    expect(args[3]).toMatchObject({ target: 'produit', value: 'riz-noir' });
  });

  it('compte « envoyé » et « échoué » sans jamais parler de lecture', async () => {
    const { service, prisma } = setup(['t1', 't2', 't3'], { sent: 2, invalid: 1 });
    const result = await service.send(ADMIN, base);
    const data = (prisma.db.notificationCampaign.update as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({
      status: 'SENT',
      sentCount: 2,
      failedCount: 1,
      invalidCount: 1,
    });
    expect(data).not.toHaveProperty('readCount');
    expect(result).toMatchObject({ status: 'SENT', sentCount: 2 });
  });

  it('marque FAILED quand aucun appareil n’a été accepté', async () => {
    const { service, prisma } = setup(['t1'], { sent: 0, invalid: 0, error: 'Service injoignable.' });
    await service.send(ADMIN, base);
    const data = (prisma.db.notificationCampaign.update as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'FAILED', failedCount: 1, lastError: 'Service injoignable.' });
  });

  it('sans destinataire, ne prétend rien envoyer', async () => {
    const { service, notifications, prisma } = setup([]);
    await service.send(ADMIN, base);
    expect(notifications.pushToTokens).not.toHaveBeenCalled();
    const data = (prisma.db.notificationCampaign.update as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'SENT', sentCount: 0, failedCount: 0 });
  });

  it('exige une destination quand un type de lien est choisi', async () => {
    const { service } = setup(['t1']);
    await expect(
      service.send(ADMIN, { ...base, linkTarget: 'offre' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
