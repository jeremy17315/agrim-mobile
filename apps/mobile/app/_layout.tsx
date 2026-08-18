import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { usePushRegistration } from '@/lib/usePushRegistration';
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
    void restore();
  }, [restore]);

  // Jeton de notification : lié à la session, pas à un écran.
  usePushRegistration();

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {hydrated ? (
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
          // Session en cours de restauration : afficher les écrans maintenant
          // provoquerait une redirection visible dès que le token est retrouvé.
          <View style={styles.splash}>
            <ActivityIndicator color={palette.green} />
          </View>
        )}
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.bg,
  },
});
