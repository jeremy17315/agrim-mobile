import {
  canTransition,
  canTransitionDelivery,
  isCourierSettable,
  isDeliveryTerminal,
  ORDER_STATUSES,
  DELIVERY_STATUSES,
  type DeliveryStatus,
  type OrderStatus,
} from './enums';
import { isCancellableByClient } from './order-status';
import { isCancellableByManager } from './management';

/**
 * Ces tests couvrent l'invariant central du parcours : une commande finit
 * TOUJOURS par atteindre un état terminal. Le trou corrigé ici — une livraison
 * échouée laissait la commande à `OUT_FOR_DELIVERY`, statut qu'aucun rôle ne
 * pouvait quitter — n'était visible que quand on posait la question dans ce
 * sens : « depuis cet état, qui peut agir ? ».
 */

describe('machine à états des commandes', () => {
  it('autorise le retour à READY après un échec de livraison', () => {
    expect(canTransition('OUT_FOR_DELIVERY', 'READY')).toBe(true);
  });

  it('ne rouvre jamais une commande terminée', () => {
    for (const status of ORDER_STATUSES) {
      expect(canTransition('DELIVERED', status)).toBe(false);
      expect(canTransition('CANCELLED', status)).toBe(false);
    }
  });

  it("n'autorise aucun autre retour en arrière que celui-là", () => {
    // `READY` depuis `OUT_FOR_DELIVERY` est la seule arête régressive admise.
    // Toute autre trahirait un parcours qui boucle.
    const ordre: OrderStatus[] = [
      'PENDING',
      'CONFIRMED',
      'PREPARING',
      'READY',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ];
    for (const [i, from] of ordre.entries()) {
      for (const [j, to] of ordre.entries()) {
        if (j >= i) continue;
        const exception = from === 'OUT_FOR_DELIVERY' && to === 'READY';
        expect(canTransition(from, to)).toBe(exception);
      }
    }
  });

  /**
   * Depuis chaque statut non terminal, au moins un acteur doit pouvoir faire
   * bouger la commande — sinon elle est immobilisée, stock compris.
   *
   * Ce test n'aurait PAS attrapé le bug d'origine, et il faut le dire : la
   * table autorisait déjà `OUT_FOR_DELIVERY → DELIVERED`, c'est le chemin de
   * code menant à cette transition qui n'existait pas après un échec. Il garde
   * néanmoins sa valeur — il interdit d'introduire un jour un statut sans
   * issue — mais l'invariant réellement rompu est celui du test suivant.
   */
  it('laisse toujours une issue depuis un statut non terminal', () => {
    for (const status of ORDER_STATUSES) {
      if (status === 'DELIVERED' || status === 'CANCELLED') continue;

      const issue =
        isCancellableByClient(status) ||
        isCancellableByManager(status) ||
        // La livraison peut faire avancer OU revenir la commande.
        canTransition(status, 'DELIVERED') ||
        canTransition(status, 'READY');

      expect({ status, issue }).toEqual({ status, issue: true });
    }
  });

  /**
   * L'invariant qui était rompu.
   *
   * Une livraison échouée ramène la commande à `READY`. Encore faut-il que
   * quelqu'un puisse agir DE LÀ : sans cela on ne fait que déplacer le
   * cul-de-sac. Les deux sorties doivent exister — relancer une course, ou
   * annuler et rendre le stock.
   */
  it('rend la main à la gestion après un échec de livraison', () => {
    const apresEchec: OrderStatus = 'READY';

    // Sortie nº 1 : relancer une course.
    expect(canTransition(apresEchec, 'OUT_FOR_DELIVERY')).toBe(true);
    // Sortie nº 2 : annuler, ce qui rend le stock au rayon.
    expect(isCancellableByManager(apresEchec)).toBe(true);
    expect(canTransition(apresEchec, 'CANCELLED')).toBe(true);
  });
});

describe('machine à états des livraisons', () => {
  it('permet à la gestion de remettre en jeu une course échouée', () => {
    expect(canTransitionDelivery('FAILED', 'ASSIGNED')).toBe(true);
  });

  it('interdit au livreur de clore lui-même une course', () => {
    // L'invariant le plus important du dispositif OTP : la remise ne se
    // constate pas sur parole du terrain.
    expect(isCourierSettable('DELIVERED')).toBe(false);
    expect(isCourierSettable('OTP_VERIFIED')).toBe(false);
  });

  it('ne laisse repartir une course QUE depuis un échec', () => {
    // Une course livrée ne se réattribue jamais ; une course en cours non plus
    // — cela la ferait disparaître sous les pieds du livreur qui roule.
    const reassignables = DELIVERY_STATUSES.filter((s: DeliveryStatus) =>
      canTransitionDelivery(s, 'ASSIGNED'),
    );
    expect([...reassignables].sort()).toEqual(['FAILED', 'UNASSIGNED']);
  });

  it('considère une course échouée comme terminée pour le livreur', () => {
    // Terminale côté terrain, rouvrable côté bureau : les deux à la fois.
    expect(isDeliveryTerminal('FAILED')).toBe(true);
    expect(canTransitionDelivery('FAILED', 'ASSIGNED')).toBe(true);
  });
});
