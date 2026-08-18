import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

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
  const restore = useAuthStore((s) => s.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

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
