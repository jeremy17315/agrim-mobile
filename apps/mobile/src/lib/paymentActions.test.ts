import { Linking } from 'react-native';

import { canDialUssd, openPublishedLink } from './paymentActions';

/**
 * « Payer depuis ce téléphone » — les deux gestes qui marchent avec un seul
 * appareil. Ce qui est testé ici : on n'ouvre que ce qui est publié, et on
 * n'annonce jamais une réussite qui n'a pas eu lieu.
 */
describe('ouverture d’un lien publié', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('ouvre le lien et le dit', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await expect(
      openPublishedLink('https://pay.wave.com/m/M_agrim/c/ci/'),
    ).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith('https://pay.wave.com/m/M_agrim/c/ci/');
  });

  it('rend `false` quand aucune application ne répond', async () => {
    // Cas normal : téléphone sans l'application de l'opérateur, pas de
    // navigateur. L'écran doit pouvoir proposer l'autre voie, pas planter.
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    await expect(openPublishedLink('tel:%23144%23')).resolves.toBe(false);
  });
});

describe('code USSD', () => {
  it('n’est proposé au composeur que sur Android', () => {
    // iOS bloque les codes USSD : proposer le bouton serait une promesse vide.
    expect(canDialUssd('android')).toBe(true);
    expect(canDialUssd('ios')).toBe(false);
    expect(canDialUssd('web')).toBe(false);
  });
});
