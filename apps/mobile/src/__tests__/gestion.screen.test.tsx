import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { ManagedOrder } from '@/api/management';

import GestionScreen from '../../app/gestion/index';

/**
 * Tableau de bord gestionnaire.
 *
 * Risques couverts : proposer une action qui n'appartient pas au gestionnaire
 * (déclarer une livraison depuis le bureau), assigner deux fois la même
 * course, et noyer l'écran d'alertes sans objet.
 */

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockUpdateStatus = jest.fn();
const mockAssign = jest.fn();
let mockDashboard: ReturnType<typeof queryState>;
let mockOrders: ReturnType<typeof queryState>;

jest.mock('@/api/management', () => ({
  useManagerDashboard: () => mockDashboard,
  useManagedOrders: () => mockOrders,
  useCouriers: () => ({
    data: [
      {
        id: 'c1',
        firstName: 'Ibrahim',
        lastName: 'Coulibaly',
        phone: '0700000002',
        activeDeliveries: 2,
      },
    ],
  }),
  useUpdateOrderStatus: () => ({
    mutate: mockUpdateStatus,
    isPending: false,
  }),
  useAssignCourier: () => ({ mutate: mockAssign, isPending: false }),
}));

jest.mock('@/store/auth', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      accessToken: 'token',
      user: {
        id: 'u1',
        firstName: 'Mariam',
        lastName: 'Bamba',
        role: 'GESTIONNAIRE',
      },
    }),
}));

function queryState(data: unknown) {
  return {
    data,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: jest.fn(),
  };
}

const dashboard = {
  revenueToday: 284500,
  ordersToday: 23,
  toPrepare: 7,
  activeDeliveries: 5,
  lowStockCount: 2,
  stalePendingCount: 1,
};

const order = (overrides: Partial<ManagedOrder> = {}): ManagedOrder => ({
  id: 'o1',
  reference: 'AGR-2026-0045',
  status: 'PENDING',
  total: 12000,
  itemCount: 2,
  createdAt: new Date().toISOString(),
  customerName: 'Awa Koné',
  customerPhone: '0700000001',
  city: 'Yamoussoukro',
  hasCourier: false,
  awaitingRetry: false,
  deliveryFailureReason: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDashboard = queryState(dashboard);
  mockOrders = queryState([order()]);
});

it('affiche les indicateurs du jour', () => {
  render(<GestionScreen />);

  expect(screen.getByText('284\u202F500\u202FF')).toBeTruthy();
  expect(screen.getByText('23')).toBeTruthy();
  expect(screen.getByText('7')).toBeTruthy();
});

it('résume les alertes en cours', () => {
  render(<GestionScreen />);

  expect(
    screen.getByLabelText(/Alertes : 2 stocks faibles, 1 commande en attente/),
  ).toBeTruthy();
});

it('n’affiche aucune alerte quand tout va bien', () => {
  mockDashboard = queryState({
    ...dashboard,
    lowStockCount: 0,
    stalePendingCount: 0,
  });

  render(<GestionScreen />);

  expect(screen.queryByLabelText(/Alertes/)).toBeNull();
});

it('propose « Confirmer » sur une commande en attente', () => {
  render(<GestionScreen />);

  fireEvent.press(screen.getByText('Confirmer'));

  expect(mockUpdateStatus).toHaveBeenCalledWith(
    { reference: 'AGR-2026-0045', status: 'CONFIRMED' },
    expect.anything(),
  );
});

it('propose « Préparer » puis « Marquer prête »', () => {
  mockOrders = queryState([order({ status: 'CONFIRMED' })]);
  const { rerender } = render(<GestionScreen />);
  expect(screen.getByText('Préparer')).toBeTruthy();

  mockOrders = queryState([order({ status: 'PREPARING' })]);
  rerender(<GestionScreen />);
  expect(screen.getByText('Marquer prête')).toBeTruthy();
});

it('n’offre aucune transition de statut sur une commande prête', () => {
  mockOrders = queryState([order({ status: 'READY' })]);

  render(<GestionScreen />);

  // Ces étapes appartiennent au livreur : les proposer ici ferait mentir le
  // suivi client.
  expect(screen.queryByText('En livraison')).toBeNull();
  expect(screen.queryByText('Marquer livrée')).toBeNull();
  expect(screen.getByText('Assigner')).toBeTruthy();
});

it('ouvre le choix du livreur à l’assignation', () => {
  mockOrders = queryState([order({ status: 'READY' })]);
  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  render(<GestionScreen />);
  fireEvent.press(screen.getByText('Assigner'));

  expect(spy.mock.calls[0]![0]).toContain('AGR-2026-0045');
  // La charge courante figure dans le libellé, pour répartir le travail.
  const buttons = spy.mock.calls[0]![2] as { text: string }[];
  expect(buttons[0]!.text).toContain('Ibrahim Coulibaly');
  expect(buttons[0]!.text).toContain('2');

  spy.mockRestore();
});

it('ne propose plus l’assignation quand un livreur est déjà affecté', () => {
  mockOrders = queryState([order({ status: 'READY', hasCourier: true })]);

  render(<GestionScreen />);

  expect(screen.queryByText('Assigner')).toBeNull();
  expect(screen.getByText('Assignée')).toBeTruthy();
});

it('mène au détail d’une commande', () => {
  render(<GestionScreen />);

  fireEvent.press(screen.getByLabelText('Ouvrir AGR-2026-0045'));

  expect(mockPush).toHaveBeenCalledWith('/gestion/AGR-2026-0045');
});

it('mène aux stocks', () => {
  render(<GestionScreen />);

  fireEvent.press(screen.getByLabelText('Stocks'));

  expect(mockPush).toHaveBeenCalledWith('/gestion/stocks');
});

it('annonce une file vide', () => {
  mockOrders = queryState([]);

  render(<GestionScreen />);

  expect(screen.getByText('Rien en attente')).toBeTruthy();
});

it('affiche une erreur récupérable', () => {
  mockDashboard = {
    ...queryState(undefined),
    isError: true,
    error: new Error('réseau'),
  };

  render(<GestionScreen />);

  expect(screen.getByText(/Réessayer/i)).toBeTruthy();
});
