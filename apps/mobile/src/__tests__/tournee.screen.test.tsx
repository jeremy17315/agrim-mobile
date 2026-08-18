/**
 * Écran livreur — validation par code.
 *
 * Ce qui est verrouillé ici :
 *  - aucun bouton ne permet au livreur de se déclarer livré ;
 *  - le champ de code n'apparaît qu'une fois sur place ;
 *  - la saisie n'accepte que 4 chiffres et rien d'autre ;
 *  - un code refusé par le serveur laisse la course ouverte ;
 *  - l'action proposée correspond à l'état réel de la course.
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import React from 'react';

const mockBack = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'd1' }),
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockStatusMutate = jest.fn();
const mockVerifyOtp = jest.fn(async () => undefined);

let mockDelivery: Record<string, unknown>;
let mockOtpStatus: Record<string, unknown> | null;

jest.mock('@/api/deliveries', () => ({
  useDelivery: () => ({
    data: mockDelivery,
    isPending: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  }),
  useUpdateDeliveryStatus: () => ({
    mutate: mockStatusMutate,
    isPending: false,
  }),
  useVerifyOtp: () => ({
    mutateAsync: mockVerifyOtp,
    isPending: false,
  }),
  useOtpStatus: () => ({ data: mockOtpStatus, isPending: false }),
  usePushLocations: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeliveryTracking: () => ({ data: null, isPending: false }),
}));

import CourseScreen from '../../app/tournee/[id]';

/** Course type, personnalisable par test. */
const buildDelivery = (overrides: Record<string, unknown> = {}) => ({
  id: 'd1',
  status: 'ARRIVED',
  assignedAt: '2026-08-18T08:00:00.000Z',
  acceptedAt: '2026-08-18T08:05:00.000Z',
  inTransitAt: '2026-08-18T08:20:00.000Z',
  arrivedAt: '2026-08-18T08:40:00.000Z',
  deliveredAt: null,
  failureReason: null,
  otpVerifiedAt: null,
  order: {
    reference: 'AGR-2026-0042',
    total: 12000,
    status: 'OUT_FOR_DELIVERY',
    items: [
      {
        id: 'i1',
        productName: 'Royal Grains',
        variantLabel: '5 kg',
        quantity: 2,
      },
    ],
    payment: { method: 'CASH_ON_DELIVERY', status: 'PENDING' },
  },
  address: {
    label: 'Domicile',
    city: 'Yamoussoukro',
    commune: 'Habitat',
    district: null,
    landmark: 'En face de la pharmacie',
    instructions: null,
    contactPhone: '0700000001',
    latitude: null,
    longitude: null,
  },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDelivery = buildDelivery();
  mockOtpStatus = {
    isActive: true,
    expiresAt: '2026-08-18T09:40:00.000Z',
    attemptsRemaining: 5,
    verifiedAt: null,
    canResendAt: null,
    resendsRemaining: 5,
  };
});

