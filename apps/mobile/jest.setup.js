/* eslint-disable @typescript-eslint/no-require-imports */
// expo-constants n'est pas disponible hors runtime Expo : on fournit la
// configuration minimale attendue par le client API.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: 'http://127.0.0.1:3000/api/v1' } } },
}));

// Mock officiel d'AsyncStorage : le module natif n'existe pas sous Jest.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/**
 * react-native-maps exige un binaire natif, absent sous Jest.
 * Le mock rend des vues inertes : les tests vérifient la logique des écrans,
 * pas le rendu cartographique lui-même (qui relève d'un test sur appareil).
 */
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Stub = ({ children, ...props }) =>
    React.createElement(View, props, children);
  return {
    __esModule: true,
    default: Stub,
    Marker: Stub,
    Polyline: Stub,
    PROVIDER_GOOGLE: 'google',
  };
});

/** expo-location : aucun capteur GPS dans l'environnement de test. */
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  Accuracy: { Balanced: 3 },
}));
