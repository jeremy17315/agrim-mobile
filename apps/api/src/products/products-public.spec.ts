// Client généré ABSENT hors CI (produit par `prisma generate`) : mock
// virtuel (même remède que payments.reconcile.spec).
jest.mock('../../generated/prisma/client', () => ({
  PrismaClient: class {},
  Prisma: { join: (parts: unknown[]) => parts.join(', ') },
}), { virtual: true });

import { ProductsService } from './products.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Lectures publiques du catalogue — le contrat que le site consomme.
 *
 * Ce que l'on éprouve : le prix AFFICHÉ est le prix FACTURÉ (promotions
 * dans leur fenêtre, même règle que le checkout), et rien de plus —
 * pas de SELECT * vers les frontaux, pas de prix périmé affiché.
 */

const MAINTENANT = new Date('2026-09-20T12:00:00Z');

function produitFaux(variantes: unknown[]) {
  return {
    id: 'prod-1',
    slug: 'attieke-1kg',
    name: 'Attiéké',
    shortDescription: null,
    description: null,
    brand: null,
    imageUrl: '/media/attieke.jpg',
    isFeatured: false,
    isActive: true,
    category: { id: 'cat-1', slug: 'vivriers', name: 'Vivriers' },
    variants: variantes,
  };
}

const promoActive = {
  isActive: true,
  priceXof: 1990,
  label: 'Rentrée',
  startsAt: new Date('2026-09-01T00:00:00Z'),
  endsAt: null,
};

function harnais(variantes: unknown[], mode: 'list' | 'fiche' = 'list') {
  const db = {
    product: {
      findMany: jest.fn(async () => [produitFaux(variantes)]),
      count: jest.fn(async () => 1),
      findFirst: jest.fn(async () => produitFaux(variantes)),
    },
  };
  const config = { get: jest.fn(() => 'https://site.example') };
  const service = new ProductsService(
    { db } as unknown as PrismaService,
    config as never,
  );
  return { service, db, config, mode };
}

describe('ProductsService — lectures publiques (contrat site)', () => {
  it('le prix affiché est le prix EFFECTIF : promotion ouverte appliquée', async () => {
    const { service } = harnais([
      {
        id: 'var-1',
        sku: 'ATT-1KG',
        label: '1 kg',
        weightGrams: 1000,
        price: 2500,
        originalPrice: null,
        stock: 8,
        isAvailable: true,
        promotions: [promoActive],
      },
    ]);
    jest.spyOn(global, 'Date').mockImplementation(() => MAINTENANT);

    const { data } = await service.list({ page: 1, limit: 20 });

    expect(data[0].variants[0]).toMatchObject({
      price: 2500,
      effectivePrice: 1990,
      promotion: { label: 'Rentrée', priceXof: 1990 },
    });
    jest.restoreAllMocks();
  });

  it('une promotion périmée est ignorée — prix de base, pas de promotion', async () => {
    const { service } = harnais([
      {
        id: 'var-1',
        sku: 'ATT-1KG',
        label: '1 kg',
        weightGrams: 1000,
        price: 2500,
        originalPrice: null,
        stock: 8,
        isAvailable: true,
        promotions: [
          { ...promoActive, endsAt: new Date('2026-08-31T00:00:00Z') },
        ],
      },
    ]);
    jest.spyOn(global, 'Date').mockImplementation(() => MAINTENANT);

    const fiche = await service.findBySlug('attieke-1kg');

    expect(fiche.variants[0]).toMatchObject({
      effectivePrice: 2500,
      promotion: null,
    });
    jest.restoreAllMocks();
  });

  it('sans promotion : effectivePrice = prix de base, promotion null', async () => {
    const { service } = harnais([
      {
        id: 'var-1',
        sku: 'ATT-1KG',
        label: '1 kg',
        weightGrams: 1000,
        price: 2500,
        originalPrice: null,
        stock: 8,
        isAvailable: true,
        promotions: [],
      },
    ]);
    jest.spyOn(global, 'Date').mockImplementation(() => MAINTENANT);

    const { data } = await service.list({ page: 1, limit: 20 });

    expect(data[0].variants[0]).toMatchObject({
      effectivePrice: 2500,
      promotion: null,
    });
    jest.restoreAllMocks();
  });

  it('l’image relative est résolue contre la base du site', async () => {
    const { service } = harnais([]);
    jest.spyOn(global, 'Date').mockImplementation(() => MAINTENANT);

    const { data } = await service.list({ page: 1, limit: 20 });

    expect(data[0].imageUrl).toBe('https://site.example/media/attieke.jpg');
    jest.restoreAllMocks();
  });
});
