import { fireEvent, render, screen } from '@testing-library/react-native';

import WelcomeScreen from '../../app/(tabs)/index';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

beforeEach(() => {
  mockPush.mockClear();
});

describe('Accueil public', () => {
  it('présente AGRIM et la promesse du parcours invité', () => {
    render(<WelcomeScreen />);

    expect(screen.getByLabelText('Logo AGRIM')).toBeTruthy();
    expect(screen.getByText('Le bon riz,')).toBeTruthy();
    expect(screen.getByText('simplement.')).toBeTruthy();
    expect(
      screen.getByText('Commande sans compte · Livraison ou Mobile Money'),
    ).toBeTruthy();
  });

  it('mène directement au catalogue sans passer par une connexion', () => {
    render(<WelcomeScreen />);

    fireEvent.press(screen.getByText('COMMENCER'));
    expect(mockPush).toHaveBeenCalledWith('/catalogue');
    expect(screen.queryByText(/connexion/i)).toBeNull();
  });
});
