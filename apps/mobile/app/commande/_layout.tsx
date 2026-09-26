import { Stack } from 'expo-router';

/** Tunnel de commande : le checkout invité est public, les adresses restent legacy. */
export default function CommandeLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
