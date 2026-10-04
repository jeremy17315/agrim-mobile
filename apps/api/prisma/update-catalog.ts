/**
 * Met à jour la gamme Bélier d’Or, ses produits et leurs prix sans toucher
 * aux comptes, commandes ou livraisons. À la différence de seed.ts, ce script
 * ne purge RIEN : il crée ce qui manque et met à jour ce qui existe déjà,
 * en conservant les stocks réels déjà entamés par de vraies commandes.
 *
 * Cas particulier : les anciens produits diététiques sont renommés en place
 * vers « riz-noir » et « riz-violet » (mêmes Product et mêmes IDs de
 * variantes), plutôt que recréés. Les commandes historiques continuent ainsi
 * de référencer exactement les mêmes lignes.
 *
 * Usage : npx tsx prisma/update-catalog.ts (DATABASE_URL doit être défini).
 */
import 'dotenv/config';

import {
  BELIER_PRODUCTS,
  BELIER_PRODUCT_PRICING,
  COMPANY,
  PACK_FORMATS,
} from '@agrim/contracts';
import { prisma } from '../src/prisma/prisma.client';

type BelierProductSlug = keyof typeof BELIER_PRODUCT_PRICING;

async function upsertVariants(
  productId: string,
  productSlug: BelierProductSlug,
) {
  const pricing = BELIER_PRODUCT_PRICING[productSlug];

  for (const f of PACK_FORMATS) {
    const grid = pricing[f.weightGrams as keyof typeof pricing];
    // 22,5 kg et 25 kg sont les deux « gros formats » : rotation plus lente,
    // seuil d'alerte plus bas. Ne s'applique qu'à la création d'une
    // variante réellement nouvelle — jamais à une mise à jour.
    const isBigFormat = f.weightGrams >= 22500;
    const sku = `BELIER-${productSlug.toUpperCase()}-${f.weightGrams}`;

    // On retrouve la variante par (produit, poids), pas par sku : le sku peut
    // changer avec le nom de gamme, mais le format lui-même — donc la ligne
    // d'inventaire réelle — ne change pas.
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
  console.log(
    '🌾 Mise à jour du catalogue AGRIM (production, non destructive)…',
  );

  // Une seule catégorie commerciale contient tous les produits Bélier d’Or.
  // Les anciens produits gardent leurs propres IDs et leurs variantes : seule
  // leur catégorie est corrigée, sans toucher aux lignes de commande.
  const belierDor = await prisma.category.upsert({
    where: { slug: 'belier-dor' },
    create: {
      slug: 'belier-dor',
      name: COMPANY.brandName,
      description: COMPANY.brandSignature,
      sortOrder: 1,
    },
    update: {
      name: COMPANY.brandName,
      description: COMPANY.brandSignature,
      sortOrder: 1,
    },
  });

  const legacySlugs: Partial<Record<BelierProductSlug, string[]>> = {
    // Conserver les IDs historiques plutôt que de recréer les produits.
    'riz-violet': ['dietetique-violet'],
    'riz-noir': ['dietetique-complet', 'dietetique'],
  };

  for (const productDefinition of BELIER_PRODUCTS) {
    const candidates = legacySlugs[productDefinition.slug] ?? [];
    // La version déjà renommée a toujours priorité sur l'ancien slug : sans
    // cela, une base temporairement dupliquée ferait échouer la contrainte
    // d'unicité au lieu de conserver le bon produit actuel.
    const currentProduct = await prisma.product.findUnique({
      where: { slug: productDefinition.slug },
    });
    const legacyProduct =
      currentProduct ??
      (candidates.length
        ? await prisma.product.findFirst({
            where: { slug: { in: candidates } },
          })
        : null);
    const sourceSlug = legacyProduct?.slug ?? productDefinition.slug;

    const product = await prisma.product.upsert({
      where: { slug: sourceSlug },
      create: {
        slug: productDefinition.slug,
        name: productDefinition.name,
        shortDescription: productDefinition.description,
        description: `${productDefinition.description}. ${COMPANY.brandSignature}. Cultivé et transformé en ${COMPANY.country}.`,
        brand: COMPANY.brandName,
        categoryId: belierDor.id,
        isFeatured: productDefinition.sortOrder <= 2,
      },
      update: {
        slug: productDefinition.slug,
        name: productDefinition.name,
        shortDescription: productDefinition.description,
        description: `${productDefinition.description}. ${COMPANY.brandSignature}. Cultivé et transformé en ${COMPANY.country}.`,
        categoryId: belierDor.id,
        isFeatured: productDefinition.sortOrder <= 2,
        isActive: true,
      },
    });

    await upsertVariants(product.id, productDefinition.slug);
    console.log(`  ✓ ${productDefinition.name} (${productDefinition.slug})`);
  }

  // Les anciens produits restent en base pour l'historique, mais ne doivent
  // plus être proposés à l'achat ni revenir dans les filtres de l'app.
  const retired = await prisma.product.updateMany({
    where: {
      slug: {
        in: ['sika', 'dietetique', 'dietetique-complet', 'dietetique-violet'],
      },
      isActive: true,
    },
    data: { isActive: false },
  });
  if (retired.count > 0) {
    console.log(`  ✓ ${retired.count} ancien(s) produit(s) retiré(s) du rayon`);
  }

  console.log('✅ Catalogue à jour : 1 gamme, 5 produits, 4 formats chacun.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
