/**
 * Le point de passage unique de la restitution de stock, mis sous test.
 *
 * `cancelOrderAndReleaseStock` est la seule fonction autorisée à rendre au
 * rayon la marchandise réservée par une commande. Trois appelants s'en
 * servent — le client, le bureau, le paiement — et rien n'empêche deux
 * d'entre eux de s'exécuter au même instant sur la même commande. Ce que ces
 * tests gardent, c'est donc moins le calcul que l'EXCLUSION : quoi qu'il
 * arrive, une commande ne rend son stock qu'une fois.
 *
 * Depuis l'administration centrale (août 2026), la restitution laisse aussi
 * une ligne au journal des mouvements. Les tests couvrent les deux : ce qui
 * revient au rayon, et ce qu'on pourra en dire six mois plus tard.
 *
 * Test unitaire et non e2e : il vérifie une décision (qui rend le stock, et
 * sous quelle condition), pas une intégration. Il tourne sans PostgreSQL —
 * ce qu'on veut d'un test qui garde un invariant d'argent.
 */
import { cancelOrderAndReleaseStock } from './order-stock';
// Mock VIRTUEL du client généré : absent hors CI (produit par prisma generate).
jest.mock('../../../generated/prisma/client', () => ({
  StockMovementType: {
    ENTREE: 'ENTREE', SORTIE: 'SORTIE', AJUSTEMENT: 'AJUSTEMENT',
    COMMANDE: 'COMMANDE', ANNULATION: 'ANNULATION', RETOUR: 'RETOUR',
  },
}), { virtual: true });
import { fakeStockTx, type FakeLine } from './stock-tx.fake';

/** Une commande d'une ligne, avec le stock de départ de sa variante. */
function harnais(
  statutInitial: string,
  lignes: FakeLine[],
  stockInitial = 0,
) {
  const stocks: Record<string, number> = {};
  for (const l of lignes) stocks[l.variantId] = stockInitial;
  return fakeStockTx({
    order: {
      id: 'order-1',
      reference: 'AGR-2026-0042',
      status: statutInitial,
    },
    items: lignes,
    stocks,
  });
}

describe('cancelOrderAndReleaseStock', () => {
  it('annule la commande et désigne la réservation à libérer', async () => {
    // Le compteur LOCAL ne bouge plus : le stock est retenu par le site, qui
    // en est propriétaire depuis le 29 août 2026. Cette fonction arbitre
    // l'annulation et rend la clé ; c'est l'appelant qui libère, hors
    // transaction, parce que c'est un appel réseau.
    const { tx, etat } = harnais(
      'PENDING',
      [
        { variantId: 'variant-a', quantity: 2 },
        { variantId: 'variant-b', quantity: 3 },
      ],
      10,
    );

    const resultat = await cancelOrderAndReleaseStock(tx, 'order-1');

    expect(resultat.released).toBe(true);
    expect(resultat.reservationRef).toBe('idem-key-1');
    expect(etat.order.status).toBe('CANCELLED');
    // Inchangé : recréditer ici recréerait le second compteur qu'on supprime.
    expect(etat.stocks).toEqual({ 'variant-a': 10, 'variant-b': 10 });
  });

  it('journalise l’annulation, avec la référence de la commande', async () => {
    // Sans la référence, une ligne de journal serait orpheline : impossible de
    // remonter d'un écart d'inventaire à la vente qui l'explique.
    //
    // `stockBefore` et `stockAfter` sont ÉGAUX : ils décrivent la copie
    // locale, que ce mouvement ne modifie pas. La quantité, elle, reste signée
    // — c'est elle qui raconte le retour.
    const { tx, mouvements } = harnais(
      'CONFIRMED',
      [{ variantId: 'variant-a', quantity: 2 }],
      10,
    );

    await cancelOrderAndReleaseStock(tx, 'order-1', 'user-gestionnaire');

    expect(mouvements).toEqual([
      {
        variantId: 'variant-a',
        type: 'ANNULATION',
        quantity: 2,
        stockBefore: 10,
        stockAfter: 10,
        reason: null,
        reference: 'AGR-2026-0042',
        actorId: 'user-gestionnaire',
      },
    ]);
  });

  it('inscrit « aucun auteur » quand c’est le système qui annule', async () => {
    // L'expiration d'un paiement n'a pas d'auteur humain. Inventer un
    // responsable serait pire que de n'en afficher aucun.
    const { tx, mouvements } = harnais(
      'PENDING',
      [{ variantId: 'variant-a', quantity: 1 }],
      5,
    );

    await cancelOrderAndReleaseStock(tx, 'order-1');

    expect(mouvements[0].actorId).toBeNull();
  });

  it('ne rend rien quand la commande est déjà annulée', async () => {
    const { tx, etat, mouvements, brut } = harnais(
      'CANCELLED',
      [{ variantId: 'variant-a', quantity: 2 }],
      10,
    );

    const resultat = await cancelOrderAndReleaseStock(tx, 'order-1');

    expect(resultat.released).toBe(false);
    expect(etat.stocks['variant-a']).toBe(10);
    expect(mouvements).toEqual([]);
    // Le perdant ne doit même pas LIRE les lignes : rien à faire, rien à
    // verrouiller.
    expect(brut.orderItem.findMany).not.toHaveBeenCalled();
  });

  it('ne rend rien quand la commande est déjà livrée', async () => {
    // La marchandise est chez le client : la rendre au rayon inventerait du
    // stock. `DELIVERED` n'est pas dans les statuts qui retiennent du stock.
    const { tx, etat } = harnais(
      'DELIVERED',
      [{ variantId: 'variant-a', quantity: 2 }],
      10,
    );

    const resultat = await cancelOrderAndReleaseStock(tx, 'order-1');

    expect(resultat.released).toBe(false);
    expect(etat.stocks['variant-a']).toBe(10);
  });

  it('n’annule QU’UNE FOIS quand deux chemins annulent la même commande', async () => {
    // Le cœur du correctif. Deux appelants concurrents — le client qui tape
    // deux fois sur « Annuler », ou le webhook qui arrive pendant la
    // réconciliation — passent par la même bascule conditionnelle. Un seul
    // gagne ; l'autre repart les mains vides, sans clé de réservation, donc
    // sans rien libérer chez le site.
    const { tx, mouvements } = harnais(
      'PENDING',
      [{ variantId: 'variant-a', quantity: 2 }],
      10,
    );

    const [premier, second] = await Promise.all([
      cancelOrderAndReleaseStock(tx, 'order-1'),
      cancelOrderAndReleaseStock(tx, 'order-1'),
    ]);

    const gagnants = [premier, second].filter((r) => r.released);
    expect(gagnants).toHaveLength(1);
    expect(gagnants[0]?.reservationRef).toBe('idem-key-1');
    // Le perdant ne désigne aucune réservation : c'est ce qui empêche une
    // double libération chez le site.
    const perdant = [premier, second].find((r) => !r.released);
    expect(perdant?.reservationRef).toBeUndefined();
    // Et une seule ligne de journal : deux lignes raconteraient deux
    // annulations là où il n'y en a eu qu'une.
    expect(mouvements).toHaveLength(1);
  });

  it('regroupe deux lignes de la même variante en un seul mouvement', async () => {
    // Une commande peut porter deux lignes de la même variante ; le journal
    // doit en faire un seul mouvement, sans quoi l'historique afficherait deux
    // retours pour une seule annulation.
    const { tx, mouvements } = harnais(
      'READY',
      [
        { variantId: 'variant-a', quantity: 2 },
        { variantId: 'variant-a', quantity: 3 },
      ],
      10,
    );

    await cancelOrderAndReleaseStock(tx, 'order-1');

    expect(mouvements).toHaveLength(1);
    expect(mouvements[0]).toMatchObject({
      quantity: 5,
      // La copie locale n'a pas bougé : le stock est chez le site.
      stockBefore: 10,
      stockAfter: 10,
    });
  });

  it('annule depuis chacun des statuts qui retiennent du stock', async () => {
    for (const statut of [
      'PENDING',
      'CONFIRMED',
      'PREPARING',
      'READY',
      'OUT_FOR_DELIVERY',
    ]) {
      const { tx, mouvements } = harnais(
        statut,
        [{ variantId: 'variant-a', quantity: 1 }],
        4,
      );
      const resultat = await cancelOrderAndReleaseStock(tx, 'order-1');
      expect([statut, resultat.released]).toEqual([statut, true]);
      expect([statut, resultat.reservationRef]).toEqual([statut, 'idem-key-1']);
      expect(mouvements).toHaveLength(1);
    }
  });
});


