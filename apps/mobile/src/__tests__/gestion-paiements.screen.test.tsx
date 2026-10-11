import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import GestionPaiementsScreen from '../../app/gestion/paiements';

/**
 * File de vérification des paiements par transfert direct.
 *
 * Risques couverts : confirmer un montant sans avoir remarqué l'écart,
 * rejeter sans dire pourquoi (le client ne comprendrait pas), et confirmer
 * deux fois un dossier déjà réglé.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/api/client', () => ({
  API_BASE_URL: '/api/v1',
  currentAccessToken: () => 'jeton-de-test',
}));

const mockReview = jest.fn();
let mockDeclarations: {
  data: { data: unknown[]; meta: unknown } | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: jest.Mock;
};

jest.mock('@/api/management', () => ({
  usePaymentDeclarations: () => mockDeclarations,
  useReviewPayment: () => ({ mutate: mockReview, isPending: false }),
}));

const dossier = {
  declarationId: '11111111-1111-4111-8111-111111111111',
  orderReference: 'AGR-2026-0042',
  customerName: 'Awa Koné',
  customerPhone: '0700000001',
  expectedAmount: 18_500,
  declaredAmount: 18_500,
  paymentMethodCode: 'ORANGE_MONEY',
  receivingNumber: '0700000000',
  transactionReference: 'TX123456789',
  declaredPaidAt: null,
  submittedAt: '2026-10-11T10:30:00.000Z',
  hasProof: false,
  proofMimeType: null,
  status: 'DECLARED',
  amountMatches: true,
  orderStatus: 'PENDING',
  paymentStatus: 'DECLARED_BY_CUSTOMER',
  lastReview: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDeclarations = {
    data: { data: [dossier], meta: { page: 1, limit: 20, total: 1 } },
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  };
});

it('affiche tout ce qu’il faut pour décider : montants, numéro, référence', async () => {
  render(<GestionPaiementsScreen />);

  expect(await screen.findByText('AGR-2026-0042')).toBeTruthy();
  expect(screen.getByText('Awa Koné · 0700000001')).toBeTruthy();
  expect(screen.getByText('DÉCLARÉ')).toBeTruthy();

  fireEvent.press(screen.getByLabelText('Dossier AGR-2026-0042'));
  expect(screen.getByText('TX123456789')).toBeTruthy();
  expect(screen.getByText('0700000000')).toBeTruthy();
  expect(screen.getByText(/Montant attendu/)).toBeTruthy();
});

it('signale un écart de montant avant toute confirmation', async () => {
  mockDeclarations.data = {
    data: [{ ...dossier, declaredAmount: 17_000, amountMatches: false }],
    meta: { page: 1, limit: 20, total: 1 },
  };
  render(<GestionPaiementsScreen />);

  fireEvent.press(await screen.findByLabelText('Dossier AGR-2026-0042'));
  expect(
    screen.getByText(/Écart de montant : vérifiez avant de confirmer/),
  ).toBeTruthy();
});

it('refuse un rejet sans motif : le client doit comprendre', async () => {
  render(<GestionPaiementsScreen />);
  fireEvent.press(await screen.findByLabelText('Dossier AGR-2026-0042'));
  fireEvent.press(screen.getByText('REJETER LA DÉCLARATION'));

  await waitFor(() =>
    expect(
      screen.getByText(/Indiquez le motif du rejet/),
    ).toBeTruthy(),
  );
  expect(mockReview).not.toHaveBeenCalled();
});

it('confirme la réception des fonds après dialogue, avec la note saisie', async () => {
  const alerte = jest.spyOn(Alert, 'alert');
  render(<GestionPaiementsScreen />);
  fireEvent.press(await screen.findByLabelText('Dossier AGR-2026-0042'));

  fireEvent.changeText(
    screen.getByLabelText('Note / motif (obligatoire pour rejeter)'),
    'Fonds reçus sur le compte marchand.',
  );
  fireEvent.press(screen.getByText('CONFIRMER LA RÉCEPTION DES FONDS'));

  // Rien n'est confirmé avant que le gestionnaire ait validé le dialogue.
  expect(mockReview).not.toHaveBeenCalled();
  expect(alerte).toHaveBeenCalled();

  accepterLaDerniereAction(alerte);
  await waitFor(() =>
    expect(mockReview).toHaveBeenCalledWith(
      expect.objectContaining({
        declarationId: dossier.declarationId,
        decision: 'CONFIRM',
        note: 'Fonds reçus sur le compte marchand.',
      }),
      expect.any(Object),
    ),
  );
});

it('rejette avec motivation, et n’applique rien tant que le dialogue n’est pas validé', async () => {
  const alerte = jest.spyOn(Alert, 'alert');
  render(<GestionPaiementsScreen />);
  fireEvent.press(await screen.findByLabelText('Dossier AGR-2026-0042'));

  fireEvent.changeText(
    screen.getByLabelText('Note / motif (obligatoire pour rejeter)'),
    'Référence introuvable chez l’opérateur.',
  );
  fireEvent.press(screen.getByText('REJETER LA DÉCLARATION'));
  expect(mockReview).not.toHaveBeenCalled();

  accepterLaDerniereAction(alerte);
  await waitFor(() =>
    expect(mockReview).toHaveBeenCalledWith(
      expect.objectContaining({
        declarationId: dossier.declarationId,
        decision: 'REJECT',
        rejectionNote: 'Référence introuvable chez l’opérateur.',
      }),
      expect.any(Object),
    ),
  );
});

it('n’oublie pas qu’un dossier déjà réglé ne se confirme pas deux fois', async () => {
  mockDeclarations.data = {
    data: [{ ...dossier, paymentStatus: 'SUCCEEDED' }],
    meta: { page: 1, limit: 20, total: 1 },
  };
  render(<GestionPaiementsScreen />);
  fireEvent.press(await screen.findByLabelText('Dossier AGR-2026-0042'));

  const bouton = screen.getByText('CONFIRMER LA RÉCEPTION DES FONDS');
  fireEvent.press(bouton);
  expect(mockReview).not.toHaveBeenCalled();
});

/** Déclenche l'action de confirmation du dialogue déjà espionné. */
function accepterLaDerniereAction(
  alerte: jest.SpyInstance,
  index = -1,
) {
  const appels = alerte.mock.calls;
  const boutons = appels[appels.length - 1]?.[2] as AlertButton[] | undefined;
  const cible = index === -1 ? boutons?.[boutons.length - 1] : boutons?.[index];
  cible?.onPress?.();
}
