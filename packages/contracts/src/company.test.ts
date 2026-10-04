import { BELIER_PRODUCTS } from './company';

describe('produits Bélier d’Or', () => {
  it('reprend exactement les cinq produits proposés sur le site', () => {
    expect(BELIER_PRODUCTS.map((product) => product.name)).toEqual([
      'Royal Grains',
      'Djassa',
      'Ébène d’Or',
      'Riz violet',
      'Riz noir',
    ]);
  });
});
