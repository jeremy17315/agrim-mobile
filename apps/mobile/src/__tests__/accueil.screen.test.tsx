import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import WelcomeScreen from '../../app/(tabs)/index';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

beforeEach(() => {
  mockPush.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Accueil public', () => {
  it('ne propose qu’une seule action, la marque restant discrète', () => {
    render(<WelcomeScreen />);

    // Une seule cible : le parcours ne demande aucune décision à l'entrée.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText('COMMENCER')).toBeTruthy();
    expect(screen.getByLabelText('Logo AGRIM')).toBeTruthy();
    // La ligne d'assurance remplace l'ancienne mention technique : la page ne
    // parle plus du fonctionnement interne du parcours.
    expect(screen.getByText('Commandez en toute sécurité')).toBeTruthy();
    expect(screen.queryByText(/sans compte/)).toBeNull();
    // Le lien secondaire de l'ancienne page vitrine n'est pas revenu.
    expect(screen.queryByText('Contact et aide')).toBeNull();
  });

  it('centre le bouton au milieu de la page', () => {
    render(<WelcomeScreen />);

    expect(screen.getByTestId('accueil')).toHaveStyle({
      alignItems: 'center',
      justifyContent: 'center',
    });
  });

  it('mène directement au catalogue sans passer par une connexion', () => {
    render(<WelcomeScreen />);

    fireEvent.press(screen.getByText('COMMENCER'));
    expect(mockPush).toHaveBeenCalledWith('/catalogue');
    expect(screen.queryByText(/connexion/i)).toBeNull();
  });

  it('reste complet quand le système demande de réduire les animations', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);

    render(<WelcomeScreen />);

    // Aucun fondu n'est joué : le contenu est disponible immédiatement, et
    // l'action reste utilisable.
    await waitFor(() => expect(screen.getByText('COMMENCER')).toBeTruthy());
    fireEvent.press(screen.getByText('COMMENCER'));
    expect(mockPush).toHaveBeenCalledWith('/catalogue');
  });
});
