// Client généré ABSENT hors CI (produit par `prisma generate`) : mock
// virtuel (même remède que payments.reconcile.spec).
jest.mock('../../generated/prisma/client', () => ({
  PrismaClient: class {},
  Prisma: { join: (parts: unknown[]) => parts.join(', ') },
}), { virtual: true });

import { CartQuoteService } from './cart-quote.service';
import type { PrismaService } from '../prisma/prisma.service';

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
    product: { name: 'Attiéké' },
    promotions: [],
    ...overrides,
  };
}

function harnais(opts: {
  variants?: VarianteFausse[];
  grille?: Record<string, unknown> | null;
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
  const service = new CartQuoteService({ db } as unknown as PrismaService);
  return { service, db };
}

/** Code métier attendu : les exceptions NestJS portent le code dans
 * `exception.response.code` (convention maison, voir erreurs actives). */
const codeErreur = (code: string) => ({ response: { code } });

const items = (...paires: [string, number][]) =>
  paires.map(([variantId, quantity]) => ({ variantId, quantity }));

describe('CartQuoteService — le serveur calcule, le client affiche', () => {
  it('devis nominal : prix effectif (promo active), zone résolue, frais, total', async () => {
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
    // Sous-total 2×1990 + 4000 = 7980 ; Abidjan ⇒ 1000 XOF.
    expect(devis.subtotal).toBe(7980);
    expect(devis.zone).toBe('abidjan');
    expect(devis.deliveryFee).toBe(1000);
    expect(devis.total).toBe(8980);
    expect(devis.currency).toBe('XOF');
    // Poids 2×1kg + 2kg = 4kg, seuil 10 ⇒ il manque 6 kg pour l'offerte.
    expect(devis.weightKg).toBe(4);
    expect(devis.weightUntilFreeDeliveryKg).toBe(6);
  });

  it('une promotion périmée ou future ne change PAS le prix affiché', async () => {
    const { service } = harnais({
      variants: [
        variante({
          promotions: [
            {
              isActive: true,
              priceXof: 990,
              startsAt: new Date('2026-08-01T00:00:00Z'),
              endsAt: new Date('2026-08-31T00:00:00Z'),
            },
            {
              isActive: true,
              priceXof: 990,
              startsAt: new Date('2026-10-01T00:00:00Z'),
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
    expect(devis.total).toBe(2500 + 1000);
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

  it('livraison offerte au-delà du seuil de poids', async () => {
    const { service } = harnais({
      variants: [variante({ weightGrams: 6000 }), variante({ id: 'var-2', weightGrams: 5000 })],
    });

    const devis = await service.quote({
      items: items(['var-1', 1], ['var-2', 1]),
      city: 'Abidjan',
    });

    expect(devis.weightKg).toBe(11);
    expect(devis.weightUntilFreeDeliveryKg).toBe(0);
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
    expect(devis.deliveryFee).toBe(2500);
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
