/**
 * Le module qui peut vider la boutique, mis sous test.
 *
 * `sync()` est la seule fonction de cette API autorisée à retirer de la vente
 * des variantes ET des gammes entières, en masse, sans intervention humaine.
 * Elle tourne toute seule toutes les quinze minutes. Les deux commits qui lui
 * ont donné ce pouvoir n'apportaient aucun test : une régression y serait
 * passée inaperçue jusqu'à ce qu'un client ouvre un rayon vide.
 *
 * Ce qui est gardé ici, ce sont les trois règles écrites en tête du service —
 * on n'écrase jamais un stock local, on ne supprime jamais, la clé est la
 * référence du site — et surtout les DEUX GARDE-FOUS de la désactivation :
 * ni catalogue vide, ni synchronisation partielle. Sans eux, une panne du
 * site retirerait de la vente des produits parfaitement réels.
 *
 * Test unitaire et non e2e : il vérifie des DÉCISIONS (que retire-t-on, et
 * sous quelles conditions), pas une intégration. Prisma et `fetch` sont
 * simulés, il tourne donc sans PostgreSQL et sans le site.
 */
// La chaîne d'imports traverse `prisma.client`, qui exige `DATABASE_URL` dès
// son chargement. Aucune connexion n'est ouverte ici — le PrismaService est
// entièrement simulé — mais la variable doit exister, comme dans les suites e2e.
import 'dotenv/config';

import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CatalogSyncService } from './catalog-sync.service';
import type { PrismaService } from '../prisma/prisma.service';

type Row = Record<string, unknown>;

/**
 * Prisma en mémoire, réduit aux formes que le service emploie réellement.
 *
 * Un `jest.fn()` par méthode ne suffirait pas : la désactivation dépend de ce
 * que les upserts ont écrit JUSTE AVANT — une variante du seed adoptée reçoit
 * son `sourceRef` et échappe alors au filtre. Il faut donc un vrai état, pas
 * des retours figés, sans quoi le test ne prouverait rien de l'enchaînement.
 */
function correspond(valeur: unknown, clause: unknown): boolean {
  if (clause !== null && typeof clause === 'object') {
    const c = clause as Record<string, unknown>;
    if ('in' in c) return (c.in as unknown[]).includes(valeur);
    if ('not' in c || 'notIn' in c) {
      if ('not' in c && c.not === null && valeur === null) return false;
      if ('notIn' in c && (c.notIn as unknown[]).includes(valeur)) return false;
      return true;
    }
  }
  return valeur === clause;
}

function filtre(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([champ, clause]) => {
    if (champ === 'OR') {
      return (clause as Record<string, unknown>[]).some((c) => filtre(row, c));
    }
    return correspond(row[champ], clause);
  });
}

function table(prefixe: string, initiales: Row[] = []) {
  const rows: Row[] = initiales.map((r) => ({ ...r }));
  let sequence = 0;

  return {
    rows,
    findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const trouvee = rows.find((r) => filtre(r, where));
      return trouvee ? { ...trouvee } : null;
    }),
    findMany: jest.fn(async () => rows.map((r) => ({ ...r }))),
    create: jest.fn(async ({ data }: { data: Row }) => {
      sequence += 1;
      const creee = { id: `${prefixe}-${sequence}`, ...data };
      rows.push(creee);
      return { ...creee };
    }),
    update: jest.fn(
      async ({ where, data }: { where: { id: string }; data: Row }) => {
        const cible = rows.find((r) => r.id === where.id);
        if (!cible) throw new Error(`ligne ${where.id} absente`);
        Object.assign(cible, data);
        return { ...cible };
      },
    ),
    updateMany: jest.fn(
      async ({ where, data }: { where: Record<string, unknown>; data: Row }) => {
        const cibles = rows.filter((r) => filtre(r, where));
        for (const cible of cibles) Object.assign(cible, data);
        return { count: cibles.length };
      },
    ),
  };
}

