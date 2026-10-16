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

/** Les gestes « un seul téléphone » : on observe ce qui est demandé d'ouvrir. */
const mockOpenLink = jest.fn(async (_url: string) => true);
jest.mock('@/lib/paymentActions', () => ({
  openPublishedLink: (url: string) => mockOpenLink(url),
  canDialUssd: () => true,
}));

/** Le vrai QR dessine une matrice de points : illisible dans un test. Le faux
 *  restitue la VALEUR passée au composant — c'est elle qui compte (le contenu
 *  publié par AGRIM, jamais un QR fabriqué par l'application). */
jest.mock('react-native-qrcode-svg', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: ({ value }: { value: string }) =>
      React.createElement(Text, { testID: 'qr-marchand' }, value),
  };
});

/**
 * Instruction de paiement telle que le SERVEUR la renvoie : le numéro affiché
 * est celui de la configuration d'AGRIM, pas une constante de l'application.
 */
const methodVide = {
  code: 'ORANGE_MONEY',
  operatorName: 'Orange Money',
  receivingNumber: '0700000000',
  beneficiaryName: 'AGRIM SARL',
  instructions: 'Choisissez « Transfert », puis saisissez le numéro.',
  ussdTemplate: null as string | null,
  qrPayload: null as string | null,
  paymentUrl: null as string | null,
};

const instruction = {
  reference: 'AGR-2026-0042',
  amount: 18_500,
  currency: 'XOF' as const,
  status: 'PENDING',
  method: methodVide,
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

it('affiche le QR marchand quand AGRIM l’a publié, tel quel', async () => {
  const qr = 'https://pay.wave.com/m/M_agrim/c/ci/';
  mockInstructionState = {
    data: { ...instruction, method: { ...methodVide, qrPayload: qr } },
    isError: false,
  };
  render(<GuestPaymentScreen />);

  await waitFor(() => expect(screen.getByTestId('qr-marchand')).toBeTruthy());
  // Le contenu affiché est celui du serveur, à la virgule près.
  expect(screen.getByText(qr, { exact: true })).toBeTruthy();
  expect(screen.getByText('OU SCANNEZ LE QR DU COMPTE')).toBeTruthy();
});

it('sans QR publié, n’affiche aucun QR — le numéro reste la seule voie', async () => {
  render(<GuestPaymentScreen />);

  await waitFor(() => expect(screen.getByText('0700000000')).toBeTruthy());
  expect(screen.queryByTestId('qr-marchand')).toBeNull();
  expect(screen.queryByText('OU SCANNEZ LE QR DU COMPTE')).toBeNull();
});

it('propose d’ouvrir le lien de paiement publié, montant déjà connu', async () => {
  const lien = 'https://pay.wave.com/m/M_agrim/c/ci/';
  mockInstructionState = {
    data: { ...instruction, method: { ...methodVide, paymentUrl: lien } },
    isError: false,
  };
  render(<GuestPaymentScreen />);

  await waitFor(() =>
    expect(screen.getByText('PAYER AVEC ORANGE MONEY')).toBeTruthy(),
  );
  fireEvent.press(screen.getByText('PAYER AVEC ORANGE MONEY'));

  await waitFor(() => expect(mockOpenLink).toHaveBeenCalledWith(lien));
});

it('compose le code du compte AVEC le montant exact de la commande', async () => {
  mockInstructionState = {
    data: {
      ...instruction,
      method: { ...methodVide, ussdTemplate: '#144*1*1*{number}*{amount}#' },
    },
    isError: false,
  };
  render(<GuestPaymentScreen />);

  await waitFor(() =>
    expect(screen.getByText('#144*1*1*0700000000*18500#')).toBeTruthy(),
  );

  fireEvent.press(screen.getByText('COMPOSER'));
  await waitFor(() =>
    expect(mockOpenLink).toHaveBeenCalledWith(
      'tel:%23144*1*1*0700000000*18500%23',
    ),
  );
});

it('sans lien ni code publiés, n’ajoute aucun bouton', async () => {
  render(<GuestPaymentScreen />);

  await waitFor(() => expect(screen.getByText('0700000000')).toBeTruthy());
  expect(screen.queryByText(/PAYER AVEC/)).toBeNull();
  expect(screen.queryByText('CODE À COMPOSER')).toBeNull();
});
