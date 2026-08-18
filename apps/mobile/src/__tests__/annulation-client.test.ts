import { isCancellableByClient, ORDER_STATUSES } from '@agrim/contracts';

/**
 * Frontière de l'annulation en libre-service.
 *
 * Régression corrigée en phase 18 : le client pouvait annuler une commande
 * déjà `OUT_FOR_DELIVERY`. Le stock était alors recrédité pour une marchandise
 * partie avec le livreur, et la course restait active dans sa tournée — il
 * livrait une commande annulée.
 */

it('autorise l’annulation tant que la commande est au bureau', () => {
  expect(isCancellableByClient('PENDING')).toBe(true);
  expect(isCancellableByClient('CONFIRMED')).toBe(true);
  expect(isCancellableByClient('PREPARING')).toBe(true);
  expect(isCancellableByClient('READY')).toBe(true);
});

it('refuse l’annulation dès que la marchandise est partie', () => {
  // Passé ce point, la sortie se fait par le terrain : le livreur clôt la
  // course en échec. Pas par un bouton dans l'application.
  expect(isCancellableByClient('OUT_FOR_DELIVERY')).toBe(false);
  expect(isCancellableByClient('DELIVERED')).toBe(false);
  expect(isCancellableByClient('CANCELLED')).toBe(false);
});

it('couvre explicitement tous les statuts de commande', () => {
  // Un nouveau statut ajouté au contrat sans décision d'annulation ferait
  // échouer ce test plutôt que de passer inaperçu.
  const decided = ORDER_STATUSES.map((status) => ({
    status,
    cancellable: isCancellableByClient(status),
  }));
  expect(
    decided.filter((row) => row.cancellable).map((row) => row.status),
  ).toEqual(['PENDING', 'CONFIRMED', 'PREPARING', 'READY']);
});
