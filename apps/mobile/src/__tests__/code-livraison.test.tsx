/**
 * Carte « code de livraison », côté client.
 *
 * Ce qui est verrouillé ici :
 *  - le code n'apparaît que pendant la livraison ;
 *  - il est extrait du message reçu, jamais deviné ni fabriqué ;
 *  - la consigne de ne pas le donner à l'avance est toujours affichée.
 */
import { render, screen } from '@testing-library/react-native';
import React from 'react';

const mockResend = jest.fn();
let mockNotifications: { type: string; body: string }[];

jest.mock('@/api/deliveries', () => ({
  useResendOtp: () => ({ mutate: mockResend, isPending: false }),
}));

jest.mock('@/api/notifications', () => ({
  useNotifications: () => ({
    data: { data: mockNotifications, meta: { unread: 0 } },
    isPending: false,
    refetch: jest.fn(),
  }),
}));

import { DeliveryCodeCard } from '@/components/DeliveryCodeCard';

beforeEach(() => {
  jest.clearAllMocks();
  mockNotifications = [
    {
      type: 'DELIVERY_OTP',
      body: 'Code 4821 pour la commande AGR-2026-0042. Communiquez-le au livreur à la remise, jamais avant.',
    },
  ];
});

describe('Code de livraison (client)', () => {
  it('affiche le code pendant la livraison', () => {
    render(
      <DeliveryCodeCard
        reference="AGR-2026-0042"
        orderStatus="OUT_FOR_DELIVERY"
      />,
    );

    // Affiché groupé par deux pour être dicté sans erreur.
    expect(screen.getByText('48 21')).toBeTruthy();
  });

  it('reste invisible tant que la commande n’est pas partie', () => {
    render(
      <DeliveryCodeCard reference="AGR-2026-0042" orderStatus="PREPARING" />,
    );

    expect(screen.queryByText('48 21')).toBeNull();
    expect(screen.queryByText('Votre code de livraison')).toBeNull();
  });

  it('disparaît une fois la commande livrée', () => {
    render(
      <DeliveryCodeCard reference="AGR-2026-0042" orderStatus="DELIVERED" />,
    );

    expect(screen.queryByText('Votre code de livraison')).toBeNull();
  });

  it('rappelle de ne pas communiquer le code à l’avance', () => {
    render(
      <DeliveryCodeCard
        reference="AGR-2026-0042"
        orderStatus="OUT_FOR_DELIVERY"
      />,
    );

    expect(screen.getByText(/uniquement à la remise/)).toBeTruthy();
    expect(screen.getByText(/jamais par téléphone/)).toBeTruthy();
  });

  it('reste utilisable quand aucun code n’est encore arrivé', () => {
    mockNotifications = [];
    render(
      <DeliveryCodeCard
        reference="AGR-2026-0042"
        orderStatus="OUT_FOR_DELIVERY"
      />,
    );

    expect(screen.getByText(/apparaîtra ici/)).toBeTruthy();
    expect(screen.getByText('Je n’ai pas reçu mon code')).toBeTruthy();
  });

  it('énonce le code chiffre par chiffre pour les lecteurs d’écran', () => {
    render(
      <DeliveryCodeCard
        reference="AGR-2026-0042"
        orderStatus="OUT_FOR_DELIVERY"
      />,
    );

    // « 4821 » lu d'un bloc serait annoncé « quatre mille huit cent vingt et un ».
    expect(
      screen.getByLabelText('Votre code de livraison est 4 8 2 1'),
    ).toBeTruthy();
  });

  it('ignore un message d’un autre type', () => {
    mockNotifications = [
      { type: 'ORDER_CONFIRMED', body: 'Commande AGR-2026-0042 confirmée.' },
    ];
    render(
      <DeliveryCodeCard
        reference="AGR-2026-0042"
        orderStatus="OUT_FOR_DELIVERY"
      />,
    );

    expect(screen.getByText(/apparaîtra ici/)).toBeTruthy();
  });
});
