/**
 * Frais de livraison — RÈGLE OFFICIELLE UNIQUE.
 *
 * Décision métier du 29 août 2026
 * ────────────────────────────────
 * Le même trajet était facturé 3 500 F sur le site et 1 000 F dans
 * l'application : deux règles pour un seul service, donc deux prix selon
 * l'écran que le client ouvrait. `A-VALIDER-AVEC-AGRIM.md` listait « Frais de
 * livraison par ville » parmi les points NON tranchés, ce qui interdisait de
 * choisir l'un des deux montants au hasard.
 *
 * La décision retenue est la même que pour la grille produits (24 août 2026) :
 * **le SITE fait foi**. Ce module ne contient donc AUCUN montant. Il contient
 * le CALCUL ; les valeurs arrivent de `GET /api/integration/livraison`, servi
 * par le site, où un gestionnaire les modifie sans redéploiement.
 *
 * C'est la même séparation que pour le catalogue : le site décide, les deux
 * plateformes appliquent. Un tarif écrit en dur ici recréerait exactement la
 * divergence que cette étape supprime.
 */

/** Une zone de livraison, telle que le site la publie. */
export interface DeliveryZone {
  libelle: string;
  /** Frais en XOF entier. */
  frais: number;
  delai: string;
}

/** La grille officielle, servie par le site. */
export interface DeliveryGrid {
  zones: Record<string, DeliveryZone>;
  /** Zone appliquée quand celle du client n'est pas reconnue. */
  zoneParDefaut: string;
  /** Le retrait sur place est toujours gratuit : il n'y a pas de transport. */
  retrait: { libelle: string; frais: number; delai: string };
  /**
   * Poids à partir duquel la livraison à domicile est offerte, en kilos.
   * `0` = offre désactivée. En kilos et non en francs : c'est le poids qui
   * fait le coût réel d'un transport.
   */
  livraisonOfferteSeuilKg: number;
}

export type DeliveryMode = 'domicile' | 'retrait';

export interface DeliveryFeeInput {
  /** Clé de zone déjà résolue (voir `resolveDeliveryZone`). */
  zone: string;
  mode: DeliveryMode;
  /** Poids total commandé, en kilos. */
  weightKg: number;
}

/**
 * Normalise un nom de ville en clé de zone.
 *
 * Le site range ses clients par `zone` (une liste fermée) ; l'application, elle,
 * ne connaît que la `city` d'une adresse, saisie à la main. Il faut donc
 * rapprocher un texte libre d'une clé — et cette correspondance doit vivre au
 * même endroit que le calcul, sinon les deux plateformes rangeraient le même
 * client dans deux zones différentes.
 *
 * Accents, casse et espaces sont ignorés : « Bouaké », « bouake » et « BOUAKE »
 * désignent la même ville.
 *
 * Une ville inconnue tombe dans la zone par défaut du site — jamais dans la
 * moins chère. Facturer par défaut le tarif le plus bas ferait d'une faute de
 * frappe une remise.
 */
export function resolveDeliveryZone(
  city: string | null | undefined,
  grid: DeliveryGrid,
): string {
  const normalise = (valeur: string) =>
    valeur
      .normalize('NFD')
      // Retire les diacritiques : « Bouaké » → « bouake ».
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

  const cible = normalise(city ?? '');
  if (!cible) return grid.zoneParDefaut;

  for (const cle of Object.keys(grid.zones)) {
    if (normalise(cle) === cible) return cle;
    if (normalise(grid.zones[cle]!.libelle) === cible) return cle;
  }
  return grid.zoneParDefaut;
}

/**
 * Frais de livraison officiels, en XOF entier.
 *
 * Ordre d'application, identique à celui du site (`metier.calculer_panier`) :
 *   1. le retrait sur place est gratuit — rien d'autre n'est évalué ;
 *   2. sinon, le tarif de la zone (zone inconnue → zone par défaut) ;
 *   3. la gratuité au poids l'emporte, à domicile uniquement.
 */
export function computeDeliveryFee(
  input: DeliveryFeeInput,
  grid: DeliveryGrid,
): number {
  if (input.mode === 'retrait') return grid.retrait.frais;

  const zone = grid.zones[input.zone] ?? grid.zones[grid.zoneParDefaut];
  // Une grille sans zone par défaut est une grille cassée : mieux vaut le dire
  // que facturer zéro en silence.
  if (!zone) {
    throw new Error(
      `Grille de livraison inexploitable : ni « ${input.zone} » ni la zone par défaut « ${grid.zoneParDefaut} » n'y figurent.`,
    );
  }

  const seuil = grid.livraisonOfferteSeuilKg;
  if (seuil > 0 && input.weightKg >= seuil) return 0;

  return zone.frais;
}

/**
 * Poids restant avant la livraison offerte, en kilos. `0` = seuil atteint ou
 * offre désactivée. Sert la barre de progression du panier.
 */
export function weightUntilFreeDelivery(
  weightKg: number,
  grid: DeliveryGrid,
): number {
  const seuil = grid.livraisonOfferteSeuilKg;
  if (seuil <= 0 || weightKg >= seuil) return 0;
  return seuil - weightKg;
}
