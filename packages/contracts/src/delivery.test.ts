/**
 * La règle tarifaire officielle, mise sous test.
 *
 * Ce qu'elle répare
 * ─────────────────
 * Le même trajet vers Abidjan était facturé 3 500 F sur le site et 1 000 F
 * dans l'application. Deux règles pour un seul service, donc deux prix selon
 * l'écran ouvert par le client. Décision du 29 août 2026 : le SITE fait foi.
 *
 * Ces tests gardent le CALCUL, pas les montants : les valeurs ci-dessous
 * imitent la grille réelle du site, mais la vraie arrive par
 * `GET /api/integration/livraison`. Figer 3 500 dans le code reproduirait
 * exactement le défaut corrigé — c'est pourquoi la grille est un paramètre.
 */
import {
  computeDeliveryFee,
  quoteDelivery,
  resolveDeliveryZone,
  weightUntilFreeDelivery,
  type DeliveryGrid,
} from './delivery';

/** Calque de la grille servie par le site (config.py : ZONES_LIVRAISON). */
const GRILLE: DeliveryGrid = {
  zones: {
    yamoussoukro: { libelle: 'Yamoussoukro', frais: 1000, delai: '24 h' },
    abidjan: { libelle: 'Abidjan', frais: 3500, delai: '48 h' },
    bouake: { libelle: 'Bouaké', frais: 3000, delai: '48 h' },
    autre: { libelle: 'Autre ville', frais: 5000, delai: '72 h' },
  },
  zoneParDefaut: 'autre',
  retrait: { libelle: 'Retrait au dépôt', frais: 0, delai: '2 h' },
  livraisonOfferteSeuilKg: 75,
};

describe('resolveDeliveryZone', () => {
  it('reconnaît une ville par sa clé', () => {
    expect(resolveDeliveryZone('abidjan', GRILLE)).toBe('abidjan');
  });

  it('reconnaît une ville par son libellé, accents et casse compris', () => {
    // Les adresses sont saisies à la main : « Bouaké », « BOUAKE » et
    // « bouake » désignent la même ville et doivent coûter le même prix.
    expect(resolveDeliveryZone('Bouaké', GRILLE)).toBe('bouake');
    expect(resolveDeliveryZone('BOUAKE', GRILLE)).toBe('bouake');
    expect(resolveDeliveryZone('  bouake  ', GRILLE)).toBe('bouake');
  });

  it('range une ville inconnue dans la zone par défaut, jamais la moins chère', () => {
    // Facturer par défaut le tarif le plus bas ferait d'une faute de frappe
    // une remise, et le transport réel resterait à la charge d'AGRIM.
    expect(resolveDeliveryZone('Korhogo', GRILLE)).toBe('autre');
    expect(resolveDeliveryZone('', GRILLE)).toBe('autre');
    expect(resolveDeliveryZone(null, GRILLE)).toBe('autre');
  });
});

describe('computeDeliveryFee — la règle officielle', () => {
  const domicile = (zone: string, weightKg = 0) =>
    computeDeliveryFee({ zone, mode: 'domicile', weightKg }, GRILLE);

  it('facture le tarif de chaque zone', () => {
    expect(domicile('yamoussoukro')).toBe(1000);
    expect(domicile('abidjan')).toBe(3500);
    expect(domicile('bouake')).toBe(3000);
    expect(domicile('autre')).toBe(5000);
  });

  it('applique le tarif par défaut à une zone inconnue', () => {
    expect(domicile('zone-qui-nexiste-pas')).toBe(5000);
  });

  it('ne facture jamais un retrait sur place', () => {
    // C'est le transport qui coûte, et il n'y en a pas.
    expect(
      computeDeliveryFee(
        { zone: 'abidjan', mode: 'retrait', weightKg: 0 },
        GRILLE,
      ),
    ).toBe(0);
  });

  describe('la gratuité au poids', () => {
    it('offre la livraison au seuil exact', () => {
      expect(domicile('abidjan', 75)).toBe(0);
    });

    it('facture encore juste sous le seuil', () => {
      expect(domicile('abidjan', 74.9)).toBe(3500);
    });

    it('offre la livraison au-delà du seuil', () => {
      expect(domicile('autre', 120)).toBe(0);
    });

    it('ne s’applique pas quand le seuil est désactivé', () => {
      const sansOffre: DeliveryGrid = {
        ...GRILLE,
        livraisonOfferteSeuilKg: 0,
      };
      expect(
        computeDeliveryFee(
          { zone: 'abidjan', mode: 'domicile', weightKg: 500 },
          sansOffre,
        ),
      ).toBe(3500);
    });
  });

  it('refuse une grille inexploitable plutôt que de facturer zéro', () => {
    // Une grille vide qui renverrait 0 offrirait silencieusement toutes les
    // livraisons. Mieux vaut une erreur bruyante.
    const cassee: DeliveryGrid = { ...GRILLE, zones: {} };
    expect(() =>
      computeDeliveryFee({ zone: 'abidjan', mode: 'domicile', weightKg: 0 }, cassee),
    ).toThrow(/inexploitable/i);
  });
});