type Table = ReturnType<typeof table>;

function ligne(t: Table, id: string): Row {
  const trouvee = t.rows.find((r) => r.id === id);
  if (!trouvee) throw new Error(`ligne ${id} introuvable`);
  return trouvee;
}

// ── Le catalogue du site ───────────────────────────────────────────────────
// Deux gammes, deux références. Djassa existe déjà ici, créée par le seed sans
// rattachement ; Prémium est absente de l'application — c'est la « vente
// perdue » relevée par l'audit de cohérence.

const GAMMES = [
  {
    code: 'DJA',
    nom: 'Djassa',
    slug: 'djassa',
    description_courte: 'Le riz du quotidien',
    description: 'Riz local, grain long.',
    ordre: 1,
    actif: true,
    image_url: '',
  },
  {
    code: 'PRE',
    nom: 'Prémium',
    slug: 'premium',
    description_courte: 'Le haut de gamme',
    description: 'Sélection premier choix.',
    ordre: 2,
    actif: true,
    image_url: '',
  },
];

const PRODUITS = [
  {
    reference: 'DJA-5KG',
    sku: 'DJ5',
    gamme_code: 'DJA',
    gamme_nom: 'Djassa',
    gamme_slug: 'djassa',
    nom: 'Djassa 5 kg',
    description: '',
    format: 'Sac de 5 kg',
    poids_grammes: 5000,
    prix: 2250,
    prix_barre: null,
    en_promotion: false,
    stock: 118,
    seuil_alerte: 10,
    actif: true,
    disponible: true,
    badge: '',
    couleur: '',
    image_url: '',
  },
  {
    reference: 'PRE-5KG',
    sku: 'PR5',
    gamme_code: 'PRE',
    gamme_nom: 'Prémium',
    gamme_slug: 'premium',
    nom: 'Prémium 5 kg',
    description: '',
    format: 'Sac de 5 kg',
    poids_grammes: 5000,
    prix: 15000,
    prix_barre: null,
    en_promotion: false,
    stock: 26,
    seuil_alerte: 5,
    actif: true,
    disponible: true,
    badge: '',
    couleur: '',
    image_url: '',
  },
];

const CATALOGUE = {
  genere_le: '2026-08-28T18:00:00.000Z',
  marque: 'RIZ BOAGNI',
  devise: 'XOF',
  gammes: GAMMES,
  produits: PRODUITS,
  total: PRODUITS.length,
};

const URL_SITE = 'https://agrim-zuxe.onrender.com';
const CATALOGUE_URL = `${URL_SITE}/api/integration/catalogue`;

function reponse(corps: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => corps,
  };
}

/**
 * L'état local AVANT synchronisation : celui que l'audit a trouvé en base.
 *
 * Djassa et Sika viennent du seed, sans `sourceCode` ni `sourceRef`. Sika est
 * la gamme entière qui n'existe pas au catalogue ; le sachet de 900 g est le
 * format inventé ; `var-retiree` est une référence que le site a vendue puis
 * cessé de vendre. Les trois doivent disparaître de la vente — et la Djassa
 * 5 kg, elle, doit être ADOPTÉE et garder son stock.
 */
