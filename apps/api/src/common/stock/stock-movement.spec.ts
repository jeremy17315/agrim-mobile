/**
 * Le point de passage unique de TOUTE variation de stock, mis sous test.
 *
 * Deux invariants, et ils ne valent que pris ensemble :
 *
 *   1. Le journal ne peut pas diverger du compteur — une variation sans ligne
 *      de journal, ou l'inverse, ne doit pas exister.
 *   2. Le stock ne peut pas devenir négatif, même sous deux retraits
 *      simultanés.
 *
 * Le second est celui qui manquait : `adjustStock` lisait la quantité,
 * vérifiait `stock + delta >= 0`, puis incrémentait sans revérifier. Deux
 * retraits concurrents passaient tous deux le contrôle. Le test « deux
 * retraits simultanés » ci-dessous échouerait sur l'ancien code.
 *
 * Test unitaire : il vérifie une décision, pas une intégration, et tourne
 * sans PostgreSQL.
 */
import { applyStockChange } from './stock-movement';
import { fakeStockTx } from './stock-tx.fake';

describe('applyStockChange', () => {
  describe('les apports', () => {
    it('ajoute au rayon et journalise l’entrée', async () => {
      const { tx, etat, mouvements } = fakeStockTx({ stocks: { 'var-a': 100 } });

      const resultat = await applyStockChange(tx, {
        variantId: 'var-a',
        delta: 50,
        type: 'ENTREE',
        reason: 'Livraison fournisseur',
        actorId: 'user-1',
      });

      expect(resultat).toEqual({ stockBefore: 100, stockAfter: 150 });
      expect(etat.stocks['var-a']).toBe(150);
      expect(mouvements).toEqual([
        {
          variantId: 'var-a',
          type: 'ENTREE',
          quantity: 50,
          stockBefore: 100,
          stockAfter: 150,
          reason: 'Livraison fournisseur',
          reference: null,
          actorId: 'user-1',
        },
      ]);
    });

    it('n’oppose aucune condition à un apport', async () => {
      // Rien n'empêche jamais d'ajouter du stock : la clause conditionnelle ne
      // concerne que les retraits.
      const { tx } = fakeStockTx({ stocks: { 'var-a': 0 } });

      const resultat = await applyStockChange(tx, {
        variantId: 'var-a',
        delta: 10,
        type: 'ENTREE',
      });

      expect(resultat).toEqual({ stockBefore: 0, stockAfter: 10 });
    });
  });

  describe('les retraits', () => {
    it('retire du rayon et journalise la sortie', async () => {
      const { tx, etat, mouvements } = fakeStockTx({ stocks: { 'var-a': 100 } });

      const resultat = await applyStockChange(tx, {
        variantId: 'var-a',
        delta: -2,
        type: 'COMMANDE',
        reference: 'AGR-2026-0007',
      });

      expect(resultat).toEqual({ stockBefore: 100, stockAfter: 98 });
      expect(etat.stocks['var-a']).toBe(98);
      expect(mouvements[0]).toMatchObject({
        type: 'COMMANDE',
        quantity: -2,
        reference: 'AGR-2026-0007',
        actorId: null,
      });
    });

    it('accepte un retrait qui vide exactement le rayon', async () => {
      const { tx, etat } = fakeStockTx({ stocks: { 'var-a': 3 } });

      const resultat = await applyStockChange(tx, {
        variantId: 'var-a',
        delta: -3,
        type: 'SORTIE',
      });

      expect(resultat).toEqual({ stockBefore: 3, stockAfter: 0 });
      expect(etat.stocks['var-a']).toBe(0);
    });

    it('refuse un retrait qui dépasse le stock, et n’écrit rien', async () => {
      const { tx, etat, mouvements } = fakeStockTx({ stocks: { 'var-a': 3 } });

      const resultat = await applyStockChange(tx, {
        variantId: 'var-a',
        delta: -4,
        type: 'SORTIE',
      });

      expect(resultat).toBeNull();
      expect(etat.stocks['var-a']).toBe(3);
      // Un refus ne laisse pas de trace au journal : il ne s'est rien passé.
      expect(mouvements).toEqual([]);
    });

    it('empêche deux retraits simultanés de faire passer le stock sous zéro', async () => {
      // LE test de ce lot. Deux gestes concurrents sur les trois derniers
      // sacs : deux fois deux. L'ancien code lisait 3, validait les deux
      // (3−2 ≥ 0 pour chacun) et écrivait −1. Ici la condition est dans le
      // WHERE : le second retrait ne trouve plus de quoi se servir.
      const { tx, etat, mouvements } = fakeStockTx({ stocks: { 'var-a': 3 } });

      const [premier, second] = await Promise.all([
        applyStockChange(tx, {
          variantId: 'var-a',
          delta: -2,
          type: 'COMMANDE',
        }),
        applyStockChange(tx, {
          variantId: 'var-a',
          delta: -2,
          type: 'COMMANDE',
        }),
      ]);

      const reussis = [premier, second].filter(Boolean);
      expect(reussis).toHaveLength(1);
      expect(etat.stocks['var-a']).toBe(1);
      expect(etat.stocks['var-a']).toBeGreaterThanOrEqual(0);
      expect(mouvements).toHaveLength(1);
    });
  });

  describe('ce que le journal doit dire', () => {
    it('enchaîne les mouvements sans trou : chaque « après » est le « avant » du suivant', async () => {
      // C'est la propriété qui rend le journal auditable. Un écart entre le
      // `stockAfter` d'une ligne et le `stockBefore` de la suivante signale
      // une écriture qui a échappé au point de passage.
      const { tx, mouvements } = fakeStockTx({ stocks: { 'var-a': 100 } });

      await applyStockChange(tx, {
        variantId: 'var-a',
        delta: 50,
        type: 'ENTREE',
      });
      await applyStockChange(tx, {
        variantId: 'var-a',
        delta: -2,
        type: 'COMMANDE',
      });
      await applyStockChange(tx, {
        variantId: 'var-a',
        delta: 2,
        type: 'ANNULATION',
      });

      expect(mouvements.map((m) => [m.stockBefore, m.stockAfter])).toEqual([
        [100, 150],
        [150, 148],
        [148, 150],
      ]);
    });

    it('refuse une variation nulle', async () => {
      // Un mouvement de zéro n'est pas un mouvement : l'écrire polluerait
      // l'historique sans rien expliquer.
      const { tx } = fakeStockTx({ stocks: { 'var-a': 10 } });

      await expect(
        applyStockChange(tx, {
          variantId: 'var-a',
          delta: 0,
          type: 'AJUSTEMENT',
        }),
      ).rejects.toThrow(/invalide/i);
    });

    it('refuse une variante inconnue plutôt que d’inventer un stock', async () => {
      const { tx, mouvements } = fakeStockTx({ stocks: {} });

      const resultat = await applyStockChange(tx, {
        variantId: 'var-fantome',
        delta: 5,
        type: 'ENTREE',
      });

      expect(resultat).toBeNull();
      expect(mouvements).toEqual([]);
    });
  });
});
