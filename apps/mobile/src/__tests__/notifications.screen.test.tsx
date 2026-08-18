import { render, screen, fireEvent } from '@testing-library/react-native';

import type { NotificationItem } from '@/api/notifications';

import NotificationsScreen from '../../app/notifications/index';

/**
 * Écran de notifications.
 *
 * Risques couverts : marquer comme lu trop tôt (le client perd le repère de ce
 * qui est nouveau), et mener nulle part depuis une notification de commande.
 */

const mockPush = jest.fn();
const mockBack = jest.fn();

/**
 * `useFocusEffect` d'expo-router : ici l'écran est monté puis démonté, ce qui
 * doit déclencher le nettoyage — c'est exactement le moment du marquage.
 */
jest.mock('expo-router', () => {
  const { useEffect } = require('react') as typeof import('react');
  return {
    useRouter: () => ({ push: mockPush, back: mockBack }),
    useFocusEffect: (effect: () => undefined | (() => void)) => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      useEffect(() => effect(), []);
    },
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockMarkMutate = jest.fn();
let mockList: {
  data: { data: NotificationItem[]; meta: { unread: number } } | undefined;
  isLoading: boolean;
  isError: boolean;
  isRefetching: boolean;
  error: unknown;
  refetch: jest.Mock;
};

jest.mock('@/api/notifications', () => ({
  useNotifications: () => mockList,
  useMarkNotificationsRead: () => ({ mutate: mockMarkMutate }),
}));

jest.mock('@/api/orders', () => ({
  useOrders: () => ({
    data: {
      data: [
        {
          id: 'order-1',
          reference: 'AGR-2026-0007',
          status: 'PREPARING',
          total: 12000,
          createdAt: new Date().toISOString(),
          itemCount: 2,
        },
      ],
    },
  }),
}));

jest.mock('@/store/auth', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ accessToken: 'token', user: { id: 'u1', role: 'CLIENT' } }),
}));

const notification = (
  overrides: Partial<NotificationItem> = {},
): NotificationItem => ({
  id: 'n1',
  type: 'ORDER_PREPARING',
  title: 'Commande en préparation',
  body: 'Votre commande AGR-2026-0007 est en cours de préparation.',
  isRead: false,
  orderId: 'order-1',
  createdAt: new Date().toISOString(),
  ...overrides,
});

const listState = (items: NotificationItem[], unread: number) => ({
  data: { data: items, meta: { unread } },
  isLoading: false,
  isError: false,
  isRefetching: false,
  error: null,
  refetch: jest.fn(),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockList = listState([notification()], 1);
});

it('affiche les notifications reçues', () => {
  render(<NotificationsScreen />);

  expect(screen.getByText('Commande en préparation')).toBeTruthy();
  expect(
    screen.getByText(/Votre commande AGR-2026-0007 est en cours/),
  ).toBeTruthy();
});

it('ne marque pas comme lu tant que l’écran est affiché', () => {
  render(<NotificationsScreen />);

  expect(mockMarkMutate).not.toHaveBeenCalled();
});

it('marque comme lu en quittant l’écran', () => {
  const view = render(<NotificationsScreen />);
  view.unmount();

  expect(mockMarkMutate).toHaveBeenCalledTimes(1);
});

it('ne marque rien quand tout est déjà lu', () => {
  mockList = listState([notification({ isRead: true })], 0);

  const view = render(<NotificationsScreen />);
  view.unmount();

  expect(mockMarkMutate).not.toHaveBeenCalled();
});

it('ouvre la commande liée', () => {
  render(<NotificationsScreen />);

  fireEvent.press(
    screen.getByLabelText(/Commande en préparation\. Votre commande/),
  );

  expect(mockPush).toHaveBeenCalledWith('/commandes/AGR-2026-0007');
});

it('renvoie vers l’historique quand la commande n’est pas connue', () => {
  mockList = listState([notification({ orderId: 'inconnue' })], 1);

  render(<NotificationsScreen />);
  fireEvent.press(
    screen.getByLabelText(/Commande en préparation\. Votre commande/),
  );

  expect(mockPush).toHaveBeenCalledWith('/commandes');
});

it('affiche un état vide explicite', () => {
  mockList = listState([], 0);

  render(<NotificationsScreen />);

  expect(screen.getByText('Aucune notification')).toBeTruthy();
});

it('affiche une erreur récupérable', () => {
  mockList = {
    ...listState([], 0),
    data: undefined,
    isError: true,
    error: new Error('réseau'),
  };

  render(<NotificationsScreen />);

  expect(screen.getByText(/Réessayer/i)).toBeTruthy();
});
