import { fireEvent, render, screen } from '@testing-library/react-native';

import CompteScreen from '../../app/(tabs)/compte';

/**
 * Écran Compte.
 *
 * Risques couverts : la page « Contact et aide » existait sans qu'aucun écran
 * n'y mène (le client devait téléphoner pour obtenir… le numéro de téléphone),
 * et l'entrée doit rester accessible même déconnecté — un visiteur qui
 * n'arrive pas à commander a autant besoin des coordonnées qu'un client.
 * Le raccourci d'appel direct, lui, ne doit pas disparaître au profit du lien.
 */

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockCallCompany = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/contact', () => ({
  callCompany: () => mockCallCompany(),
}));

jest.mock('@/api/notifications', () => ({
  useUnreadCount: () => 0,
}));

let mockIsAuthenticated = true;

jest.mock('@/store/auth', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      accessToken: mockIsAuthenticated ? 'jeton' : null,
      user: {
        id: 'u1',
        firstName: 'Awa',
        lastName: 'Kone',
        phone: '0700000001',
        role: 'CLIENT',
      },
      signOut: jest.fn(),
      deleteAccount: jest.fn(),
    }),
}));

const ENTRY = 'Coordonnées, boutiques et questions fréquentes';

beforeEach(() => {
  jest.clearAllMocks();
  mockIsAuthenticated = true;
});

it('mène à la page Contact et aide depuis un compte connecté', () => {
  render(<CompteScreen />);

  fireEvent.press(screen.getByText(ENTRY));

  expect(mockPush).toHaveBeenCalledWith('/contact');
});

it('y mène aussi quand aucun compte n’est connecté', () => {
  mockIsAuthenticated = false;
  render(<CompteScreen />);

  // Le client est bien dans l'état « visiteur »…
  expect(screen.getByText('Connexion requise')).toBeTruthy();

  // …et les coordonnées restent joignables.
  fireEvent.press(screen.getByText(ENTRY));
  expect(mockPush).toHaveBeenCalledWith('/contact');
});

it('garde l’appel direct du standard en un seul geste', () => {
  render(<CompteScreen />);

  fireEvent.press(screen.getByText('Appeler le fixe'));

  expect(mockCallCompany).toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});
