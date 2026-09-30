import { RICE_RANGES } from './company';

describe('gammes Bélier d’Or', () => {
  it('reprend exactement les cinq gammes proposées sur le site', () => {
    expect(RICE_RANGES.map((range) => range.name)).toEqual([
      'Royal Grains',
      'Djassa',
      'Ébène d’Or',
      'Riz violet',
      'Riz noir',
    ]);
  });
});
