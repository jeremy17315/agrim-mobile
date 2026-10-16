/**
 * Campagnes de notifications, mises sous test.
 *
 * Ce qui est réellement gardé ici :
 *
 *  - **le consentement.** Une campagne ne doit jamais toucher un appareil qui
 *    a refusé les promotions, ni un appareil désactivé ;
 *  - **l'unicité de l'envoi.** Un double appui (ou deux responsables) ne doit
 *    pas envoyer deux fois la même promotion : la transition de statut est
 *    conditionnelle, et c'est cette condition qui est testée ;
 *  - **la vérité des compteurs.** « accepté » n'est pas « lu », et un appareil
 *    disparu se compte à part.
 *
 * Test unitaire : un faux Prisma en mémoire suffit, et il tourne sans
 * PostgreSQL — ce qu'on veut d'un test qui garde une règle d'envoi.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Role } from '@agrim/contracts';

import { CampaignsService } from './campaigns.service';
import type { NotificationsService } from './notifications.service';

type FauxAppareil = {
  token: string;
  userId: string | null;
  isActive: boolean;
  promoOptIn: boolean;
  role?: Role;
};

type FauxCandidat = {
  id: string;
  title: string;
  body: string;
  category: string;
  linkTarget: string | null;
  linkValue: string | null;
  audience: string;
  status: string;
  targetCount: number;
  sentCount: number;
  failedCount: number;
  invalidCount: number;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
};

/** Clauses `where` que le service construit réellement sur `pushDevice`. */
type ClauseAppareils = {
  isActive?: boolean;
  promoOptIn?: boolean;
  /** `{ not: null }` : appareils rattachés à un compte. */
  userId?: { not: string | null };
  /** Appareils de l'équipe interne. */
  user?: { role?: { in: Role[] } };
};

/** Données qu'une écriture de campagne peut porter. */
type DonneesCampagne = {
  title?: string;
  body?: string;
  category?: string;
  linkTarget?: string | null;
  linkValue?: string | null;
  audience?: string;
  status?: string;
  targetCount?: number;
  sentCount?: number;
  failedCount?: number;
  invalidCount?: number;
  lastError?: string | null;
  sentAt?: Date | null;
  sendingAt?: Date;
  createdById?: string;
};

/** Filtre minimal mais FIDÈLE aux clauses réellement construites par le service. */
function correspond(appareil: FauxAppareil, where: ClauseAppareils) {
  if (where.isActive === true && !appareil.isActive) return false;
  if (where.promoOptIn === true && !appareil.promoOptIn) return false;
  if (where.userId?.not === null && appareil.userId === null) return false;
  if (
    where.user?.role?.in &&
    (!appareil.role || !where.user.role.in.includes(appareil.role))
  )
    return false;
  return true;
}

function harnais(appareils: FauxAppareil[]) {
  const campagnes = new Map<string, FauxCandidat>();
  const notifications: Record<string, unknown>[] = [];
  const journaux: Record<string, unknown>[] = [];
  let sequence = 0;

  const db = {
    pushDevice: {
      findMany: async ({ where }: { where: ClauseAppareils }) =>
        appareils.filter((a) => correspond(a, where)),
      count: async ({ where }: { where: ClauseAppareils }) =>
        appareils.filter((a) => correspond(a, where)).length,
    },
    notificationCampaign: {
      create: async ({ data }: { data: DonneesCampagne }) => {
        sequence += 1;
        const ligne: FauxCandidat = {
          id: `campagne-${sequence}`,
          title: data.title ?? '',
          body: data.body ?? '',
          category: data.category ?? 'PROMOTION',
          linkTarget: data.linkTarget ?? null,
          linkValue: data.linkValue ?? null,
          audience: data.audience ?? 'ALL_OPTED_IN',
          status: data.status ?? 'DRAFT',
          targetCount: data.targetCount ?? 0,
          sentCount: 0,
          failedCount: 0,
          invalidCount: 0,
          lastError: null,
          sentAt: null,
          createdAt: new Date(),
        };
        campagnes.set(ligne.id, ligne);
        return ligne;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        campagnes.get(where.id) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: DonneesCampagne;
      }) => {
        const ligne = campagnes.get(where.id)!;
        Object.assign(ligne, data);
        return ligne;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status?: { in: string[] } };
        data: DonneesCampagne;
      }) => {
        const ligne = campagnes.get(where.id);
        if (!ligne) return { count: 0 };
        if (where.status?.in && !where.status.in.includes(ligne.status)) {
          return { count: 0 };
        }
        Object.assign(ligne, data);
        return { count: 1 };
      },
    },
    notification: {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        notifications.push(...data);
        return { count: data.length };
      },
    },
  };

  const pushToTokens = jest.fn(
    async (
      tokens: string[],
      _title: string,
      _body: string,
      _data: Record<string, string>,
    ) => ({ sent: tokens.length, invalidTokens: [] as string[] }),
  );
  const recordMessageLog = jest.fn(async (entree: Record<string, unknown>) => {
    journaux.push(entree);
  });

  const service = new CampaignsService(
    { db } as never,
    { pushToTokens, recordMessageLog } as unknown as NotificationsService,
  );

  return { service, campagnes, notifications, journaux, pushToTokens };
}

