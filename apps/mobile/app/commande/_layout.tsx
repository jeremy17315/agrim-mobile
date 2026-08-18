import { Stack } from 'expo-router';

/** Tunnel de commande : regroupé pour être protégé d'un seul tenant. */
export default function CommandeLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
