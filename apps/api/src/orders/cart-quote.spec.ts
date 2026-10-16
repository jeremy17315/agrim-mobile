// Client généré ABSENT hors CI (produit par `prisma generate`) : mock
// virtuel (même remède que payments.reconcile.spec).
jest.mock('../../generated/prisma/client', () => ({
  PrismaClient: class {},
  Prisma: { join: (parts: unknown[]) => parts.join(', ') },
}), { virtual: true });

import { CartQuoteService } from './cart-quote.service';
import type { ReferralCreditService } from '../referrals/referral-credit.service';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  PromoCodesService,
  RemiseResolution,
} from '../promo-codes/promo-codes.service';

/**
 * Le devis panier, sous test — POLITIQUE de prix, pas transport.
 *
 * Le faux `prisma.db` tient un état minimal : des variantes avec leurs
 * promotions, la grille de livraison. Ce que l'on éprouve : le client
 * n'apporte que des identifiants et des quantités, et le serveur répond
 * le montant EXACT que le checkout facturera (même règle de prix, même
 * grille) — ou refuse.
 */

const GRILLE = {
  zones: {
    abidjan: { libelle: 'Abidjan', frais: 1000, delai: '24-48h' },
    interieur: { libelle: 'Intérieur', frais: 2500, delai: '3-5 jours' },
  },
  zoneParDefaut: 'interieur',
  retrait: { libelle: 'Retrait sur place', frais: 0, delai: 'immédiat' },
  livraisonOfferteSeuilKg: 10,
};

interface VarianteFausse {
  id: string;
  sku: string;
  label: string;
  price: number;
  weightGrams: number;
  stock: number;
  sourceRef: string | null;
  product: { name: string };
  promotions: { isActive: boolean; priceXof: number; startsAt: Date; endsAt: Date | null }[];
}

function variante(overrides: Partial<VarianteFausse>): VarianteFausse {
  return {
    id: 'var-1',
    sku: 'ATT-1KG',
    label: '1 kg',
    price: 2500,
    weightGrams: 1000,
    stock: 12,
    sourceRef: 'RB-ATT-01',
    product: { name: 'Attiéké' },
    promotions: [],
    ...overrides,
  };
}

function harnais(opts: {
  variants?: VarianteFausse[];
  grille?: Record<string, unknown> | null;
  /**
   * Décision de remise. Par défaut : aucune remise, code inconnu.
   *
   * Le devis ne parle PLUS directement au site : il passe par la règle
   * partagée avec le checkout (`PromoCodesService`), qui décide localement
   * pour les codes d'AGRIM et n'interroge le site que pour le reste.
   */
  remise?: Partial<RemiseResolution>;
  /** Solde de crédit de parrainage du compte connecté (`undefined` = visiteur). */
  creditBalanceXof?: number;
} = {}) {
  const db = {
    productVariant: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        (opts.variants ?? []).filter((v) => where.id.in.includes(v.id)),
      ),
    },
    companySetting: {
      findUnique: jest.fn(async () =>
        opts.grille === null ? null : { value: JSON.stringify(opts.grille ?? GRILLE) },
      ),
    },
  };
  const resolved: RemiseResolution = {
    status: 'ok',
    siteAvailable: true,
    remise: 0,
    code: null,
    message: null,
    reason: null,
    local: false,
    ...opts.remise,
  };
  const resolveRemise = jest.fn(async () => resolved);
  // Le crédit n'est lu QUE pour un compte connecté : le faux service note
  // pour quel compte il a été interrogé, ce qui permet d'affirmer qu'un
  // devis anonyme ne lit jamais de solde.
  const balance = jest.fn(async () => opts.creditBalanceXof ?? 0);
  const service = new CartQuoteService(
    { db } as unknown as PrismaService,
    { resolveRemise } as unknown as PromoCodesService,
    { balance } as unknown as ReferralCreditService,
  );
  return { service, db, resolveRemise, balance };
}

/** Code métier attendu : les exceptions NestJS portent le code dans
 * `exception.response.code` (convention maison, voir erreurs actives). */
const codeErreur = (code: string) => ({ response: { code } });