function makeHarness(options: { url?: string; token?: string } = {}) {
  const category = table('cat', [
    { id: 'cat-djassa', slug: 'djassa', sourceCode: null },
    { id: 'cat-sika', slug: 'sika', sourceCode: null },
  ]);

  const product = table('prod', [
    { id: 'prod-djassa', slug: 'djassa', sourceCode: null, isActive: true },
    { id: 'prod-sika', slug: 'sika', sourceCode: null, isActive: true },
  ]);

  const productVariant = table('var', [
    {
      id: 'var-djassa-5',
      productId: 'prod-djassa',
      weightGrams: 5000,
      sourceRef: null,
      sku: 'DJ5',
      label: 'Sac de 5 kg',
      price: 2800,
      originalPrice: null,
      isAvailable: true,
      stock: 37,
      lowStockThreshold: 5,
    },
    {
      id: 'var-djassa-900',
      productId: 'prod-djassa',
      weightGrams: 900,
      sourceRef: null,
      sku: 'DJ09',
      label: 'Sachet de 900 g',
      price: 600,
      originalPrice: null,
      isAvailable: true,
      stock: 1992,
      lowStockThreshold: 5,
    },
    {
      id: 'var-sika-5',
      productId: 'prod-sika',
      weightGrams: 5000,
      sourceRef: null,
      sku: 'SI5',
      label: 'Sac de 5 kg',
      price: 3000,
      originalPrice: null,
      isAvailable: true,
      stock: 200,
      lowStockThreshold: 5,
    },
    {
      id: 'var-retiree',
      productId: 'prod-djassa',
      weightGrams: 25000,
      sourceRef: 'DJA-25KG',
      sku: 'DJ25',
      label: 'Sac de 25 kg',
      price: 12000,
      originalPrice: null,
      isAvailable: true,
      stock: 40,
      lowStockThreshold: 5,
    },
  ]);

  const prisma = {
    db: { category, product, productVariant },
  } as unknown as PrismaService;

  const config = new ConfigService({
    SITE_INTEGRATION_URL: options.url ?? URL_SITE,
    SITE_INTEGRATION_TOKEN: options.token ?? 'jeton-de-test',
  });

  const service = new CatalogSyncService(prisma, config);

  return { service, category, product, productVariant };
}

const fetchMock = jest.fn();

