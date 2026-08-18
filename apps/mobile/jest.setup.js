/* eslint-disable @typescript-eslint/no-require-imports */
// expo-constants n'est pas disponible hors runtime Expo : on fournit la
// configuration minimale attendue par le client API.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: 'http://127.0.0.1:3000/api/v1' } } },
}));
