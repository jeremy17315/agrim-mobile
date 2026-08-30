/**
 * L'ajustement de stock depuis l'administration, mis sous test.
 *
 * Deux défauts que ces tests gardent fermés :
 *
 *   1. **Aucune trace.** Le stock se corrigeait sans dire qui, quand, ni
 *      pourquoi. On lisait « 148 » sans pouvoir distinguer 150 moins deux
 *      ventes de 200 moins une erreur de saisie.
 *   2. **Le compteur pouvait passer sous zéro.** L'ancien code lisait le
 *      stock, vérifiait `stock + delta >= 0`, puis incrémentait sans
 *      revérifier — deux retraits simultanés passaient tous deux.
 *
 * Test unitaire : Prisma est simulé, il tourne sans PostgreSQL.
 */
import 'dotenv/config';

import { BadRequestException, NotFoundException } from '@nestjs/common';

import { fakeStockTx } from '../common/stock/stock-tx.fake';
import { ManagementService } from './management.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { CatalogSyncService } from '../catalog-sync/catalog-sync.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AdjustStockDto } from './dto/adjust-stock.dto';

const VARIANTE = 'a3f1c2d4-0000-4000-8000-000000000001';
const GESTIONNAIRE = 'b3f1c2d4-0000-4000-8000-000000000002';

function makeHarness(stockInitial = 100) {
  const socle = fakeStockTx({ stocks: { [VARIANTE]: stockInitial } });

  // La lecture finale de la variante renvoie l'état courant du faux, pour que
  // la réponse du service décrive la réalité et non une valeur figée.
  const brut = socle.brut as unknown as Record<string, Record<string, unknown>>;
  brut.productVariant.update = jest.fn(async () => ({
    id: VARIANTE,
    sku: 'RB-DJA-05',
    label: 'Sac de 5 kg',
    weightGrams: 5000,
    stock: socle.etat.stocks[VARIANTE],
    lowStockThreshold: 10,
    isAvailable: true,
    product: { name: 'RIZ BOAGNI Djassa' },
  }));

  const prisma = {
    db: {
      productVariant: {
        findUnique: jest.fn(async () => ({ id: VARIANTE })),
      },
      $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(socle.tx)),
    },
  } as unknown as PrismaService;

  const notifications = {} as unknown as NotificationsService;
  // Le service libère désormais la réservation chez le SITE : on simule cet
  // appel, il n'est pas l'objet de ces tests.
  const catalog = {
    releaseStock: jest.fn(async () => ({ status: 'ok', body: {} })),
  } as unknown as CatalogSyncService;
  const service = new ManagementService(prisma, notifications, catalog);

  return { service, prisma, etat: socle.etat, mouvements: socle.mouvements };
}

const ajuster = (dto: AdjustStockDto) => dto;

