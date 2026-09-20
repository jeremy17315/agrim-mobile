import { Prisma } from '../../generated/prisma/client';

import { CatalogService, assertPromotionDates } from './catalog.service';
import { PromotionsService } from './promotions.service';

/**
 * Administration du catalogue — tests unitaires (logique et garde-fous).
 *
 * Deux mocks, pour deux raisons distinctes :
 *  - le client Prisma GÉNÉRÉ est remplacé par un équivalent minimal : ces
 *    services n'y emploient que `PrismaClientKnownRequestError` (reconnaissance
 *    des violations d'unicité). En CI le vrai client existe ; il est masqué
 *    par ce module à l'exécution, et l'`instanceof` reste cohérent des deux
 *    côtés du mock ;
 *  - `prisma` devient un faux AVEC ÉTAT (même esprit que `stock-tx.fake.ts`)
 *    : les écritures existent réellement dans des maps vérifiables, ce qui
 *    permet de prouver « l'ancienne promo est désactivée » ou « les variantes
 *    suivent le produit » plutôt que de compter des appels.
 */

// `{ virtual: true }` : le client généré n'existe pas hors CI (il faut
// `prisma generate` pour le produire). Le mock virtuel le remplace ici et
// le masque en CI — valeurs identiques, assertions inchangées.
jest.mock('../../generated/prisma/client', () => {
  class PrismaClientKnownRequestError extends Error {
    readonly code: string;
    constructor(message: string, info: { code: string; clientVersion?: string }) {
      super(message);
      this.name = 'PrismaClientKnownRequestError';
      this.code = info.code;
    }
  }
  return {
    Prisma: { PrismaClientKnownRequestError },
    StockMovementType: {
      ENTREE: 'ENTREE',
      SORTIE: 'SORTIE',
      AJUSTEMENT: 'AJUSTEMENT',
      COMMANDE: 'COMMANDE',
      ANNULATION: 'ANNULATION',
      RETOUR: 'RETOUR',
    },
  };
}, { virtual: true });

type Rec = Record<string, unknown> & {
  id: string;
  [k: string]: unknown;
};

const { etat } = jest.requireMock('../prisma/prisma.client') as {
  etat: {
    categories: Map<string, Rec>;
    products: Map<string, Rec>;
    variants: Map<string, Rec>;
    promotions: Map<string, Rec>;
    seq: number;
    failureP2002: Error | null;
  };
};

jest.mock('../prisma/prisma.client', () => {
  const etat = {
    categories: new Map<string, Rec>(),
    products: new Map<string, Rec>(),
    variants: new Map<string, Rec>(),
    promotions: new Map<string, Rec>(),
    seq: 0,
    /** Prochaine création à faire échouer en P2002 (test de course). */
    failureP2002: null as Error | null,
  };

  const echouerSiProgrammé = (): void => {
    if (etat.failureP2002) {
      const e = etat.failureP2002;
      etat.failureP2002 = null;
      throw e;
    }
  };

  const category = {
    create: async ({ data }: { data: Rec }) => {
      echouerSiProgrammé();
      const rec = { id: `rec-${++etat.seq}`, ...data } as Rec;
      etat.categories.set(rec.id, rec);
      return rec;
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      etat.categories.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Rec }) => {
      const rec = etat.categories.get(where.id);
      if (!rec) throw new Error('catégorie inconnue du faux');
      return Object.assign(rec, data);
    },
  };

  const product = {
    create: async ({ data }: { data: { variants?: { create?: Rec[] } } & Rec }) => {
      echouerSiProgrammé();
      const { variants, ...reste } = data;
      const rec = { id: `rec-${++etat.seq}`, ...reste } as Rec;
      etat.products.set(rec.id, rec);
      rec.variants = (variants?.create ?? []).map((v) => {
        const vr = { id: `rec-${++etat.seq}`, productId: rec.id, ...v } as Rec;
        etat.variants.set(vr.id, vr);
        return vr;
      });
      return rec;
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      etat.products.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Rec }) => {
      const rec = etat.products.get(where.id);
      if (!rec) throw new Error('produit inconnu du faux');
      return Object.assign(rec, data);
    },
  };

  const productVariant = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      etat.variants.get(where.id) ?? null,
    create: async ({ data }: { data: Rec }) => {
      echouerSiProgrammé();
      const rec = { id: `rec-${++etat.seq}`, ...data } as Rec;
      etat.variants.set(rec.id, rec);
      return rec;
    },
    update: async ({ where, data }: { where: { id: string }; data: Rec }) => {
      const rec = etat.variants.get(where.id);
      if (!rec) throw new Error('variante inconnue du faux');
      return Object.assign(rec, data);
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { productId?: string; id?: string };
      data: Rec;
    }) => {
      let count = 0;
      for (const rec of etat.variants.values()) {
        if (where.productId && rec.productId !== where.productId) continue;
        if (where.id && rec.id !== where.id) continue;
        Object.assign(rec, data);
        count += 1;
      }
      return { count };
    },
  };

  const promotion = {
    create: async ({ data }: { data: Rec }) => {
      echouerSiProgrammé();
      const rec = {
        id: `rec-${++etat.seq}`,
        createdAt: new Date(),
        // Défaut de colonne du schéma : le vrai Prisma l'applique, le faux
        // doit le faire aussi, sinon les tests prouvent un monde faux.
        isActive: true,
        ...data,
      } as Rec;
      etat.promotions.set(rec.id, rec);
      return rec;
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      etat.promotions.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Rec }) => {
      const rec = etat.promotions.get(where.id);
      if (!rec) throw new Error('promotion inconnue du faux');
      return Object.assign(rec, data);
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { variantId?: string; isActive?: boolean };
      data: Rec;
    }) => {
      let count = 0;
      for (const rec of etat.promotions.values()) {
        if (where.variantId && rec.variantId !== where.variantId) continue;
        if (where.isActive !== undefined && rec.isActive !== where.isActive)
          continue;
        Object.assign(rec, data);
        count += 1;
      }
      return { count };
    },
    findMany: async ({ where }: { where: Rec }) =>
      [...etat.promotions.values()].filter((r) => {
        if (where?.variantId && r.variantId !== where.variantId) return false;
        if (where?.isActive !== undefined && r.isActive !== where.isActive)
          return false;
        return true;
      }),
  };

  const prisma = {
    category,
    product,
    productVariant,
    promotion,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };
  return { prisma, etat };
});

