import { MessagingDispatcher } from './messaging.dispatcher';
import { prisma } from '../prisma/prisma.client';
import type { WhatsappMessage, WhatsappResult } from './whatsapp.provider';
import type { EmailMessage, EmailResult } from './email.provider';

/**
 * Dispatcher de diffusion — tests de POLITIQUE, pas de transport.
 *
 * Les ports WhatsApp/e-mail sont des enregistreurs pilotés : ce qui est
 * éprouvé ici, c'est le routage (qui part sur quel canal), la journalisation
 * (`MessageLog`), la distinction SKIPPED/FAILED et la règle d'échec — « tous
 * les canaux actifs échouent ⇒ l'événement est relancé ; au moins un passe ⇒
 * l'événement est clos, les échecs restent visibles ».
 *
 * `prisma` est remplacé par un faux avec état : les lignes `MessageLog`
 * sont réellement poussées dans un tableau vérifiable, comme le ferait la
 * base — l'esprit du faux `stock-tx.fake.ts`.
 */

jest.mock('../prisma/prisma.client', () => {
  const etat = { users: {} as Record<string, unknown>, logs: [] as unknown[] };
  return {
    prisma: {
      __etat: etat,
      user: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
          (etat.users as Record<string, { phone: string; email: string } | undefined>)[
            where.id
          ] ?? null,
        ),
      },
      messageLog: {
        create: jest.fn(async ({ data }: { data: unknown }) => {
          etat.logs.push(data);
          return data;
        }),
      },
    },
  };
});

const etat = (
  prisma as unknown as {
    __etat: {
      users: Record<string, { phone: string; email: string } | undefined>;
      logs: Array<Record<string, unknown>>;
    };
  }
).__etat;

function portWhatsapp(reponse: Partial<WhatsappResult>) {
  const appels: WhatsappMessage[] = [];
  return {
    appels,
    port: {
      send: jest.fn(async (m: WhatsappMessage): Promise<WhatsappResult> => {
        appels.push(m);
        return { sent: false, duplicate: false, ...reponse };
      }),
    } as unknown as import('./whatsapp.provider').WhatsappPort,
  };
}

function portEmail(reponse: Partial<EmailResult>) {
  const appels: EmailMessage[] = [];
  return {
    appels,
    port: {
      send: jest.fn(async (m: EmailMessage): Promise<EmailResult> => {
        appels.push(m);
        return { sent: false, duplicate: false, ...reponse };
      }),
    } as unknown as import('./email.provider').EmailPort,
  };
}

const notifications = { notify: jest.fn(async () => undefined) };

function dispatcher(whatsapp: unknown, email: unknown): MessagingDispatcher {
  return new MessagingDispatcher(
    notifications as never,
    whatsapp as never,
    email as never,
  );
}

const EVENEMENT = {
  id: 'evt-1',
  attempts: 0,
  payload: {
    userId: 'user-1',
    orderId: 'order-1',
    reference: 'AGR-2026-0001',
  },
};

beforeEach(() => {
  etat.users = {
    'user-1': { phone: '+2250700000001', email: 'client@example.ci' },
  };
  etat.logs = [];
  notifications.notify.mockClear();
});

describe('MessagingDispatcher — routage', () => {
  it('ORDER_CREATED ne part que sur PUSH (canal gratuit par défaut)', async () => {
    const wa = portWhatsapp({ sent: true });
    const em = portEmail({ sent: true });
    await dispatcher(wa.port, em.port).handle({
      ...EVENEMENT,
      type: 'ORDER_CREATED',
    });

    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(wa.appels).toHaveLength(0);
    expect(em.appels).toHaveLength(0);
    expect(etat.logs).toHaveLength(1);
    expect(etat.logs[0]).toMatchObject({ channel: 'PUSH', status: 'SENT' });
  });

  it('ORDER_CONFIRMED part sur les trois canaux', async () => {
    const wa = portWhatsapp({ sent: true });
    const em = portEmail({ sent: true });
    await dispatcher(wa.port, em.port).handle({
      ...EVENEMENT,
      type: 'ORDER_CONFIRMED',
    });

    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(wa.appels).toHaveLength(1);
    expect(em.appels).toHaveLength(1);
    // Clés d'idempotence par canal : un drain rejoué ne renvoie pas deux fois.
    expect(wa.appels[0].uniqueKey).toBe('evt-1:whatsapp');
    expect(em.appels[0].uniqueKey).toBe('evt-1:email');
    expect(etat.logs.filter((l) => l.status === 'SENT')).toHaveLength(3);
  });

  it('un événement non routé est clos sans rien faire', async () => {
    const wa = portWhatsapp({ sent: true });
    const em = portEmail({ sent: true });
    await dispatcher(wa.port, em.port).handle({
      ...EVENEMENT,
      type: 'TYPE_INCONNU',
    });

    expect(notifications.notify).not.toHaveBeenCalled();
    expect(etat.logs).toHaveLength(0);
  });
});

