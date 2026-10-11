import * as Clipboard from 'expo-clipboard';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { formatXof } from '@/lib/format';

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

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
}));

/**
 * Instruction de paiement telle que le SERVEUR la renvoie : le numéro affiché
 * est celui de la configuration d'AGRIM, pas une constante de l'application.
 */
const instruction = {
  reference: 'AGR-2026-0042',
  amount: 18_500,
  currency: 'XOF' as const,
  status: 'PENDING',
  method: {
    code: 'ORANGE_MONEY',
    operatorName: 'Orange Money',
    receivingNumber: '0700000000',
    beneficiaryName: 'AGRIM SARL',
    instructions: 'Choisissez « Transfert », puis saisissez le numéro.',
    ussdTemplate: null,
  },
  paymentReference: 'AGR-2026-0042',
  declarations: 0,
  lastDeclaration: null,
  rejectionNote: null,
};

const mockDeclare = jest.fn();
let mockInstructionState: {
  data: typeof instruction | undefined;
  isError: boolean;
};
let mockPaymentState: {
  data: { status: string; amount: number } | undefined;
  isError: boolean;
  isFetching: boolean;
  refetch: jest.Mock;
};
const mockPaymentRefetch = jest.fn().mockResolvedValue({});

jest.mock('@/api/payments', () => ({
  usePaymentInstructions: () => mockInstructionState,
  useDeclarePayment: () => ({
    mutateAsync: mockDeclare,
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
  // Le numéro affiché vient du SERVEUR ; le test fixe celui d'AGRIM, comme le
  // ferait le repli du contrat partagé.
  supportPhone: () => '+225 07 00 05 04 52',
}));

let mockOnline = true;
jest.mock('@/lib/network', () => ({
  useIsOnline: () => mockOnline,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockGetGuestPaymentAccess.mockResolvedValue('capabilite-temporaire');
  mockInstructionState = { data: instruction, isError: false };
  mockDeclare.mockResolvedValue({
    recorded: true,
    status: 'DECLARED_BY_CUSTOMER',
    amountMatches: true,
    message: 'Merci. Votre déclaration est enregistrée.',
  });
  mockPaymentState = {
    data: { status: 'PENDING', amount: 18_500 },
    isError: false,
    isFetching: false,
    refetch: mockPaymentRefetch,
  };
});

it('affiche le montant exact, le numéro officiel et la référence de la commande', async () => {
  render(<GuestPaymentScreen />);

  await waitFor(() => expect(screen.getByText('0700000000')).toBeTruthy());
  expect(screen.getByText(formatXof(18_500))).toBeTruthy();
  expect(screen.getByText('AGR-2026-0042')).toBeTruthy();
  expect(screen.getByText('Orange Money')).toBeTruthy();
  expect(screen.getByText('Bénéficiaire : AGRIM SARL')).toBeTruthy();
  expect(screen.getByLabelText('Étape 3 sur 4 : Paiement')).toBeTruthy();
});

it('copie le numéro officiel et l’instruction complète', async () => {
  render(<GuestPaymentScreen />);
  await waitFor(() =>
    expect(screen.getByText('COPIER LE NUMÉRO')).toBeTruthy(),
  );

  fireEvent.press(screen.getByText('COPIER LE NUMÉRO'));
  await waitFor(() =>
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('0700000000'),
  );

  fireEvent.press(
    screen.getByText('COPIER MONTANT + NUMÉRO + RÉFÉRENCE'),
  );
  await waitFor(() =>
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
      expect.stringContaining(formatXof(18_500)),
    ),
  );
});

it('déclare le transfert sans jamais confirmer le paiement', async () => {
  render(<GuestPaymentScreen />);
  await waitFor(() =>
    expect(screen.getByText('J’ai effectué le transfert')).toBeTruthy(),
  );

  fireEvent.changeText(
    screen.getByLabelText('Référence de la transaction'),
    'TX123456789',
  );
  fireEvent.changeText(
    screen.getByLabelText('Montant transféré (F CFA)'),
    '18500',
  );
  fireEvent.press(screen.getByText('DÉCLARER MON TRANSFERT'));

  await waitFor(() =>
    expect(mockDeclare).toHaveBeenCalledWith({
      transactionReference: 'TX123456789',
      declaredAmount: 18_500,
      note: undefined,
    }),
  );

  // La réponse du serveur ne dit QUE « déclaration enregistrée ».
  await waitFor(() =>
    expect(
      screen.getByText(/Merci\. Votre déclaration est enregistrée/i),
    ).toBeTruthy(),
  );
  expect(mockReplace).not.toHaveBeenCalledWith(
    expect.stringContaining('confirmation'),
  );
});

it('n’accepte pas une déclaration hors connexion et propose l’appel AGRIM', async () => {
  mockOnline = false;
  render(<GuestPaymentScreen />);

  await waitFor(() =>
    expect(screen.getByText('DÉCLARER MON TRANSFERT')).toBeTruthy(),
  );
  fireEvent.changeText(
    screen.getByLabelText('Référence de la transaction'),
    'TX123456789',
  );
  fireEvent.press(screen.getByText('DÉCLARER MON TRANSFERT'));

  expect(mockDeclare).not.toHaveBeenCalled();
  fireEvent.press(
    screen.getByText(new RegExp(`APPELER AGRIM · .*`)),
  );
  expect(mockCallMobileSupport).toHaveBeenCalledTimes(1);
});

it('rejoint la confirmation seulement quand AGRIM a confirmé les fonds', async () => {
  mockPaymentState.data = { status: 'SUCCEEDED', amount: 18_500 };
  render(<GuestPaymentScreen />);

  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith(
      '/confirmation/AGR-2026-0042?payment=DIRECT_MOBILE_MONEY',
    ),
  );
});

it('explique la session expirée sans perdre la commande', async () => {
  mockGetGuestPaymentAccess.mockResolvedValue(null);
  render(<GuestPaymentScreen />);

  await waitFor(() =>
    expect(screen.getByText('Session de paiement expirée')).toBeTruthy(),
  );
  expect(screen.getByText(/votre dossier reste enregistré/i)).toBeTruthy();
});