const items = (...paires: [string, number][]) =>
  paires.map(([variantId, quantity]) => ({ variantId, quantity }));

describe('CartQuoteService — le serveur calcule, le client affiche', () => {
  it('devis nominal : prix effectif (promo active), zone résolue, total sans frais', async () => {
    const { service } = harnais({
      variants: [
        variante({
          id: 'var-1',
          promotions: [
            {
              isActive: true,
              priceXof: 1990,
              startsAt: new Date('2026-09-01T00:00:00Z'),
              endsAt: null,
            },
          ],
        }),
        variante({ id: 'var-2', price: 4000, weightGrams: 2000 }),
      ],
    });

    const devis = await service.quote({
      items: items(['var-1', 2], ['var-2', 1]),
      city: 'Abidjan',
    });

    // Le prix AFFICHÉ est le prix FACTURÉ : la promotion s'applique.
    expect(devis.items[0].unitPrice).toBe(1990);
    expect(devis.items[1].unitPrice).toBe(4000);
    // Sous-total 2×1990 + 4000 = 7980. Abidjan a une zone, un délai — et
    // AUCUN frais encaissé : le total reste le sous-total (site, /commander).
    expect(devis.subtotal).toBe(7980);
    expect(devis.zone).toBe('abidjan');
    expect(devis.deliveryFee).toBe(0);
    expect(devis.delivery.statut).toBe('A_CONFIRMER');
    expect(devis.delivery.message).toBe('À confirmer');
    expect(devis.delivery.delai).toBe('24-48h');
    expect(devis.total).toBe(7980);
    expect(devis.currency).toBe('XOF');
    // Poids 2×1kg + 2kg = 4kg, seuil 10 ⇒ il manque 6 kg pour l'offerte.
    expect(devis.weightKg).toBe(4);
    expect(devis.weightUntilFreeDeliveryKg).toBe(6);
  });

  it('applique la remise décidée par la règle partagée, et rien d’autre', async () => {
    const { service } = harnais({
      variants: [variante({})],
      remise: { status: 'ok', remise: 500, siteAvailable: true },
    });

    const devis = await service.quote({
      items: items(['var-1', 2]),
      city: 'Abidjan',
    });

    expect(devis.subtotal).toBe(5000);
    expect(devis.remise).toBe(500);
    expect(devis.total).toBe(4500);
    expect(devis.deliveryFee).toBe(0);
  });

  it('calculateur du site injoignable ⇒ aucune remise inventée, et le client est prévenu', async () => {
    const { service } = harnais({
      variants: [variante({})],
      remise: { status: 'ok', remise: 0, siteAvailable: false },
    });

    const devis = await service.quote({
      items: items(['var-1', 2]),
      city: 'Abidjan',
      codePromo: 'BIENVENUE10',
    });

    expect(devis.remise).toBe(0);
    expect(devis.remiseStatus).toBe('unavailable');
    expect(devis.total).toBe(5000);
  });

  it('un code refusé est ANNONCÉ comme tel, avec son motif', async () => {
    const { service } = harnais({
      variants: [variante({})],
      remise: {
        status: 'refused',
        remise: 0,
        code: 'USE',
        message: 'Ce code promo a expiré.',
        reason: 'EXPIRE',
        local: true,
      },
    });

    const devis = await service.quote({
      items: items(['var-1', 1]),
      city: 'Abidjan',
      codePromo: 'USE',
    });

    expect(devis.remiseStatus).toBe('refused');
    expect(devis.promoMessage).toBe('Ce code promo a expiré.');
    expect(devis.remise).toBe(0);
    expect(devis.total).toBe(2500);
  });

  it('la remise locale est appliquée même si le site est injoignable', async () => {
    // Un code créé par AGRIM dans l'application doit fonctionner sans le site :
    // c'est ce qui rend une promotion locale fiable.
    const { service } = harnais({
      variants: [variante({})],
      remise: {
        status: 'ok',
        remise: 250,
        code: 'AGRIM10',
        message: 'Remise AGRIM10 appliquée.',
        local: true,
        siteAvailable: false,
      },
    });

    const devis = await service.quote({
      items: items(['var-1', 1]),
      city: 'Abidjan',
      codePromo: 'AGRIM10',
    });

    expect(devis.remiseStatus).toBe('ok');
    expect(devis.remise).toBe(250);
    expect(devis.total).toBe(2250);
    expect(devis.promoCode).toBe('AGRIM10');
  });

  it('une promotion périmée ou future ne change PAS le prix affiché', async () => {
    const { service } = harnais({
      variants: [
        variante({
          promotions: [
            {
              isActive: true,
              priceXof: 990,
              startsAt: new Date('2001-08-01T00:00:00Z'),
              endsAt: new Date('2001-08-31T00:00:00Z'),
            },
            {
              isActive: true,
              priceXof: 990,
              startsAt: new Date('2099-10-01T00:00:00Z'),
              endsAt: null,
            },
          ],
        }),
      ],
    });

    const devis = await service.quote({
      items: items(['var-1', 1]),
      city: 'Abidjan',
    });

    expect(devis.items[0].unitPrice).toBe(2500);
    expect(devis.total).toBe(2500);
  });

  it('quantités dupliquées : fusionnées en une ligne (2+3 = 5)', async () => {
    const { service } = harnais({ variants: [variante({})] });

    const devis = await service.quote({
      items: items(['var-1', 2], ['var-1', 3]),
      city: 'Abidjan',
    });

    expect(devis.items).toHaveLength(1);
    expect(devis.items[0].quantity).toBe(5);
    expect(devis.subtotal).toBe(5 * 2500);
  });

  it('le seuil de poids de la grille ne change plus le total', async () => {
    const { service } = harnais({
      variants: [
        variante({ weightGrams: 6000 }),
        variante({ id: 'var-2', weightGrams: 5000 }),
      ],
    });

    const devis = await service.quote({
      items: items(['var-1', 1], ['var-2', 1]),
      city: 'Abidjan',
    });

    expect(devis.weightKg).toBe(11);
    expect(devis.weightUntilFreeDeliveryKg).toBe(0);
    // Au-dessus du seuil comme en dessous : aucun frais n'est encaissé.
    expect(devis.deliveryFee).toBe(0);
    expect(devis.total).toBe(devis.subtotal);
  });

  it('ville inconnue ⇒ zone par défaut de la grille (jamais un tarif inventé)', async () => {
    const { service } = harnais({ variants: [variante({})] });

    const devis = await service.quote({
      items: items(['var-1', 1]),
      city: 'Sur la Lune',
    });

    expect(devis.zone).toBe('interieur');
    expect(devis.deliveryFee).toBe(0);
    expect(devis.delivery.message).toBe('À confirmer');
  });

  it('une variante inconnue ou retirée du rayon ⇒ 404 métier', async () => {
    const { service } = harnais({ variants: [variante({})] });

    await expect(
      service.quote({ items: items(['var-fantome', 1]) }),
    ).rejects.toMatchObject(codeErreur('VARIANT_NOT_FOUND'));
  });

  it('grille absente ⇒ 503 : on ne facture jamais un forfait inventé', async () => {
    const { service } = harnais({ variants: [variante({})], grille: null });

    await expect(
      service.quote({ items: items(['var-1', 1]), city: 'Abidjan' }),
    ).rejects.toMatchObject(codeErreur('DELIVERY_GRID_UNAVAILABLE'));
  });

  it('grille corrompue ⇒ 503 aussi (un montant plausible mais faux serait pire)', async () => {
    const { service } = harnais({ variants: [variante({})], grille: { zones: {} } });

    await expect(
      service.quote({ items: items(['var-1', 1]), city: 'Abidjan' }),
    ).rejects.toMatchObject(codeErreur('DELIVERY_GRID_UNAVAILABLE'));
  });
});

