import type { ExpoConfig } from 'expo/config';

/**
 * Configuration Expo AGRIM-Mobile.
 *
 * En .ts plutôt qu'en .json : l'URL de l'API et le canal de build proviennent
 * de l'environnement, ce qu'un JSON statique ne permet pas.
 *
 * Aucun secret ici. Tout ce qui figure dans `extra` est lisible dans le bundle
 * livré : seules des valeurs publiques y sont admises.
 */

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000/api/v1';

const config: ExpoConfig = {
  name: 'AGRIM',
  slug: 'agrim-mobile',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'agrim',
  userInterfaceStyle: 'light',

  icon: './assets/adaptive-icon.png',

  ios: {
    supportsTablet: false,
    bundleIdentifier: 'ci.agrim.mobile',
    infoPlist: {
      // Justifications affichées par iOS : elles doivent décrire l'usage réel.
      NSLocationWhenInUseUsageDescription:
        'Votre position sert à repérer votre adresse de livraison et à suivre le livreur en temps réel.',
      NSCameraUsageDescription:
        'La caméra sert au livreur à photographier le colis remis comme preuve de livraison.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    package: 'ci.agrim.mobile',
    adaptiveIcon: {
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundColor: '#0B5D1E',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'CAMERA',
      'INTERNET',
    ],
  },

  web: {
    bundler: 'metro',
    output: 'static',
  },

  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        backgroundColor: '#0B5D1E',
        imageWidth: 180,
      },
    ],
    [
      'expo-location',
      {
        // Message affiché à la demande de permission, au démarrage réel du
        // suivi — jamais à l'ouverture de l'application.
        locationWhenInUsePermission:
          'Votre position sert à informer le client de votre progression pendant la livraison.',
        // Pas de suivi en arrière-plan en V1 : l'application suit la course
        // pendant que le livreur l'utilise, ce qui suffit et préserve la
        // batterie comme la vie privée.
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Les photos servent uniquement à joindre une preuve de livraison.',
        cameraPermission:
          'La caméra sert au livreur à photographier le colis remis comme preuve de livraison.',
      },
    ],
  ],

  experiments: {
    typedRoutes: true,
    // React Compiler laissé désactivé : incompatible NativeWind v4 et non
    // nécessaire ici. À réévaluer si l'on migre le styling.
  },

  extra: {
    apiUrl: API_URL,
    eas: {
      // Renseigné par `eas init` ; laissé vide pour ne pas figer un ID factice.
      projectId: process.env.EAS_PROJECT_ID ?? undefined,
    },
  },
};

export default config;
