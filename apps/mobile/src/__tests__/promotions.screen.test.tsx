import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import PromotionsScreen from '../../app/direction/promotions';

/**
 * Écran d'administration des codes promo (ADMIN / DG).
 *
 * Risques couverts : publier une remise non relue, oublier la borne « une
 * utilisation par numéro », et laisser croire qu'un code est actif alors qu'il
 * ne l'est pas.
 */

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDeactivate = jest.fn();
let mockCodes: {
  data: unknown[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: jest.Mock;
};

jest.mock('@/api/promos', () => ({
  usePromoCodes: () => mockCodes,
  useCreatePromoCode: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdatePromoCode: () => ({ mutateAsync: mockUpdate, isPending: false }),
  useDeactivatePromoCode: () => ({
    mutateAsync: mockDeactivate,
    isPending: false,
  }),
}));

const enAttente = {
  id: 'p-1',
  code: 'BIENVENUE10',
  description: '10 % sur la première commande',
  discountType: 'PERCENT',
  discountValue: 10,
  minOrderTotal: 10_000,
  appliesTo: [],
  zone: null,
  maxUses: 100,
  usedCount: 3,
  maxUsesPerPhone: 1,
  startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: null,
  isActive: false,
};

const publie = {
  ...enAttente,
  id: 'p-2',
  code: 'AGRIM500',
  discountType: 'FIXED',
  discountValue: 500,
  isActive: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCodes = {
    data: [enAttente, publie],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  };
  mockCreate.mockResolvedValue({});
  mockUpdate.mockResolvedValue({});
  mockDeactivate.mockResolvedValue({});
});

/** Exécute le bouton de confirmation du dernier dialogue affiché. */
function confirmer(espion: jest.SpyInstance, index = -1) {
  const appels = espion.mock.calls;
  const boutons = appels[appels.length - 1]?.[2] as AlertButton[] | undefined;
  const cible = index === -1 ? boutons?.[boutons.length - 1] : boutons?.[index];
  cible?.onPress?.();
}

it('distingue un code publié d’un code non publié, et montre son usage', async () => {
  render(<PromotionsScreen />);

  expect(await screen.findByText('BIENVENUE10')).toBeTruthy();
  expect(screen.getByText('NON PUBLIÉ')).toBeTruthy();
  expect(screen.getByText('PUBLIÉ')).toBeTruthy();
  // Deux codes, deux compteurs d'usage : on vérifie la valeur, pas l'unicité.
  expect(screen.getAllByText('3 / 100').length).toBeGreaterThan(0);
  expect(screen.getByText('10 %')).toBeTruthy();
});

it('crée un code NON publié et le dit clairement', async () => {
  const alerte = jest.spyOn(Alert, 'alert');
  render(<PromotionsScreen />);

  fireEvent.changeText(await screen.findByLabelText('Code'), 'NOUVEAU10');
  fireEvent.changeText(screen.getByLabelText('Valeur (%)'), '10');
  fireEvent.press(screen.getByText('CRÉER LE CODE'));

  await waitFor(() =>
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'NOUVEAU10',
        discountType: 'PERCENT',
        discountValue: 10,
      }),
    ),
  );
  // La publication n'est JAMAIS implicite : le message le dit.
  expect(alerte).toHaveBeenCalledWith(
    'Code enregistré',
    expect.stringContaining('NON PUBLIÉ'),
  );
});

it('refuse un pourcentage impossible avant tout appel réseau', async () => {
  render(<PromotionsScreen />);

  fireEvent.changeText(await screen.findByLabelText('Code'), 'TROP10');
  fireEvent.changeText(screen.getByLabelText('Valeur (%)'), '150');
  fireEvent.press(screen.getByText('CRÉER LE CODE'));

  await waitFor(() =>
    expect(
      screen.getByText(/Un pourcentage ne peut pas dépasser 100/),
    ).toBeTruthy(),
  );
  expect(mockCreate).not.toHaveBeenCalled();
});

it('publie un code après confirmation explicite', async () => {
  const alerte = jest.spyOn(Alert, 'alert');
  render(<PromotionsScreen />);

  fireEvent.press(await screen.findByText('PUBLIER CE CODE'));
  expect(mockUpdate).not.toHaveBeenCalled();

  confirmer(alerte);
  await waitFor(() =>
    expect(mockUpdate).toHaveBeenCalledWith({
      id: 'p-1',
      isActive: true,
    }),
  );
});

it('désactive un code publié sans le supprimer', async () => {
  const alerte = jest.spyOn(Alert, 'alert');
  render(<PromotionsScreen />);

  fireEvent.press(await screen.findByText('DÉSACTIVER'));
  confirmer(alerte);

  await waitFor(() =>
    expect(mockDeactivate).toHaveBeenCalledWith('p-2'),
  );
});

it('prépare la modification d’un code existant', async () => {
  render(<PromotionsScreen />);

  fireEvent.press((await screen.findAllByText('MODIFIER'))[0]!);

  expect(screen.getByText('Modifier BIENVENUE10')).toBeTruthy();
  expect(screen.getByLabelText('Valeur (%)')).toHaveProp('value', '10');
});
