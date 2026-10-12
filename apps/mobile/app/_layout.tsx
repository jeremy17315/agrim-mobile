import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Image,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { apiRequest } from '@/api/client';
import { appConfigSchema, configKeys } from '@/api/config';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { fetchProducts, catalogKeys } from '@/api/catalog';
import { OfflineBanner } from '@/components/OfflineBanner';
import { rememberPublishedSupport } from '@/lib/contact';
import { usePushRegistration } from '@/lib/usePushRegistration';
import { startNetworkMonitoring } from '@/lib/network';
import {
  persistCatalogCache,
  restoreCatalogCache,
} from '@/lib/queryPersistence';
import { useAuthStore } from '@/store/auth';
import { palette } from '@/theme/tokens';

/**
 * Racine de l'application.
 *
 * Le QueryClient est créé dans un état local et non au niveau module : sinon
 * un rechargement à chaud recrée le cache et fait clignoter les écrans.
 */
export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Réseau souvent lent ou intermittent : on privilégie le cache et
            // on limite les rafraîchissements automatiques coûteux en data.
            staleTime: 60_000,
            retry: 2,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  const [catalogHydrated, setCatalogHydrated] = useState(false);

  const hydrated = useAuthStore((s) => s.hydrated);
  const isAuthenticated = useAuthStore((s) => s.accessToken !== null);
  const ready = hydrated && catalogHydrated;

  // Lancement : même fond et même logo que le splash natif, puis fondu court
  // dès que le chargement réel est terminé (jamais de délai artificiel).
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashOpacity] = useState(() => new Animated.Value(1));
  // Dimensions du fichier splash-icon.png (540 × 177) : fixées ici plutôt que
  // lues à l'exécution, car Image.resolveAssetSource n'existe pas sur le web.
  const splashWidth = 180;
  const splashHeight = (splashWidth * 177) / 540;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    // « Réduire les animations » : on coupe le fondu, l'écran change tout de suite.
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled) return;
        Animated.timing(splashOpacity, {
          toValue: 0,
          duration: reduce ? 0 : 200,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished && !cancelled) setSplashVisible(false);
        });
      });
    return () => {
      cancelled = true;
    };
  }, [ready, splashOpacity]);
  // L'espace livreur n'a de sens que pour un livreur. Ce guard masque l'onglet
  // et la route ; le serveur reste seul juge des droits réels.
  const isCourier = useAuthStore((s) => s.user?.role === 'LIVREUR');
  const isProducer = useAuthStore((s) => s.user?.role === 'PRODUCTEUR');
  // Back-office : trois rôles y accèdent, le serveur reste seul juge.
  const isManager = useAuthStore(
    (s) =>
      s.user?.role === 'GESTIONNAIRE' ||
      s.user?.role === 'ADMIN' ||
      s.user?.role === 'DG',
  );
  // Direction : périmètre plus étroit que le back-office, l'espace consolide
  // les chiffres de toute l'entreprise.
  const isExecutive = useAuthStore(
    (s) => s.user?.role === 'DG' || s.user?.role === 'ADMIN',
  );
  const restore = useAuthStore((s) => s.restore);

  useEffect(() => {
    startNetworkMonitoring();
    void restore();
  }, [restore]);

  useEffect(() => {
    let active = true;
    let stopPersisting: () => void = () => undefined;

    // Le cache est relu AVANT de monter les écrans : hors ligne, le catalogue
    // existant s'affiche directement au lieu d'être remplacé par une erreur.
    void restoreCatalogCache(queryClient).finally(() => {
      if (!active) return;
      stopPersisting = persistCatalogCache(queryClient);
      setCatalogHydrated(true);
    });

    return () => {
      active = false;
      stopPersisting();
    };
  }, [queryClient]);

  useEffect(() => {
    if (!catalogHydrated) return;

    // Conserver jusqu'à 100 références rend la recherche et les fiches produit
    // réellement utiles lors de la prochaine coupure réseau. Le serveur borne
    // lui-même cette valeur à 100.
    void queryClient
      .prefetchQuery({
        queryKey: catalogKeys.products({ limit: 100 }),
        queryFn: ({ signal }) => fetchProducts({ limit: 100 }, signal),
        staleTime: 10 * 60 * 1000,
      })
      .catch(() => {
        // Hors ligne, React Query conserve le cache relu ci-dessus et attend
        // le retour du réseau pour rafraîchir le catalogue.
      });

    // Coordonnées et textes publiés par AGRIM, préchargés une fois pour
    // toutes : les écrans de secours (appel du support, livraison) appellent
    // ensuite la bonne ligne, même s'ils n'ont pas fait la requête eux-mêmes.
    void queryClient
      .fetchQuery({
        queryKey: configKeys.all,
        queryFn: ({ signal }) =>
          apiRequest({
            path: '/config/app',
            schema: appConfigSchema,
            isPublic: true,
            signal,
          }),
        staleTime: 10 * 60 * 1000,
      })
      .then((config) => rememberPublishedSupport(config.support))
      .catch(() => {
        // API injoignable : `contact.ts` retombe sur les valeurs AGRIM du
        // contrat partagé — jamais sur un écran sans numéro.
      });
  }, [catalogHydrated, queryClient]);

  // Jeton de notification : lié à la session, pas à un écran.
  usePushRegistration();

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <View style={styles.app}>
            <OfflineBanner />
            {ready ? (
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: palette.bg },
                }}
              >
                {/* Le parcours d'achat est public : l'authentification reste
                    réservée aux espaces historiques et aux rôles internes. */}
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="produit/[slug]" />
                <Stack.Screen name="commande" />
                {/* Contact et aide : public, sans compte. */}
                <Stack.Screen name="contact" />
                <Stack.Screen name="paiement/[reference]" />
                <Stack.Screen name="confirmation/[reference]" />

                <Stack.Protected guard={!isAuthenticated}>
                  <Stack.Screen name="(auth)" />
                </Stack.Protected>

                <Stack.Protected guard={isAuthenticated}>
                  <Stack.Screen name="commandes" />
                  <Stack.Screen name="notifications" />
                  <Stack.Screen name="parrainage" />
                </Stack.Protected>

                <Stack.Protected guard={isAuthenticated && isCourier}>
                  <Stack.Screen name="tournee" />
                </Stack.Protected>

                <Stack.Protected guard={isAuthenticated && isProducer}>
                  <Stack.Screen name="exploitation" />
                </Stack.Protected>

                <Stack.Protected guard={isAuthenticated && isExecutive}>
                  <Stack.Screen name="direction" />
                </Stack.Protected>

                <Stack.Protected guard={isAuthenticated && isManager}>
                  <Stack.Screen name="gestion" />
                </Stack.Protected>
              </Stack>
            ) : null}
            {splashVisible ? (
              // Session et cache catalogue en cours de restauration : même
              // rendu que le splash natif, pour un passage invisible.
              <Animated.View
                style={[styles.splash, { opacity: splashOpacity }]}
                accessibilityLabel="Chargement AGRIM"
              >
                <Image
                  source={require('../assets/splash-icon.png')}
                  style={{ width: splashWidth, height: splashHeight }}
                  resizeMode="contain"
                  accessibilityLabel="Logo AGRIM"
                />
              </Animated.View>
            ) : null}
          </View>
        </SafeAreaProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1 },
  splash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.green,
  },
});
