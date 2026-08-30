/**
 * Synchronisation du catalogue depuis le SITE — AGRIM / RIZ BOAGNI.
 *
 * Décision d'architecture (audit de cohérence, août 2026)
 * ──────────────────────────────────────────────────────
 * Le site et l'application sont deux interfaces d'un même commerce. Le
 * catalogue n'a donc qu'un seul propriétaire : le SITE, dont le back office
 * « Catalogue Produit » gère gammes, formats, prix, promotions et stocks.
 *
 * Cette API en garde une COPIE locale — ses paniers et ses commandes
 * référencent les variantes par clé étrangère, elle ne peut pas lire le
 * catalogue à distance à chaque requête. Mais elle ne l'invente plus :
 * un prix ne se corrige QUE sur le site.
 *
 * Trois règles, qui expliquent tout le code ci-dessous
 * ────────────────────────────────────────────────────
 * 1. **On n'écrase jamais un stock local.** Le stock de cette base est
 *    entamé par de vraies commandes mobiles ; celui du site l'est par les
 *    commandes web. Tant que les deux stocks vivent séparément, recopier
 *    l'un sur l'autre ferait disparaître des ventes. On synchronise donc
 *    l'IDENTITÉ et le PRIX, pas la quantité — voir `syncStock`.
 * 2. **On ne supprime jamais.** Une variante retirée du site est
 *    DÉSACTIVÉE ici, jamais effacée : des commandes la référencent.
 * 3. **La clé est la référence du site**, pas le nom ni le sku, qui peuvent
 *    être corrigés dans le back office sans rien casser.
 */
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DeliveryGrid } from '@agrim/contracts';

import { PrismaService } from '../prisma/prisma.service';

/** Une gamme, telle que le site l'expose. */
interface SourceRange {
  code: string;
  nom: string;
  slug: string;
  description_courte: string;
  description: string;
  ordre: number;
  actif: boolean;
  image_url: string;
}

/** Une référence vendable, telle que le site l'expose. */
interface SourceProduct {
  reference: string;
  sku: string;
  gamme_code: string;
  gamme_nom: string;
  gamme_slug: string;
  nom: string;
  description: string;
  format: string;
  poids_grammes: number;
  prix: number;
  prix_barre: number | null;
  en_promotion: boolean;
  stock: number;
  seuil_alerte: number;
  actif: boolean;
  disponible: boolean;
  /**
   * Le site autorise-t-il la vente de cette référence, stock mis à part ?
   *
   * `actif` seul ne le dit pas : le back office distingue le retrait du
   * catalogue (`actif = 0`) de la rupture DÉCLARÉE — « il en reste en
   * magasin, mais on n'en vend plus » — qui laisse la référence active. La
   * boutique du site refuse la seconde ; l'application l'acceptait.
   *
   * Facultatif : un site antérieur à ce champ n'en envoie pas, et l'on
   * retombe alors sur `actif`, l'ancien comportement. À rendre obligatoire
   * une fois le site déployé.
   */
  vendable?: boolean;
  disponibilite?: 'auto' | 'rupture';
  badge: string;
  couleur: string;
  image_url: string;
}

interface SourceCatalog {
  genere_le: string;
  marque: string;
  devise: string;
  gammes: SourceRange[];
  produits: SourceProduct[];
  total: number;
}

/** Ce qu'on lit d'une variante locale pour la comparer au site. */
interface LocalVariant {
  sourceRef: string | null;
  sku: string;
  label: string;
  weightGrams: number;
  price: number;
  originalPrice: number | null;
  isAvailable: boolean;
}

export interface SyncReport {
  ok: boolean;
  source: string;
  generatedAt: string | null;
  ranges: { created: number; updated: number; deactivated: number };
  variants: { created: number; updated: number; deactivated: number };
  skipped: string[];
  errors: string[];
  durationMs: number;
}