describe('CartQuoteService — les zones proposées au client', () => {
  it('expose les zones de la grille du site, sans en écrire aucune en dur', async () => {
    const { service } = harnais({});

    const proposees = await service.zones();

    expect(proposees.zones).toEqual([
      { value: 'abidjan', label: 'Abidjan', delai: '24-48h', frais: 1000 },
      { value: 'interieur', label: 'Intérieur', delai: '3-5 jours', frais: 2500 },
    ]);
    expect(proposees.defaultZone).toBe('interieur');
  });

  it('sans grille connue ⇒ 503, jamais une liste inventée', async () => {
    const { service } = harnais({ grille: null });

    await expect(service.zones()).rejects.toMatchObject(
      codeErreur('DELIVERY_GRID_UNAVAILABLE'),
    );
  });
});

describe('CartQuoteService — contract de service', () => {
  it('ne réserve aucun stock : aucune écriture, le devis est réentrant', async () => {
    const { service, db } = harnais({ variants: [variante({ stock: 3 })] });

    await service.quote({ items: items(['var-1', 5]), city: 'Abidjan' });

    // Le devis ne qu'aucune écriture : les mutations du faux doivent être
    // limitées aux lectures déclarées.
    const mutateurs = Object.values(db).flatMap((modele) =>
      Object.keys(modele).filter((k) => k !== 'findMany' && k !== 'findUnique'),
    );
    expect(mutateurs).toHaveLength(0);
  });

  it('le stock est éCHOUÉ au client (griser les quantités), sans le réserver', async () => {
    const { service } = harnais({ variants: [variante({ stock: 3 })] });

    const devis = await service.quote({
      items: items(['var-1', 5]),
      city: 'Abidjan',
    });

    expect(devis.items[0].stock).toBe(3);
  });
});

