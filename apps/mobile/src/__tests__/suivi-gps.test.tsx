/**
 * Carte de suivi temps réel (client) et cadrage cartographique.
 *
 * Ce qui est verrouillé ici :
 *  - aucune interrogation réseau hors livraison en cours ;
 *  - une position périmée est annoncée, jamais affichée comme fiable ;
 *  - l'estimation est présentée comme indicative ;
 *  - le cadrage englobe livreur et destination sans zoom aberrant.
 */
import { render, screen } from '@testing-library/react-native';
import React from 'react';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockUseTracking = jest.fn();

jest.mock('@/api/deliveries', () => ({
  useDeliveryTracking: (...args: unknown[]) => mockUseTracking(...args),
}));

import { LiveTrackingCard } from '../components/LiveTrackingCard';
import { boundsOf } from '../components/map';

const buildTracking = (overrides: Record<string, unknown> = {}) => ({
  deliveryId: '11111111-1111-4111-8111-111111111111',
  orderReference: 'AGR-2026-0042',
  status: 'IN_TRANSIT',
  currentPosition: {
    latitude: 6.8366,
    longitude: -5.2893,
    accuracy: 12,
    heading: 180,
    speed: 6,
    recordedAt: new Date().toISOString(),
  },
  destination: {
    latitude: 6.8276,
    longitude: -5.2893,
    landmark: 'Près du marché',
  },
  remainingMeters: 1000,
  etaSeconds: 164,
  estimatedArrivalAt: new Date(Date.now() + 164_000).toISOString(),
  lastUpdateAt: new Date().toISOString(),
  isLive: true,
  courier: { firstName: 'Konan', contactPhone: null, vehicleType: null },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseTracking.mockReturnValue({
    data: buildTracking(),
    isPending: false,
  });
});

describe('Carte de suivi client', () => {
  it('n’affiche rien tant que la commande n’est pas en livraison', () => {
    const { toJSON } = render(
      <LiveTrackingCard reference="AGR-2026-0042" orderStatus="PREPARING" />,
    );

    expect(toJSON()).toBeNull();
  });

  it('n’interroge pas le réseau hors livraison en cours', () => {
    render(
      <LiveTrackingCard reference="AGR-2026-0042" orderStatus="CONFIRMED" />,
    );

    // Le second argument commande l'activation de la requête.
    expect(mockUseTracking).toHaveBeenCalledWith('AGR-2026-0042', false);
  });

  it('active le suivi pendant la livraison', () => {
    render(
      <LiveTrackingCard
        reference="AGR-2026-0042"
        orderStatus="OUT_FOR_DELIVERY"
      />,
    );

    expect(mockUseTracking).toHaveBeenCalledWith('AGR-2026-0042', true);
  });

  it('affiche la distance, la durée et le prénom du livreur', () => {
    render(
      <LiveTrackingCard
        reference="AGR-2026-0042"
        orderStatus="OUT_FOR_DELIVERY"
      />,
    );

    expect(screen.getByText('En direct')).toBeTruthy();
    expect(screen.getByText(/Konan/)).toBeTruthy();
    expect(screen.getByText(/1,0\s?km/)).toBeTruthy();
    expect(screen.getByText(/Environ/)).toBeTruthy();
  });

  it('présente l’estimation comme indicative', () => {
    render(
      <LiveTrackingCard
        reference="AGR-2026-0042"
        orderStatus="OUT_FOR_DELIVERY"
      />,
    );

    // L'ETA repose sur une distance à vol d'oiseau : le dire évite une
    // promesse que le produit ne peut pas tenir.
    expect(screen.getByText(/Estimation indicative/)).toBeTruthy();
  });

  it('annonce une position périmée sans afficher de distance', () => {
    mockUseTracking.mockReturnValue({
      data: buildTracking({
        isLive: false,
        remainingMeters: null,
        etaSeconds: null,
      }),
      isPending: false,
    });

    render(
      <LiveTrackingCard
        reference="AGR-2026-0042"
        orderStatus="OUT_FOR_DELIVERY"
      />,
    );

    expect(screen.getByText('Position indisponible')).toBeTruthy();
    expect(screen.queryByText(/1,0\s?km/)).toBeNull();
  });

  it('signale l’attente de position tout en affichant la destination', () => {
    mockUseTracking.mockReturnValue({
      data: buildTracking({
        currentPosition: null,
        isLive: false,
        remainingMeters: null,
        etaSeconds: null,
        lastUpdateAt: null,
      }),
      isPending: false,
    });

    render(
      <LiveTrackingCard
        reference="AGR-2026-0042"
        orderStatus="OUT_FOR_DELIVERY"
      />,
    );

    // La carte reste affichée (destination connue), mais l'absence de position
    // du livreur doit être dite explicitement.
    expect(screen.getByText('Position indisponible')).toBeTruthy();
    expect(screen.getByText(/Position du livreur en attente/)).toBeTruthy();
  });
});

describe('Cadrage cartographique', () => {
  it('englobe les deux points', () => {
    const viewport = boundsOf([
      { latitude: 6.8366, longitude: -5.2893 },
      { latitude: 6.8276, longitude: -5.2893 },
    ]);

    expect(viewport).not.toBeNull();
    expect(viewport!.center.latitude).toBeCloseTo(6.8321, 4);
  });

  it('impose un zoom plancher pour deux points confondus', () => {
    const p = { latitude: 6.8276, longitude: -5.2893 };
    const viewport = boundsOf([p, p]);

    // Sans plancher, le delta serait nul et le zoom absurde.
    expect(viewport!.latitudeDelta).toBeGreaterThanOrEqual(0.01);
    expect(viewport!.longitudeDelta).toBeGreaterThanOrEqual(0.01);
  });

  it('renvoie null sans point', () => {
    expect(boundsOf([])).toBeNull();
  });
});
