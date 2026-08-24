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
  ranges: { created: number; updated: number };
  variants: { created: number; updated: number; deactivated: number };
  skipped: string[];
  errors: string[];
  durationMs: number;
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

@Injectable()
export class CatalogSyncService {
  private readonly logger = new Logger(CatalogSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

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
      ranges: { created: 0, updated: 0 },
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

    // ── 3. Ce que le site ne vend plus ───────────────────────────────────
    // Désactivé, jamais supprimé : des commandes le référencent.
    if (referencesVues.size > 0) {
      const retirees = await this.prisma.db.productVariant.updateMany({
        where: {
          sourceRef: { not: null, notIn: [...referencesVues] },
          isAvailable: true,
        },
        data: { isAvailable: false },
      });
      rapport.variants.deactivated = retirees.count;
    }

    rapport.ok = rapport.errors.length === 0;
    rapport.durationMs = Date.now() - debut;

    const resume =
      `gammes ${rapport.ranges.created}+/${rapport.ranges.updated}~ · ` +
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
      isAvailable: produit.actif,
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
      compare('isAvailable', produit.actif, locale.isAvailable);
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