/** Les exceptions NestJS rangent le code métier dans `response`. */
const codeErreur = (code: string) => ({ response: { code } });

function services() {
  const catalog = new CatalogService();
  const promotions = new PromotionsService(catalog);
  return { catalog, promotions };
}

/** État de départ : une catégorie, un produit, une variante, une promo active. */
function semer(): void {
  etat.categories.clear();
  etat.products.clear();
  etat.variants.clear();
  etat.promotions.clear();
  etat.seq = 0;
  etat.failureP2002 = null;

  etat.categories.set('cat-1', { id: 'cat-1', slug: 'riz', name: 'Riz' });
  etat.products.set('prod-1', {
    id: 'prod-1',
    slug: 'djassa',
    name: 'Riz Djassa',
    isActive: true,
  });
  etat.variants.set('var-1', {
    id: 'var-1',
    productId: 'prod-1',
    sku: 'RB-DJA-05',
    label: 'Sac de 5 kg',
    price: 2250,
    weightGrams: 5000,
    isAvailable: true,
  });
  etat.promotions.set('promo-old', {
    id: 'promo-old',
    variantId: 'var-1',
    priceXof: 2100,
    label: 'Ancienne',
    isActive: true,
    startsAt: new Date('2026-01-01'),
    endsAt: null,
  });
}

afterEach(() => {
  delete process.env.STOCK_MODE;
});

describe('Verrou de bascule (STOCK_MODE)', () => {
  it('refuse toute écriture tant que le site possède le catalogue (503)', async () => {
    process.env.STOCK_MODE = 'site';
    semer();
    const { catalog, promotions } = services();

    await expect(
      catalog.createCategory({ slug: 'a', name: 'A' } as never),
    ).rejects.toMatchObject(codeErreur('CATALOG_WRITES_ON_SITE'));

    await expect(
      promotions.create(
        { variantId: 'var-1', priceXof: 1990, label: 'X' } as never,
        'admin-1',
      ),
    ).rejects.toMatchObject(codeErreur('CATALOG_WRITES_ON_SITE'));

    expect(etat.promotions.get('promo-old')?.isActive).toBe(true); // rien n'a bougé
  });
});