describe('CatalogSyncService', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(reponse(CATALOGUE));
    global.fetch = fetchMock as unknown as typeof fetch;
    // Le service journalise un résumé à chaque passage : inutile dans la sortie
    // des tests, et plusieurs cas ci-dessous passent volontairement par `warn`.
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Le passage nominal ───────────────────────────────────────────────────

  describe('sync — le catalogue du site fait foi', () => {
    it('adopte le catalogue réel et retire les références fantômes', async () => {
      const { service, product, productVariant } = makeHarness();

      const rapport = await service.sync();

      expect(rapport.ok).toBe(true);
      expect(rapport.errors).toEqual([]);
      expect(rapport.generatedAt).toBe(CATALOGUE.genere_le);
      // Djassa mise à jour, Prémium créée ; Sika retirée.
      expect(rapport.ranges).toEqual({ created: 1, updated: 1, deactivated: 1 });
      // Djassa 5 kg adoptée, Prémium 5 kg créée ; trois fantômes retirés.
      expect(rapport.variants).toEqual({
        created: 1,
        updated: 1,
        deactivated: 3,
      });

      const retirees = productVariant.rows
        .filter((r) => r.isAvailable === false)
        .map((r) => r.id)
        .sort();
      expect(retirees).toEqual(['var-djassa-900', 'var-retiree', 'var-sika-5']);

      // Une gamme dont tout vient d'être retiré ne reste pas en rayon vide.
      expect(ligne(product, 'prod-sika').isActive).toBe(false);
      expect(ligne(product, 'prod-djassa').isActive).toBe(true);
    });

    it('adopte une variante du seed par (produit, poids) et lui donne sa référence', async () => {
      // C'est ce rattachement qui empêche la désactivation de faucher une
      // variante légitime : sans lui, `sourceRef` resterait vide et la Djassa
      // 5 kg — bien vendue par le site — partirait avec les fantômes.
      const { service, productVariant } = makeHarness();

      await service.sync();

      const adoptee = ligne(productVariant, 'var-djassa-5');
      expect(adoptee.sourceRef).toBe('DJA-5KG');
      expect(adoptee.isAvailable).toBe(true);
    });

    it('corrige le prix local sur celui du site', async () => {
      // L'application vendait la Djassa 5 kg 2 800 là où le site la vend
      // 2 250 : 550 XOF de trop payés par le client.
      const { service, productVariant } = makeHarness();

      await service.sync();

      expect(ligne(productVariant, 'var-djassa-5').price).toBe(2250);
    });

    it("n'écrase jamais le stock local par défaut", async () => {
      // Règle 1. Les deux plateformes tiennent chacune leur stock : recopier
      // l'un sur l'autre ferait disparaître des ventes déjà encaissées.
      const { service, productVariant } = makeHarness();

      await service.sync();

      expect(ligne(productVariant, 'var-djassa-5').stock).toBe(37);
      expect(productVariant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ stock: expect.anything() }),
        }),
      );
    });

    it('recopie le stock quand on le demande explicitement', async () => {
      // Le jour où le site devient maître du stock, ce drapeau est la bascule.
      const { service, productVariant } = makeHarness();

      await service.sync({ syncStock: true });

      expect(ligne(productVariant, 'var-djassa-5').stock).toBe(118);
      expect(ligne(productVariant, 'var-djassa-5').lowStockThreshold).toBe(10);
    });

    it('reprend le stock du site à la création, faute de mieux', async () => {
      const { service, productVariant } = makeHarness();

      await service.sync();

      const creee = productVariant.rows.find((r) => r.sourceRef === 'PRE-5KG');
      expect(creee).toBeDefined();
      expect(creee?.stock).toBe(26);
      expect(creee?.price).toBe(15000);
    });

    it('désactive sans jamais supprimer — des commandes référencent ces lignes', async () => {
      // Règle 2. Une suppression casserait l'historique de commande.
      const { service, product, productVariant } = makeHarness();
      const avant = productVariant.rows.length;

      await service.sync();

      expect(productVariant.rows.length).toBeGreaterThanOrEqual(avant);
      expect(ligne(productVariant, 'var-sika-5')).toBeDefined();
      expect(ligne(product, 'prod-sika')).toBeDefined();
    });
  });

  // ── L'autorisation de vendre ─────────────────────────────────────────────
  //
  // Le back office du site distingue deux refus de vente : le retrait du
  // catalogue (`actif = 0`) et la rupture DÉCLARÉE — « il en reste en magasin,
  // mais on n'en vend plus » — qui laisse la référence active. La
  // synchronisation ne recopiait que le premier : la boutique du site refusait
  // la commande pendant que l'application l'acceptait.
  //
  // Ce qui traverse la frontière, c'est `vendable` : l'autorisation, jamais la
  // quantité, qui reste propre à chaque plateforme (règle 1).

  describe('sync — la rupture déclarée par le site', () => {
    /** Le catalogue nominal, avec une seule référence retouchée. */
    function catalogueAvec(reference: string, champs: Record<string, unknown>) {
      return {
        ...CATALOGUE,
        produits: CATALOGUE.produits.map((p) =>
          p.reference === reference ? { ...p, ...champs } : p,
        ),
      };
    }

    it('retire de la vente une référence que le site déclare en rupture', async () => {
      fetchMock.mockResolvedValue(
        reponse(
          catalogueAvec('DJA-5KG', {
            actif: true,
            vendable: false,
            disponibilite: 'rupture',
            // Le stock du site reste renseigné : c'est bien la DÉCISION, et
            // non la quantité, qui ferme la vente.
            stock: 118,
          }),
        ),
      );
      const { service, productVariant } = makeHarness();

      await service.sync();

      const djassa = ligne(productVariant, 'var-djassa-5');
      expect(djassa.isAvailable).toBe(false);
      // Le stock local n'a pas bougé pour autant : la marchandise est toujours
      // là, seule la vente est suspendue.
      expect(djassa.stock).toBe(37);
    });

    it('laisse en vente une référence que le site autorise', async () => {
      fetchMock.mockResolvedValue(
        reponse(
          catalogueAvec('DJA-5KG', { vendable: true, disponibilite: 'auto' }),
        ),
      );
      const { service, productVariant } = makeHarness();

      await service.sync();

      expect(ligne(productVariant, 'var-djassa-5').isAvailable).toBe(true);
    });

    it('ignore le stock du site : à zéro là-bas, la vente reste ouverte ici', async () => {
      // Conséquence directe de la règle 1. Tant que les deux stocks vivent
      // séparément, fermer le rayon d'ici parce que le site a tout vendu
      // annulerait des ventes bien réelles.
      fetchMock.mockResolvedValue(
        reponse(
          catalogueAvec('DJA-5KG', {
            stock: 0,
            disponible: false,
            vendable: true,
          }),
        ),
      );
      const { service, productVariant } = makeHarness();

      await service.sync();

      expect(ligne(productVariant, 'var-djassa-5').isAvailable).toBe(true);
      expect(ligne(productVariant, 'var-djassa-5').stock).toBe(37);
    });

    it('retombe sur « actif » face à un site qui ignore encore ce champ', async () => {
      // Compatibilité ascendante : la synchronisation doit continuer de
      // fonctionner contre un site non redéployé, sans quoi ce correctif
      // fermerait la boutique le temps d'une mise en ligne.
      fetchMock.mockResolvedValue(
        reponse(catalogueAvec('DJA-5KG', { actif: false })),
      );
      const { service, productVariant } = makeHarness();

      await service.sync();

      expect(ligne(productVariant, 'var-djassa-5').isAvailable).toBe(false);
    });
  });

  // ── Les deux garde-fous ──────────────────────────────────────────────────

  describe('sync — les garde-fous de la désactivation', () => {
    it('ne vide pas la boutique quand le site renvoie un catalogue vide', async () => {
      fetchMock.mockResolvedValue(
        reponse({ ...CATALOGUE, gammes: [], produits: [], total: 0 }),
      );
      const { service, product, productVariant } = makeHarness();

      const rapport = await service.sync();

      expect(rapport.variants.deactivated).toBe(0);
      expect(rapport.ranges.deactivated).toBe(0);
      expect(productVariant.updateMany).not.toHaveBeenCalled();
      expect(product.updateMany).not.toHaveBeenCalled();
      expect(productVariant.rows.every((r) => r.isAvailable === true)).toBe(
        true,
      );
      expect(product.rows.every((r) => r.isActive === true)).toBe(true);
    });

    it('ne retire rien quand la synchronisation est partielle', async () => {
      // Une gamme en échec, c'est un catalogue incomplet. Retirer sur cette
      // base ferait disparaître de la vente des produits bien réels : la panne
      // du site deviendrait une panne de la boutique.
      const { service, category, product, productVariant } = makeHarness();
      category.create.mockRejectedValueOnce(new Error('site en panne'));

      const rapport = await service.sync();

      expect(rapport.ok).toBe(false);
      expect(rapport.errors).toHaveLength(1);
      expect(rapport.errors[0]).toContain('PRE');
      // La référence orpheline est signalée, pas rattachée au hasard.
      expect(rapport.skipped).toEqual(['PRE-5KG']);

      expect(productVariant.updateMany).not.toHaveBeenCalled();
      expect(product.updateMany).not.toHaveBeenCalled();
      expect(rapport.variants.deactivated).toBe(0);
      expect(rapport.ranges.deactivated).toBe(0);
      expect(productVariant.rows.every((r) => r.isAvailable === true)).toBe(
        true,
      );
    });

    it('poursuit le passage quand une seule référence échoue', async () => {
      // Un incident isolé ne doit pas interrompre la synchronisation : les
      // autres références ont droit à leur prix à jour.
      const { service, productVariant } = makeHarness();
      productVariant.create.mockRejectedValueOnce(new Error('contrainte'));

      const rapport = await service.sync();

      expect(rapport.ok).toBe(false);
      expect(rapport.errors[0]).toContain('PRE-5KG');
      expect(rapport.variants.updated).toBe(1);
      expect(ligne(productVariant, 'var-djassa-5').price).toBe(2250);
      // Mais toujours aucune désactivation : le catalogue est incomplet.
      expect(productVariant.updateMany).not.toHaveBeenCalled();
    });
  });

  // ── La source ────────────────────────────────────────────────────────────

  describe('fetchSource — la source du catalogue', () => {
    it('interroge le site avec le jeton de synchronisation', async () => {
      const { service } = makeHarness();

      await service.sync();

      expect(fetchMock).toHaveBeenCalledWith(
        CATALOGUE_URL,
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Sync-Token': 'jeton-de-test' }),
        }),
      );
    });

    it("refuse de travailler sans SITE_INTEGRATION_URL, et n'appelle personne", async () => {
      const { service } = makeHarness({ url: '' });

      expect(service.isConfigured).toBe(false);
      await expect(service.sync()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("accepte une surcharge explicite de l'URL du catalogue", () => {
      const prisma = { db: {} } as unknown as PrismaService;
      const config = new ConfigService({
        SITE_INTEGRATION_URL: 'https://site.test',
        CATALOG_SOURCE_URL: 'https://proxy.test/catalogue.json',
      });

      expect(new CatalogSyncService(prisma, config).sourceUrl).toBe(
        'https://proxy.test/catalogue.json',
      );
    });

    it("supprime les barres finales de l'adresse du site", () => {
      const prisma = { db: {} } as unknown as PrismaService;
      const config = new ConfigService({
        SITE_INTEGRATION_URL: 'https://site.test///',
      });

      expect(new CatalogSyncService(prisma, config).sourceUrl).toBe(
        'https://site.test/api/integration/catalogue',
      );
    });

    it('abandonne sur une réponse HTTP en erreur', async () => {
      fetchMock.mockResolvedValue(reponse(null, { ok: false, status: 503 }));
      const { service, productVariant } = makeHarness();

      await expect(service.sync()).rejects.toThrow('HTTP 503');
      // Une source en erreur ne doit avoir touché à rien.
      expect(productVariant.updateMany).not.toHaveBeenCalled();
    });

    it('abandonne sur une réponse sans « produits » ni « gammes »', async () => {
      // Une page d'erreur HTML renvoyée en 200, ou un JSON d'authentification
      // refusée : la forme est le seul indice disponible.
      fetchMock.mockResolvedValue(reponse({ message: 'Non autorisé' }));
      const { service, productVariant } = makeHarness();

      await expect(service.sync()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(productVariant.updateMany).not.toHaveBeenCalled();
    });
  });

  // ── La cotation au checkout ──────────────────────────────────────────────

  describe('quote — les prix relus au checkout', () => {
    it('renvoie les prix effectifs du site', async () => {
      const { service } = makeHarness();
      fetchMock.mockResolvedValue(
        reponse({
          prix: {
            'DJA-5KG': {
              prix: 2250,
              prix_barre: 2800,
              disponible: true,
              vendable: true,
            },
            'PRE-5KG': null,
          },
        }),
      );

      const resultat = await service.quote(['DJA-5KG', 'PRE-5KG']);

      if (resultat.status !== 'ok') throw new Error(`statut ${resultat.status}`);
      expect(resultat.prices.get('DJA-5KG')).toEqual({
        prix: 2250,
        prixBarre: 2800,
        disponible: true,
        vendable: true,
      });
      // Une ligne nulle est une référence que le site ne connaît pas : elle
      // n'entre pas dans la table, l'appelant retombe sur son prix local.
      expect(resultat.prices.has('PRE-5KG')).toBe(false);
    });

    it('remonte le retrait de la vente décidé depuis la dernière synchro', async () => {
      // La fenêtre que cette cotation sert à couvrir : entre deux passages de
      // synchronisation (quinze minutes), le site a pu fermer la vente d'une
      // référence que notre copie croit encore disponible.
      const { service } = makeHarness();
      fetchMock.mockResolvedValue(
        reponse({
          prix: {
            'DJA-5KG': {
              prix: 2250,
              prix_barre: null,
              disponible: false,
              vendable: false,
            },
          },
        }),
      );

      const resultat = await service.quote(['DJA-5KG']);

      if (resultat.status !== 'ok') throw new Error(`statut ${resultat.status}`);
      expect(resultat.prices.get('DJA-5KG')?.vendable).toBe(false);
    });

    it('suppose la vente autorisée face à un site qui ignore ce champ', async () => {
      // Compatibilité ascendante, et parti pris explicite : sans information,
      // on ne bloque pas une vente.
      const { service } = makeHarness();
      fetchMock.mockResolvedValue(
        reponse({
          prix: {
            'DJA-5KG': { prix: 2250, prix_barre: null, disponible: true },
          },
        }),
      );

      const resultat = await service.quote(['DJA-5KG']);

      if (resultat.status !== 'ok') throw new Error(`statut ${resultat.status}`);
      expect(resultat.prices.get('DJA-5KG')?.vendable).toBe(true);
    });

    it("se tait quand le jeton n'est pas configuré", async () => {
      const { service } = makeHarness({ token: '' });

      await expect(service.quote(['DJA-5KG'])).resolves.toEqual({
        status: 'disabled',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("n'appelle pas le site pour une liste vide", async () => {
      const { service } = makeHarness();

      await expect(service.quote([])).resolves.toEqual({ status: 'disabled' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('borne la demande à cinquante références', async () => {
      const { service } = makeHarness();
      fetchMock.mockResolvedValue(reponse({ prix: {} }));

      await service.quote(Array.from({ length: 60 }, (_, i) => `REF-${i}`));

      const corps = JSON.parse(
        (fetchMock.mock.calls[0][1] as { body: string }).body,
      ) as { references: string[] };
      expect(corps.references).toHaveLength(50);
    });

    it('laisse vendre au prix local quand le site répond en erreur', async () => {
      const { service } = makeHarness();
      fetchMock.mockResolvedValue(reponse(null, { ok: false, status: 500 }));

      await expect(service.quote(['DJA-5KG'])).resolves.toEqual({
        status: 'unavailable',
      });
    });

    it('laisse vendre au prix local quand le site est injoignable', async () => {
      // Un checkout ne doit jamais échouer parce que le site ne répond pas.
      const { service } = makeHarness();
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));

      await expect(service.quote(['DJA-5KG'])).resolves.toEqual({
        status: 'unavailable',
      });
    });
  });

  // ── L'audit ──────────────────────────────────────────────────────────────

  describe('diff — comparer sans écrire', () => {
    it('relève les écarts de prix, les manques et les fantômes', async () => {
      const { service, productVariant } = makeHarness();
      // La Djassa 5 kg est déjà rattachée, mais au mauvais prix.
      ligne(productVariant, 'var-djassa-5').sourceRef = 'DJA-5KG';

      const resultat = await service.diff();

      expect(resultat.ok).toBe(false);
      expect(resultat.checked).toBe(2);
      expect(resultat.differences).toEqual([
        { reference: 'DJA-5KG', field: 'price', site: 2250, app: 2800 },
      ]);
      // Prémium se vend sur le site et nulle part dans l'application.
      expect(resultat.missingInApp).toEqual(['PRE-5KG']);
      // La 25 kg ne se vend plus sur le site mais reste offerte ici.
      expect(resultat.extraInApp).toEqual(['DJA-25KG']);
    });

    it("n'écrit rien, jamais", async () => {
      // C'est tout l'intérêt de cette route : on peut la lancer en production
      // avant de décider d'écrire.
      const { service, category, product, productVariant } = makeHarness();

      await service.diff();

      for (const t of [category, product, productVariant]) {
        expect(t.create).not.toHaveBeenCalled();
        expect(t.update).not.toHaveBeenCalled();
        expect(t.updateMany).not.toHaveBeenCalled();
      }
    });
  });
});
