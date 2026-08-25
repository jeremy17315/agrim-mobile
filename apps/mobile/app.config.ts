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

/**
 * Un APK de test parle à une API de développement en HTTP simple, sur le
 * réseau local. Or Android bloque le trafic en clair depuis Android 9 : sans
 * cette autorisation, toutes les requêtes échouent avec une erreur réseau
 * opaque, écran vide à la clé.
 *
 * L'autorisation suit l'URL réellement configurée : dès que l'API passe en
 * HTTPS, le trafic en clair redevient interdit sans rien avoir à penser.
 */
const ALLOWS_CLEARTEXT = API_URL.startsWith('http://');

/**
 * Clé Google Maps Android, injectée au build (jamais commitée).
 *
 * Sans elle, react-native-maps affiche une carte grise sur Android : les
 * écrans d'itinéraire semblent cassés alors que le code est correct. La clé
 * est restreinte côté console Google au paquet + empreinte de signature, ce
 * qui la rend inexploitable ailleurs — c'est pour cela qu'elle peut figurer
 * dans le binaire.
 */
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_ANDROID_KEY ?? '';

/**
 * Identifiant du projet EAS, utilisé pour les builds, les notifications
 * poussées et l'URL de manifeste des mises à jour OTA (EAS Update).
 *
 * Écrit en clair volontairement : ce n'est pas un secret, il figure de toute
 * façon dans le bundle livré. La variable d'environnement reste prioritaire,
 * pour rattacher le projet à un autre compte sans modifier le dépôt.
 */
const EAS_PROJECT_ID =
  process.env.EAS_PROJECT_ID ?? '35eb97ae-3d76-48ec-8424-3bd75584ca72';

const config: ExpoConfig = {
  name: 'AGRIM',
  slug: 'agrim-mobile',
  // Compte propriétaire du projet EAS. Doit correspondre au `slug` enregistré
  // chez Expo, sinon les builds partent sur un projet différent.
  owner: process.env.EAS_PROJECT_OWNER ?? 'jeremy1731',
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
      // Aucune justification caméra : la preuve photo a été retirée avec le
      // passage à la validation par code. Déclarer un usage inexistant est
      // refusé en revue.
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    package: 'ci.agrim.mobile',
    // Incrémenté à chaque envoi sur le Play Store ; sans effet pour un APK
    // installé à la main.
    versionCode: 1,
    ...(GOOGLE_MAPS_API_KEY
      ? { config: { googleMaps: { apiKey: GOOGLE_MAPS_API_KEY } } }
      : {}),
    adaptiveIcon: {
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundColor: '#0B5D1E',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    // Strictement ce que l'application utilise. CAMERA a été retirée avec la
    // preuve photo : demander une permission inutilisée coûte des refus
    // d'installation sans rien apporter.
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'INTERNET'],
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
      'expo-notifications',
      {
        color: '#0B5D1E',
        defaultChannel: 'default',
      },
    ],
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
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: ALLOWS_CLEARTEXT,
        },
      },
    ],
  ],

  experiments: {
    typedRoutes: true,
    // React Compiler laissé désactivé : incompatible NativeWind v4 et non
    // nécessaire ici. À réévaluer si l'on migre le styling.
  },

  /**
   * Mises à jour OTA (EAS Update) : un changement JS seul peut être poussé
   * aux appareils déjà installés, sans nouveau build ni nouveau lien.
   *
   * Policy « appVersion » : la version d'exécution suit le champ `version`
   * ci-dessus. La policy « fingerprint » (hash du code natif) a été
   * essayée en premier mais échoue de façon reproductible en monorepo npm
   * workspaces : EAS calcule un fingerprint local (chemins relatifs
   * `../../node_modules/...`) différent de celui calculé côté serveur, et
   * l'écart fait échouer la phase CONFIGURE_EXPO_UPDATES du build.
   *
   * Conséquence à retenir : après un changement natif (nouveau module,
   * permission, plugin…), il faut incrémenter `version` ci-dessus. Sans
   * ça, une update OTA publiée après le changement natif pourrait être
   * proposée à tort à d'anciens APK. Voir docs/APK-DE-TEST.md.
   */
  runtimeVersion: {
    policy: 'appVersion',
  },
  updates: {
    url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
  },

  extra: {
    apiUrl: API_URL,
    eas: {
      /**
       * Identifiant du projet EAS.
       *
       * `eas init` ne peut pas écrire dans une configuration dynamique (.ts) :
       * la valeur est donc renseignée ici (voir `EAS_PROJECT_ID` plus haut).
       */
      projectId: EAS_PROJECT_ID,
    },
  },
};

export default config;
