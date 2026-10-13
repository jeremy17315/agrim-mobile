import { resolveProductImageUrl } from './productImage';

describe('resolveProductImageUrl', () => {
  it('conserve une URL HTTPS fournie par le catalogue du site', () => {
    expect(
      resolveProductImageUrl('https://agrimsarl.ci/media/riz-belier.jpg'),
    ).toBe('https://agrimsarl.ci/media/riz-belier.jpg');
  });

  it('rend affichable un chemin relatif encore présent dans le cache hors ligne', () => {
    expect(resolveProductImageUrl('/media/riz-belier.jpg')).toBe(
      'https://agrimsarl.ci/belier/media/riz-belier.jpg',
    );
    expect(resolveProductImageUrl('media/riz-belier.jpg')).toBe(
      'https://agrimsarl.ci/belier/media/riz-belier.jpg',
    );
  });

  it('gère les URL protocol-relative et les valeurs absentes', () => {
    expect(resolveProductImageUrl('//cdn.agrimsarl.ci/riz.jpg')).toBe(
      'https://cdn.agrimsarl.ci/riz.jpg',
    );
    expect(resolveProductImageUrl(null)).toBeNull();
    expect(resolveProductImageUrl('   ')).toBeNull();
  });

  it('garde le sous-dossier du site pour un chemin relatif', () => {
    expect(resolveProductImageUrl('/media/riz-belier.jpg')).toBe(
      'https://agrimsarl.ci/belier/media/riz-belier.jpg',
    );
    expect(resolveProductImageUrl('media/riz-belier.jpg')).toBe(
      'https://agrimsarl.ci/belier/media/riz-belier.jpg',
    );
  });

  it('ne double pas le sous-dossier si le site l\'a déjà inclus', () => {
    expect(resolveProductImageUrl('/belier/media/riz-belier.jpg')).toBe(
      'https://agrimsarl.ci/belier/media/riz-belier.jpg',
    );
  });
});