/**
 * La référence est-elle en vente, selon le SITE ?
 *
 * Règle unique, appliquée aussi bien par la synchronisation que par l'audit
 * `diff()` — deux définitions feraient réapparaître ici, sous forme de faux
 * écarts, la divergence que cette fonction sert justement à supprimer.
 *
 * Le stock n'y entre pas : chaque plateforme tient le sien tant que la
 * réservation n'est pas centralisée (règle 1 en tête de fichier). Ce que
 * l'application copie, c'est l'AUTORISATION DE VENDRE, pas la quantité.
 *
 * Repli sur `actif` quand le site n'envoie pas encore `vendable` : la
 * synchronisation doit continuer de fonctionner contre un site non redéployé,
 * exactement comme avant ce correctif.
 */
function estVendable(produit: SourceProduct): boolean {
  if (typeof produit.vendable === 'boolean') return produit.vendable;
  if (produit.disponibilite === 'rupture') return false;
  return produit.actif;
}

/**
 * Rattachement des gammes du site aux gammes DÉJÀ présentes ici.
 *
 * Nécessaire une seule fois : au premier passage, les catégories locales
 * n'ont pas encore de `sourceCode`. Sans cette table, la synchronisation
 * créerait six gammes en double — et les commandes existantes pointeraient
 * sur les anciennes.
 *
 * `dietetique` est l'ancienne gamme unique, scindée depuis en Complet et
 * Violet côté site : elle est rattachée à Complet et conserve donc ses
 * variantes, ses identifiants et ses commandes.
 */
const LEGACY_SLUGS: Record<string, string[]> = {
  EBE: ['ebene-dor', 'ebene-d-or'],
  DIE: ['dietetique-complet', 'dietetique'],
  DJA: ['djassa'],
  DV: ['dietetique-violet'],
  ROY: ['royal-grains', 'royal-grain'],
  SIK: ['sika'],
};

/**
 * Grille de livraison relue du site, avec sa date de péremption.
 *
 * Mise en cache pour deux raisons, et la seconde est la plus importante :
 * ne pas appeler le site à chaque passage en caisse, et surtout continuer à
 * vendre quand il est injoignable. Un tarif de livraison ne change pas dans
 * la minute ; une panne du site ne doit pas fermer la boutique.
 */
interface CachedGrid {
  grid: DeliveryGrid;
  fetchedAt: number;
}

/** Durée de fraîcheur du cache. Même ordre que la synchronisation catalogue. */
const GRID_TTL_MS = 15 * 60_000;

@Injectable()
export class CatalogSyncService {
  private readonly logger = new Logger(CatalogSyncService.name);

  private cachedGrid: CachedGrid | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Grille officielle des frais de livraison — servie par le SITE.
   *
   * Décision métier du 29 août 2026 : le site fait foi, comme pour la grille
   * produits. L'application n'a plus aucun tarif en dur ; elle lit celui-ci.
   *
   * Renvoie `null` quand la grille est indisponible ET jamais reçue. Ce cas
   * est traité par l'appelant : voir `OrdersService.create`, qui refuse alors
   * de deviner un montant plutôt que d'en facturer un faux.
   *
   * Une grille périmée est PRÉFÉRÉE à l'absence de grille : un tarif vieux de
   * quelques heures reste un tarif officiel, alors qu'un refus de commande
   * est une vente perdue.
   *
   * **Ne bloque JAMAIS un passage en caisse pour joindre le site.** Dès qu'une
   * grille est connue, elle est renvoyée immédiatement et le rafraîchissement
   * part en arrière-plan. La première version faisait l'inverse : chaque
   * commande attendait jusqu'à huit secondes un site endormi, et le client
   * regardait tourner un écran de paiement pour un tarif qui n'avait pas
   * changé. Seule une installation qui n'a JAMAIS reçu de grille attend.
   */
  async deliveryGrid(): Promise<DeliveryGrid | null> {
    const frais = this.cachedGrid;
    if (frais && Date.now() - frais.fetchedAt < GRID_TTL_MS) return frais.grid;

    const connue = await this.lastKnownGrid();
    if (connue) {
      // Rafraîchissement détaché : la commande en cours part avec le tarif
      // connu, la suivante bénéficiera du nouveau.
      //
      // Le `catch` n'est pas décoratif : une promesse détachée qui rejette
      // fait tomber le processus Node entier (unhandled rejection). Un site
      // injoignable ne doit pas arrêter l'API.
      void this.refreshGrid().catch(() => undefined);
      return connue;
    }

    // Aucune grille, jamais : là seulement on attend le site.
    return this.refreshGrid();
  }

