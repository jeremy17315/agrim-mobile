/**
 * Met à jour le catalogue (gammes, produits, prix) sans toucher aux
 * comptes, commandes ou livraisons. À la différence de seed.ts, ce script
 * ne purge RIEN : il crée ce qui manque et met à jour ce qui existe déjà,
 * en conservant les stocks réels déjà entamés par de vraies commandes.
 *
 * Cas particulier : l'ancienne gamme unique « dietetique » est renommée en
 * place vers « dietetique-complet » (même Category/Product, mêmes IDs de
 * variantes) plutôt que recréée, pour ne rien casser côté commandes
 * existantes qui référenceraient déjà ces variantes. « dietetique-violet »
 * est une gamme entièrement nouvelle.
 *
 * Usage : npx tsx prisma/update-catalog.ts (DATABASE_URL doit être défini).
 */
import 'dotenv/config';

import { COMPANY, PACK_FORMATS, RICE_PRICING, RICE_RANGES } from '@agrim/contracts';
import { prisma } from '../src/prisma/prisma.client';

type RangeSlug = keyof typeof RICE_PRICING;

async function upsertVariants(productId: string, rangeSlug: RangeSlug) {
  const pricing = RICE_PRICING[rangeSlug];

  for (const f of PACK_FORMATS) {
    const grid = pricing[f.weightGrams as keyof typeof pricing];
    // 22,5 kg et 25 kg sont les deux « gros formats » : rotation plus lente,
    // seuil d'alerte plus bas. Ne s'applique qu'à la création d'une
    // variante réellement nouvelle — jamais à une mise à jour.
    const isBigFormat = f.weightGrams >= 22500;
    const sku = `BOAGNI-${rangeSlug.toUpperCase()}-${f.weightGrams}`;

    // On retrouve la variante par (produit, poids), pas par sku : le sku
    // change pour dietetique-complet (dérivé du nouveau slug), mais le
    // format lui-même — donc la ligne d'inventaire réelle — ne change pas.
    const existing = await prisma.productVariant.findFirst({
      where: { productId, weightGrams: f.weightGrams },
    });

    if (existing) {
      await prisma.productVariant.update({
        where: { id: existing.id },
        data: {
          sku,
          label: f.label,
          price: grid.price,
          originalPrice: grid.originalPrice,
          // stock/lowStockThreshold volontairement absents : ne jamais
          // écraser un stock réel déjà entamé par de vraies commandes.
        },
      });
    } else {
      await prisma.productVariant.create({
        data: {
          productId,
          sku,
          label: f.label,
          weightGrams: f.weightGrams,
          price: grid.price,
          originalPrice: grid.originalPrice,
          stock: isBigFormat ? 40 : 200,
          lowStockThreshold: isBigFormat ? 10 : 30,
        },
      });
    }
  }
}

async function main() {
  console.log('🌾 Mise à jour du catalogue AGRIM (production, non destructive)…');

  const legacyDietetique = await prisma.category.findUnique({
    where: { slug: 'dietetique' },
  });

  for (const range of RICE_RANGES) {
    const sourceSlug =
      range.slug === 'dietetique-complet' && legacyDietetique
        ? 'dietetique'
        : range.slug;

    const category = await prisma.category.upsert({
      where: { slug: sourceSlug },
      create: {
        slug: range.slug,
        name: range.name,
        description: range.description,
        sortOrder: range.sortOrder,
      },
      update: {
        slug: range.slug,
        name: range.name,
        description: range.description,
        sortOrder: range.sortOrder,
      },
    });

    const product = await prisma.product.upsert({
      where: { slug: sourceSlug },
      create: {
        slug: range.slug,
        name: `${COMPANY.brandName} ${range.name}`,
        shortDescription: range.description,
        description: `${range.description}. ${COMPANY.brandSignature}. Cultivé et transformé en ${COMPANY.country}.`,
        brand: COMPANY.brandName,
        categoryId: category.id,
        isFeatured: range.sortOrder <= 2,
      },
      update: {
        slug: range.slug,
        name: `${COMPANY.brandName} ${range.name}`,
        shortDescription: range.description,
        description: `${range.description}. ${COMPANY.brandSignature}. Cultivé et transformé en ${COMPANY.country}.`,
        categoryId: category.id,
        isFeatured: range.sortOrder <= 2,
      },
    });

    await upsertVariants(product.id, range.slug as RangeSlug);
    console.log(`  ✓ ${range.name} (${range.slug})`);
  }

  console.log('✅ Catalogue à jour : 6 gammes, 4 formats chacune.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