describe('PromotionsService.create', () => {
  beforeEach(() => {
    process.env.STOCK_MODE = 'local';
    semer();
  });

  it('désactive l’active existante et pose la nouvelle, dans la même transaction', async () => {
    const { promotions } = services();

    const rec = (await promotions.create(
      { variantId: 'var-1', priceXof: 1990, label: 'Rentrée' } as never,
      'admin-1',
    )) as Rec;

    expect(etat.promotions.get('promo-old')?.isActive).toBe(false);
    expect(etat.promotions.get(rec.id)).toMatchObject({
      variantId: 'var-1',
      priceXof: 1990,
      label: 'Rentrée',
      isActive: true,
    });
  });

  it('refuse un prix promotionnel au-dessus (ou égal) au prix de base', async () => {
    const { promotions } = services();

    await expect(
      promotions.create(
        { variantId: 'var-1', priceXof: 2250, label: 'Fausse promo' } as never,
        'admin-1',
      ),
    ).rejects.toMatchObject(codeErreur('PROMOTION_PRICE_INVALID'));

    // L'ancienne promo reste active : rien n'a bougé.
    expect(etat.promotions.get('promo-old')?.isActive).toBe(true);
  });

  it('refuse des dates incohérentes', async () => {
    const { promotions } = services();

    await expect(
      promotions.create(
        {
          variantId: 'var-1',
          priceXof: 1990,
          label: 'X',
          startsAt: '2026-10-01T00:00:00Z',
          endsAt: '2026-09-01T00:00:00Z',
        } as never,
        'admin-1',
      ),
    ).rejects.toMatchObject(codeErreur('PROMOTION_DATES_INVALID'));
  });

  it('une course entre deux créations est tranchée par l’index (409)', async () => {
    const { promotions } = services();
    etat.failureP2002 = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
    });

    await expect(
      promotions.create(
        { variantId: 'var-1', priceXof: 1990, label: 'Course' } as never,
        'admin-1',
      ),
    ).rejects.toMatchObject(codeErreur('PROMOTION_ALREADY_ACTIVE'));
  });

  it('variante inconnue ⇒ 404', async () => {
    const { promotions } = services();

    await expect(
      promotions.create(
        { variantId: 'ghost', priceXof: 10, label: 'X' } as never,
        'admin-1',
      ),
    ).rejects.toMatchObject(codeErreur('VARIANT_NOT_FOUND'));
  });
});

describe('CatalogService — produits', () => {
  beforeEach(() => {
    process.env.STOCK_MODE = 'local';
    semer();
  });

  it('crée un produit avec ses variantes', async () => {
    const { catalog } = services();

    const rec = (await catalog.createProduct({
      categoryId: 'cat-1',
      slug: 'royal',
      name: 'Riz Royal',
      variants: [
        { sku: 'RB-ROY-25', label: 'Sac 25 kg', weightGrams: 25000, price: 9500 },
      ],
    } as never)) as Rec;

    expect(etat.products.get(rec.id)?.name).toBe('Riz Royal');
    const variantes = [...etat.variants.values()].filter(
      (v) => v.productId === rec.id,
    );
    expect(variantes).toHaveLength(1);
    expect(variantes[0]).toMatchObject({ sku: 'RB-ROY-25', price: 9500 });
  });

  it('catégorie inconnue ⇒ 404, sans produit écrit', async () => {
    const { catalog } = services();

    await expect(
      catalog.createProduct({
        categoryId: 'ghost',
        slug: 'x',
        name: 'X',
        variants: [{ sku: 'S', label: 'L', weightGrams: 1, price: 1 }],
      } as never),
    ).rejects.toMatchObject(codeErreur('CATEGORY_NOT_FOUND'));

    expect(etat.products.size).toBe(1); // seulement le produit semé
  });

  it('conflit de SKU/slug (P2002) ⇒ 409 lisible', async () => {
    const { catalog } = services();
    etat.failureP2002 = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
    });

    await expect(
      catalog.createProduct({
        categoryId: 'cat-1',
        slug: 'doublon',
        name: 'Doublon',
        variants: [{ sku: 'RB-X', label: 'L', weightGrams: 1, price: 1 }],
      } as never),
    ).rejects.toMatchObject(codeErreur('CATALOG_REFERENCE_CONFLICT'));
  });

  it('désactiver un produit retire ses variantes du rayon ; réactiver ne les remet pas', async () => {
    const { catalog } = services();

    await catalog.updateProduct('prod-1', { isActive: false });
    expect(etat.products.get('prod-1')?.isActive).toBe(false);
    expect(etat.variants.get('var-1')?.isAvailable).toBe(false);

    await catalog.updateProduct('prod-1', { isActive: true });
    // On ne remet JAMAIS en vente en bloc ce qu'on avait retiré.
    expect(etat.variants.get('var-1')?.isAvailable).toBe(false);
  });

  it('« suppression » = retrait du rayon (produit + variantes), jamais physique', async () => {
    const { catalog } = services();

    await expect(catalog.deleteProduct('prod-1')).resolves.toMatchObject({
      isActive: false,
    });

    expect(etat.products.has('prod-1')).toBe(true); // toujours là
    expect(etat.products.get('prod-1')?.isActive).toBe(false);
    expect(etat.variants.get('var-1')?.isAvailable).toBe(false);
  });
});

describe('assertPromotionDates', () => {
  it('refuse une fin antérieure au début', () => {
    expect(() =>
      assertPromotionDates(new Date('2026-10-01'), new Date('2026-09-01')),
    ).toThrow();
  });

  it('accepte une fin postérieure ou absente', () => {
    expect(() =>
      assertPromotionDates(new Date('2026-09-01'), new Date('2026-10-01')),
    ).not.toThrow();
    expect(() => assertPromotionDates(new Date('2026-09-01'), null)).not.toThrow();
  });
});
