/**
 * Clôture d'exception d'une livraison, côté gestion.
 *
 * Ce qui est verrouillé ici :
 *  - rien ne part sans motif circonstancié (la règle serveur est doublée à
 *    l'écran pour éviter un aller-retour, pas pour la remplacer) ;
 *  - la conséquence est annoncée avant l'action, pas découverte après ;
 *  - une erreur serveur reste lisible et n'efface pas la saisie.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

const mockMutate = jest.fn();
let mockPending = false;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/api/management', () => ({
  useCloseDelivery: () => ({ mutate: mockMutate, isPending: mockPending }),
}));

import { ManualClosureSheet } from '@/components/ManualClosureSheet';

const MOTIF = 'Téléphone du client déchargé, colis remis en main propre';

const setup = (
  props?: Partial<React.ComponentProps<typeof ManualClosureSheet>>,
) => {
  const onClose = jest.fn();
  const onDone = jest.fn();
  render(
    <ManualClosureSheet
      reference="AGR-2026-0042"
      visible
      onClose={onClose}
      onDone={onDone}
      {...props}
    />,
  );
  return { onClose, onDone };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPending = false;
});

describe('Clôture sans code (gestion)', () => {
  it('annonce la conséquence avant l’action', () => {
    setup();

    expect(screen.getByText('Clôturer sans code')).toBeTruthy();
    expect(screen.getByText(/AGR-2026-0042/)).toBeTruthy();
    expect(
      screen.getByText(/signalée à la direction avec votre nom/),
    ).toBeTruthy();
  });

  it('refuse un motif vide', () => {
    setup();

    fireEvent.press(screen.getByText('Confirmer la clôture'));

    expect(mockMutate).not.toHaveBeenCalled();
    expect(
      screen.getByText('Décrivez la situation en une phrase.'),
    ).toBeTruthy();
  });

  it('refuse un motif trop court', () => {
    setup();

    // « ok » n'explique rien : en cas de litige, ce champ est la seule trace.
    fireEvent.changeText(screen.getByLabelText('Motif'), 'ok');
    fireEvent.press(screen.getByText('Confirmer la clôture'));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('transmet le motif saisi', () => {
    setup();

    fireEvent.changeText(screen.getByLabelText('Motif'), MOTIF);
    fireEvent.press(screen.getByText('Confirmer la clôture'));

    expect(mockMutate).toHaveBeenCalledWith(
      { reference: 'AGR-2026-0042', reason: MOTIF },
      expect.anything(),
    );
  });

  it('retire les espaces superflus du motif', () => {
    setup();

    fireEvent.changeText(screen.getByLabelText('Motif'), `  ${MOTIF}  `);
    fireEvent.press(screen.getByText('Confirmer la clôture'));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ reason: MOTIF }),
      expect.anything(),
    );
  });

  it('referme et prévient l’écran appelant en cas de succès', () => {
    const { onClose, onDone } = setup();
    mockMutate.mockImplementation((_input, handlers) => handlers.onSuccess());

    fireEvent.changeText(screen.getByLabelText('Motif'), MOTIF);
    fireEvent.press(screen.getByText('Confirmer la clôture'));

    expect(onClose).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it('affiche l’échec sans perdre la saisie', () => {
    const { onClose } = setup();
    mockMutate.mockImplementation((_input, handlers) =>
      handlers.onError(new Error('boom')),
    );

    fireEvent.changeText(screen.getByLabelText('Motif'), MOTIF);
    fireEvent.press(screen.getByText('Confirmer la clôture'));

    // La feuille reste ouverte : refaire la saisie serait puni deux fois.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue(MOTIF)).toBeTruthy();
  });

  it('laisse revenir en arrière sans clôturer', () => {
    const { onClose } = setup();

    fireEvent.press(screen.getByText('Revenir'));

    expect(mockMutate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('empêche un double envoi pendant la requête', () => {
    mockPending = true;
    setup();

    // Le bouton de confirmation annonce son occupation, le retour est bloqué :
    // rien ne peut partir deux fois ni être interrompu à mi-course.
    expect(
      screen.getByRole('button', { name: 'Confirmer la clôture' }).props
        .accessibilityState.busy,
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Revenir' }).props.accessibilityState
        .disabled,
    ).toBe(true);
  });
});
