/**
 * Appareils et liens profonds, mis sous test.
 *
 * Ce que ces tests réparent, en deux points :
 *
 *  1. **Recevoir sans compte.** Un client qui commande en invité ne recevait
 *     RIEN : aucun appareil n'était enregistré hors connexion, donc `notifyPhone`
 *     ne trouvait personne. On vérifie ici qu'une installation s'enregistre
 *     sans compte, que le numéro déclaré s'y rattache, et qu'un téléphone qui
 *     change de main ne laisse pas deux comptes se partager le même jeton.
 *  2. **Un lien qui mène quelque part.** Les colonnes `linkTarget`/`linkValue`
 *     existaient sans être écrites : chaque notification partait sans
 *     destination. On vérifie le lien par défaut (la commande) et surtout que
 *     la charge utile push le transporte.
 */
import type { PushProvider } from './push.provider';
import { NotificationsService } from './notifications.service';
import type { SmsProvider } from './sms.provider';

type FauxAppareil = {
  installationId: string;
  token: string;
  platform: string;
  userId: string | null;
  phone: string | null;
  appVersion: string | null;
  isActive: boolean;
};

/** Laisse s'exécuter les envois détachés (`void this.deliver(...)`). */
const laisserPartir = () => new Promise((resolve) => setImmediate(resolve));

function harnais() {
  const appareils = new Map<string, FauxAppareil>();
  /** Ancienne table `PushToken` : jeton → compte propriétaire. */
  const jetonsAnciens = new Map<string, string>();
  const notifications: Record<string, unknown>[] = [];
  const journaux: Record<string, unknown>[] = [];
  let sequence = 0;

  const db = {
    pushDevice: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { installationId: string };
        create: FauxAppareil;
        update: Partial<FauxAppareil>;
      }) => {
        const existant = appareils.get(where.installationId);
        // Un `upsert` Prisma ne réécrit que les champs fournis : le faux doit
        // faire pareil, sinon il masquerait une régression (téléphone effacé).
        const ligne = existant
          ? { ...existant, ...update }
          : { ...create, isActive: true };
        appareils.set(where.installationId, ligne as FauxAppareil);
        return ligne;
      },
      deleteMany: async ({
        where,
      }: {
        where: { token?: string; installationId?: { not: string } };
      }) => {
        let count = 0;
        for (const [cle, appareil] of appareils) {
          if (where.token && appareil.token !== where.token) continue;
          if (
            where.installationId?.not &&
            cle === where.installationId.not
          ) {
            continue;
          }
          appareils.delete(cle);
          count += 1;
        }
        return { count };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { token?: string; userId?: string | null; isActive?: boolean };
        data: Partial<FauxAppareil>;
      }) => {
        let count = 0;
        for (const appareil of appareils.values()) {
          if (where.token && appareil.token !== where.token) continue;
          if (where.userId === null && appareil.userId !== null) continue;
          if (where.isActive === true && !appareil.isActive) continue;
          Object.assign(appareil, data);
          count += 1;
        }
        return { count };
      },
      findMany: async ({
        where,
      }: {
        where: { token?: { in: string[] }; userId?: string };
      }) =>
        [...appareils.values()].filter((appareil) => {
          if (where.userId && appareil.userId !== where.userId) return false;
          if (where.token?.in && !where.token.in.includes(appareil.token)) {
            return false;
          }
          return true;
        }),
      count: async () => appareils.size,
    },
    pushToken: {
      findMany: async ({ where }: { where: { userId?: string } }) =>
        [...jetonsAnciens.entries()]
          .filter(([, userId]) => where.userId === userId)
          .map(([token]) => ({ token })),
      deleteMany: async ({ where }: { where: { token?: string } }) => {
        if (!where.token) {
          const n = jetonsAnciens.size;
          jetonsAnciens.clear();
          return { count: n };
        }
        const avait = jetonsAnciens.delete(where.token);
        return { count: avait ? 1 : 0 };
      },
    },
    notification: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        sequence += 1;
        const ligne = { id: `notif-${sequence}`, ...data };
        notifications.push(ligne);
        return ligne;
      },
    },
    messageLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        journaux.push(data);
        return data;
      },
    },
  };

  const envois: { tokens: string[]; data?: Record<string, string> }[] = [];
  const push = {
    send: jest.fn(
      async (message: {
        tokens: string[];
        title: string;
        body: string;
        data?: Record<string, string>;
      }) => {
        envois.push({ tokens: message.tokens, data: message.data });
        return { sent: message.tokens.length, invalidTokens: [] };
      },
    ),
  };

  const sms = { send: jest.fn(async () => ({ sent: true })) };

  const service = new NotificationsService(
    { db } as never,
    push as unknown as PushProvider,
    sms as unknown as SmsProvider,
  );

  return { service, appareils, jetonsAnciens, notifications, envois, push };
}

