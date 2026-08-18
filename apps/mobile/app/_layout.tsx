import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

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

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.bg },
          }}
        />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