describe('MessagingDispatcher — politique d’échec', () => {
  it('tous les canaux échouent (push compris) ⇒ l’événement est relancé (throw)', async () => {
    // Le PUSH fait partie du routage : pour un échec TOTAL, il doit échouer
    // lui aussi — c'est la condition exacte de relance de l'événement.
    notifications.notify.mockRejectedValueOnce(new Error('push indisponible'));
    const wa = portWhatsapp({ detail: 'HTTP 500' });
    const em = portEmail({ detail: 'Erreur SMTP : timeout' });
    await expect(
      dispatcher(wa.port, em.port).handle({
        ...EVENEMENT,
        type: 'ORDER_CONFIRMED',
      }),
    ).rejects.toThrow(/échouée sur tous les canaux/);

    expect(etat.logs.filter((l) => l.status === 'FAILED')).toHaveLength(3);
  });

  it('échec partiel ⇒ l’événement est clos, l’échec reste visible au journal', async () => {
    const wa = portWhatsapp({ sent: true });
    const em = portEmail({ detail: 'Erreur SMTP : refus' });
    await expect(
      dispatcher(wa.port, em.port).handle({
        ...EVENEMENT,
        type: 'ORDER_CONFIRMED',
      }),
    ).resolves.toBeUndefined();

    const statuts = etat.logs.map((l) => [l.channel, l.status]);
    expect(statuts).toContainEqual(['WHATSAPP', 'SENT']);
    expect(statuts).toContainEqual(['EMAIL', 'FAILED']);
  });

  it('un canal non configuré est SKIPPED — pas une panne à relancer', async () => {
    const wa = portWhatsapp({ detail: 'Canal WhatsApp non configuré (WHATSAPP_API_URL absent).' });
    const em = portEmail({ sent: true });
    await dispatcher(wa.port, em.port).handle({
      ...EVENEMENT,
      type: 'ORDER_CONFIRMED',
    });

    expect(etat.logs.filter((l) => l.channel === 'WHATSAPP')).toMatchObject([
      { status: 'SKIPPED' },
    ]);
  });

  it('un client sans e-mail ne fait pas échouer la diffusion (EMAIL SKIPPED)', async () => {
    etat.users['user-1'] = { phone: '+2250700000001', email: '' };
    const wa = portWhatsapp({ sent: true });
    const em = portEmail({ sent: true });
    await dispatcher(wa.port, em.port).handle({
      ...EVENEMENT,
      type: 'ORDER_CONFIRMED',
    });

    expect(em.appels).toHaveLength(0);
    expect(etat.logs.filter((l) => l.channel === 'EMAIL')).toMatchObject([
      { status: 'SKIPPED' },
    ]);
  });
});

describe('MessagingDispatcher — journal', () => {
  it('chaque ligne MessageLog est rattachée à l’événement et au destinataire', async () => {
    const wa = portWhatsapp({ sent: true, providerMessageId: 'WA-42' });
    const em = portEmail({ sent: true });
    await dispatcher(wa.port, em.port).handle({
      ...EVENEMENT,
      type: 'PAYMENT_SUCCEEDED',
    });

    const logWhatsapp = etat.logs.find((l) => l.channel === 'WHATSAPP');
    expect(logWhatsapp).toMatchObject({
      outboxEventId: 'evt-1',
      userId: 'user-1',
      orderId: 'order-1',
      toAddress: '+2250700000001',
      providerMessageId: 'WA-42',
    });
  });
});
