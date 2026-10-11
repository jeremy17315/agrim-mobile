import { fireEvent, render, screen } from '@testing-library/react-native';

import ContactScreen from '../../app/contact';

/**
 * Contact et aide.
 *
 * Ce que le test protège : aucun numéro n'est écrit dans l'écran, tout vient
 * du serveur — et un point de vente « information seulement » ne doit jamais
 * laisser croire qu'un retrait y est possible.
 */

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockCallMobileSupport = jest.fn().mockResolvedValue(undefined);
const mockCallCompany = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/contact', () => ({
  callMobileSupport: () => mockCallMobileSupport(),
  callCompany: () => mockCallCompany(),
  supportPhone: () => '+225 07 00 05 04 52',
}));

let mockConfig: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: jest.Mock;
};

jest.mock('@/api/config', () => ({
  useAppConfig: () => mockConfig,
}));

jest.mock('@/lib/network', () => ({
  useIsOnline: () => true,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig = {
    data: {
      version: 1,
      support: {
        phone: '+225 07 11 22 33 44',
        landlinePhone: '+225 27 20 36 32 83',
        whatsapp: '2250700050452',
        email: 'contact@agrim.ci',
      },
      pointsOfSale: [
        {
          id: 'pos-1',
          name: 'Boutique 227 Logement',
          address: '227 Logement, avenue principale',
          city: 'Yamoussoukro',
          landmark: 'En face de la pharmacie',
          phone: '0700000001',
          openingHours: 'Lun–Sam 8h–18h',
          latitude: null,
          longitude: null,
          supportsPickup: true,
          isActive: true,
          sortOrder: 1,
        },
        {
          id: 'pos-2',
          name: 'Usine Aboukro',
          address: 'Aboukro Extension',
          city: 'Yamoussoukro',
          landmark: null,
          phone: null,
          openingHours: null,
          latitude: null,
          longitude: null,
          supportsPickup: false,
          isActive: true,
          sortOrder: 2,
        },
      ],
      delivery: {
        summary: 'Livraison à domicile ou retrait au point de vente.',
        delays: 'Délai annoncé par AGRIM.',
        pickupConditions: 'Présentez votre numéro de commande.',
        feeNotice: 'Aucun frais n’est payé en ligne.',
      },
      faq: [
        {
          question: 'Comment payer ma commande ?',
          answer: 'Transférez le montant vers le numéro officiel, puis déclarez.',
        },
      ],
      announcement: null,
      updatedAt: '2026-10-11T10:00:00.000Z',
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  };
});

it('affiche le numéro publié par AGRIM, jamais un numéro du bundle', async () => {
  render(<ContactScreen />);

  expect(await screen.findByText('APPELER LE +225 07 11 22 33 44')).toBeTruthy();
  expect(screen.getByText('STANDARD · +225 27 20 36 32 83')).toBeTruthy();
  expect(screen.getByText('ÉCRIRE SUR WHATSAPP')).toBeTruthy();
  expect(screen.getByText('ÉCRIRE À contact@agrim.ci')).toBeTruthy();

  fireEvent.press(screen.getByText('APPELER LE +225 07 11 22 33 44'));
  expect(mockCallMobileSupport).toHaveBeenCalledTimes(1);
});

it('distingue le retrait possible de la simple information', async () => {
  render(<ContactScreen />);

  expect(await screen.findByText('Boutique 227 Logement')).toBeTruthy();
  expect(screen.getByText('RETRAIT POSSIBLE')).toBeTruthy();
  expect(screen.getByText('INFORMATION')).toBeTruthy();
});

it('publie les questions fréquentes et la règle de frais', async () => {
  render(<ContactScreen />);

  expect(
    await screen.findByText('Comment payer ma commande ?'),
  ).toBeTruthy();
  expect(screen.getByText(/Aucun frais n’est payé en ligne/)).toBeTruthy();
  expect(
    screen.getByText(/AGRIM ne vous demandera jamais votre code secret/),
  ).toBeTruthy();
});

it('ne prétend pas connaître de point de vente quand il n’y en a aucun', async () => {
  mockConfig.data = {
    ...(mockConfig.data as Record<string, unknown>),
    pointsOfSale: [],
  };
  render(<ContactScreen />);

  expect(
    await screen.findByText(/n’a pas encore publié de point de vente/),
  ).toBeTruthy();
});