describe('CartQuoteService — le crédit de parrainage entre dans le devis', () => {
  it('un devis ANONYME ne lit aucun solde et ne déduit rien', async () => {
    const { service, balance } = harnais({ variants: [variante({ price: 6000 })] });

    const devis = await service.quote({
      items: items(['var-1', 1]),
      city: 'Abidjan',
    });

    // Le crédit appartient à un COMPTE : sans session, il n'y a rien à lire.
    // C'est la règle qui empêche qu'un numéro déclaré dans le corps de la
    // requête donne accès au crédit de quelqu'un d'autre.
    expect(balance).not.toHaveBeenCalled();
    expect(devis.credit).toBe(0);
    expect(devis.creditBalanceXof).toBe(0);
    expect(devis.total).toBe(6000);
  });

  it('applique le crédit du compte connecté et annonce le solde restant', async () => {
    const { service } = harnais({
      variants: [variante({ price: 6000 })],
      creditBalanceXof: 1_000,
    });

    const devis = await service.quote(
      { items: items(['var-1', 1]), city: 'Abidjan' },
      'compte-1',
    );

    expect(devis.subtotal).toBe(6000);
    expect(devis.credit).toBe(1_000);
    // Le solde est celui d'AVANT application : l'écran peut dire « il vous
    // restera 0 » sans relire le compte.
    expect(devis.creditBalanceXof).toBe(1_000);
    expect(devis.total).toBe(5000);
  });

  it('plafonne le crédit au reste à payer : un panier ne devient jamais négatif', async () => {
    const { service } = harnais({
      variants: [variante({ price: 1_000 })],
      creditBalanceXof: 5_000,
    });

    const devis = await service.quote(
      { items: items(['var-1', 1]), city: 'Abidjan' },
      'compte-1',
    );

    // 1 000 de panier, 5 000 de crédit : 1 000 consommés, PAS 5 000. Le solde
    // non utilisé reste sur le compte pour la commande suivante.
    expect(devis.credit).toBe(1_000);
    expect(devis.total).toBe(0);
  });

  it('le crédit vient APRÈS la remise, jamais avant', async () => {
    const { service } = harnais({
      variants: [variante({ price: 6_000 })],
      remise: { status: 'ok', remise: 1_000, code: 'BIENVENUE10', local: true },
      creditBalanceXof: 10_000,
    });

    const devis = await service.quote(
      { items: items(['var-1', 1]), city: 'Abidjan' },
      'compte-1',
    );

    // 6 000 − 1 000 de remise − 5 000 de crédit (plafonné) = 0, pas −1 000.
    expect(devis.remise).toBe(1_000);
    expect(devis.credit).toBe(5_000);
    expect(devis.total).toBe(0);
  });
});
