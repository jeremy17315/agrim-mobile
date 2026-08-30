import type { DeliveryGrid } from '@agrim/contracts';

import type { CatalogSyncService } from '../catalog-sync/catalog-sync.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Le SITE, simulé pour les tests d'intégration de cette API.
 *
 * Pourquoi un double, et pourquoi celui-ci
 * ─────────────────────────────────────────
 * Depuis le 29 août 2026, le site possède le catalogue, les prix, la grille de
 * livraison et le stock. C'est un système EXTERNE : une suite e2e de cette API
 * ne peut dépendre ni de sa disponibilité, ni de ses données, ni de son délai
 * de réponse. Sans double, `POST /orders` répond 503 dès que le site dort —
 * ce qui est le comportement voulu en production, et inexploitable en test.
 *
 * Ce double n'est PAS un `jest.fn()` qui dit toujours oui. Il implémente le
 * même contrat observable que le site, et surtout la même règle d'arbitrage :
 * la réservation est un décrément CONDITIONNEL (`stock >= quantité`), donc
 * deux commandes concurrentes sur le dernier sac ne peuvent pas réussir toutes
 * les deux. C'est ce qui permet aux assertions de stock des suites e2e —
 * décrément, refus, non-survente, restitution à l'annulation — de garder
 * exactement le sens qu'elles avaient.
 *
 * Il opère sur `ProductVariant.stock`, la copie locale. En production cette
 * colonne n'est plus qu'un reflet du stock du site ; ici elle en tient lieu,
 * ce qui donne un point d'observation unique et déterministe.
 *
 * La VRAIE implémentation, elle, est testée là où elle vit : côté site,
 * `backend/tests/test_reservations.py`, concurrence réelle comprise. Ce double
 * ne prétend pas la remplacer — il isole cette API de son voisin.
 */

/**
 * Grille de livraison figée, calquée sur `config.py:ZONES_LIVRAISON`.
 *
 * Figée volontairement : un test qui dépendrait de la grille servie par le
 * site ne serait plus déterministe. Les montants ci-dessous n'ont donc pas
 * valeur de vérité métier — celle-ci vient du site — ils rendent les totaux
 * assertables.
 */
