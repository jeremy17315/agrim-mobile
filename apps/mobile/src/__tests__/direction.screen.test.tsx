import { render, screen } from '@testing-library/react-native';

import type { ExecutiveDashboard } from '@/api/analytics';

import DirectionScreen from '../../app/direction/index';

/**
 * Tableau de bord de la direction.
 *
 * Risques couverts : un pourcentage de croissance inventé à partir d'un mois
 * de référence vide, une alerte affichée sans motif, et l'apparition d'une
 * action dans un écran qui doit rester consultatif.
 */

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

let mockDashboard: {
  data: ExecutiveDashboard | undefined;
  isLoading: boolean;
  isError: boolean;
  isRefetching: boolean;
  error: unknown;
  refetch: jest.Mock;
};

jest.mock('@/api/analytics', () => ({
  useExecutiveDashboard: () => mockDashboard,
}));

const dashboard = (
  overrides: Partial<ExecutiveDashboard> = {},
): ExecutiveDashboard => ({
  month: '2026-08',
  monthLabel: 'Août',
  revenueMonth: 4_285_000,
  revenueGrowth: 23.4,
  ordersMonth: 342,
  ordersGrowth: 18,
  newCustomers: 198,
  averageBasket: 12_528,
  lateDeliveries: 0,
  manualClosures: 0,
  manualClosureRate: 0,
  lowStockCount: 0,
  productionReceivedKg: 15_400,
  pendingProductionReviews: 0,
  sales: [
    { month: '2026-03', label: 'Mar', revenue: 3_200_000, orders: 260 },
    { month: '2026-04', label: 'Avr', revenue: 4_200_000, orders: 300 },
    { month: '2026-05', label: 'Mai', revenue: 3_800_000, orders: 280 },
    { month: '2026-06', label: 'Juin', revenue: 5_400_000, orders: 320 },
    { month: '2026-07', label: 'Juil', revenue: 5_800_000, orders: 330 },
    { month: '2026-08', label: 'Août', revenue: 4_285_000, orders: 342 },
  ],
  categories: [
    {
      categoryId: '11111111-1111-4111-8111-111111111111',
      name: 'Royal Grains',
      revenue: 1_800_000,
      share: 42,
    },
    {
      categoryId: '22222222-2222-4222-8222-222222222222',
      name: 'Ébène d’or',
      revenue: 1_200_000,
      share: 28,
    },
  ],
  ...overrides,
});

const state = (data: ExecutiveDashboard | undefined) => ({
  data,
  isLoading: false,
  isError: false,
  isRefetching: false,
  error: null as unknown,
  refetch: jest.fn(),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDashboard = state(dashboard());
});

it('met en avant le chiffre d’affaires du mois', () => {
  render(<DirectionScreen />);

  expect(screen.getByText('4 285 000 F')).toBeTruthy();
  expect(screen.getByText('CHIFFRE D’AFFAIRES DU MOIS')).toBeTruthy();
  // « Août » apparaît deux fois : en-tête de période et dernière barre.
  expect(screen.getAllByText('Août').length).toBeGreaterThanOrEqual(1);
});

it('affiche la croissance et sa référence', () => {
  render(<DirectionScreen />);

  expect(screen.getByText('+23.4 %')).toBeTruthy();
  expect(screen.getByText('vs mois précédent')).toBeTruthy();
});

it('n’invente pas de croissance sans mois de référence', () => {
  mockDashboard = state(dashboard({ revenueGrowth: null }));

  render(<DirectionScreen />);

  // Passer de rien à quelque chose n'est pas « +100 % ».
  expect(screen.queryByText('vs mois précédent')).toBeNull();
  expect(screen.getByText('Pas de référence le mois précédent')).toBeTruthy();
});

it('affiche les indicateurs du mois', () => {
  render(<DirectionScreen />);

  expect(screen.getByText('342')).toBeTruthy();
  expect(screen.getByText('198')).toBeTruthy();
  expect(screen.getByText('12 528 F')).toBeTruthy();
  expect(screen.getByText('15,4 t')).toBeTruthy();
});

