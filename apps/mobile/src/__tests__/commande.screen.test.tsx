import type { Product, ProductVariant } from '@agrim/contracts';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { ApiError, NetworkError } from '@/api/errors';
import { useCartStore } from '@/store/cart';

import CommandeScreen from '../../app/commande/index';

/**
 * Checkout invité : seuls nom, téléphone et zone sont nécessaires. Le test
 * protège le point essentiel de la simplification : aucune adresse enregistrée
 * et aucun compte ne doivent s'intercaler avant la commande.
 */
const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: mockBack }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

let mockUuidCounter = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () =>
    `00000000-0000-4000-8000-${String(++mockUuidCounter).padStart(12, '0')}`,
}));

const mockCreateGuestOrder = jest.fn();
jest.mock('@/api/orders', () => ({
  useCreateGuestOrder: () => ({
    mutateAsync: mockCreateGuestOrder,
    isPending: false,
  }),
  useGuestCartQuote: () => ({
    mutateAsync: jest.fn(),
    data: undefined,
  }),
}));

const mockSaveGuestPaymentAccess = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/guestPayment', () => ({
  // La fonction enveloppe garde la référence du mock après l'initialisation
  // des modules Jest (le checkout l'importe au chargement de l'écran).
  saveGuestPaymentAccess: (...args: [string, string]) =>
    mockSaveGuestPaymentAccess(...args),
}));

const product: Product = {
  id: 'p1',
  slug: 'royal-grains',
  name: 'Bélier d’Or Royal Grains',
  shortDescription: null,
  description: null,
  brand: 'Bélier d’Or',
  imageUrl: null,
  category: { id: 'c1', slug: 'royal-grains', name: 'Royal Grains' },
  isFeatured: false,
  isActive: true,
  variants: [],
};

const variant: ProductVariant = {
  id: '22222222-2222-4222-8222-222222222222',
  sku: 'BELIER-ROYAL-5000',
  weightGrams: 5000,
  label: '5 kg',
  price: 6000,
  originalPrice: null,
  stock: 50,
  isAvailable: true,
};

const fillDelivery = () => {
  fireEvent.changeText(screen.getByLabelText('Nom'), 'Awa Koné');
  fireEvent.changeText(
    screen.getByLabelText('Numéro de téléphone'),
    '07 00 00 00 01',
  );
  fireEvent.changeText(
    screen.getByLabelText('Zone / lieu de livraison'),
    'Cocody Angré, près de la pharmacie',
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUuidCounter = 0;
  useCartStore.setState({ items: [], hydrated: true });
  useCartStore.getState().addItem(product, variant, 2);
  mockCreateGuestOrder.mockResolvedValue({ reference: 'AGR-2026-0001' });
});

it('commande sans compte, adresse enregistrée ni prix envoyé par le client', async () => {
  render(<CommandeScreen />);
  fillDelivery();
  fireEvent.press(screen.getByText('CONFIRMER LA COMMANDE'));

  await waitFor(() => expect(mockCreateGuestOrder).toHaveBeenCalled());
  const payload = mockCreateGuestOrder.mock.calls[0]![0];

  expect(payload).toMatchObject({
    customerName: 'Awa Koné',
    phone: '0700000001',
    deliveryLocation: 'Cocody Angré, près de la pharmacie',
    items: [{ variantId: variant.id, quantity: 2 }],
  });
  expect(JSON.stringify(payload)).not.toContain('addressId');
  expect(JSON.stringify(payload)).not.toContain('unitPrice');
  expect(JSON.stringify(payload)).not.toContain('password');
});

it('transmet le choix Mobile Money et rejoint le paiement invité sécurisé', async () => {
  mockCreateGuestOrder.mockResolvedValueOnce({
    reference: 'AGR-2026-0002',
    paymentAccessToken: 'capabilite-invitee-de-paiement-valide',
  });
  render(<CommandeScreen />);
  fireEvent.press(screen.getByLabelText('Payer maintenant par Mobile Money'));
  fillDelivery();
  fireEvent.press(screen.getByText('CONTINUER VERS LE PAIEMENT'));

  await waitFor(() => expect(mockCreateGuestOrder).toHaveBeenCalled());
  expect(mockCreateGuestOrder.mock.calls[0]![0]).toMatchObject({
    paymentMethod: 'MOBILE_MONEY',
    mobileMoneyProvider: 'ORANGE_MONEY',
  });
  await waitFor(() =>
    expect(mockSaveGuestPaymentAccess).toHaveBeenCalledWith(
      'AGR-2026-0002',
      'capabilite-invitee-de-paiement-valide',
    ),
  );
  expect(mockReplace).toHaveBeenCalledWith('/paiement/AGR-2026-0002');
});

it('vide le panier et affiche la confirmation après la réponse serveur', async () => {
  render(<CommandeScreen />);
  fillDelivery();
  fireEvent.press(screen.getByText('CONFIRMER LA COMMANDE'));

  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith(
      '/confirmation/AGR-2026-0001?payment=CASH_ON_DELIVERY',
    ),
  );
  expect(useCartStore.getState().items).toHaveLength(0);
});

it('demande seulement les trois informations de livraison, sans adresse enregistrée', () => {
  render(<CommandeScreen />);

  expect(screen.getByLabelText('Nom')).toBeTruthy();
  expect(screen.getByLabelText('Numéro de téléphone')).toBeTruthy();
  expect(screen.getByLabelText('Zone / lieu de livraison')).toBeTruthy();
  expect(screen.queryByText(/Ajouter une adresse/i)).toBeNull();
  expect(screen.getByText(/Mobile Money/i)).toBeTruthy();
});

it('conserve le panier et la clé d’idempotence après une coupure réseau', async () => {
  mockCreateGuestOrder.mockRejectedValueOnce(
    new NetworkError('Connexion impossible.'),
  );
  render(<CommandeScreen />);
  fillDelivery();

  fireEvent.press(screen.getByText('CONFIRMER LA COMMANDE'));
  await waitFor(() => expect(mockCreateGuestOrder).toHaveBeenCalledTimes(1));
  expect(useCartStore.getState().items).toHaveLength(1);

  fireEvent.press(screen.getByText('CONFIRMER LA COMMANDE'));
  await waitFor(() => expect(mockCreateGuestOrder).toHaveBeenCalledTimes(2));

  expect(mockCreateGuestOrder.mock.calls[1]![0].idempotencyKey).toBe(
    mockCreateGuestOrder.mock.calls[0]![0].idempotencyKey,
  );
});

it('renouvelle la clé après un refus métier explicite', async () => {
  mockCreateGuestOrder.mockRejectedValueOnce(
    new ApiError({
      status: 409,
      code: 'INSUFFICIENT_STOCK',
      message: 'Stock insuffisant pour cette quantité.',
    }),
  );
  render(<CommandeScreen />);
  fillDelivery();

  fireEvent.press(screen.getByText('CONFIRMER LA COMMANDE'));
  await waitFor(() => expect(mockCreateGuestOrder).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByText('CONFIRMER LA COMMANDE'));
  await waitFor(() => expect(mockCreateGuestOrder).toHaveBeenCalledTimes(2));

  expect(mockCreateGuestOrder.mock.calls[1]![0].idempotencyKey).not.toBe(
    mockCreateGuestOrder.mock.calls[0]![0].idempotencyKey,
  );
});

it('n’affiche pas le formulaire avec un panier vide', () => {
  useCartStore.setState({ items: [] });
  render(<CommandeScreen />);

  expect(screen.getByText('Votre panier est vide')).toBeTruthy();
  expect(screen.queryByText('CONFIRMER LA COMMANDE')).toBeNull();
});
