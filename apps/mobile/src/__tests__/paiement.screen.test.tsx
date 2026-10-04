import { Linking } from 'react-native';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import GuestPaymentScreen from '../../app/paiement/[reference]';

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockParams = { reference: 'AGR-2026-0042' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockInitiateGuestPayment = jest.fn();
const mockPaymentRefetch = jest.fn().mockResolvedValue({});
let mockPaymentState: {
  data:
    | {
        status: string;
        provider: string | null;
        amount: number;
        providerReference: string | null;
      }
    | undefined;
  isError: boolean;
  isFetching: boolean;
  refetch: jest.Mock;
};
jest.mock('@/api/payments', () => ({
  useInitiateGuestPayment: () => ({
    mutateAsync: mockInitiateGuestPayment,
    isPending: false,
  }),
  useGuestPaymentStatus: () => mockPaymentState,
}));

const mockGetGuestPaymentAccess = jest.fn();
jest.mock('@/lib/guestPayment', () => ({
  getGuestPaymentAccess: (...args: [string]) =>
    mockGetGuestPaymentAccess(...args),
}));

const mockCallMobileSupport = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/contact', () => ({
  callMobileSupport: () => mockCallMobileSupport(),
}));

let mockOnline = true;
jest.mock('@/lib/network', () => ({
  useIsOnline: () => mockOnline,
}));

const mockOpenUrl = jest.spyOn(Linking, 'openURL');

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockGetGuestPaymentAccess.mockResolvedValue('capabilite-temporaire');
  mockInitiateGuestPayment.mockResolvedValue({
    reference: mockParams.reference,
    status: 'PENDING',
    checkoutUrl: 'https://paiement.example/transaction',
  });
  mockPaymentRefetch.mockResolvedValue({});
  mockPaymentState = {
    data: {
      status: 'PENDING',
      provider: 'ORANGE_MONEY',
      amount: 12_000,
      providerReference: null,
    },
    isError: false,
    isFetching: false,
    refetch: mockPaymentRefetch,
  };
  mockOpenUrl.mockResolvedValue(true);
});

afterAll(() => {
  mockOpenUrl.mockRestore();
});

it('ouvre le paiement invité et indique sa troisième étape', async () => {
  render(<GuestPaymentScreen />);

  await waitFor(() =>
    expect(screen.getByText('PAYER MAINTENANT')).toBeTruthy(),
  );
  expect(screen.getByLabelText('Étape 3 sur 4 : Paiement')).toBeTruthy();

  fireEvent.press(screen.getByText('PAYER MAINTENANT'));

  await waitFor(() =>
    expect(mockInitiateGuestPayment).toHaveBeenCalledWith({
      reference: mockParams.reference,
      token: 'capabilite-temporaire',
    }),
  );
  expect(mockPaymentRefetch).toHaveBeenCalledTimes(1);
  expect(mockOpenUrl).toHaveBeenCalledWith(
    'https://paiement.example/transaction',
  );
});

it('actualise un paiement déjà lancé sans rouvrir une seconde transaction', async () => {
  mockPaymentState.data = {
    ...mockPaymentState.data!,
    providerReference: 'provider-transaction-42',
  };
  render(<GuestPaymentScreen />);

  await waitFor(() =>
    expect(screen.getByText('ACTUALISER LE STATUT')).toBeTruthy(),
  );
  fireEvent.press(screen.getByText('ACTUALISER LE STATUT'));

  await waitFor(() => expect(mockPaymentRefetch).toHaveBeenCalledTimes(1));
  expect(mockInitiateGuestPayment).not.toHaveBeenCalled();
});

it('ne relance pas le paiement hors connexion et propose l’appel AGRIM', async () => {
  mockOnline = false;
  render(<GuestPaymentScreen />);

  await waitFor(() =>
    expect(screen.getByText('CONNEXION NÉCESSAIRE')).toBeTruthy(),
  );
  expect(
    screen.getByText(/Votre paiement n’est pas relancé automatiquement/i),
  ).toBeTruthy();
  fireEvent.press(screen.getByText('APPELER AGRIM · 07 00 05 04 52'));

  expect(mockCallMobileSupport).toHaveBeenCalledTimes(1);
  expect(mockInitiateGuestPayment).not.toHaveBeenCalled();
});
