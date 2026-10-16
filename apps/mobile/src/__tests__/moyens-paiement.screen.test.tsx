import * as Clipboard from 'expo-clipboard';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import MoyensDePaiementScreen from '../../app/paiement/moyens';

/**
 * Payer AGRIM — comptes marchands et QR.
 *
 * Ce que ces tests protègent, et qui n'est pas négociable :
 *  - le numéro et le QR affichés viennent du SERVEUR, jamais d'une constante ;
 *  - le QR réaffiche le contenu EXACT publié par AGRIM (pas de QR fabriqué) ;
 *  - sans QR publié, l'écran l'écrit au lieu d'afficher un carré vide ;
 *  - sans aucun compte publié, l'écran le dit et renvoie vers l'appel — il
 *    n'affiche jamais un numéro inventé.
 */

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/lib/contact', () => ({
  callMobileSupport: jest.fn().mockResolvedValue(undefined),
  supportPhone: () => '+2250700050452',
}));

jest.mock('@/lib/network', () => ({
  useIsOnline: () => true,
}));

/**
 * Le vrai composant dessine une matrice de points : illisible dans un test.
 * Le faux restitue la VALEUR qu'on lui passe — c'est exactement ce que le test
 * doit vérifier (le contenu publié par le serveur, tel quel).
 */
jest.mock('react-native-qrcode-svg', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: ({ value }: { value: string }) =>
      React.createElement(Text, { testID: 'qr-marchand' }, value),
  };
});

type Method = {
  code: string;
  operatorName: string;
  receivingNumber: string;
  beneficiaryName: string | null;
  instructions: string | null;
  ussdTemplate: string | null;
  qrPayload: string | null;
};

const orange: Method = {
  code: 'ORANGE_MONEY',
  operatorName: 'Orange Money',
  receivingNumber: '0700050452',
  beneficiaryName: 'AGRIM SARL',
  instructions: 'Choisissez « Transfert », puis saisissez le numéro.',
  ussdTemplate: null,
  qrPayload: 'https://pay.orange.ci/m/AGRIM',
};

let mockMethods: {
  data: { methods: Method[] } | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: jest.Mock;
};

jest.mock('@/api/payments', () => ({
  usePaymentMethods: () => mockMethods,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockMethods = {
    data: { methods: [orange] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  };
});

describe('Écran « Payer AGRIM »', () => {
  it('affiche le compte publié par le serveur : nom, numéro, bénéficiaire', () => {
    render(<MoyensDePaiementScreen />);

    expect(screen.getByText('Orange Money')).toBeTruthy();
    expect(screen.getByText('0700050452')).toBeTruthy();
    expect(screen.getByText(/Bénéficiaire : AGRIM SARL/)).toBeTruthy();
    // Aucun numéro codé dans le bundle : celui-ci n'existe que dans la fixture.
    expect(screen.queryByText('0700000000')).toBeNull();
  });

  it('réaffiche le QR MARCHAND tel que publié par AGRIM', () => {
    render(<MoyensDePaiementScreen />);

    expect(screen.getByTestId('qr-marchand')).toBeTruthy();
    expect(
      screen.getByText('https://pay.orange.ci/m/AGRIM', { exact: true }),
    ).toBeTruthy();
  });

  it('sans QR publié, le dit au lieu d’afficher un carré vide', () => {
    mockMethods.data = { methods: [{ ...orange, qrPayload: null }] };
    render(<MoyensDePaiementScreen />);

    expect(screen.queryByTestId('qr-marchand')).toBeNull();
    expect(
      screen.getByText(/Le QR de ce compte n’est pas encore publié/),
    ).toBeTruthy();
    // Le numéro reste affiché : le client peut toujours payer en recopiant.
    expect(screen.getByText('0700050452')).toBeTruthy();
  });

  it('sans aucun compte publié, ne fabrique AUCUN numéro et propose l’appel', () => {
    mockMethods.data = { methods: [] };
    render(<MoyensDePaiementScreen />);

    expect(
      screen.getByText(/AGRIM n’a pas encore publié de compte marchand/),
    ).toBeTruthy();
    expect(screen.queryByTestId('qr-marchand')).toBeNull();
    expect(screen.queryByText(/NUMÉRO OFFICIEL DE RÉCEPTION/)).toBeNull();
  });

  it('copie le numéro du serveur, pas un numéro local', async () => {
    render(<MoyensDePaiementScreen />);

    fireEvent.press(screen.getByText('COPIER LE NUMÉRO'));

    await waitFor(() =>
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith('0700050452'),
    );
    await screen.findByText('NUMÉRO COPIÉ');
  });

  it('pendant le chargement, n’affiche aucun compte', () => {
    mockMethods.data = undefined;
    mockMethods.isLoading = true;
    render(<MoyensDePaiementScreen />);

    expect(screen.queryByTestId('qr-marchand')).toBeNull();
    expect(screen.queryByText('Orange Money')).toBeNull();
  });
});