describe('ManagementService.adjustStock', () => {
  describe('ce qui est écrit au journal', () => {
    it('journalise un réapprovisionnement, avec son auteur', async () => {
      const { service, etat, mouvements } = makeHarness(100);

      const resultat = await service.adjustStock(
        VARIANTE,
        ajuster({ delta: 50, reason: 'Livraison fournisseur' }),
        GESTIONNAIRE,
      );

      expect(etat.stocks[VARIANTE]).toBe(150);
      expect(resultat.stock).toBe(150);
      expect(mouvements).toEqual([
        {
          variantId: VARIANTE,
          type: 'ENTREE',
          quantity: 50,
          stockBefore: 100,
          stockAfter: 150,
          reason: 'Livraison fournisseur',
          reference: null,
          // L'auteur vient du jeton, jamais du corps de la requête : c'est ce
          // qui rend le journal opposable.
          actorId: GESTIONNAIRE,
        },
      ]);
    });

    it('déduit ENTREE ou SORTIE du signe quand le motif n’est pas précisé', async () => {
      const { service, mouvements } = makeHarness(100);

      await service.adjustStock(VARIANTE, ajuster({ delta: -3 }), GESTIONNAIRE);

      expect(mouvements[0]).toMatchObject({ type: 'SORTIE', quantity: -3 });
    });

    it('respecte le motif explicite plutôt que le signe', async () => {
      // Une correction d'inventaire et une casse sont toutes deux des « −3 ».
      // Les confondre rendrait l'historique inutilisable pour comprendre une
      // démarque : c'est tout l'objet du champ `type`.
      const { service, mouvements } = makeHarness(100);

      await service.adjustStock(
        VARIANTE,
        ajuster({ delta: -3, type: 'AJUSTEMENT', reason: 'Comptage du 29/08' }),
        GESTIONNAIRE,
      );

      expect(mouvements[0]).toMatchObject({
        type: 'AJUSTEMENT',
        quantity: -3,
        reason: 'Comptage du 29/08',
      });
    });

    it('n’écrit aucun mouvement quand seul le seuil change', async () => {
      // Régler une alerte ne déplace pas de marchandise : l'inscrire au
      // journal des mouvements y ajouterait du bruit sans information.
      const { service, mouvements } = makeHarness(100);

      await service.adjustStock(
        VARIANTE,
        ajuster({ lowStockThreshold: 30 }),
        GESTIONNAIRE,
      );

      expect(mouvements).toEqual([]);
    });
  });

  describe('ce qui est refusé', () => {
    it('exige un motif pour une correction d’inventaire', async () => {
      // Une correction sans explication est exactement ce que ce journal
      // existe pour empêcher.
      const { service, mouvements, etat } = makeHarness(100);

      await expect(
        service.adjustStock(
          VARIANTE,
          ajuster({ delta: -3, type: 'AJUSTEMENT' }),
          GESTIONNAIRE,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mouvements).toEqual([]);
      expect(etat.stocks[VARIANTE]).toBe(100);
    });

    it('refuse un retrait qui dépasse le stock', async () => {
      const { service, etat, mouvements } = makeHarness(3);

      await expect(
        service.adjustStock(VARIANTE, ajuster({ delta: -4 }), GESTIONNAIRE),
      ).rejects.toMatchObject({
        response: { code: 'STOCK_CANNOT_BE_NEGATIVE' },
      });

      expect(etat.stocks[VARIANTE]).toBe(3);
      expect(mouvements).toEqual([]);
    });

    it('refuse une requête qui ne demande rien', async () => {
      const { service } = makeHarness();

      await expect(
        service.adjustStock(VARIANTE, ajuster({}), GESTIONNAIRE),
      ).rejects.toMatchObject({ response: { code: 'NOTHING_TO_UPDATE' } });
    });

    it('refuse une variante inconnue', async () => {
      const { service, prisma } = makeHarness();
      (
        prisma.db.productVariant.findUnique as jest.Mock
      ).mockResolvedValue(null);

      await expect(
        service.adjustStock(VARIANTE, ajuster({ delta: 10 }), GESTIONNAIRE),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('la concurrence', () => {
    it('empêche deux retraits simultanés de vider le rayon sous zéro', async () => {
      // Deux gestionnaires retirent chacun deux sacs des trois derniers, au
      // même instant. L'ancien code lisait 3, validait les deux, et écrivait
      // −1. La condition vit maintenant dans le WHERE : un seul passe.
      const { service, etat, mouvements } = makeHarness(3);

      const resultats = await Promise.allSettled([
        service.adjustStock(VARIANTE, ajuster({ delta: -2 }), GESTIONNAIRE),
        service.adjustStock(VARIANTE, ajuster({ delta: -2 }), GESTIONNAIRE),
      ]);

      const reussis = resultats.filter((r) => r.status === 'fulfilled');
      expect(reussis).toHaveLength(1);
      expect(etat.stocks[VARIANTE]).toBe(1);
      expect(mouvements).toHaveLength(1);
    });
  });
});
