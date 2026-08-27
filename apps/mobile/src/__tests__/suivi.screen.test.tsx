import type { OrderStatus } from '@agrim/contracts';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import type { OrderDetail } from '@/api/orders';

import SuiviCommandeScreen from '../../app/commandes/[reference]';

/**
 * Écran de suivi.
 *
 * Deux risques : afficher une chronologie qui ne correspond pas au statut
 * réel, et proposer une annulation là où elle est impossible.
 */

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string> = { reference: 'AGR-2026-0001' };

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: mockBack, replace: mockReplace, push: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockUseOrder = jest.fn();
const mockCancelMutate = jest.fn();
/**
 * La carte de suivi GPS interroge l'API livraisons : sans ce mock, l'écran
 * réclamerait un QueryClient. Le suivi lui-même est couvert par ses propres
 * tests, côté API.
 */
// Le code de livraison est demandé au serveur, qui seul peut le déchiffrer.
jest.mock('@/api/deliveries', () => ({
  useDeliveryTracking: () => ({ data: null, isPending: false }),
  useResendOtp: () => ({ mutate: jest.fn(), isPending: false }),
  useDeliveryCode: () => ({
    data: { code: null, expiresAt: null },
    isPending: false,
    refetch: jest.fn(),
  }),
}));

jest.mock('@/api/orders', () => ({
  useOrder: (reference: string) => mockUseOrder(reference),
  useCancelOrder: () => ({ mutate: mockCancelMutate, isPending: false }),
}));

/**
 * `useSuiviPaiement` encapsule l'interrogation périodique du paiement et la
 * relecture de la commande quand il se règle. Le mock renvoie simplement le
 * statut déjà porté par la commande : le suivi lui-même est couvert côté API,
 * et sans ce mock l'écran réclamerait un QueryClient.
 */
jest.mock('@/api/payments', () => ({
  initiatePayment: jest.fn(),
  useInitiatePayment: () => ({ mutateAsync: jest.fn(), isPending: false }),
  usePaymentStatus: () => ({ data: null, isPending: false }),
  useSuiviPaiement: (_reference: string, statutConnu?: string | null) =>
    statutConnu ?? null,
}));

function buildOrder(
  status: OrderStatus,
  events: { status: OrderStatus; createdAt: string }[],
): OrderDetail {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    reference: 'AGR-2026-0001',
    status,
    subtotal: 12_000,
    deliveryFee: 1000,
    total: 13_000,
    note: null,
    createdAt: '2026-08-18T09:00:00.000Z',
    items: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        productName: 'RIZ BOAGNI Royal Grains',
        variantLabel: '5 kg',
        unitPrice: 6000,
        quantity: 2,
        lineTotal: 12_000,
      },
    ],
    address: {
      id: '11111111-1111-4111-8111-111111111111',
      label: 'Maison',
      city: 'Yamoussoukro',
      commune: 'Habitat',
      district: null,
      landmark: 'En face de la pharmacie',
      instructions: null,
      contactPhone: '0700000001',
      latitude: null,
      longitude: null,
    },
    payment: { method: 'CASH_ON_DELIVERY', status: 'PENDING' },
    events: events.map((event, index) => ({
      id: `event-${index}`,
      status: event.status,
      comment: null,
      createdAt: event.createdAt,
    })),
  };
}

const mockOrder = (order: OrderDetail) => {
  mockUseOrder.mockReturnValue({
    data: order,
    isPending: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { reference: 'AGR-2026-0001' };
  mockOrder(
    buildOrder('PENDING', [
      { status: 'PENDING', createdAt: '2026-08-18T09:00:00.000Z' },
    ]),
  );
});

it('affiche la référence, le statut et les montants du serveur', () => {
  render(<SuiviCommandeScreen />);

  expect(screen.getAllByText('AGR-2026-0001').length).toBeGreaterThan(0);
  // « En attente » apparaît deux fois : l'étiquette de statut et l'étape de
  // la chronologie.
  expect(screen.getAllByText('En attente').length).toBe(2);
  expect(screen.getByText('Nous avons bien reçu votre commande.')).toBeTruthy();
});

it('affiche toutes les étapes du parcours', () => {
  mockOrder(
    buildOrder('PREPARING', [
      { status: 'PENDING', createdAt: '2026-08-18T09:00:00.000Z' },
      { status: 'CONFIRMED', createdAt: '2026-08-18T09:30:00.000Z' },
      { status: 'PREPARING', createdAt: '2026-08-18T10:00:00.000Z' },
    ]),
  );
  render(<SuiviCommandeScreen />);

  for (const label of [
    'Confirmée',
    'En préparation',
    'Prête',
    'En livraison',
    'Livrée',
  ]) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  }
});