const APPAREILS: FauxAppareil[] = [
  // Client abonné, avec compte.
  { token: 'ExponentPushToken[client]', userId: 'user-1', isActive: true, promoOptIn: true, role: 'CLIENT' },
  // Client abonné, commande en invité (pas de compte).
  { token: 'ExponentPushToken[invite]', userId: null, isActive: true, promoOptIn: true },
  // Client qui a REFUSÉ les promotions.
  { token: 'ExponentPushToken[refus]', userId: 'user-2', isActive: true, promoOptIn: false, role: 'CLIENT' },
  // Application désinstallée : jeton désactivé.
  { token: 'ExponentPushToken[ancien]', userId: 'user-3', isActive: false, promoOptIn: true, role: 'CLIENT' },
  // Appareil d'un responsable (envois de test uniquement).
  { token: 'ExponentPushToken[patron]', userId: 'user-4', isActive: true, promoOptIn: true, role: 'DG' },
];

const REDACTION = {
  title: 'Nouveau format 10 kg',
  body: 'Le riz Royal Grains arrive en 10 kg dès cette semaine.',
  category: 'NOUVEAU_PRODUIT' as const,
  linkTarget: 'produit' as const,
  linkValue: 'royal-grains',
  audience: 'ALL_OPTED_IN' as const,
  createdById: 'user-4',
};