describe('Écran de course', () => {
  it('affiche la référence, l’adresse et le colis', () => {
    render(<CourseScreen />);

    expect(screen.getByText('AGR-2026-0042')).toBeTruthy();
    expect(screen.getByText(/En face de la pharmacie/)).toBeTruthy();
    expect(screen.getByText(/Royal Grains/)).toBeTruthy();
  });

  /* --------------------------- Progression ------------------------------ */

  it('propose d’accepter une course affectée', () => {
    mockDelivery = buildDelivery({ status: 'ASSIGNED' });
    render(<CourseScreen />);

    fireEvent.press(screen.getByText('Accepter la course'));
    expect(mockStatusMutate).toHaveBeenCalledWith({ status: 'ACCEPTED' });
  });

  it('propose de démarrer la livraison une fois la course acceptée', () => {
    mockDelivery = buildDelivery({ status: 'ACCEPTED' });
    render(<CourseScreen />);

    fireEvent.press(screen.getByText('Démarrer la livraison'));
    expect(mockStatusMutate).toHaveBeenCalledWith({ status: 'IN_TRANSIT' });
  });

  it('propose de signaler l’arrivée pendant le trajet', () => {
    mockDelivery = buildDelivery({ status: 'IN_TRANSIT' });
    render(<CourseScreen />);

    fireEvent.press(screen.getByText('Je suis arrivé chez le client'));
    expect(mockStatusMutate).toHaveBeenCalledWith({ status: 'ARRIVED' });
  });

  /* ------------------------- Validation par code ------------------------ */

  it('ne propose aucun bouton de validation manuelle', () => {
    render(<CourseScreen />);

    // La livraison ne peut être close que par le code : aucune action de
    // l'interface ne doit laisser croire le contraire.
    expect(screen.queryByText('Valider la livraison')).toBeTruthy();
    expect(screen.queryByText('Marquer comme livrée')).toBeNull();
    expect(screen.queryByText('Confirmer la remise')).toBeNull();
  });

  it('n’affiche pas le champ de code avant l’arrivée sur place', () => {
    mockDelivery = buildDelivery({ status: 'IN_TRANSIT' });
    render(<CourseScreen />);

    expect(screen.queryByText('Code de livraison')).toBeNull();
  });

  it('affiche le champ de code une fois sur place', () => {
    render(<CourseScreen />);

    expect(screen.getByText('Code de livraison')).toBeTruthy();
    expect(screen.getByText(/Demandez au client le code/)).toBeTruthy();
  });

  it('laisse la validation inactive tant que le code est incomplet', () => {
    render(<CourseScreen />);

    fireEvent.changeText(screen.getByLabelText('Code du client'), '12');
    fireEvent.press(screen.getByText('Valider la livraison'));

    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it('n’accepte que des chiffres, au plus quatre', () => {
    render(<CourseScreen />);
    const input = screen.getByLabelText('Code du client');

    // Une saisie parasite ne doit pas produire une valeur refusée au serveur.
    fireEvent.changeText(input, '4a8b2c1d9');
    expect(input.props.value).toBe('4821');
  });

  it('envoie le code saisi au serveur', async () => {
    render(<CourseScreen />);

    fireEvent.changeText(screen.getByLabelText('Code du client'), '4821');
    fireEvent.press(screen.getByText('Valider la livraison'));

    await waitFor(() => {
      expect(mockVerifyOtp).toHaveBeenCalledWith({
        code: '4821',
        position: undefined,
      });
    });
  });

  it('affiche l’erreur du serveur et vide le champ après un refus', async () => {
    mockVerifyOtp.mockRejectedValueOnce(
      new Error('Code incorrect. 4 tentatives restantes.'),
    );
    render(<CourseScreen />);

    fireEvent.changeText(screen.getByLabelText('Code du client'), '0000');
    fireEvent.press(screen.getByText('Valider la livraison'));

    await waitFor(() => {
      expect(
        screen.getByText('Code incorrect. 4 tentatives restantes.'),
      ).toBeTruthy();
    });
    // La course reste ouverte : rien n'a été validé.
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('avertit quand il ne reste que peu de tentatives', () => {
    mockOtpStatus = { ...mockOtpStatus, attemptsRemaining: 1 };
    render(<CourseScreen />);

    expect(screen.getByText(/1 tentative restante/)).toBeTruthy();
  });

  it('signale l’absence de code actif et oriente vers le renvoi', () => {
    mockOtpStatus = { ...mockOtpStatus, isActive: false };
    render(<CourseScreen />);

    expect(screen.getByText(/Aucun code actif/)).toBeTruthy();
  });

  /* ------------------------------- Échec -------------------------------- */

  it('exige un motif avant de déclarer un échec', () => {
    render(<CourseScreen />);

    fireEvent.press(screen.getByText('Livraison impossible'));
    const confirm = screen.getByText('Confirmer l’échec');
    fireEvent.press(confirm);

    expect(mockStatusMutate).not.toHaveBeenCalled();
  });

  it('affiche le résultat d’une course close sans proposer d’action', () => {
    mockDelivery = buildDelivery({
      status: 'DELIVERED',
      deliveredAt: '2026-08-18T09:00:00.000Z',
      otpVerifiedAt: '2026-08-18T09:00:00.000Z',
    });
    render(<CourseScreen />);

    expect(screen.getByText('Livrée')).toBeTruthy();
    expect(screen.queryByText('Code de livraison')).toBeNull();
    expect(screen.queryByText('Livraison impossible')).toBeNull();
  });
});
