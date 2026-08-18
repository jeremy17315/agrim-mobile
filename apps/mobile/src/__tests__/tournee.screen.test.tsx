/**
 * Écrans livreur.
 *
 * Ce qui est verrouillé ici :
 *  - le bouton de validation reste inactif tant qu'aucune preuve n'est
 *    enregistrée (le serveur l'impose, l'interface ne doit pas le suggérer) ;
 *  - une signature sans nom de réceptionnaire est refusée avant tout envoi ;
 *  - la validation passe par une confirmation explicite ;
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

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///photo.jpg', mimeType: 'image/jpeg' }],
  })),
}));

const mockStatusMutate = jest.fn();
const mockProofMutateAsync = jest.fn(async () => undefined);
const mockUpload = jest.fn(async () => ({ id: 'f1' }));

let mockDelivery: Record<string, unknown>;

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
  useSubmitProof: () => ({
    mutateAsync: mockProofMutateAsync,
    isPending: false,
  }),
  uploadProofFile: (...args: unknown[]) => mockUpload(...(args as [])),
  // Suivi GPS : le hook est appelé par l'écran, sans intérêt ici.
  usePushLocations: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeliveryTracking: () => ({ data: null, isPending: false }),
}));

import CourseScreen from '../../app/tournee/[id]';

/** Course type, personnalisable par test. */
const buildDelivery = (overrides: Record<string, unknown> = {}) => ({
  id: 'd1',
  status: 'IN_TRANSIT',
  assignedAt: '2026-08-18T08:00:00.000Z',
  acceptedAt: '2026-08-18T08:05:00.000Z',
  pickedUpAt: '2026-08-18T08:20:00.000Z',
  deliveredAt: null,
  failureReason: null,
  proofMethods: [],
  proofReceivedBy: null,
  proofSubmittedAt: null,
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
});

describe('Écran de course', () => {
  it('affiche la référence, l’adresse et le colis', () => {
    render(<CourseScreen />);

    expect(screen.getByText('AGR-2026-0042')).toBeTruthy();
    expect(screen.getByText(/En face de la pharmacie/)).toBeTruthy();
    expect(screen.getByText(/Royal Grains/)).toBeTruthy();
  });

  it('propose d’accepter une course affectée', () => {
    mockDelivery = buildDelivery({ status: 'ASSIGNED' });
    render(<CourseScreen />);

    fireEvent.press(screen.getByText('Accepter la course'));
    expect(mockStatusMutate).toHaveBeenCalledWith({ status: 'ACCEPTED' });
  });

  it('propose de récupérer le colis une fois la course acceptée', () => {
    mockDelivery = buildDelivery({ status: 'ACCEPTED' });
    render(<CourseScreen />);

    fireEvent.press(screen.getByText('J’ai récupéré le colis'));
    expect(mockStatusMutate).toHaveBeenCalledWith({ status: 'PICKED_UP' });
  });

  it('n’affiche pas la preuve avant la récupération du colis', () => {
    mockDelivery = buildDelivery({ status: 'ACCEPTED' });
    render(<CourseScreen />);

    expect(screen.queryByText('Preuve de livraison')).toBeNull();
  });

  it('désactive la validation tant qu’aucune preuve n’est enregistrée', () => {
    render(<CourseScreen />);

    const button = screen.getByLabelText('Valider la livraison');
    expect(button.props.accessibilityState.disabled).toBe(true);
  });

  it('active la validation une fois la preuve enregistrée', () => {
    mockDelivery = buildDelivery({
      proofSubmittedAt: '2026-08-18T09:00:00.000Z',
      proofMethods: ['SIGNATURE'],
      proofReceivedBy: 'Awa Koné',
    });
    render(<CourseScreen />);

    const button = screen.getByLabelText('Valider la livraison');
    expect(button.props.accessibilityState.disabled).toBe(false);
    expect(screen.getByText(/Preuve enregistrée/)).toBeTruthy();
  });

  it('exige une confirmation avant de valider la livraison', () => {
    const alertSpy = jest
      .spyOn(require('react-native').Alert, 'alert')
      .mockImplementation(() => undefined);

    mockDelivery = buildDelivery({
      proofSubmittedAt: '2026-08-18T09:00:00.000Z',
    });
    render(<CourseScreen />);

    fireEvent.press(screen.getByLabelText('Valider la livraison'));

    // Rien n'est envoyé tant que le livreur n'a pas confirmé.
    expect(mockStatusMutate).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('refuse une signature sans nom de réceptionnaire', () => {
    render(<CourseScreen />);

    // La signature est proposée par défaut, la surface est vide.
    expect(screen.getByText('La signature est vide.')).toBeTruthy();
    const save = screen.getByLabelText('Enregistrer la preuve');
    expect(save.props.accessibilityState.disabled).toBe(true);
    expect(mockProofMutateAsync).not.toHaveBeenCalled();
  });

  it('bloque l’envoi si aucune méthode n’est retenue', () => {
    render(<CourseScreen />);

    // On décoche la signature, proposée par défaut.
    fireEvent.press(screen.getByText('Signature'));

    expect(screen.getByText('Choisissez au moins une preuve.')).toBeTruthy();
  });

  it('demande une photo quand la méthode photo est retenue', () => {
    render(<CourseScreen />);

    fireEvent.press(screen.getByText('Signature')); // décoche
    fireEvent.press(screen.getByText('Photo')); // coche

    expect(screen.getByText('Prenez une photo.')).toBeTruthy();
  });

  it('exige un motif avant de déclarer un échec', async () => {
    render(<CourseScreen />);

    fireEvent.press(screen.getByLabelText('Livraison impossible'));

    await waitFor(() => {
      expect(screen.getByLabelText('Confirmer l’échec')).toBeTruthy();
    });
    const confirm = screen.getByLabelText('Confirmer l’échec');
    expect(confirm.props.accessibilityState.disabled).toBe(true);
  });

  it('affiche le résultat d’une course close sans proposer d’action', () => {
    mockDelivery = buildDelivery({
      status: 'FAILED',
      failureReason: 'Client absent après deux appels',
    });
    render(<CourseScreen />);

    expect(screen.getByText('Client absent après deux appels')).toBeTruthy();
    expect(screen.queryByLabelText('Valider la livraison')).toBeNull();
    expect(screen.queryByText('Preuve de livraison')).toBeNull();
  });
});
