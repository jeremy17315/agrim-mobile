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

/** Gammes RIZ BOAGNI (section 14). */
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
    slug: 'dietetique',
    name: 'Diététique',
    description: 'Violet et noir',
    sortOrder: 4,
  },
] as const;

/** Formats connus (section 16). Poids en GRAMMES pour rester en entiers. */
export const PACK_FORMATS = [
  { label: '900 g', weightGrams: 900 },
  { label: '5 kg', weightGrams: 5000 },
  { label: '22,5 kg', weightGrams: 22500 },
] as const;

/**
 * PROVISOIRE — prix officiels non communiqués (section 17).
 * Prix indicatifs marché ivoirien, en XOF, à remplacer par les tarifs AGRIM.
 */
export const PROVISIONAL_PRICING = {
  'royal-grains': { 900: 1200, 5000: 6000, 22500: 25000 },
  'ebene-dor': { 900: 1000, 5000: 5000, 22500: 21000 },
  sika: { 900: 800, 5000: 4000, 22500: 17000 },
  dietetique: { 900: 1800, 5000: 8500, 22500: 36000 },
} as const;

/** PROVISOIRE — règles de livraison non communiquées. */
export const PROVISIONAL_DELIVERY = {
  baseFee: 1000,
  freeDeliveryThreshold: 25000,
} as const;
