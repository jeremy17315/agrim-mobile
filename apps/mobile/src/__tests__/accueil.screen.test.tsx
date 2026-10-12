import { render, screen } from '@testing-library/react-native';

import IndexRedirect from '../../app/(tabs)/index';

/**
 * L'écran « Commencer » a été retiré : la route racine renvoie directement au
 * catalogue, qui est l'accueil du parcours public.
 */
const mockRedirect = jest.fn();
jest.mock('expo-router', () => ({
  Redirect: (props: { href: string }) => {
    mockRedirect(props);
    return null;
  },
}));

beforeEach(() => {
  mockRedirect.mockClear();
});

describe('Accueil public', () => {
  it('renvoie directement au catalogue, sans écran intermédiaire', () => {
    render(<IndexRedirect />);

    expect(mockRedirect).toHaveBeenCalledWith({ href: '/catalogue' });
    expect(screen.queryByText('COMMENCER')).toBeNull();
    expect(screen.queryByText('Le bon riz,')).toBeNull();
  });

  it('ne montre aucun bouton « Commencer » ni invitation à se connecter', () => {
    render(<IndexRedirect />);

    expect(screen.queryByText(/commencer/i)).toBeNull();
    expect(screen.queryByText(/connexion/i)).toBeNull();
  });
});
