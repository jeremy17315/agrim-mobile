import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ProductReviews } from '@/components/ProductReviews';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
}));

let mockConnected = false;
jest.mock('@/store/auth', () => ({
  useIsAuthenticated: () => mockConnected,
}));

const mockMutate = jest.fn();
const mockReviews = {
  average: 4.5,
  count: 2,
  data: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      authorFirstName: 'Awa',
      rating: 5,
      comment: 'Riz parfumé, bien gonflé à la cuisson.',
      createdAt: '2026-08-20T10:00:00.000Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      authorFirstName: 'Koffi',
      rating: 4,
      comment: 'Bon rapport qualité-prix pour le 5 kg.',
      createdAt: '2026-08-18T09:00:00.000Z',
    },
  ],
};

jest.mock('@/api/reviews', () => ({
  useProductReviews: () => ({
    data: mockReviews,
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useSubmitReview: () => ({
    mutateAsync: mockMutate,
    isPending: false,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockConnected = false;
  mockMutate.mockResolvedValue(undefined);
});

it('affiche les commentaires et la moyenne', () => {
  render(<ProductReviews slug="royal-grains" />);

  expect(screen.getByText('AVIS CLIENTS')).toBeTruthy();
  expect(screen.getByText('4,5 / 5')).toBeTruthy();
  expect(screen.getByText('2 avis')).toBeTruthy();
  expect(screen.getByText('Awa')).toBeTruthy();
  expect(
    screen.getByText('Riz parfumé, bien gonflé à la cuisson.'),
  ).toBeTruthy();
  expect(screen.getByText('Koffi')).toBeTruthy();
});

it('laisse cocher les étoiles', () => {
  render(<ProductReviews slug="royal-grains" />);

  fireEvent.press(screen.getByLabelText('4 étoiles'));
  expect(screen.getByLabelText('4 étoiles').props.accessibilityState).toEqual(
    expect.objectContaining({ selected: true }),
  );
});

it('invite à se connecter pour publier', () => {
  render(<ProductReviews slug="royal-grains" />);

  fireEvent.press(screen.getByText('Connectez-vous pour publier un avis'));
  expect(mockPush).toHaveBeenCalledWith('/(auth)/connexion');
  expect(mockMutate).not.toHaveBeenCalled();
});

it('publie note et commentaire une fois connecté', async () => {
  mockConnected = true;
  render(<ProductReviews slug="royal-grains" />);

  fireEvent.press(screen.getByLabelText('5 étoiles'));
  fireEvent.changeText(
    screen.getByLabelText('Votre commentaire'),
    'Très bon riz, cuisson parfaite.',
  );
  fireEvent.press(screen.getByText('Publier mon avis'));

  await waitFor(() =>
    expect(mockMutate).toHaveBeenCalledWith({
      rating: 5,
      comment: 'Très bon riz, cuisson parfaite.',
    }),
  );
  expect(screen.getByText('Merci, votre avis est publié.')).toBeTruthy();
});
