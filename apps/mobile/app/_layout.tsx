import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { fetchProducts, catalogKeys } from '@/api/catalog';
import { OfflineBanner } from '@/components/OfflineBanner';
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
            {hydrated && catalogHydrated ? (
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: palette.bg },
                }}
              >
                {/*
                  Le catalogue reste consultable sans compte : obliger à s'inscrire
                  avant même de voir les produits ferait fuir des clients.
                  Seul le tunnel de commande exige une session.
                */}
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="produit/[slug]" />

                <Stack.Protected guard={!isAuthenticated}>
                  <Stack.Screen name="(auth)" />
                </Stack.Protected>

                <Stack.Protected guard={isAuthenticated}>
                  <Stack.Screen name="commande" />
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
            ) : (
              // Session et cache catalogue en cours de restauration : afficher
              // les écrans maintenant provoquerait une erreur ou une redirection
              // visible dès que les données locales sont retrouvées.
              <View style={styles.splash}>
                <ActivityIndicator color={palette.green} />
              </View>
            )}
          </View>
        </SafeAreaProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1 },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.bg,
  },
});