describe('CampaignsService', () => {
  it('refuse une destination qui a besoin d’une valeur et n’en a pas', async () => {
    const { service } = harnais(APPAREILS);

    await expect(
      service.create({ ...REDACTION, linkValue: '  ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepte une destination sans valeur (information) et n’en invente pas', async () => {
    const { service } = harnais(APPAREILS);

    const campagne = await service.create({
      ...REDACTION,
      linkTarget: 'information',
      linkValue: undefined,
    });

    expect(campagne.status).toBe('DRAFT');
    expect(campagne.linkValue).toBeNull();
  });

  it('ne compte que les appareils joignables au moment de la rédaction', async () => {
    const { service } = harnais(APPAREILS);

    const campagne = await service.create(REDACTION);

    // Client + invité + responsable : ni le refus (promoOptIn), ni le jeton
    // désactivé (désinstallation).
    expect(campagne.targetCount).toBe(3);
  });

  it('n’envoie à des tests QUE les appareils de l’équipe', async () => {
    const { service, pushToTokens } = harnais(APPAREILS);

    const campagne = await service.create({
      ...REDACTION,
      audience: 'TEST',
    });
    await service.send(campagne.id);

    expect(pushToTokens).toHaveBeenCalledTimes(1);
    expect(pushToTokens.mock.calls[0]![0]).toEqual([
      'ExponentPushToken[patron]',
    ]);
  });

  it('n’envoie aux comptes QUE les appareils rattachés à un compte', async () => {
    const { service, pushToTokens } = harnais(APPAREILS);

    const campagne = await service.create({
      ...REDACTION,
      audience: 'AUTHENTICATED',
    });
    await service.send(campagne.id);

    const jetons = pushToTokens.mock.calls[0]![0] as string[];
    expect(jetons).toContain('ExponentPushToken[client]');
    expect(jetons).toContain('ExponentPushToken[patron]');
    expect(jetons).not.toContain('ExponentPushToken[invite]');
  });

  it('refuse d’envoyer deux fois la même campagne', async () => {
    const { service, pushToTokens } = harnais(APPAREILS);

    const campagne = await service.create(REDACTION);
    await service.send(campagne.id);

    await expect(service.send(campagne.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    // Un seul envoi réel, malgré la seconde tentative.
    expect(pushToTokens).toHaveBeenCalledTimes(1);
  });

  it('laisse RELANCER une campagne dont rien n’est parti', async () => {
    const { service, pushToTokens, campagnes } = harnais(APPAREILS);
    // Premier essai : le service de notifications n'accuse rien.
    pushToTokens.mockResolvedValueOnce({ sent: 0, invalidTokens: [] });
    const campagne = await service.create(REDACTION);
    await service.send(campagne.id);
    expect(campagnes.get(campagne.id)!.status).toBe('FAILED');

    // Le responsable corrige la panne, puis relance : c'est permis, personne
    // n'ayant rien reçu.
    await service.send(campagne.id);

    expect(pushToTokens).toHaveBeenCalledTimes(2);
    expect(campagnes.get(campagne.id)!.status).toBe('SENT');
    expect(campagnes.get(campagne.id)!.sentCount).toBe(3);
  });

  it('refuse de relancer une campagne PARTIELLEMENT envoyée', async () => {
    const { service, pushToTokens, campagnes } = harnais(APPAREILS);
    // Un seul appareil servi sur trois : relancer doublerait chez lui.
    pushToTokens.mockResolvedValueOnce({
      sent: 1,
      invalidTokens: ['ExponentPushToken[client]', 'ExponentPushToken[invite]'],
    });
    const campagne = await service.create(REDACTION);
    await service.send(campagne.id);
    expect(campagnes.get(campagne.id)!.sentCount).toBe(1);

    await expect(service.send(campagne.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(pushToTokens).toHaveBeenCalledTimes(1);
  });

  it('refuse un envoi concurrent déjà en cours', async () => {
    const { service, campagnes } = harnais(APPAREILS);
    const campagne = await service.create(REDACTION);
    campagnes.get(campagne.id)!.status = 'SENDING';

    await expect(service.send(campagne.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('envoie, recopie la campagne dans les notifications des comptes et compte juste', async () => {
    const { service, notifications, journaux, pushToTokens } =
      harnais(APPAREILS);

    const campagne = await service.create(REDACTION);
    const apres = await service.send(campagne.id);

    // Le lien enregistré part tel quel dans la charge utile push : c'est lui
    // qui fait ouvrir la fiche produit au tap.
    expect(pushToTokens.mock.calls[0]![3]).toEqual({
      target: 'produit',
      value: 'royal-grains',
    });

    expect(apres.status).toBe('SENT');
    expect(apres.sentAt).not.toBeNull();
    expect(apres.targetCount).toBe(3);
    expect(apres.sentCount).toBe(3);
    expect(apres.failedCount).toBe(0);
    expect(apres.invalidCount).toBe(0);
    expect(apres.lastError).toBeNull();

    // Seuls les appareils rattachés à un compte reçoivent une notification en
    // base : un invité n'a pas de liste de notifications à remplir.
    expect(notifications).toHaveLength(2);
    expect(notifications.map((n) => n['userId']).sort()).toEqual([
      'user-1',
      'user-4',
    ]);
    expect(notifications[0]).toMatchObject({
      type: 'PROMOTION',
      title: REDACTION.title,
      linkTarget: 'produit',
      linkValue: 'royal-grains',
      campaignId: campagne.id,
    });

    // Le journal porte la trace de l'envoi, sans identifiant de destinataire.
    expect(journaux[0]).toMatchObject({ channel: 'PUSH', status: 'SENT' });
  });

  it('compte à part les appareils disparus et les refus', async () => {
    const { service, pushToTokens, campagnes } = harnais(APPAREILS);
    pushToTokens.mockResolvedValueOnce({
      sent: 1,
      invalidTokens: ['ExponentPushToken[client]'],
    });

    const campagne = await service.create(REDACTION);
    await service.send(campagne.id);

    const apres = campagnes.get(campagne.id)!;
    expect(apres.status).toBe('SENT');
    expect(apres.sentCount).toBe(1);
    expect(apres.invalidCount).toBe(1);
    // 3 visés − 1 accepté − 1 disparu = 1 refusé par le service.
    expect(apres.failedCount).toBe(1);
  });

  it('marque un échec EXPLICITE quand le public ne contient aucun appareil', async () => {
    const { service, campagnes, pushToTokens, notifications } = harnais([
      { token: 'ExponentPushToken[refus]', userId: 'user-2', isActive: true, promoOptIn: false },
    ]);

    const campagne = await service.create(REDACTION);
    await service.send(campagne.id);

    const apres = campagnes.get(campagne.id)!;
    expect(pushToTokens).not.toHaveBeenCalled();
    expect(apres.status).toBe('FAILED');
    expect(apres.lastError).toMatch(/aucun appareil/i);
    expect(notifications).toHaveLength(0);
  });

  it('écrit POURQUOI rien n’est parti quand aucun envoi n’aboutit', async () => {
    const { service, pushToTokens } = harnais(APPAREILS);
    // Aucun accusé de réception : c'est le cas d'un serveur dont les
    // notifications poussées sont désactivées. La campagne ne doit pas
    // s'afficher « envoyée » alors que personne n'a été prévenu.
    pushToTokens.mockResolvedValueOnce({ sent: 0, invalidTokens: [] });

    const campagne = await service.create(REDACTION);
    const apres = await service.send(campagne.id);

    expect(apres.status).toBe('FAILED');
    expect(apres.sentCount).toBe(0);
    expect(apres.failedCount).toBe(3);
    expect(apres.lastError).toMatch(/aucun envoi/i);
  });

  it('relit une destination corrompue sans planter l’envoi', async () => {
    const { service, pushToTokens, campagnes } = harnais(APPAREILS);
    const campagne = await service.create(REDACTION);
    // La colonne est du texte libre en base : une valeur inattendue ne doit
    // pas envoyer le client vers n'importe quel écran.
    campagnes.get(campagne.id)!.linkTarget = 'nimportequoi';

    await service.send(campagne.id);

    const donnees = pushToTokens.mock.calls[0]![3] as Record<string, string>;
    expect(donnees['target']).toBe('information');
  });
});