describe('Appareils (recevoir sans compte)', () => {
  it('enregistre une installation avec son compte et le numéro déclaré', async () => {
    const { service, appareils } = harnais();

    await service.registerDevice({
      installationId: 'installation-1',
      token: 'ExponentPushToken[invite]',
      platform: 'android',
      userId: 'user-1',
      phone: '0700000001',
      appVersion: '1.0.0',
    });

    expect(appareils.get('installation-1')).toMatchObject({
      token: 'ExponentPushToken[invite]',
      userId: 'user-1',
      phone: '0700000001',
      isActive: true,
    });
  });

  it('enregistre une installation SANS compte (commande invitée)', async () => {
    const { service, appareils } = harnais();

    await service.registerDevice({
      installationId: 'installation-2',
      token: 'ExponentPushToken[invite]',
      platform: 'ios',
      userId: null,
      phone: '0700000002',
    });

    expect(appareils.get('installation-2')).toMatchObject({
      userId: null,
      phone: '0700000002',
    });
  });

  it('déplace le jeton quand le téléphone a été réinstallé', async () => {
    const { service, appareils } = harnais();
    await service.registerDevice({
      installationId: 'ancienne',
      token: 'ExponentPushToken[partage]',
      platform: 'android',
    });

    await service.registerDevice({
      installationId: 'nouvelle',
      token: 'ExponentPushToken[partage]',
      platform: 'android',
    });

    // Le jeton est unique : une seule installation le porte, sinon la même
    // notification partirait deux fois vers le même téléphone.
    expect(appareils.has('ancienne')).toBe(false);
    expect(appareils.get('nouvelle')?.token).toBe('ExponentPushToken[partage]');
  });

  it('ne réécrit que ce qui est fourni : un téléphone absent reste connu', async () => {
    const { service, appareils } = harnais();
    await service.registerDevice({
      installationId: 'installation-3',
      token: 'ExponentPushToken[client]',
      platform: 'android',
      userId: 'user-1',
      phone: '0700000003',
    });

    await service.registerDevice({
      installationId: 'installation-3',
      token: 'ExponentPushToken[client]',
      platform: 'android',
    });

    // Sans numéro dans la requête, l'appareil reste joignable par téléphone.
    expect(appareils.get('installation-3')?.phone).toBe('0700000003');
  });

  it('détache l’appareil du compte à la déconnexion, sans le désactiver', async () => {
    const { service, appareils, jetonsAnciens } = harnais();
    await service.registerDevice({
      installationId: 'installation-4',
      token: 'ExponentPushToken[client]',
      platform: 'android',
      userId: 'user-1',
      phone: '0700000004',
    });
    jetonsAnciens.set('ExponentPushToken[client]', 'user-1');

    await service.unlinkDevice('installation-4', 'ExponentPushToken[client]');

    const appareil = appareils.get('installation-4');
    expect(appareil?.userId).toBeNull();
    // Toujours actif : l'appareil continue de recevoir les commandes invitées.
    expect(appareil?.isActive).toBe(true);
    expect(appareil?.phone).toBe('0700000004');
    // L'ancienne table, elle, est purgée comme avant.
    expect(jetonsAnciens.size).toBe(0);
  });
});

describe('Liens profonds', () => {
  it('enregistre la commande comme destination par défaut et la transporte', async () => {
    const { service, notifications, envois } = harnais();
    await service.registerDevice({
      installationId: 'installation-6',
      token: 'ExponentPushToken[client]',
      platform: 'android',
      userId: 'user-1',
    });

    const notification = await service.notify({
      userId: 'user-1',
      type: 'ORDER_CONFIRMED',
      reference: 'AGR-2026-0042',
      orderId: 'order-1',
    });

    expect(notification).toMatchObject({
      linkTarget: 'commande',
      linkValue: 'AGR-2026-0042',
    });
    expect(notifications[0]).toMatchObject({
      linkTarget: 'commande',
      linkValue: 'AGR-2026-0042',
    });

    await laisserPartir();
    expect(envois[0]?.data).toMatchObject({
      target: 'commande',
      value: 'AGR-2026-0042',
      // Conservé pour les applications installées qui ignorent target/value.
      reference: 'AGR-2026-0042',
    });
  });

  it('n’envoie JAMAIS le code de livraison dans la notification poussée', async () => {
    const { service, envois, push } = harnais();
    await service.registerDevice({
      installationId: 'installation-7',
      token: 'ExponentPushToken[client]',
      platform: 'android',
      userId: 'user-1',
    });

    await service.notify({
      userId: 'user-1',
      type: 'DELIVERY_OTP',
      reference: 'AGR-2026-0042',
      values: { code: '4821' },
    });
    await laisserPartir();

    const corps = (push.send as jest.Mock).mock.calls[0]![0].body as string;
    expect(corps).not.toContain('4821');
    expect(corps).toMatch(/application/i);
    // Le lien, lui, reste utile : il ouvre le suivi de la commande.
    expect(envois[0]?.data?.['target']).toBe('commande');
  });

  it('n’envoie qu’une fois à un jeton présent dans les deux tables', async () => {
    const { service, jetonsAnciens, envois } = harnais();
    await service.registerDevice({
      installationId: 'installation-5',
      token: 'ExponentPushToken[client]',
      platform: 'android',
      userId: 'user-1',
    });
    // Le même téléphone est aussi dans l'ancienne table des comptes.
    jetonsAnciens.set('ExponentPushToken[client]', 'user-1');

    await service.notify({ userId: 'user-1', type: 'ORDER_CREATED' });
    await laisserPartir();

    expect(envois[0]?.tokens).toEqual(['ExponentPushToken[client]']);
  });
});