it('décrit l’historique des ventes pour les lecteurs d’écran', () => {
  render(<DirectionScreen />);

  const chart = screen.getByLabelText(/Mar : /);
  expect(chart).toBeTruthy();
  expect(screen.getByText('Ventes · 6 derniers mois')).toBeTruthy();
});

it('signale une période sans aucune vente', () => {
  mockDashboard = state(
    dashboard({
      sales: dashboard().sales.map((point) => ({
        ...point,
        revenue: 0,
        orders: 0,
      })),
    }),
  );

  render(<DirectionScreen />);

  expect(
    screen.getByText('Aucune vente enregistrée sur la période.'),
  ).toBeTruthy();
});

it('affiche la répartition par gamme', () => {
  render(<DirectionScreen />);

  expect(screen.getByText('Royal Grains')).toBeTruthy();
  expect(screen.getByText('42 %')).toBeTruthy();
  expect(screen.getByText('Ébène d’or')).toBeTruthy();
});

it('annonce l’absence de vente à répartir', () => {
  mockDashboard = state(dashboard({ categories: [] }));

  render(<DirectionScreen />);

  expect(screen.getByText('Aucune vente à répartir ce mois-ci.')).toBeTruthy();
});

it('ne montre aucune alerte quand tout va bien', () => {
  render(<DirectionScreen />);

  expect(screen.getByText('Aucun point de vigilance.')).toBeTruthy();
  expect(screen.queryByText('Points de vigilance')).toBeNull();
});

it('détaille chaque point de vigilance', () => {
  mockDashboard = state(
    dashboard({
      lowStockCount: 2,
      lateDeliveries: 1,
      pendingProductionReviews: 3,
    }),
  );

  render(<DirectionScreen />);

  expect(screen.getByText('Points de vigilance')).toBeTruthy();
  expect(screen.getByText('2 variantes sous leur seuil de stock')).toBeTruthy();
  expect(
    screen.getByText('1 livraison au-delà du délai de référence'),
  ).toBeTruthy();
  expect(screen.getByText('3 déclarations de récolte à examiner')).toBeTruthy();
});

it('signale les clôtures sans code du client', () => {
  mockDashboard = state(dashboard({ manualClosures: 2, manualClosureRate: 4 }));

  render(<DirectionScreen />);

  expect(
    screen.getByText('2 livraisons closes sans code client (4 % du mois)'),
  ).toBeTruthy();
});

it('alerte quand la clôture sans code cesse d’être une exception', () => {
  // Au-delà du seuil, le message change de sens : ce n'est plus un incident
  // isolé mais un défaut du parcours, et la direction doit le lire ainsi.
  mockDashboard = state(
    dashboard({ manualClosures: 9, manualClosureRate: 18 }),
  );

  render(<DirectionScreen />);

  expect(
    screen.getByText(
      '9 livraisons closes sans code client (18 % du mois) — le parcours par code est à revoir',
    ),
  ).toBeTruthy();
});

it('n’affiche rien quand aucune livraison n’a été close sans code', () => {
  mockDashboard = state(dashboard({ manualClosures: 0, manualClosureRate: 0 }));

  render(<DirectionScreen />);

  expect(screen.queryByText(/sans code client/)).toBeNull();
});

it('accorde les libellés au singulier', () => {
  mockDashboard = state(
    dashboard({ lowStockCount: 1, pendingProductionReviews: 1 }),
  );

  render(<DirectionScreen />);

  expect(screen.getByText('1 variante sous son seuil de stock')).toBeTruthy();
  expect(screen.getByText('1 déclaration de récolte à examiner')).toBeTruthy();
});

it('reste un écran de consultation', () => {
  render(<DirectionScreen />);

  // Aucun bouton d'action : décider ici contournerait les contrôles métier
  // des espaces gestionnaire et livreur.
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(screen.getByText(/Consultation seule/)).toBeTruthy();
});

it('affiche une erreur récupérable', () => {
  mockDashboard = {
    ...state(undefined),
    isError: true,
    error: new Error('réseau'),
  };

  render(<DirectionScreen />);

  expect(screen.getByText(/Réessayer/i)).toBeTruthy();
});
