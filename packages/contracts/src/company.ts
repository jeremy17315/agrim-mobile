/**
 * Configuration AGRIM centralisée (sections 13/20).
 * AUCUNE de ces valeurs ne doit être écrite en dur dans un composant UI.
 * Les valeurs provisoires sont marquées PROVISOIRE et modifiables ici.
 */

export const COMPANY = {
  name: 'AGRIM',
  slogan: 'Développer autrement',
  brandName: 'RIZ BOAGNI',
  brandSignature: 'Pur riz local de luxe',
  address: 'Siège Yamoussoukro, Côte d\u2019Ivoire',
  city: 'Yamoussoukro',
  country: 'Côte d\u2019Ivoire',
  phone: '+225 07 00 05 04 52',
  secondaryPhone: '07 57 66 55 27',
  currency: 'XOF',
  locale: 'fr-CI',
  timezone: 'Africa/Abidjan',
} as const;

/** Arguments commerciaux (section 15) — formulations marketing, pas des certifications. */
export const SELLING_POINTS = [
  'Qualité supérieure, sélectionnée avec soin',
  'Idéal pour toute la famille',
  'Cultivé avec amour en Côte d\u2019Ivoire',
  '100 % naturel, sans conservateurs ni additifs',
] as const;

/**
 * Gammes RIZ BOAGNI (section 14), alignées sur le catalogue réel agrimsarl.ci.
 * Slugs et prix sont les vraies valeurs du site ; les descriptions de
 * djassa/dietetique-complet/dietetique-violet restent provisoires (texte
 * marketing non communiqué) — à affiner avec le vrai texte du site.
 */
export const RICE_RANGES = [
  {
    slug: 'royal-grains',
    name: 'Royal Grains',
    description: 'Riz premium, 100 % long grains',
    sortOrder: 1,
  },
  {
    slug: 'ebene-dor',
    name: 'Ébène d\u2019or',
    description: 'Élégance du goût, 25 % de brisures',
    sortOrder: 2,
  },
  {
    slug: 'sika',
    name: 'Sika',
    description: 'Économique, 40 % de brisures',
    sortOrder: 3,
  },
  {
    slug: 'djassa',
    name: 'Djassa',
    // PROVISOIRE — texte marketing non communiqué.
    description: 'Riz économique du quotidien',
    sortOrder: 4,
  },
  {
    slug: 'dietetique-complet',
    name: 'Diététique Complet',
    // PROVISOIRE — texte marketing non communiqué.
    description: 'Riz complet, diététique',
    sortOrder: 5,
  },
  {
    slug: 'dietetique-violet',
    name: 'Diététique Violet',
    // PROVISOIRE — texte marketing non communiqué.
    description: 'Riz violet, diététique',
    sortOrder: 6,
  },
] as const;

/** Formats connus (section 16). Poids en GRAMMES pour rester en entiers. */
export const PACK_FORMATS = [
  { label: '900 g', weightGrams: 900 },
  { label: '5 kg', weightGrams: 5000 },
  { label: '22,5 kg', weightGrams: 22500 },
  { label: '25 kg', weightGrams: 25000 },
] as const;

/** Grille commune aux deux gammes Diététique (mêmes tarifs, produits différents). */
const DIETETIQUE_PRICING = {
  900: { price: 1000, originalPrice: 1200 },
  5000: { price: 5000, originalPrice: 7000 },
  22500: { price: 22500, originalPrice: 24000 },
  25000: { price: 25000, originalPrice: 27500 },
} as const;

/**
 * Grille tarifaire RIZ BOAGNI, en XOF (section 17).
 * `originalPrice` est le prix barré affiché en promotion.
 *
 * ⚠️ CETTE GRILLE N'EST PLUS LA SOURCE DE VÉRITÉ (audit de cohérence,
 * août 2026). Le catalogue appartient désormais au SITE, qui le gère dans
 * son back office « Catalogue Produit » ; cette API le recopie via
 * `CatalogSyncService`. Les valeurs ci-dessous ne servent plus qu'à
 * amorcer une base VIDE (`prisma/seed.ts`).
 *
 * Corriger un prix ICI ne change rien : la synchronisation suivante le
 * réécrira depuis le site. Un prix se corrige dans le back office du site.
 */
export const RICE_PRICING = {
  'royal-grains': {
    900: { price: 800, originalPrice: 900 },
    5000: { price: 4000, originalPrice: 4500 },
    22500: { price: 18500, originalPrice: 20000 },
    25000: { price: 20000, originalPrice: 24000 },
  },
  'ebene-dor': {
    900: { price: 700, originalPrice: 850 },
    5000: { price: 3500, originalPrice: 4000 },
    22500: { price: 15000, originalPrice: 17500 },
    25000: { price: 17500, originalPrice: 20000 },
  },
  sika: {
    900: { price: 600, originalPrice: 750 },
    5000: { price: 3500, originalPrice: 3750 },
    22500: { price: 13500, originalPrice: 15000 },
    25000: { price: 15000, originalPrice: 17000 },
  },
  djassa: {
    900: { price: 500, originalPrice: 700 },
    5000: { price: 2800, originalPrice: 3000 },
    22500: { price: 12500, originalPrice: 13500 },
    25000: { price: 14000, originalPrice: 15000 },
  },
  'dietetique-complet': DIETETIQUE_PRICING,
  'dietetique-violet': DIETETIQUE_PRICING,
} as const;

/**
 * Frais de livraison : RETIRÉ, et il ne doit pas revenir.
 * ───────────────────────────────────────────────────────
 * Il y avait ici un forfait provisoire — 1 000 F, gratuit au-delà de
 * 25 000 F — posé faute de règle communiquée. Le site, lui, facturait par
 * zone : 3 500 F pour Abidjan. Le même trajet coûtait donc deux prix selon
 * l'écran ouvert par le client.
 *
 * Décision métier du 29 août 2026 : **le SITE fait foi**, comme pour la
 * grille produits (24 août). La règle vit désormais dans `delivery.ts`, et
 * les VALEURS viennent de `GET /api/integration/livraison`.
 *
 * Ne pas réintroduire de constante tarifaire ici : ce serait recréer la
 * divergence, et elle est invisible tant que personne ne compare les deux
 * écrans.
 */