it('interrompt la chronologie sur une commande annulée', () => {
  mockOrder(
    buildOrder('CANCELLED', [
      { status: 'PENDING', createdAt: '2026-08-18T09:00:00.000Z' },
      { status: 'CANCELLED', createdAt: '2026-08-18T11:00:00.000Z' },
    ]),
  );
  render(<SuiviCommandeScreen />);

  expect(screen.getAllByText('Annulée').length).toBeGreaterThan(0);
  // Le parcours ne doit pas donner l'illusion qu'il continue.
  expect(screen.queryByText('En livraison')).toBeNull();
  expect(screen.queryByText('Livrée')).toBeNull();
});

it('propose l’annulation tant que la commande n’est pas partie', () => {
  render(<SuiviCommandeScreen />);
  expect(screen.getByText('Annuler la commande')).toBeTruthy();
});

it('masque l’annulation sur une commande livrée', () => {
  mockOrder(
    buildOrder('DELIVERED', [
      { status: 'PENDING', createdAt: '2026-08-18T09:00:00.000Z' },
      { status: 'DELIVERED', createdAt: '2026-08-18T14:00:00.000Z' },
    ]),
  );
  render(<SuiviCommandeScreen />);

  expect(screen.queryByText('Annuler la commande')).toBeNull();
});

it('masque l’annulation sur une commande déjà annulée', () => {
  mockOrder(
    buildOrder('CANCELLED', [
      { status: 'PENDING', createdAt: '2026-08-18T09:00:00.000Z' },
      { status: 'CANCELLED', createdAt: '2026-08-18T11:00:00.000Z' },
    ]),
  );
  render(<SuiviCommandeScreen />);

  expect(screen.queryByText('Annuler la commande')).toBeNull();
});

it('demande confirmation avant d’annuler', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<SuiviCommandeScreen />);

  fireEvent.press(screen.getByText('Annuler la commande'));

  // Une annulation est irréversible : jamais sans confirmation explicite.
  expect(alertSpy).toHaveBeenCalled();
  expect(mockCancelMutate).not.toHaveBeenCalled();

  // On simule l'appui sur le bouton destructif de la boîte de dialogue.
  const buttons = (alertSpy.mock.calls[0]![2] ?? []) as AlertButton[];
  buttons.find((b) => b.style === 'destructive')?.onPress?.();

  await waitFor(() => expect(mockCancelMutate).toHaveBeenCalled());
  alertSpy.mockRestore();
});

it('affiche le message de succès seulement après création', () => {
  mockParams = { reference: 'AGR-2026-0001', nouvelle: '1' };
  render(<SuiviCommandeScreen />);
  expect(screen.getByText('Commande enregistrée')).toBeTruthy();
});

it('n’affiche pas le message de succès en consultation normale', () => {
  render(<SuiviCommandeScreen />);
  expect(screen.queryByText('Commande enregistrée')).toBeNull();
});

it('ne propose pas de reprendre un paiement à la livraison', () => {
  render(<SuiviCommandeScreen />);
  expect(screen.queryByText('Reprendre le paiement')).toBeNull();
  expect(screen.getByText('Paiement à la livraison')).toBeTruthy();
});

it('propose de reprendre un paiement Mobile Money encore ouvert', () => {
  const order = buildOrder('PENDING', [
    { status: 'PENDING', createdAt: '2026-08-18T09:00:00.000Z' },
  ]);
  order.payment = { method: 'MOBILE_MONEY', status: 'AWAITING_CONFIRMATION' };
  mockOrder(order);
  render(<SuiviCommandeScreen />);
  expect(screen.getByText('Reprendre le paiement')).toBeTruthy();
});