  /** Rafraîchissement effectif. Un seul en vol à la fois. */
  private refreshing: Promise<DeliveryGrid | null> | null = null;

  private refreshGrid(): Promise<DeliveryGrid | null> {
    // Sans ce garde, dix commandes simultanées déclencheraient dix appels au
    // site pour la même information.
    this.refreshing ??= this.fetchGrid().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async fetchGrid(): Promise<DeliveryGrid | null> {
    const base = (this.config.get<string>('SITE_INTEGRATION_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    const token = this.config.get<string>('SITE_INTEGRATION_TOKEN') ?? '';
    if (!base || !token) return this.lastKnownGrid();

    try {
      const response = await fetch(`${base}/api/integration/livraison`, {
        headers: {
          'X-Sync-Token': token,
          Accept: 'application/json',
          'User-Agent': 'agrim-api/delivery-grid',
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return this.lastKnownGrid();

      const payload = (await response.json()) as {
        zones?: Record<string, { libelle: string; frais: number; delai: string }>;
        zone_par_defaut?: string;
        retrait?: { libelle: string; frais: number; delai: string };
        livraison_offerte_seuil_kg?: number;
      };

      // Une grille sans zones n'est pas une grille : la refuser vaut mieux que
      // de facturer zéro à tout le monde.
      if (!payload.zones || Object.keys(payload.zones).length === 0) {
        this.logger.warn('Grille de livraison vide : ancienne grille conservée.');
        return this.lastKnownGrid();
      }

      const grid: DeliveryGrid = {
        zones: payload.zones,
        zoneParDefaut: payload.zone_par_defaut ?? 'autre',
        retrait: payload.retrait ?? { libelle: 'Retrait', frais: 0, delai: '' },
        livraisonOfferteSeuilKg: payload.livraison_offerte_seuil_kg ?? 0,
      };
      this.cachedGrid = { grid, fetchedAt: Date.now() };
      // Copie persistée : au redémarrage, l'API doit pouvoir facturer avant
      // d'avoir joint le site. Même raisonnement que la copie du catalogue —
      // c'est un cache, pas une source : le site reste le seul à décider.
      await this.rememberGrid(grid);
      return grid;
    } catch {
      this.logger.warn(
        'Grille de livraison injoignable : ancienne grille conservée.',
      );
      return this.lastKnownGrid();
    }
  }

  /* ─────────────────────────── Réservation de stock ────────────────────────
   *
   * Le SITE possède le stock (décision du 29 août 2026). Cette API ne tient
   * plus de compteur concurrent : elle demande, elle ne décide pas.
   *
   * Les trois verbes ci-dessous n'implémentent AUCUNE règle — ils appellent
   * `/api/integration/stock/*`, dont le contrat et l'atomicité vivent côté
   * site (`reservations.py`). Réécrire cette logique ici recréerait les deux
   * compteurs que ce lot supprime.
   */

  /** Résultat d'une demande de réservation, dans le vocabulaire de l'appelant. */
  private async callStock(
    chemin: 'reserver' | 'liberer' | 'confirmer' | 'finaliser',
    corps: Record<string, unknown>,
  ): Promise<
    | { status: 'ok'; body: unknown }
    | { status: 'refused'; message: string; details: unknown }
    | { status: 'unavailable' }
  > {
    const base = (this.config.get<string>('SITE_INTEGRATION_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    const token = this.config.get<string>('SITE_INTEGRATION_TOKEN') ?? '';
    if (!base || !token) return { status: 'unavailable' };

    try {
      const response = await fetch(`${base}/api/integration/stock/${chemin}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Sync-Token': token,
          Accept: 'application/json',
        },
        body: JSON.stringify(corps),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) return { status: 'ok', body: await response.json() };

      // 409 = conflit d'état côté site : stock insuffisant, référence retirée
      // de la vente. C'est un refus MÉTIER, à traduire pour le client, et non
      // une panne.
      if (response.status === 409) {
        const payload = (await response.json().catch(() => ({}))) as {
          detail?: { message?: string; lignes?: unknown };
        };
        return {
          status: 'refused',
          message: payload.detail?.message ?? 'Stock insuffisant.',
          details: payload.detail?.lignes ?? [],
        };
      }

      this.logger.warn(`Stock ${chemin} : HTTP ${response.status}.`);
      return { status: 'unavailable' };
    } catch {
      this.logger.warn(`Stock ${chemin} : site injoignable.`);
      return { status: 'unavailable' };
    }
  }

  /**
   * Réserve le stock d'une commande auprès du site.
   *
   * `reference` est la clé d'idempotence de la commande : rejouer la même
   * requête ne réserve pas deux fois (le site renvoie `rejeu: true`). C'est
   * indispensable — l'appelant est un réseau mobile.
   *
   * `unavailable` n'est PAS un refus : c'est l'incapacité de savoir. Voir
   * `OrdersService.create`, qui refuse alors la commande plutôt que de vendre
   * un stock qu'aucun système ne lui a accordé.
   */
  reserveStock(
    reference: string,
    lines: ReadonlyArray<{ sourceRef: string; quantity: number }>,
  ) {
    return this.callStock('reserver', {
      reference,
      origine: 'app',
      lignes: lines.map((l) => ({
        reference_produit: l.sourceRef,
        quantite: l.quantity,
      })),
    });
  }

  /**
   * Rend au rayon le stock d'une commande annulée.
   *
   * Idempotent côté site : une réservation déjà réglée n'est pas rendue une
   * seconde fois, donc une annulation rejouée ne crée pas de stock.
   */
  releaseStock(reference: string, motif = 'annulation') {
    return this.callStock('liberer', { reference, motif, origine: 'app' });
  }

  /**
   * Arrête le compte à rebours : la COMMANDE existe.
   *
   * Sans cet appel, l'expiration rendrait au rayon la marchandise d'une
   * commande bien réelle — en particulier pour un paiement à la livraison,
   * qui reste « en attente » jusqu'à la remise.
   *
   * Ne ferme PAS la porte de sortie : une annulation légitime doit encore
   * rendre le stock. C'est `finaliseStock`, à la livraison, qui la ferme.
   */
  confirmStock(reference: string) {
    return this.callStock('confirmer', { reference, origine: 'app' });
  }

  /**
   * Ferme la réservation : la marchandise est remise au client.
   *
   * Seul état depuis lequel le stock ne revient plus. À appeler à la
   * LIVRAISON, jamais avant — tant que la marchandise n'est pas partie, une
   * annulation doit pouvoir la remettre en rayon.
   *
   * Idempotent côté site : une réservation déjà finalisée n'est pas comptée
   * deux fois, et `finaliser` ne touche de toute façon jamais au compteur de
   * stock. Une double finalisation est donc sans conséquence.
   */
  finaliseStock(reference: string) {
    return this.callStock('finaliser', { reference, origine: 'app' });
  }

  /** Clé de la copie locale de la grille, dans les paramètres société. */
  private static readonly GRID_KEY = 'deliveryGrid';

  private async rememberGrid(grid: DeliveryGrid): Promise<void> {
    try {
      await this.prisma.db.companySetting.upsert({
        where: { key: CatalogSyncService.GRID_KEY },
        create: {
          key: CatalogSyncService.GRID_KEY,
          value: JSON.stringify(grid),
        },
        update: { value: JSON.stringify(grid) },
      });
    } catch (erreur) {
      // Ne jamais faire échouer une commande parce que le CACHE n'a pas pu
      // s'écrire : la grille en mémoire suffit à facturer.
      this.logger.warn(
        `Grille de livraison non persistée : ${(erreur as Error).message}`,
      );
    }
  }

  /**
   * Dernière grille connue : mémoire d'abord, base ensuite.
   *
   * `null` signifie qu'aucune grille n'a JAMAIS été reçue — le cas d'une
   * installation neuve dont le site n'a pas encore répondu. L'appelant refuse
   * alors la commande plutôt que d'inventer un tarif.
   */
  private async lastKnownGrid(): Promise<DeliveryGrid | null> {
    if (this.cachedGrid) return this.cachedGrid.grid;

    try {
      const ligne = await this.prisma.db.companySetting.findUnique({
        where: { key: CatalogSyncService.GRID_KEY },
        select: { value: true },
      });
      if (!ligne) return null;

      const grid = JSON.parse(ligne.value) as DeliveryGrid;
      if (!grid?.zones || Object.keys(grid.zones).length === 0) return null;

      // Remise en mémoire, mais datée de zéro : la prochaine lecture
      // retentera le site plutôt que de se contenter de cette copie.
      this.cachedGrid = { grid, fetchedAt: 0 };
      return grid;
    } catch (erreur) {
      this.logger.warn(
        `Grille de livraison illisible en base : ${(erreur as Error).message}`,
      );
      return null;
    }
  }

  /**
   * URL du catalogue : dérivée de l'adresse du site, sauf surcharge explicite
   * (proxy, environnement de recette).
   */
  get sourceUrl(): string {
    const surcharge = this.config.get<string>('CATALOG_SOURCE_URL') ?? '';
    if (surcharge) return surcharge;

    const base = (this.config.get<string>('SITE_INTEGRATION_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    return base ? `${base}/api/integration/catalogue` : '';
  }

  get isConfigured(): boolean {
    return Boolean(this.sourceUrl);
  }

  /**
   * Prix effectifs du moment, relus sur le site au checkout.
   *
   * Sans cet appel, on encaisse le prix de la copie (0–15 min de retard).
   * Si le site ne répond pas, on renvoie `null` : l'appelant vend alors le
   * prix local non promo (`originalPrice` s'il existe).
   *
   * `vendable` accompagne le prix pour la même raison que lui : dans la
   * fenêtre entre deux synchronisations, le site a pu retirer la référence de
   * la vente. Le champ est facultatif — un site non redéployé n'en envoie
   * pas — et vaut alors `true` : sans information, on ne bloque pas une vente.
   */
  async quote(references: string[]): Promise<
    | { status: 'disabled' }
    | { status: 'unavailable' }
    | {
        status: 'ok';
        prices: Map<
          string,
          {
            prix: number;
            prixBarre: number | null;
            disponible: boolean;
            vendable: boolean;
          }
        >;
      }
  > {
    const base = (this.config.get<string>('SITE_INTEGRATION_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    const token = this.config.get<string>('SITE_INTEGRATION_TOKEN') ?? '';
    if (!base || !token || references.length === 0) {
      return { status: 'disabled' };
    }

    try {
      const response = await fetch(`${base}/api/integration/prix`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Sync-Token': token,
          Accept: 'application/json',
        },
        body: JSON.stringify({ references: references.slice(0, 50) }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return { status: 'unavailable' };
      const payload = (await response.json()) as {
        prix?: Record<
          string,
          {
            prix: number;
            prix_barre: number | null;
            disponible: boolean;
            vendable?: boolean;
          } | null
        >;
      };
      const prices = new Map<
        string,
        {
          prix: number;
          prixBarre: number | null;
          disponible: boolean;
          vendable: boolean;
        }
      >();
      for (const [ref, ligne] of Object.entries(payload.prix ?? {})) {
        if (ligne) {
          prices.set(ref, {
            prix: ligne.prix,
            prixBarre: ligne.prix_barre,
            disponible: ligne.disponible,
            vendable: ligne.vendable ?? true,
          });
        }
      }
      return { status: 'ok', prices };
    } catch {
      this.logger.warn('Cotation site injoignable : prix locaux conservés.');
      return { status: 'unavailable' };
    }
  }

  /** Récupère le catalogue du site. Ne modifie rien. */
  async fetchSource(): Promise<SourceCatalog> {
    const url = this.sourceUrl;
    const token = this.config.get<string>('SITE_INTEGRATION_TOKEN') ?? '';

    if (!url) {
      throw new ServiceUnavailableException(
        'SITE_INTEGRATION_URL absent : la synchronisation du catalogue est désactivée.',
      );
    }

    // Délai borné : une source injoignable ne doit pas retenir une requête
    // d'administration ni bloquer la tâche de fond.
    const abort = AbortSignal.timeout(20_000);
    const response = await fetch(url, {
      headers: {
        'X-Sync-Token': token,
        Accept: 'application/json',
        'User-Agent': 'agrim-api/catalog-sync',
      },
      signal: abort,
    });

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Catalogue source indisponible (HTTP ${response.status}).`,
      );
    }

    const data = (await response.json()) as SourceCatalog;
    if (!Array.isArray(data?.produits) || !Array.isArray(data?.gammes)) {
      throw new ServiceUnavailableException(
        'Réponse du catalogue source inexploitable : « produits » ou « gammes » manquant.',
      );
    }
    return data;
  }

  /**
   * Recopie le catalogue du site dans cette base.
   *
   * @param syncStock recopier aussi les quantités. FAUX par défaut, et ce
   *   défaut est important : tant que les deux plateformes tiennent chacune
   *   leur stock, écraser l'un par l'autre effacerait des ventes. À passer à
   *   vrai le jour où le site devient aussi le maître du stock.
   */
  async sync(options: { syncStock?: boolean } = {}): Promise<SyncReport> {
    const debut = Date.now();
    const rapport: SyncReport = {
      ok: false,
      source: this.sourceUrl,
      generatedAt: null,
      ranges: { created: 0, updated: 0, deactivated: 0 },
      variants: { created: 0, updated: 0, deactivated: 0 },
      skipped: [],
      errors: [],
      durationMs: 0,
    };

    const catalogue = await this.fetchSource();
    rapport.generatedAt = catalogue.genere_le ?? null;

    const categoryParCode = new Map<string, string>();
    const productParCode = new Map<string, string>();

    // ── 1. Les gammes ────────────────────────────────────────────────────
    for (const gamme of catalogue.gammes) {
      try {
        const { categoryId, productId, created } = await this.upsertRange(
          gamme,
          catalogue.marque,
        );
        categoryParCode.set(gamme.code, categoryId);
        productParCode.set(gamme.code, productId);
        if (created) rapport.ranges.created += 1;
        else rapport.ranges.updated += 1;
      } catch (erreur) {
        rapport.errors.push(`gamme ${gamme.code} : ${(erreur as Error).message}`);
      }
    }

    // ── 2. Les références ────────────────────────────────────────────────
    const referencesVues = new Set<string>();

    for (const produit of catalogue.produits) {
      const productId = productParCode.get(produit.gamme_code);
      if (!productId) {
        // La gamme a échoué plus haut : on saute la référence plutôt que de
        // la rattacher à un produit arbitraire.
        rapport.skipped.push(produit.reference);
        continue;
      }
      try {
        const created = await this.upsertVariant(productId, produit, options.syncStock === true);
        referencesVues.add(produit.reference);
        if (created) rapport.variants.created += 1;
        else rapport.variants.updated += 1;
      } catch (erreur) {
        rapport.errors.push(
          `référence ${produit.reference} : ${(erreur as Error).message}`,
        );
      }
    }

    // ── 3. Ce que le site ne vend pas ────────────────────────────────────
    // Désactivé, jamais supprimé : des commandes le référencent.
    //
    // Deux populations à retirer, et la seconde manquait :
    //
    //   `sourceRef` renseigné mais absent du catalogue — une référence que le
    //   site a cessé de vendre.
    //
    //   `sourceRef` VIDE — une variante que le site n'a jamais confirmée.
    //   C'est le cas des données de démarrage : le seed crée un catalogue
    //   d'exemple sans rattachement. Tant que cette branche manquait, elles
    //   survivaient à chaque synchronisation et cohabitaient avec le vrai
    //   catalogue : l'application vendait une gamme entière inexistante et un
    //   format « 900 g » sur cinq gammes, avec des stocks inventés. Un client
    //   pouvait commander ce qui n'existe pas.
    //
    // Le rattachement se fait par `sourceRef` PUIS par (produit, poids) : une
    // variante du seed qui correspond à une référence réelle est adoptée et
    // reçoit son `sourceRef`. Ne restent donc sans rattachement que celles qui
    // n'ont aucun équivalent au catalogue.
    //
    // Deux garde-fous avant d'écrire : un catalogue vide ne doit jamais vider
    // la boutique, et une synchronisation partielle non plus — sans quoi une
    // panne du site retirerait de la vente des produits bien réels.
    if (referencesVues.size > 0 && rapport.errors.length === 0) {
      const retirees = await this.prisma.db.productVariant.updateMany({
        where: {
          OR: [
            { sourceRef: { not: null, notIn: [...referencesVues] } },
            { sourceRef: null },
          ],
          isAvailable: true,
        },
        data: { isAvailable: false },
      });
      rapport.variants.deactivated = retirees.count;
    }

    // ── 4. Les gammes que le site ne propose pas ─────────────────────────
    // Sans cette etape, une gamme retiree du catalogue resterait affichee en
    // RAYON VIDE : `products.list()` ne filtre que sur `isActive`, et n'inclut
    // que les variantes disponibles. Une gamme dont toutes les variantes
    // viennent d'etre desactivees s'afficherait donc sans rien a vendre.
    //
    // Meme rattachement que pour les variantes — `sourceCode` — et memes deux
    // garde-fous : ni catalogue vide, ni synchronisation partielle.
    const codesVus = [...productParCode.keys()];
    if (codesVus.length > 0 && rapport.errors.length === 0) {
      const gammesRetirees = await this.prisma.db.product.updateMany({
        where: {
          OR: [
            { sourceCode: { not: null, notIn: codesVus } },
            { sourceCode: null },
          ],
          isActive: true,
        },
        data: { isActive: false },
      });
      rapport.ranges.deactivated = gammesRetirees.count;
    }

    rapport.ok = rapport.errors.length === 0;
    rapport.durationMs = Date.now() - debut;

    const resume =
      `gammes ${rapport.ranges.created}+/${rapport.ranges.updated}~/` +
      `${rapport.ranges.deactivated}- · ` +
      `variantes ${rapport.variants.created}+/${rapport.variants.updated}~/` +
      `${rapport.variants.deactivated}- · ${rapport.durationMs} ms`;
    if (rapport.ok) this.logger.log(`Catalogue synchronisé : ${resume}`);
    else this.logger.warn(`Catalogue synchronisé avec erreurs : ${resume}`);

    return rapport;
  }

  /**
   * Une gamme du site = une Category + un Product ici.
   *
   * Le rattachement se fait dans cet ordre : `sourceCode` (les fois
   * suivantes), puis les slugs historiques (la première fois), puis le slug
   * du site (gamme réellement nouvelle).
   */
  private async upsertRange(
    gamme: SourceRange,
    marque: string,
  ): Promise<{ categoryId: string; productId: string; created: boolean }> {
    const slugsCandidats = [
      gamme.slug,
      ...(LEGACY_SLUGS[gamme.code] ?? []),
    ];

    const categorieExistante =
      (await this.prisma.db.category.findFirst({ where: { sourceCode: gamme.code } })) ??
      (await this.prisma.db.category.findFirst({ where: { slug: { in: slugsCandidats } } }));

    const donneesCategorie = {
      slug: gamme.slug,
      name: gamme.nom,
      description: gamme.description_courte || gamme.description || null,
      sortOrder: gamme.ordre,
      sourceCode: gamme.code,
      ...(gamme.image_url ? { imageUrl: gamme.image_url } : {}),
    };

    const category = categorieExistante
      ? await this.prisma.db.category.update({
          where: { id: categorieExistante.id },
          data: donneesCategorie,
        })
      : await this.prisma.db.category.create({ data: donneesCategorie });

    const produitExistant =
      (await this.prisma.db.product.findFirst({ where: { sourceCode: gamme.code } })) ??
      (await this.prisma.db.product.findFirst({ where: { slug: { in: slugsCandidats } } }));

    const donneesProduit = {
      slug: gamme.slug,
      name: `${marque} ${gamme.nom}`,
      shortDescription: gamme.description_courte || null,
      description: gamme.description || null,
      brand: marque,
      categoryId: category.id,
      isActive: gamme.actif,
      isFeatured: gamme.ordre <= 2,
      sourceCode: gamme.code,
      ...(gamme.image_url ? { imageUrl: gamme.image_url } : {}),
    };

    const product = produitExistant
      ? await this.prisma.db.product.update({
          where: { id: produitExistant.id },
          data: donneesProduit,
        })
      : await this.prisma.db.product.create({ data: donneesProduit });

    return {
      categoryId: category.id,
      productId: product.id,
      created: !produitExistant,
    };
  }

  /**
   * Une référence du site = une ProductVariant ici.
   *
   * Rattachement : `sourceRef`, puis (produit, poids) pour les variantes
   * antérieures à la synchronisation — c'est la ligne d'inventaire réelle,
   * elle ne change pas quand le sku est corrigé.
   */
  private async upsertVariant(
    productId: string,
    produit: SourceProduct,
    syncStock: boolean,
  ): Promise<boolean> {
    const existante =
      (await this.prisma.db.productVariant.findFirst({
        where: { sourceRef: produit.reference },
      })) ??
      (await this.prisma.db.productVariant.findFirst({
        where: { productId, weightGrams: produit.poids_grammes },
      }));

    // Le sku du site peut être vide : on retombe alors sur la référence,
    // qui est toujours renseignée et unique.
    const sku = produit.sku || produit.reference;

    const commun = {
      productId,
      sku,
      label: produit.format,
      weightGrams: produit.poids_grammes,
      // `prix` est DÉJÀ le prix effectif : le site a appliqué la promotion.
      // L'application n'a donc aucune règle de prix à connaître.
      price: produit.prix,
      originalPrice: produit.prix_barre ?? null,
      isAvailable: estVendable(produit),
      sourceRef: produit.reference,
      syncedAt: new Date(),
    };

    if (existante) {
      await this.prisma.db.productVariant.update({
        where: { id: existante.id },
        data: {
          ...commun,
          // Stock exclu par défaut : voir la règle 1 en tête de fichier.
          ...(syncStock
            ? { stock: produit.stock, lowStockThreshold: produit.seuil_alerte }
            : {}),
        },
      });
      return false;
    }

    await this.prisma.db.productVariant.create({
      data: {
        ...commun,
        // À la CRÉATION, le stock du site est la seule valeur connue :
        // la reprendre est juste, il n'y a rien à écraser.
        stock: produit.stock,
        lowStockThreshold: produit.seuil_alerte,
      },
    });
    return true;
  }

  /**
   * Compare les deux catalogues sans rien écrire.
   *
   * C'est l'outil d'audit : il répond à « le même riz a-t-il le même prix
   * des deux côtés ? » sans prendre le risque d'une écriture.
   */
  async diff(): Promise<{
    ok: boolean;
    checked: number;
    differences: Array<{
      reference: string;
      field: string;
      site: unknown;
      app: unknown;
    }>;
    missingInApp: string[];
    extraInApp: string[];
  }> {
    const catalogue = await this.fetchSource();

    // Type explicite : le `select` de Prisma produit un type conditionnel que
    // le compilateur ne sait pas restreindre ici, et l'on se retrouverait à
    // comparer des `unknown`. Nommer la forme attendue rend aussi la
    // comparaison ci-dessous lisible sans remonter à la requête.
    const locales: LocalVariant[] = await this.prisma.db.productVariant.findMany({
      select: {
        sourceRef: true,
        sku: true,
        label: true,
        weightGrams: true,
        price: true,
        originalPrice: true,
        isAvailable: true,
      },
    });

    const parReference = new Map<string, LocalVariant>(
      locales
        .filter((v): v is LocalVariant & { sourceRef: string } =>
          Boolean(v.sourceRef),
        )
        .map((v) => [v.sourceRef, v]),
    );
    const differences: Array<{
      reference: string;
      field: string;
      site: unknown;
      app: unknown;
    }> = [];
    const missingInApp: string[] = [];

    for (const produit of catalogue.produits) {
      const locale = parReference.get(produit.reference);
      if (!locale) {
        missingInApp.push(produit.reference);
        continue;
      }
      const compare = (field: string, site: unknown, app: unknown) => {
        if (site !== app) {
          differences.push({ reference: produit.reference, field, site, app });
        }
      };
      compare('price', produit.prix, locale.price);
      compare('originalPrice', produit.prix_barre ?? null, locale.originalPrice);
      compare('label', produit.format, locale.label);
      compare('weightGrams', produit.poids_grammes, locale.weightGrams);
      compare('isAvailable', estVendable(produit), locale.isAvailable);
    }

    const referencesSite = new Set(catalogue.produits.map((p) => p.reference));
    const extraInApp = [...parReference.keys()].filter(
      (ref) => !referencesSite.has(ref),
    );

    return {
      ok: differences.length === 0 && missingInApp.length === 0,
      checked: catalogue.produits.length,
      differences,
      missingInApp,
      extraInApp,
    };
  }
}
