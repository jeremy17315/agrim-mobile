/**
 * Carte « code de livraison », côté client.
 *
 * Ce qui est verrouillé ici :
 *  - le code n'apparaît que pendant la livraison ;
 *  - il vient du serveur, qui seul peut le déchiffrer, et n'est jamais lu
 *    dans une notification (le corps du message ne le contient plus) ;
 *  - la consigne de ne pas le donner à l'avance est toujours affichée.
 */
import { render, screen } from '@testing-library/react-native';
import React from 'react';

const mockResend = jest.fn();
const mockRefetch = jest.fn();
const mockUseDeliveryCode = jest.fn();

jest.mock('@/api/deliveries', () => ({
  useResendOtp: () => ({ mutate: mockResend, isPending: false }),
  useDeliveryCode: (reference: string, enabled: boolean) =>
    mockUseDeliveryCode(reference, enabled),
}));

import { DeliveryCodeCard } from '@/components/DeliveryCodeCard';

const codeState = (code: string | null, isPending = false) => ({
  data: code === null && isPending ? undefined : { code, expiresAt: null },
  isPending,
  refetch: mockRefetch,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseDeliveryCode.mockReturnValue(codeState('4821'));
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

  it('ne demande pas le code au serveur hors livraison', () => {
    // La requête est désactivée : inutile de faire déchiffrer un secret pour
    // un écran qui ne l'affichera pas.
    render(
      <DeliveryCodeCard reference="AGR-2026-0042" orderStatus="PREPARING" />,
    );

    expect(mockUseDeliveryCode).toHaveBeenCalledWith('AGR-2026-0042', false);
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
    mockUseDeliveryCode.mockReturnValue(codeState(null));
    render(
      <DeliveryCodeCard
        reference="AGR-2026-0042"
        orderStatus="OUT_FOR_DELIVERY"
      />,
    );

    expect(screen.getByText(/apparaîtra ici/)).toBeTruthy();
    expect(screen.getByText('Je n’ai pas reçu mon code')).toBeTruthy();
  });

  it('annonce le chargement plutôt qu’une absence de code', () => {
    mockUseDeliveryCode.mockReturnValue(codeState(null, true));
    render(
      <DeliveryCodeCard
        reference="AGR-2026-0042"
        orderStatus="OUT_FOR_DELIVERY"
      />,
    );

    expect(screen.getByText(/Chargement/)).toBeTruthy();
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
});
