import type { Address, Product, ProductVariant } from '@agrim/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { ApiError, NetworkError } from '@/api/errors';
import { useCartStore } from '@/store/cart';

import CommandeScreen from '../../app/commande/index';

/**
 * Tunnel de commande.
 *
 * Le point le plus délicat est la clé d'idempotence : elle doit être RÉUTILISÉE
 * après un échec réseau (la commande a peut-être abouti côté serveur) mais
 * RENOUVELÉE après un rejet explicite (le panier va changer).
 */

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
    back: mockBack,
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Préfixe `mock` obligatoire : jest.mock est hissé avant les déclarations.
let mockUuidCounter = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `uuid-${++mockUuidCounter}`,
}));

const mockCreateOrder = jest.fn();
const mockAddresses = jest.fn();
jest.mock('@/api/orders', () => ({
  useAddresses: () => mockAddresses(),
  useCreateOrder: () => ({
    mutateAsync: mockCreateOrder,
    isPending: false,
  }),
}));

const address: Address = {
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
  isDefault: true,
};

const product: Product = {
  id: 'p1',
  slug: 'royal-grains',
  name: 'RIZ BOAGNI Royal Grains',
  shortDescription: null,
  description: null,
  brand: 'RIZ BOAGNI',
  imageUrl: null,
  category: { id: 'c1', slug: 'royal-grains', name: 'Royal Grains' },
  isFeatured: false,
  isActive: true,
  variants: [],
};

const variant: ProductVariant = {
  id: '22222222-2222-4222-8222-222222222222',
  sku: 'BOAGNI-ROYAL-5000',
  weightGrams: 5000,
  label: '5 kg',
  price: 6000,
  originalPrice: null,
  stock: 50,
  isAvailable: true,
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const renderScreen = () => render(<CommandeScreen />, { wrapper });

beforeEach(() => {
  jest.clearAllMocks();
  mockUuidCounter = 0;
  useCartStore.setState({ items: [], hydrated: true });
  useCartStore.getState().addItem(product, variant, 2);
  mockAddresses.mockReturnValue({
    data: [address],
    isPending: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  });
  mockCreateOrder.mockResolvedValue({
    reference: 'AGR-2026-0001',
    total: 13_000,
  });
});

it('n’envoie aucun prix au serveur', async () => {
  renderScreen();
  fireEvent.press(screen.getByText('Confirmer ma commande'));

  await waitFor(() => expect(mockCreateOrder).toHaveBeenCalled());

  const payload = mockCreateOrder.mock.calls[0]![0];
  expect(payload.items).toEqual([{ variantId: variant.id, quantity: 2 }]);
  // Aucune clé de prix ne doit figurer dans la charge utile.
  expect(JSON.stringify(payload)).not.toContain('unitPrice');
  expect(JSON.stringify(payload)).not.toContain('6000');
});

it('présélectionne l’adresse par défaut', async () => {
  renderScreen();
  fireEvent.press(screen.getByText('Confirmer ma commande'));

  await waitFor(() => expect(mockCreateOrder).toHaveBeenCalled());
  expect(mockCreateOrder.mock.calls[0]![0].addressId).toBe(address.id);
});

it('vide le panier et redirige seulement après confirmation du serveur', async () => {
  renderScreen();
  fireEvent.press(screen.getByText('Confirmer ma commande'));

  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith(
      '/commandes/AGR-2026-0001?nouvelle=1',
    ),
  );
  expect(useCartStore.getState().items).toHaveLength(0);
});

it('conserve le panier quand la commande échoue', async () => {
  mockCreateOrder.mockRejectedValue(new NetworkError('Connexion impossible.'));
  renderScreen();

  fireEvent.press(screen.getByText('Confirmer ma commande'));

  await waitFor(() =>
    expect(screen.getByText(/Connexion impossible/)).toBeTruthy(),
  );
  expect(useCartStore.getState().items).toHaveLength(1);
  expect(mockReplace).not.toHaveBeenCalled();
});

it('réutilise la clé d’idempotence après un échec réseau', async () => {
  mockCreateOrder.mockRejectedValueOnce(
    new NetworkError('Connexion impossible.'),
  );
  renderScreen();

  fireEvent.press(screen.getByText('Confirmer ma commande'));
  await waitFor(() => expect(mockCreateOrder).toHaveBeenCalledTimes(1));

  fireEvent.press(screen.getByText('Confirmer ma commande'));
  await waitFor(() => expect(mockCreateOrder).toHaveBeenCalledTimes(2));

  // Même clé : la commande peut avoir abouti côté serveur sans que la réponse
  // nous parvienne. Le rejeu ne doit pas créer de doublon.
  const first = mockCreateOrder.mock.calls[0]![0].idempotencyKey;
  const second = mockCreateOrder.mock.calls[1]![0].idempotencyKey;
  expect(second).toBe(first);
});

it('renouvelle la clé après un rejet explicite du serveur', async () => {
  mockCreateOrder.mockRejectedValueOnce(
    new ApiError({
      status: 409,
      code: 'INSUFFICIENT_STOCK',
      message: 'Stock insuffisant pour cette quantité.',
    }),
  );
  renderScreen();

  fireEvent.press(screen.getByText('Confirmer ma commande'));
  await waitFor(() => expect(mockCreateOrder).toHaveBeenCalledTimes(1));

  fireEvent.press(screen.getByText('Confirmer ma commande'));
  await waitFor(() => expect(mockCreateOrder).toHaveBeenCalledTimes(2));

  // Le serveur a tranché : rien n'a été créé, et le panier va changer.
  const first = mockCreateOrder.mock.calls[0]![0].idempotencyKey;
  const second = mockCreateOrder.mock.calls[1]![0].idempotencyKey;
  expect(second).not.toBe(first);
});

it('affiche un message lisible et jamais l’erreur technique', async () => {
  mockCreateOrder.mockRejectedValue(
    new ApiError({
      status: 409,
      code: 'INSUFFICIENT_STOCK',
      message: 'Stock insuffisant pour cette quantité.',
    }),
  );
  renderScreen();

  fireEvent.press(screen.getByText('Confirmer ma commande'));

  await waitFor(() =>
    expect(
      screen.getByText('Stock insuffisant pour cette quantité.'),
    ).toBeTruthy(),
  );
  expect(screen.queryByText(/409/)).toBeNull();
});

it('propose d’ajouter une adresse quand le carnet est vide', () => {
  mockAddresses.mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  });
  renderScreen();

  expect(screen.getByText('Ajouter une adresse')).toBeTruthy();
  // Sans adresse, la commande est impossible : on le dit au lieu de laisser
  // l'utilisateur appuyer dans le vide.
  expect(
    screen.getByText('Choisissez une adresse de livraison pour continuer.'),
  ).toBeTruthy();
});

it('n’affiche pas le tunnel avec un panier vide', () => {
  useCartStore.setState({ items: [] });
  renderScreen();

  expect(screen.getByText('Votre panier est vide')).toBeTruthy();
  expect(screen.queryByText('Confirmer ma commande')).toBeNull();
});
