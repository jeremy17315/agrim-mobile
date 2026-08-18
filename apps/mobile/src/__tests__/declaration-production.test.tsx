import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import type { Farm } from '@/api/producers';

import ProductionScreen from '../../app/exploitation/production';

/**
 * Formulaire de déclaration.
 *
 * Risques couverts : proposer une parcelle en jachère (que le serveur
 * refusera), et laisser partir une déclaration incomplète.
 */

const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: mockBack }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockCreate = jest.fn();
let mockFarmsData: Farm[];

jest.mock('@/api/producers', () => ({
  useFarms: () => ({
    data: mockFarmsData,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useCreateProduction: () => ({
    mutate: mockCreate,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

/** Le contrat impose des UUID : un identifiant fantaisiste serait rejeté. */
const FARM_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_FARM_ID = '22222222-2222-4222-8222-222222222222';

const farm = (overrides: Partial<Farm> = {}): Farm => ({
  id: FARM_ID,
  name: 'Exploitation de Bouaké-Nord',
  location: 'Bouaké',
  areaHectares: 12.5,
  latitude: null,
  longitude: null,
  isActive: true,
  productionCount: 0,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFarmsData = [farm()];
});

it('ne propose que les parcelles actives', () => {
  mockFarmsData = [
    farm(),
    farm({ id: OTHER_FARM_ID, name: 'Parcelle en jachère', isActive: false }),
  ];

  render(<ProductionScreen />);

  expect(screen.getByLabelText('Exploitation de Bouaké-Nord')).toBeTruthy();
  expect(screen.queryByLabelText('Parcelle en jachère')).toBeNull();
});

it('bloque la déclaration sans parcelle active', () => {
  mockFarmsData = [farm({ isActive: false })];

  render(<ProductionScreen />);

  expect(screen.getByText('Aucune parcelle active')).toBeTruthy();
});

it('présélectionne la parcelle quand il n’y en a qu’une', () => {
  render(<ProductionScreen />);

  expect(
    screen.getByLabelText('Exploitation de Bouaké-Nord').props
      .accessibilityState.selected,
  ).toBe(true);
});

it('refuse d’envoyer une déclaration incomplète', async () => {
  render(<ProductionScreen />);

  fireEvent.press(screen.getByText('Enregistrer la déclaration'));

  await waitFor(() => {
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

it('envoie une déclaration valide au serveur', async () => {
  render(<ProductionScreen />);

  fireEvent.changeText(
    screen.getByLabelText('Variété cultivée'),
    'Riz long grain',
  );
  fireEvent.changeText(
    screen.getByLabelText('Quantité récoltée (kg)'),
    '18000',
  );
  fireEvent.press(screen.getByText('Enregistrer la déclaration'));

  await waitFor(() => {
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  const payload = mockCreate.mock.calls[0]![0];
  expect(payload.farmId).toBe(FARM_ID);
  expect(payload.quantityKg).toBe(18000);
  // Objectif non saisi : transmis comme absent, jamais comme zéro.
  expect(payload.targetKg).toBeNull();
});

it('ignore les caractères non numériques dans la quantité', async () => {
  render(<ProductionScreen />);

  fireEvent.changeText(screen.getByLabelText('Variété cultivée'), 'Riz');
  fireEvent.changeText(
    screen.getByLabelText('Quantité récoltée (kg)'),
    '12a3b4',
  );
  fireEvent.press(screen.getByText('Enregistrer la déclaration'));

  await waitFor(() => {
    expect(mockCreate).toHaveBeenCalled();
  });
  expect(mockCreate.mock.calls[0]![0].quantityKg).toBe(1234);
});
