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
  it('Abidjan, 10 000 F de riz : total = produit + tarif officiel', () => {
    // C'est le cas qui a révélé la divergence. Le tarif officiel étant celui
    // du site, la commande revient à 13 500 F et non à 11 000 F.
    const sousTotal = 10_000;
    const frais = computeDeliveryFee(
      { zone: resolveDeliveryZone('Abidjan', GRILLE), mode: 'domicile', weightKg: 10 },
      GRILLE,
    );

    expect(frais).toBe(3500);
    expect(sousTotal + frais).toBe(13_500);
  });

  it('la même commande à Yamoussoukro coûte moins cher, et c’est voulu', () => {
    const frais = computeDeliveryFee(
      {
        zone: resolveDeliveryZone('Yamoussoukro', GRILLE),
        mode: 'domicile',
        weightKg: 10,
      },
      GRILLE,
    );
    expect(frais).toBe(1000);
  });

  it('un gros volume vers Abidjan ne paie plus la livraison', () => {
    // Quatre sacs de 25 kg = 100 kg, au-delà du seuil de 75 kg.
    const frais = computeDeliveryFee(
      { zone: 'abidjan', mode: 'domicile', weightKg: 100 },
      GRILLE,
    );
    expect(frais).toBe(0);
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
