import type { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

const INSTALL = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function setup() {
  const db = {
    pushDevice: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    pushToken: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    notification: {
      create: jest.fn().mockResolvedValue({ id: 'n1', type: 'ORDER_CREATED', title: '', body: '' }),
    },
    messageLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const push = {
    send: jest.fn().mockResolvedValue({ sent: 1, invalidTokens: [] }),
  };
  const sms = { send: jest.fn().mockResolvedValue({ sent: false }) };
  const service = new NotificationsService(
    { db } as unknown as PrismaService,
    push as never,
    sms as never,
  );
  return { service, db, push };
}

describe('NotificationsService — appareils sans compte', () => {
  it('enregistre un appareil par installation, sans compte', async () => {
    const { service, db } = setup();
    await service.registerDevice({
      installationId: INSTALL,
      token: 'ExponentPushToken[abc]',
      platform: 'android',
    });
    const upsert = (db.pushDevice.upsert as jest.Mock).mock.calls[0][0];
    expect(upsert.where).toEqual({ installationId: INSTALL });
    expect(upsert.create).toMatchObject({ promoOptIn: false, isActive: true });
    expect(upsert.create).not.toHaveProperty('userId');
  });

  it('réaffecte un jeton présenté par une autre installation', async () => {
    const { service, db } = setup();
    await service.registerDevice({
      installationId: INSTALL,
      token: 'ExponentPushToken[abc]',
      platform: 'android',
    });
    expect(db.pushDevice.deleteMany).toHaveBeenCalledWith({
      where: { token: 'ExponentPushToken[abc]', installationId: { not: INSTALL } },
    });
  });

  it('le réglage promotions est écrit en base', async () => {
    const { service, db } = setup();
    await service.setPromoPreference(INSTALL, false);
    expect(db.pushDevice.updateMany).toHaveBeenCalledWith({
      where: { installationId: INSTALL },
      data: { promoOptIn: false },
    });
  });

  it('rattache l’appareil invité à la commande, avec le numéro normalisé', async () => {
    const { service, db } = setup();
    await service.attachGuestDevice(INSTALL, 'guest-user', '+225 07 00 00 00 00');
    expect(db.pushDevice.updateMany).toHaveBeenCalledWith({
      where: { installationId: INSTALL },
      data: { userId: 'guest-user', phone: '+2250700000000' },
    });
  });

  it('déconnexion : délie l’appareil du compte sans le désactiver', async () => {
    const { service, db } = setup();
    await service.removeToken('user-1', 'ExponentPushToken[abc]', INSTALL);
    expect(db.pushDevice.updateMany).toHaveBeenCalledWith({
      where: { installationId: INSTALL, userId: 'user-1' },
      data: { userId: null },
    });
  });

  it('livre aux appareils du compte, y compris ceux rattachés à une commande invitée', async () => {
    const { service, db, push } = setup();
    (db.pushDevice.findMany as jest.Mock).mockResolvedValueOnce([{ token: 'ExponentPushToken[dev]' }]);
    await service.notify({ userId: 'guest-user', type: 'ORDER_CONFIRMED', reference: 'AGR-1' });
    await new Promise((r) => setImmediate(r));
    expect(push.send).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ['ExponentPushToken[dev]'],
        data: expect.objectContaining({ target: 'commande', value: 'AGR-1' }),
      }),
    );
  });

  it('une promotion part sur le canal promotions, un suivi de commande sur le canal commandes', async () => {
    const { service, db, push } = setup();
    (db.pushDevice.findMany as jest.Mock).mockResolvedValue([{ token: 'ExponentPushToken[dev]' }]);
    await service.notify({ userId: 'u1', type: 'PROMOTION' });
    await new Promise((r) => setImmediate(r));
    await service.notify({ userId: 'u1', type: 'ORDER_READY', reference: 'AGR-2' });
    await new Promise((r) => setImmediate(r));
    const calls = push.send.mock.calls.map((c) => c[0]);
    expect(calls[0].channelId).toBe('promotions');
    expect(calls[1].channelId).toBe('commandes');
  });

  it('purge : désactive après 90 jours, supprime les désactivés depuis 30 jours', async () => {
    const { service, db } = setup();
    await service.purgeStaleDevices(new Date('2026-10-13T00:00:00Z'));
    const deactivate = (db.pushDevice.updateMany as jest.Mock).mock.calls[0][0];
    expect(deactivate.where.isActive).toBe(true);
    expect(deactivate.where.lastSeenAt.lt.toISOString()).toBe('2026-07-15T00:00:00.000Z');
    const remove = (db.pushDevice.deleteMany as jest.Mock).mock.calls[0][0];
    expect(remove.where.isActive).toBe(false);
    expect(remove.where.updatedAt.lt.toISOString()).toBe('2026-09-13T00:00:00.000Z');
  });
});
