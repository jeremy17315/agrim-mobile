import type { Product, ProductVariant } from '@agrim/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useCartStore } from '@/store/cart';
import GuestCheckoutScreen from '../../app/commande/guest';

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCreateGuestOrder = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `00000000-0000-4000-8000-00000000000${++mockUuid}` }));

jest.mock('@/api/orders', () => ({
  usePickupPoints: () => ({
    data: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'AGRIM Yamoussoukro Centre',
        city: 'Yamoussoukro',
        address: 'Aboukro Extension',
        phone: '0700000001',
        isActive: true,
      },
    ],
    isPending: false,
  }),
  useCreateGuestOrder: () => ({
    mutateAsync: mockCreateGuestOrder,
    isPending: false,
  }),
}));

const product: Product = {
  id: 'p1',
  slug: 'royal-grains',
  name: 'Royal Grains',
  shortDescription: null,
  description: null,
  brand: 'AGRIM',
  imageUrl: null,
  category: { id: 'c1', slug: 'royal', name: 'Royal' },
  variants: [],
  isFeatured: false,
  isActive: true,
};

const variant: ProductVariant = {
  id: '22222222-2222-4222-8222-222222222222',
  sku: 'ROYAL-5',
  label: '5 kg',
  weightGrams: 5000,
  price: 10000,
  originalPrice: null,
  stock: 20,
  isAvailable: true,
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUuid = 0;
  useCartStore.setState({ items: [], hydrated: true });
  useCartStore.getState().addItem(product, variant, 2);
  mockCreateGuestOrder.mockResolvedValue({ reference: 'AGR-2026-0042' });
});

test('commande à domicile sans compte et frais à confirmer', async () => {
  render(<GuestCheckoutScreen />, { wrapper });

  fireEvent.changeText(screen.getByLabelText('Votre nom'), 'Awa Koné');
  fireEvent.changeText(screen.getByLabelText('Votre numéro de téléphone'), '0700000001');
  fireEvent.changeText(screen.getByLabelText('Ville / localité'), 'Yamoussoukro');
  fireEvent.press(screen.getByText('CONFIRMER LA COMMANDE'));

  await waitFor(() => expect(mockCreateGuestOrder).toHaveBeenCalled());
  expect(mockCreateGuestOrder.mock.calls[0]![0]).toMatchObject({
    customerName: 'Awa Koné',
    customerPhone: '0700000001',
    receptionMode: 'HOME_DELIVERY',
    city: 'Yamoussoukro',
  });
  // Le flux transmet la demande sans montant de livraison : il sera confirmé par AGRIM.
});

test('filtre le retrait par ville et envoie le point choisi', async () => {
  render(<GuestCheckoutScreen />, { wrapper });
  fireEvent.changeText(screen.getByLabelText('Votre nom'), 'Awa Koné');
  fireEvent.changeText(screen.getByLabelText('Votre numéro de téléphone'), '0700000001');
  fireEvent.press(screen.getByText('RETRAIT EN POINT DE VENTE'));
  fireEvent.press(screen.getByText('AGRIM Yamoussoukro Centre'));
  fireEvent.press(screen.getByText('CONFIRMER LA COMMANDE'));

  await waitFor(() => expect(mockCreateGuestOrder).toHaveBeenCalled());
  expect(mockCreateGuestOrder.mock.calls[0]![0]).toMatchObject({
    receptionMode: 'PICKUP_POINT',
    city: 'Yamoussoukro',
    pickupPointId: '11111111-1111-4111-8111-111111111111',
  });
  expect(mockReplace).toHaveBeenCalledWith('/commande/confirmation?reference=AGR-2026-0042');
});
