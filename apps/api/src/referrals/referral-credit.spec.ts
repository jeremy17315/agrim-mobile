// Client généré ABSENT hors CI (produit par `prisma generate`) : mock
// virtuel (même remède que cart-quote.spec).
jest.mock('../../generated/prisma/client', () => ({
  PrismaClient: class {},
  Prisma: { join: (parts: unknown[]) => parts.join(', ') },
}), { virtual: true });

import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { refundOrderCredit } from './credit-refund';
import { ReferralCreditService } from './referral-credit.service';

/**
 * Le crédit de parrainage DÉPENSABLE, sous test.
 *
 * Ce qui est éprouvé ici ne peut pas l'être par un simple appel de fonction :
 * la consommation est un UPDATE CONDITIONNEL, donc le comportement dépend de
 * l'état du solde au moment de l'écriture, pas de la lecture qui l'a précédée.
 * Le faux client transactionnel tient un solde RÉEL et refuse les décréments
 * que PostgreSQL refuserait (`WHERE creditBalanceXof >= montant`).
 */

/** Faux magasin : soldes de crédit, indexés par compte. */
function fauxSoldes(initiaux: Record<string, number>) {
  const soldes = { ...initiaux };
  return {
    soldes,
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id in soldes ? { creditBalanceXof: soldes[where.id] } : null,
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; creditBalanceXof?: { gte?: number } };
          data: { creditBalanceXof: { decrement?: number; increment?: number } };
        }) => {
          const solde = soldes[where.id];
          if (solde === undefined) return { count: 0 };
          const seuil = where.creditBalanceXof?.gte;
          if (seuil !== undefined && solde < seuil) return { count: 0 };
          const delta = data.creditBalanceXof.decrement
            ? -data.creditBalanceXof.decrement
            : (data.creditBalanceXof.increment ?? 0);
          soldes[where.id] = solde + delta;
          return { count: 1 };
        },
      ),
    },
  };
}

function service(soldes: Record<string, number>) {
  const magasin = fauxSoldes(soldes);
  return {
    magasin,
    credit: new ReferralCreditService({ db: magasin } as unknown as PrismaService),
  };
}

/** Le faux magasin est présenté comme le client transactionnel de Prisma :
 * ce qui compte, c'est le protocole appelé, pas le type réel. */
const tx = (magasin: unknown) => magasin as unknown as Prisma.TransactionClient;

describe('ReferralCreditService — consommer le crédit', () => {
  it('débite exactement le montant demandé quand le solde le couvre', async () => {
    const { credit, magasin } = service({ compte: 1_000 });

    await expect(credit.consume(tx(magasin), 'compte', 1_000)).resolves.toBe(1_000);
    expect(magasin.soldes['compte']).toBe(0);
  });

  it('ne consomme jamais plus que le solde', async () => {
    const { credit, magasin } = service({ compte: 1_000 });

    // Le devis a pu promettre 5 000 sur un solde qui valait 1 000 à un instant :
    // la consommation, elle, s'arrête au solde réel.
    await expect(credit.consume(tx(magasin), 'compte', 5_000)).resolves.toBe(1_000);
    expect(magasin.soldes['compte']).toBe(0);
  });

  it('rattrape un solde qui a fondu entre la lecture et l’écriture', async () => {
    const { credit, magasin } = service({ compte: 1_000 });
    // Une autre commande du même compte consomme 400 AVANT notre écriture : la
    // lecture du devis (1 000) est périmée.
    const updateMany = magasin.user.updateMany;
    updateMany.mockImplementationOnce(async () => {
      magasin.soldes['compte'] = 600;
      return { count: 0 };
    });

    // 600 réellement consommés : la commande refacturera les 400 manquants au
    // lieu d'encaisser un crédit qui n'existait plus.
    await expect(credit.consume(tx(magasin), 'compte', 1_000)).resolves.toBe(600);
    expect(magasin.soldes['compte']).toBe(0);
  });

  it('renonce (0) plutôt que de boucler quand le solde bouge sans arrêt', async () => {
    const { credit, magasin } = service({ compte: 1_000 });
    // L'écriture n'aboutit jamais : deux tentatives, puis on facture sans
    // crédit. Faire patienter une commande sous verrou serait pire.
    magasin.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(credit.consume(tx(magasin), 'compte', 500)).resolves.toBe(0);
    expect(magasin.user.updateMany).toHaveBeenCalledTimes(2);
    expect(magasin.soldes['compte']).toBe(1_000);
  });

  it('un solde nul, un montant nul ou un compte inconnu ne font aucune écriture', async () => {
    const { credit, magasin } = service({ vide: 0 });

    await expect(credit.consume(tx(magasin), 'vide', 1_000)).resolves.toBe(0);
    await expect(credit.consume(tx(magasin), 'compte', 0)).resolves.toBe(0);
    await expect(credit.consume(tx(magasin), 'compte', -500)).resolves.toBe(0);
    await expect(credit.consume(tx(magasin), 'inconnu', 1_000)).resolves.toBe(0);
    // Aucune écriture : demander 0 n'est pas une raison de toucher la base.
    expect(magasin.user.updateMany).not.toHaveBeenCalled();
  });

  it('la lecture du solde ne rend jamais un négatif', async () => {
    const { credit } = service({ dette: -300 });

    // Un solde négatif ne doit pas devenir un crédit : la commande n'augmente
    // pas la facture du client.
    await expect(credit.balance('dette')).resolves.toBe(0);
    await expect(credit.balance('inconnu')).resolves.toBe(0);
  });
});