export const GRILLE_DE_TEST: DeliveryGrid = {
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

/** Ce que les tests peuvent observer du « site ». */
export interface SiteIntegrationDouble {
  /** Réservations en vie, par clé d'idempotence. */
  readonly reservations: Map<string, { sourceRef: string; quantity: number }[]>;
  readonly confirmees: string[];
  readonly finalisees: string[];
  readonly liberees: string[];
  /** Vide l'état entre deux suites. */
  reset(): void;
}

/**
 * Fabrique le double et son état observable.
 *
 * @param prisma le même client que l'application : le double lit et écrit la
 *   colonne `stock`, si bien que les assertions des tests portent sur l'état
 *   réel de la base, pas sur un compteur parallèle.
 */
export function createSiteIntegrationDouble(prisma: PrismaService): {
  service: CatalogSyncService;
  observe: SiteIntegrationDouble;
} {
  const reservations = new Map<
    string,
    { sourceRef: string; quantity: number }[]
  >();
  const confirmees: string[] = [];
  const finalisees: string[] = [];
  const liberees: string[] = [];

  /** Retrouve une variante par la référence du site. */
  const parReference = (sourceRef: string) =>
    prisma.db.productVariant.findFirst({
      where: { sourceRef },
      select: { id: true },
    });

  const service = {
    /* ── Catalogue ────────────────────────────────────────────────────── */

    // `disabled` et non `ok` : les prix doivent venir du catalogue LOCAL,
    // c'est précisément ce que les suites vérifient. Une cotation simulée
    // masquerait une régression sur cette garantie.
    quote: async () => ({ status: 'disabled' as const }),

    deliveryGrid: async () => GRILLE_DE_TEST,

    /* ── Stock ────────────────────────────────────────────────────────── */

    async reserveStock(
      reference: string,
      lines: ReadonlyArray<{ sourceRef: string; quantity: number }>,
    ) {
      // Idempotence, comme le site : rejouer la même clé ne retire rien de
      // plus. C'est ce qui rend le test de rejeu significatif.
      if (reservations.has(reference)) {
        return { status: 'ok' as const, body: { rejeu: true } };
      }

      const prises: { sourceRef: string; quantity: number }[] = [];

      for (const ligne of lines) {
        const variante = await parReference(ligne.sourceRef);
        if (!variante) {
          await rendre(prises);
          return {
            status: 'refused' as const,
            message: `Référence inconnue : ${ligne.sourceRef}.`,
            details: [{ reference_produit: ligne.sourceRef }],
          };
        }

        // LE point qui compte : la condition est dans le WHERE. Deux
        // commandes simultanées sur le dernier sac ne peuvent pas réussir
        // toutes les deux — même arbitrage que `reservations.reserver`.
        const applique = await prisma.db.productVariant.updateMany({
          where: { id: variante.id, stock: { gte: ligne.quantity } },
          data: { stock: { decrement: ligne.quantity } },
        });

        if (applique.count === 0) {
          // Tout ou rien : on rend ce qui vient d'être pris sur cette
          // commande avant de refuser.
          await rendre(prises);
          return {
            status: 'refused' as const,
            message: 'Stock insuffisant.',
            details: [
              {
                reference_produit: ligne.sourceRef,
                demande: ligne.quantity,
              },
            ],
          };
        }
        prises.push({ ...ligne });
      }

      reservations.set(reference, prises);
      return { status: 'ok' as const, body: { rejeu: false } };
    },

    async releaseStock(reference: string) {
      const prises = reservations.get(reference);
      // Idempotent : une réservation déjà réglée ne rend rien une seconde
      // fois. Du stock rendu en trop est du stock inventé.
      if (!prises) return { status: 'ok' as const, body: { lignes: [] } };

      reservations.delete(reference);
      liberees.push(reference);
      await rendre(prises);
      return { status: 'ok' as const, body: { lignes: prises } };
    },

    async confirmStock(reference: string) {
      // « Confirmée » veut dire « la commande existe » : le compte à rebours
      // s'arrête, mais une annulation légitime doit ENCORE rendre le stock.
      // La réservation reste donc dans la table des rendables.
      //
      // La première version de ce double la retirait — elle reproduisait le
      // défaut du site, où `confirmer` fermait la porte de sortie et rendait
      // toute annulation incapable de restituer le stock. Un double qui
      // s'écarte du contrat cache le bug au lieu de le révéler.
      if (reservations.has(reference)) confirmees.push(reference);
      return { status: 'ok' as const, body: {} };
    },

    async finaliseStock(reference: string) {
      // La marchandise est remise au client : elle ne revient plus. C'est le
      // seul état qui ferme la porte, et il correspond à un fait physique.
      reservations.delete(reference);
      finalisees.push(reference);
      return { status: 'ok' as const, body: {} };
    },

    /* ── Le reste du service, inerte en test ──────────────────────────── */

    get isConfigured() {
      return true;
    },
    get sourceUrl() {
      return 'http://site-simule.test';
    },
    sync: async () => {
      throw new Error(
        'La synchronisation du catalogue n’a pas sa place dans une suite e2e.',
      );
    },
    diff: async () => {
      throw new Error('diff() n’est pas simulé.');
    },
    fetchSource: async () => {
      throw new Error('fetchSource() n’est pas simulé.');
    },
  } as unknown as CatalogSyncService;

  async function rendre(
    prises: { sourceRef: string; quantity: number }[],
  ): Promise<void> {
    for (const ligne of prises) {
      const variante = await parReference(ligne.sourceRef);
      if (!variante) continue;
      await prisma.db.productVariant.update({
        where: { id: variante.id },
        data: { stock: { increment: ligne.quantity } },
      });
    }
  }

  return {
    service,
    observe: {
      reservations,
      confirmees,
      finalisees,
      liberees,
      reset() {
        reservations.clear();
        confirmees.length = 0;
        finalisees.length = 0;
        liberees.length = 0;
      },
    },
  };
}

/**
 * Référence de site attribuée à une variante par les suites e2e.
 *
 * Le seed écrit le catalogue d'AMORÇAGE, sans `sourceRef` : dans ce modèle,
 * une variante sans référence est « une variante que le site n'a jamais
 * confirmée », et `OrdersService.create` refuse de la vendre
 * (`VARIANT_NOT_SYNCED`). C'est la bonne règle en production — elle empêche
 * de vendre un stock dont personne n'est propriétaire.
 *
 * Les suites e2e doivent donc faire ce que la synchronisation ferait :
 * rattacher la variante à une référence de site. Le préfixe rend l'origine
 * évidente pour quiconque inspecte la base de test.
 */
export const referenceDeTest = (variantId: string) =>
  `E2E-${variantId.slice(0, 8).toUpperCase()}`;
