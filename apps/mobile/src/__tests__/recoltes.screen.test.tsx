import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ReviewableProduction } from '@/api/management';

import RecoltesScreen from '../../app/gestion/recoltes';

/**
 * Revue des déclarations de récolte.
 *
 * Risques couverts : une décision proposée hors de l'état qui l'autorise, et
 * surtout un rejet transmis sans motif — le producteur resterait sans recours.
 */

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockDecide = jest.fn();
let mockReview: {
  data: ReviewableProduction[] | undefined;
  isLoading: boolean;
  isError: boolean;
  isRefetching: boolean;
  error: unknown;
  refetch: jest.Mock;
};

jest.mock('@/api/management', () => ({
  useProductionReview: () => mockReview,
  useReviewProduction: () => ({ mutate: mockDecide, isPending: false }),
}));

const production = (
  overrides: Partial<ReviewableProduction> = {},
): ReviewableProduction => ({
  id: '33333333-3333-4333-8333-333333333333',
  farmId: '44444444-4444-4444-8444-444444444444',
  farmName: 'Parcelle Nord',
  season: 'Saison 2026',
  cropVariety: 'Riz long grain',
  quantityKg: 12_000,
  targetKg: 20_000,
  harvestedAt: null,
  status: 'DECLARED',
  reviewNote: null,
  reviewedAt: null,
  createdAt: new Date().toISOString(),
  producerId: '55555555-5555-4555-8555-555555555555',
  producerName: 'Coopérative Salif Traoré',
  producerPhone: '0700000003',
  ...overrides,
});

const state = (items: ReviewableProduction[]) => ({
  data: items,
  isLoading: false,
  isError: false,
  isRefetching: false,
  error: null as unknown,
  refetch: jest.fn(),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockReview = state([production()]);
});

it('affiche la déclaration avec son producteur et sa quantité', () => {
  render(<RecoltesScreen />);

  expect(screen.getByText('Coopérative Salif Traoré')).toBeTruthy();
  expect(screen.getByText('Parcelle Nord · Saison 2026')).toBeTruthy();
  expect(screen.getByText('12 t')).toBeTruthy();
  expect(screen.getByText('60 % de l’objectif')).toBeTruthy();
});

it('propose « Vérifier » sur une déclaration reçue', () => {
  render(<RecoltesScreen />);

  fireEvent.press(screen.getByText('Vérifier'));

  expect(mockDecide).toHaveBeenCalledWith(
    {
      id: '33333333-3333-4333-8333-333333333333',
      status: 'CONFIRMED',
    },
    expect.anything(),
  );
});

it('propose la réception une fois la déclaration vérifiée', () => {
  mockReview = state([production({ status: 'CONFIRMED' })]);

  render(<RecoltesScreen />);
  expect(screen.queryByText('Vérifier')).toBeNull();

  fireEvent.press(screen.getByText('Marquer réceptionnée'));

  expect(mockDecide).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'RECEIVED' }),
    expect.anything(),
  );
});

it('n’envoie jamais un rejet sans motif', () => {
  render(<RecoltesScreen />);

  fireEvent.press(screen.getByText('Rejeter'));
  // Le motif reste vide.
  fireEvent.press(screen.getByText('Confirmer le rejet'));

  expect(mockDecide).not.toHaveBeenCalled();
});

it('transmet le motif saisi au rejet', () => {
  render(<RecoltesScreen />);

  fireEvent.press(screen.getByText('Rejeter'));
  fireEvent.changeText(
    screen.getByLabelText('Motif du rejet'),
    '  Quantité incohérente.  ',
  );
  fireEvent.press(screen.getByText('Confirmer le rejet'));

  expect(mockDecide).toHaveBeenCalledWith(
    {
      id: '33333333-3333-4333-8333-333333333333',
      status: 'REJECTED',
      reviewNote: 'Quantité incohérente.',
    },
    expect.anything(),
  );
});

it('n’affiche pas de taux sans objectif déclaré', () => {
  mockReview = state([production({ targetKg: null })]);

  render(<RecoltesScreen />);

  expect(screen.queryByText(/de l’objectif/)).toBeNull();
});

it('permet d’appeler le producteur', () => {
  render(<RecoltesScreen />);

  expect(
    screen.getByLabelText('Appeler Coopérative Salif Traoré'),
  ).toBeTruthy();
});

it('annonce une file vide', () => {
  mockReview = state([]);

  render(<RecoltesScreen />);

  expect(screen.getByText('Rien à examiner')).toBeTruthy();
});

it('affiche une erreur récupérable', () => {
  mockReview = {
    ...state([]),
    data: undefined,
    isError: true,
    error: new Error('réseau'),
  };

  render(<RecoltesScreen />);

  expect(screen.getByText(/Réessayer/i)).toBeTruthy();
});
