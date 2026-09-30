import { render, screen, waitFor } from '@testing-library/react-native';

import ConfirmationScreen from '../../app/confirmation/[reference]';

const mockReplace = jest.fn();
const params: { reference: string; payment?: string } = {
  reference: 'AGR-2026-0042',
};
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => params,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockPaymentStatus = jest.fn();
jest.mock('@/api/payments', () => ({
  useGuestPaymentStatus: (...args: unknown[]) => mockPaymentStatus(...args),
}));

const mockGetAccess = jest.fn().mockResolvedValue('capabilite-temporaire');
const mockClearAccess = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/guestPayment', () => ({
  getGuestPaymentAccess: (...args: unknown[]) => mockGetAccess(...args),
  clearGuestPaymentAccess: (...args: unknown[]) => mockClearAccess(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  delete params.payment;
  mockPaymentStatus.mockReturnValue({ data: undefined });
});

it('confirme clairement le paiement comptant à la livraison', () => {
  render(<ConfirmationScreen />);

  expect(screen.getByText('Commande reçue !')).toBeTruthy();
  expect(screen.getByText('À LA LIVRAISON')).toBeTruthy();
  expect(screen.getByText('Paiement à la livraison')).toBeTruthy();
});

it('n’affiche un Mobile Money comme payé qu’après le statut serveur réussi', async () => {
  params.payment = 'MOBILE_MONEY';
  mockPaymentStatus.mockReturnValue({ data: { status: 'SUCCEEDED' } });

  render(<ConfirmationScreen />);

  await waitFor(() =>
    expect(mockGetAccess).toHaveBeenCalledWith(params.reference),
  );
  expect(screen.getByText('Paiement confirmé !')).toBeTruthy();
  expect(screen.getByText('PAYÉ')).toBeTruthy();
  expect(screen.getByText('Paiement Mobile Money confirmé')).toBeTruthy();
});
