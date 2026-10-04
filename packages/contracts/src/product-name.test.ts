import { cleanProductName } from './product-name';

describe('cleanProductName', () => {
  it('retire la marque placée en tête', () => {
    expect(cleanProductName('Bélier d’Or Royal Grains')).toBe('Royal Grains');
    expect(cleanProductName("Belier d'Or Djassa")).toBe('Djassa');
  });

  it('retire la marque placée en queue', () => {
    expect(cleanProductName('Riz violet Bélier d’Or')).toBe('Riz violet');
    expect(cleanProductName('Riz noir Belier d Or')).toBe('Riz noir');
  });

  it('retire les séparateurs orphelins', () => {
    expect(cleanProductName('Bélier d’Or - Royal Grains')).toBe('Royal Grains');
    expect(cleanProductName('Royal Grains | Bélier d’Or')).toBe('Royal Grains');
  });

  it('laisse un nom déjà propre intact', () => {
    expect(cleanProductName('Ébène d’Or')).toBe('Ébène d’Or');
    expect(cleanProductName('Royal Grains')).toBe('Royal Grains');
  });

  it('ne réduit jamais un nom à une chaîne vide', () => {
    expect(cleanProductName('Bélier d’Or')).toBe('Bélier d’Or');
    expect(cleanProductName('   ')).toBe('');
    expect(cleanProductName(null)).toBe('');
  });
});