describe('le scénario de l’énoncé', () => {
  it('Abidjan, 10 000 F de riz : le client paie 10 000 F, pas 13 500 F', () => {
    // C'est le cas qui avait révélé la divergence (3 500 sur le site, 1 000
    // dans l'app). Depuis le 2 octobre 2026, aucun des deux ne facture : le
    // site affiche « À confirmer » et n'ajoute rien au total payable.
    const sousTotal = 10_000;
    const livraison = quoteDelivery({
      mode: 'domicile',
      zone: resolveDeliveryZone('Abidjan', GRILLE),
      grid: GRILLE,
    });

    expect(livraison.statut).toBe('A_CONFIRMER');
    expect(livraison.frais).toBe(0);
    expect(sousTotal + livraison.frais).toBe(10_000);
    // Le tarif de zone existe toujours : il est confirmé hors ligne.
    expect(
      computeDeliveryFee(
        { zone: 'abidjan', mode: 'domicile', weightKg: 10 },
        GRILLE,
      ),
    ).toBe(3500);
  });

  it('la livraison n’ajoute rien, quelles que soient la ville ni le volume', () => {
    for (const ville of ['Yamoussoukro', 'Abidjan', 'Bouaké', 'Korhogo']) {
      const livraison = quoteDelivery({
        mode: 'domicile',
        zone: resolveDeliveryZone(ville, GRILLE),
        grid: GRILLE,
      });
      expect(livraison.frais).toBe(0);
      expect(livraison.statut).toBe('A_CONFIRMER');
    }
  });
});

describe('quoteDelivery — ce que lit le client', () => {
  it('à domicile : le tarif n’est pas affiché, il est « à confirmer »', () => {
    const livraison = quoteDelivery({
      mode: 'domicile',
      zone: 'abidjan',
      grid: GRILLE,
    });

    expect(livraison).toEqual({
      mode: 'domicile',
      zone: 'abidjan',
      libelle: 'Abidjan',
      delai: '48 h',
      statut: 'A_CONFIRMER',
      message: 'À confirmer',
      frais: 0,
    });
  });

  it('au retrait : gratuit, comme sur le site', () => {
    const livraison = quoteDelivery({
      mode: 'retrait',
      zone: 'abidjan',
      grid: GRILLE,
    });

    expect(livraison.statut).toBe('GRATUIT');
    expect(livraison.message).toBe('Gratuit');
    expect(livraison.frais).toBe(0);
    expect(livraison.delai).toBe(GRILLE.retrait.delai);
  });

  it('zone inconnue : délai de la zone par défaut', () => {
    const livraison = quoteDelivery({
      mode: 'domicile',
      zone: 'zone-qui-nexiste-pas',
      grid: GRILLE,
    });

    expect(livraison.libelle).toBe('Autre ville');
    expect(livraison.delai).toBe('72 h');
    expect(livraison.frais).toBe(0);
  });

  it('refuse une grille inexploitable plutôt qu’un délai inventé', () => {
    const cassee: DeliveryGrid = { ...GRILLE, zones: {} };
    expect(() =>
      quoteDelivery({ mode: 'domicile', zone: 'abidjan', grid: cassee }),
    ).toThrow(/inexploitable/i);
  });
});

describe('weightUntilFreeDelivery', () => {
  it('indique le poids restant avant la gratuité', () => {
    expect(weightUntilFreeDelivery(50, GRILLE)).toBe(25);
  });

  it('renvoie zéro au seuil et au-delà', () => {
    expect(weightUntilFreeDelivery(75, GRILLE)).toBe(0);
    expect(weightUntilFreeDelivery(90, GRILLE)).toBe(0);
  });

  it('renvoie zéro quand l’offre est désactivée', () => {
    expect(
      weightUntilFreeDelivery(10, { ...GRILLE, livraisonOfferteSeuilKg: 0 }),
    ).toBe(0);
  });
});
