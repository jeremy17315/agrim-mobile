import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import InscriptionScreen from '../../app/(auth)/inscription';

/**
 * Création de compte — parcours court.
 *
 * Risques couverts : un formulaire qui redemande des informations dont
 * l'application n'a pas besoin (le nom est demandé à la commande), une
 * double saisie du mot de passe, et des champs facultatifs qui encombrent le
 * parcours par défaut.
 */

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);

jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: jest.fn(),
    back: mockBack,
    canGoBack: mockCanGoBack,
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockSignUp = jest.fn();

jest.mock('@/store/auth', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ signUp: mockSignUp }),
}));

const fillMinimal = (phone = '0700000010', password = 'Agrim2026!') => {
  fireEvent.changeText(screen.getByLabelText('Numéro de téléphone'), phone);
  fireEvent.changeText(screen.getByLabelText('Mot de passe'), password);
};

const submit = () => fireEvent.press(screen.getByText('Créer mon compte'));

beforeEach(() => {
  jest.clearAllMocks();
  mockSignUp.mockResolvedValue(undefined);
});

it('ne demande que le téléphone et le mot de passe', () => {
  render(<InscriptionScreen />);

  expect(screen.getByLabelText('Numéro de téléphone')).toBeTruthy();
  expect(screen.getByLabelText('Mot de passe')).toBeTruthy();
  // Ni prénom, ni nom, ni confirmation : ces champs ne sont pas affichés par
  // défaut (le nom sera demandé à la commande).
  expect(screen.queryByLabelText('Prénom')).toBeNull();
  expect(screen.queryByLabelText('Nom')).toBeNull();
  expect(screen.queryByLabelText('Confirmer le mot de passe')).toBeNull();
});

it('crée le compte avec les seules informations obligatoires', async () => {
  render(<InscriptionScreen />);

  fillMinimal();
  submit();

  await waitFor(() => {
    expect(mockSignUp).toHaveBeenCalledWith({
      phone: '0700000010',
      password: 'Agrim2026!',
    });
  });
  // Retour à l'écran d'où l'on vient (catalogue ou confirmation de commande).
  expect(mockBack).toHaveBeenCalled();
});

it('permet d’ajouter le nom et le parrainage si le client le souhaite', async () => {
  render(<InscriptionScreen />);

  fireEvent.press(
    screen.getByLabelText('Ajouter des informations facultatives'),
  );

  fireEvent.changeText(screen.getByLabelText('Prénom'), 'Awa');
  fireEvent.changeText(screen.getByLabelText('Nom'), 'Koné');
  fireEvent.changeText(screen.getByLabelText('Code de parrainage'), 'ab12cd');
  fillMinimal();
  submit();

  await waitFor(() => {
    expect(mockSignUp).toHaveBeenCalledWith({
      phone: '0700000010',
      password: 'Agrim2026!',
      firstName: 'Awa',
      lastName: 'Koné',
      // Le code part en majuscules : c'est la forme stockée côté serveur.
      referralCode: 'AB12CD',
    });
  });
});

it('affiche le mot de passe à la demande (pas de double saisie)', () => {
  render(<InscriptionScreen />);

  const champ = screen.getByLabelText('Mot de passe');
  expect(champ.props.secureTextEntry).toBe(true);

  fireEvent.press(screen.getByLabelText('Afficher le mot de passe'));
  expect(screen.getByLabelText('Mot de passe').props.secureTextEntry).toBe(
    false,
  );
});

it('refuse un numéro invalide sans appeler le serveur', async () => {
  render(<InscriptionScreen />);

  fillMinimal('12345');
  submit();

  await waitFor(() => {
    expect(screen.getByText(/Numéro ivoirien invalide/i)).toBeTruthy();
  });
  expect(mockSignUp).not.toHaveBeenCalled();
});