/** Faux magasin d'UNE commande : crédit, propriétaire, remboursement. */
function fauxOrdre(init: {
  credit: number;
  creditUserId: string | null;
  soldes: Record<string, number>;
}) {
  let etat = {
    creditRefundedAt: null as Date | null,
    credit: init.credit,
    creditUserId: init.creditUserId,
  };
  const soldes = { ...init.soldes };
  const magasin = {
    soldes,
    etat: () => etat,
    order: {
      findUnique: jest.fn(async () => ({
        credit: etat.credit,
        creditUserId: etat.creditUserId,
      })),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { creditRefundedAt: null; credit: { gt: number } };
          data: { creditRefundedAt: Date };
        }) => {
          if (etat.creditRefundedAt !== null) return { count: 0 };
          if (etat.credit <= where.credit.gt) return { count: 0 };
          etat = { ...etat, creditRefundedAt: data.creditRefundedAt };
          return { count: 1 };
        },
      ),
    },
    user: {
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { creditBalanceXof: { increment: number } };
        }) => {
          if (!(where.id in soldes)) return { count: 0 };
          soldes[where.id] += data.creditBalanceXof.increment;
          return { count: 1 };
        },
      ),
    },
  };
  return magasin;
}

describe('refundOrderCredit — rendre le crédit d’une commande annulée', () => {
  it('rend au compte exactement le crédit consommé', async () => {
    const magasin = fauxOrdre({
      credit: 1_000,
      creditUserId: 'parrain',
      soldes: { parrain: 0 },
    });

    await expect(refundOrderCredit(tx(magasin), 'commande-1')).resolves.toBe(1_000);
    expect(magasin.soldes['parrain']).toBe(1_000);
    expect(magasin.etat().creditRefundedAt).toBeInstanceOf(Date);
  });

  it('ne rend JAMAIS deux fois le même crédit', async () => {
    const magasin = fauxOrdre({
      credit: 1_000,
      creditUserId: 'parrain',
      soldes: { parrain: 0 },
    });

    await refundOrderCredit(tx(magasin), 'commande-1');
    // Un second chemin d'annulation (client, bureau, expiration) ne doit pas
    // créer de l'argent : l'écriture conditionnelle refuse.
    await expect(refundOrderCredit(tx(magasin), 'commande-1')).resolves.toBe(0);
    expect(magasin.soldes['parrain']).toBe(1_000);
  });

  it('ne rend rien pour une commande qui n’a pas utilisé de crédit', async () => {
    const magasin = fauxOrdre({
      credit: 0,
      creditUserId: 'parrain',
      soldes: { parrain: 500 },
    });

    await expect(refundOrderCredit(tx(magasin), 'commande-2')).resolves.toBe(0);
    expect(magasin.soldes['parrain']).toBe(500);
    // Aucune écriture du tout : la commande n'est même pas marquée.
    expect(magasin.order.updateMany).not.toHaveBeenCalled();
  });

  it('ne rend rien quand aucun compte n’a payé (commande anonyme)', async () => {
    const magasin = fauxOrdre({
      credit: 1_000,
      creditUserId: null,
      soldes: {},
    });

    await expect(refundOrderCredit(tx(magasin), 'commande-3')).resolves.toBe(0);
    expect(magasin.order.updateMany).not.toHaveBeenCalled();
  });

  it('compte disparu : rien à créditer, mais la commande est marquée traitée', async () => {
    const magasin = fauxOrdre({
      credit: 1_000,
      creditUserId: 'supprime',
      soldes: {},
    });

    await expect(refundOrderCredit(tx(magasin), 'commande-4')).resolves.toBe(0);
    // Marquée quand même : sans cela, un balayage ultérieur essaierait
    // indéfiniment de rendre un crédit à un compte qui n'existe plus.
    expect(magasin.etat().creditRefundedAt).toBeInstanceOf(Date);
  });
});
