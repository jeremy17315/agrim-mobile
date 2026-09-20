import {
  prixEffectif,
  promotionActive,
  promosActives,
} from './effective-price';

/**
 * La règle de prix est DE L'ARGENT AFFICHÉ ET FACTURÉ : elle se teste
 * seule, pure, sans base ni NestJS. Trois consommateurs (checkout,
 * catalogue, lectures publiques) partagent ces fonctions — un seul test
 * ici protège les trois.
 */
describe('promotionActive', () => {
  const maintenant = new Date('2026-09-20T12:00:00Z');

  it('active si activée et dans la fenêtre', () => {
    expect(
      promotionActive(
        {
          isActive: true,
          startsAt: new Date('2026-09-01T00:00:00Z'),
          endsAt: new Date('2026-09-30T00:00:00Z'),
        },
        maintenant,
      ),
    ).toBe(true);
  });

  it('pas encore ouverte ⇒ pas une promotion', () => {
    expect(
      promotionActive(
        {
          isActive: true,
          startsAt: new Date('2026-09-21T00:00:00Z'),
          endsAt: null,
        },
        maintenant,
      ),
    ).toBe(false);
  });

  it('périmée ⇒ pas une promotion (le bug de la fiche admin, figé ici)', () => {
    expect(
      promotionActive(
        {
          isActive: true,
          startsAt: new Date('2026-08-01T00:00:00Z'),
          endsAt: new Date('2026-09-10T00:00:00Z'),
        },
        maintenant,
      ),
    ).toBe(false);
  });

  it('désactivée ⇒ jamais, même dans la fenêtre', () => {
    expect(
      promotionActive(
        {
          isActive: false,
          startsAt: new Date('2026-09-01T00:00:00Z'),
          endsAt: null,
        },
        maintenant,
      ),
    ).toBe(false);
  });
});

describe('promosActives', () => {
  const maintenant = new Date('2026-09-20T12:00:00Z');
  const active = {
    priceXof: 1900,
    isActive: true,
    startsAt: new Date('2026-09-01T00:00:00Z'),
    endsAt: null,
  };
  const perimee = {
    priceXof: 500,
    isActive: true,
    startsAt: new Date('2026-08-01T00:00:00Z'),
    endsAt: new Date('2026-08-31T00:00:00Z'),
  };

  it('ne garde que celles dans leur fenêtre, ordre conservé', () => {
    expect(promosActives([perimee, active], maintenant)).toEqual([active]);
  });
});

describe('prixEffectif', () => {
  it('applique la promotion', () => {
    expect(prixEffectif(2500, { priceXof: 1990 })).toBe(1990);
  });

  it('sans promotion ⇒ prix de base', () => {
    expect(prixEffectif(2500, null)).toBe(2500);
    expect(prixEffectif(2500, undefined)).toBe(2500);
  });

  it('garde-fou final : une « promotion » plus chère que la base est ignorée', () => {
    // L'administration garantit priceXof <= base (PROMOTION_PRICE_INVALID) ;
    // le min est le dernier rempart, jamais la règle.
    expect(prixEffectif(2500, { priceXof: 3000 })).toBe(2500);
  });
});