// ── Mode `local` (bascule SSOT) — la restitution devient RÉELLE ─────────
//
// Depuis la refonte, ce fichier porte DEUX mondes, choisis par STOCK_MODE :
//  - `site` (ci-dessus, défaut) : le stock est retenu par le site, la
//    fonction arbitre l'annulation et rend la clé de réservation ;
//  - `local` (ci-dessous) : CETTE base possède le stock — le compteur est
//    recrédité pour de vrai, et le journal décrit la vérité, pas une copie.
describe('cancelOrderAndReleaseStock — STOCK_MODE=local', () => {
  beforeEach(() => {
    process.env.STOCK_MODE = 'local';
  });

  afterEach(() => {
    delete process.env.STOCK_MODE;
  });

  it('recrédite réellement le compteur et journalise le mouvement véridique', async () => {
    const { tx, etat, mouvements } = harnais(
      'PENDING',
      [{ variantId: 'variant-a', quantity: 2 }],
      10,
    );

    const resultat = await cancelOrderAndReleaseStock(tx, 'order-1');

    expect(resultat.released).toBe(true);
    // Aucune réservation distante en mode local : rien à libérer ailleurs.
    expect(resultat.reservationRef).toBeNull();
    // Le compteur est vrai : 10 en rayon, la commande avait pris 2, l'annulation les rend.
    expect(etat.stocks['variant-a']).toBe(12);
    expect(mouvements).toHaveLength(1);
    expect(mouvements[0]).toMatchObject({
      variantId: 'variant-a',
      type: 'ANNULATION',
      quantity: 2,
      stockBefore: 10,
      stockAfter: 12,
      reference: 'AGR-2026-0042',
      actorId: null,
    });
  });

  it('multi-lignes : chaque variante est recréditée de sa quantité', async () => {
    const { tx, etat, mouvements } = harnais(
      'READY',
      [
        { variantId: 'variant-a', quantity: 2 },
        { variantId: 'variant-b', quantity: 3 },
      ],
      5,
    );

    const resultat = await cancelOrderAndReleaseStock(tx, 'order-1');

    expect(resultat.released).toBe(true);
    expect(etat.stocks['variant-a']).toBe(7);
    expect(etat.stocks['variant-b']).toBe(8);
    expect(mouvements).toHaveLength(2);
  });

  it('le perdant de la course ne rend rien, comme en mode site', async () => {
    // L'exclusion par transition de statut est le MÊME en mode local : seule
    // la façon de rendre le stock change, pas l'arbitrage.
    const { tx, etat, mouvements } = harnais('CANCELLED', [{ variantId: 'variant-a', quantity: 2 }], 5);

    const resultat = await cancelOrderAndReleaseStock(tx, 'order-1');

    expect(resultat.released).toBe(false);
    expect(etat.stocks['variant-a']).toBe(5);
    expect(mouvements).toHaveLength(0);
  });
});
