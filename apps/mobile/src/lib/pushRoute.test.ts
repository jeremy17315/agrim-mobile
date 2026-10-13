import { pushTargetRoute } from './pushRoute';

describe('pushTargetRoute — toucher d’une notification', () => {
  it('ouvre la fiche produit', () => {
    expect(pushTargetRoute({ target: 'produit', value: 'riz-noir' }, false)).toBe(
      '/produit/riz-noir',
    );
  });

  it('ouvre le catalogue filtré sur la catégorie', () => {
    expect(pushTargetRoute({ target: 'categorie', value: 'riz' }, true)).toBe(
      '/catalogue?category=riz',
    );
  });

  it('une offre mène au catalogue', () => {
    expect(pushTargetRoute({ target: 'offre', value: 'x' }, false)).toBe('/catalogue');
  });

  it('une commande invitée ouvre la confirmation publique, jamais la page réservée', () => {
    expect(pushTargetRoute({ target: 'commande', value: 'AGR-42' }, false)).toBe(
      '/confirmation/AGR-42',
    );
  });

  it('une commande d’un compte connecté ouvre le détail de la commande', () => {
    expect(pushTargetRoute({ target: 'commande', value: 'AGR-42' }, true)).toBe(
      '/commandes/AGR-42',
    );
  });

  it('accepte l’ancien format (reference seule)', () => {
    expect(pushTargetRoute({ reference: 'AGR-7' }, false)).toBe('/confirmation/AGR-7');
  });

  it('sans destination, un invité va au catalogue et un compte à ses notifications', () => {
    expect(pushTargetRoute({}, false)).toBe('/catalogue');
    expect(pushTargetRoute(undefined, true)).toBe('/notifications');
  });

  it('encode la valeur pour ne pas sortir du chemin', () => {
    expect(pushTargetRoute({ target: 'produit', value: 'a/b c' }, false)).toBe(
      '/produit/a%2Fb%20c',
    );
  });
});
