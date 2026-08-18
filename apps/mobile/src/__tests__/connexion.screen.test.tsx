import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { ApiError, NetworkError } from '@/api/errors';

import ConnexionScreen from '../../app/(auth)/connexion';

/**
 * Connexion par téléphone.
 *
 * Risques couverts : un identifiant envoyé au serveur sans normalisation (les
 * utilisateurs saisissent volontiers « 07 00 00 00 01 »), une erreur technique
 * brute affichée à l'écran, et une double soumission pendant l'attente réseau.
 */

const mockReplace = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, back: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockSignIn = jest.fn();

jest.mock('@/store/auth', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ signIn: mockSignIn }),
}));

const fill = (phone: string, password: string) => {
  fireEvent.changeText(screen.getByLabelText('Numéro de téléphone'), phone);
  fireEvent.changeText(screen.getByLabelText('Mot de passe'), password);
};

const submit = () => fireEvent.press(screen.getByText('Se connecter'));

beforeEach(() => {
  jest.clearAllMocks();
  mockSignIn.mockResolvedValue(undefined);
});

it('connecte avec des identifiants valides', async () => {
  render(<ConnexionScreen />);

  fill('0700000001', 'Agrim2026!');
  submit();

  await waitFor(() => {
    expect(mockSignIn).toHaveBeenCalledWith({
      phone: '0700000001',
      password: 'Agrim2026!',
    });
  });
});

it('normalise un numéro saisi avec des espaces', async () => {
  render(<ConnexionScreen />);

  fill('07 00 00 00 01', 'Agrim2026!');
  submit();

  // Le serveur reçoit un numéro compact : la mise en forme est un confort de
  // saisie, pas une donnée.
  await waitFor(() => {
    expect(mockSignIn).toHaveBeenCalledWith({
      phone: '0700000001',
      password: 'Agrim2026!',
    });
  });
});

it('accepte l’indicatif international', async () => {
  render(<ConnexionScreen />);

  fill('+2250700000001', 'Agrim2026!');
  submit();

  await waitFor(() => expect(mockSignIn).toHaveBeenCalled());
});

it('remplace l’écran plutôt que de l’empiler', async () => {
  render(<ConnexionScreen />);

  fill('0700000001', 'Agrim2026!');
  submit();

  // Revenir en arrière ne doit pas ramener à la connexion une fois la session
  // ouverte.
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)'));
  expect(mockPush).not.toHaveBeenCalledWith('/(tabs)');
});

it('refuse un numéro mal formé sans appeler le serveur', async () => {
  render(<ConnexionScreen />);

  fill('123', 'Agrim2026!');
  submit();

  expect(
    await screen.findByText('Numéro ivoirien invalide (10 chiffres)'),
  ).toBeTruthy();
  expect(mockSignIn).not.toHaveBeenCalled();
});

it('refuse un mot de passe trop court sans appeler le serveur', async () => {
  render(<ConnexionScreen />);

  fill('0700000001', 'court');
  submit();

  expect(await screen.findByText('Au moins 8 caractères')).toBeTruthy();
  expect(mockSignIn).not.toHaveBeenCalled();
});

it('affiche un message lisible et jamais l’erreur technique', async () => {
  mockSignIn.mockRejectedValue(
    new ApiError({
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Numéro ou mot de passe incorrect.',
    }),
  );

  render(<ConnexionScreen />);
  fill('0700000001', 'MauvaisMotDePasse');
  submit();

  expect(
    await screen.findByText('Numéro ou mot de passe incorrect.'),
  ).toBeTruthy();
  // Aucune trace technique ne doit atteindre l'utilisateur.
  expect(screen.queryByText(/status 401/)).toBeNull();
  expect(mockReplace).not.toHaveBeenCalled();
});

it('reste sur l’écran après un échec réseau', async () => {
  mockSignIn.mockRejectedValue(new NetworkError('Connexion impossible.'));

  render(<ConnexionScreen />);
  fill('0700000001', 'Agrim2026!');
  submit();

  await waitFor(() => expect(mockSignIn).toHaveBeenCalled());
  expect(mockReplace).not.toHaveBeenCalled();
  // Un second essai reste possible : rien n'est verrouillé.
  submit();
  await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(2));
});

it('efface l’erreur précédente à la nouvelle tentative', async () => {
  mockSignIn.mockRejectedValueOnce(
    new ApiError({
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Numéro ou mot de passe incorrect.',
    }),
  );

  render(<ConnexionScreen />);
  fill('0700000001', 'MauvaisMotDePasse');
  submit();
  expect(
    await screen.findByText('Numéro ou mot de passe incorrect.'),
  ).toBeTruthy();

  mockSignIn.mockResolvedValueOnce(undefined);
  submit();

  await waitFor(() => expect(mockReplace).toHaveBeenCalled());
  expect(screen.queryByText('Numéro ou mot de passe incorrect.')).toBeNull();
});

it('mène à l’inscription', () => {
  render(<ConnexionScreen />);

  fireEvent.press(screen.getByText(/Créer un compte/i));

  expect(mockPush).toHaveBeenCalledWith('/(auth)/inscription');
});
