import { resolveProductImageUrl } from './productImage';

describe('resolveProductImageUrl', () => {
  it('conserve une URL HTTPS fournie par le catalogue du site', () => {
    expect(
      resolveProductImageUrl('https://agrimsarl.ci/media/riz-belier.jpg'),
    ).toBe('https://agrimsarl.ci/media/riz-belier.jpg');
  });

  it('rend affichable un chemin relatif encore présent dans le cache hors ligne', () => {
    expect(resolveProductImageUrl('/media/riz-belier.jpg')).toBe(
      'https://agrim-zuxe.onrender.com/media/riz-belier.jpg',
    );
    expect(resolveProductImageUrl('media/riz-belier.jpg')).toBe(
      'https://agrim-zuxe.onrender.com/media/riz-belier.jpg',
    );
  });

  it('gère les URL protocol-relative et les valeurs absentes', () => {
    expect(resolveProductImageUrl('//cdn.agrimsarl.ci/riz.jpg')).toBe(
      'https://cdn.agrimsarl.ci/riz.jpg',
    );
    expect(resolveProductImageUrl(null)).toBeNull();
    expect(resolveProductImageUrl('   ')).toBeNull();
  });
});
