import { Stack } from 'expo-router';

/**
 * Groupe d'authentification.
 *
 * Ce layout est indispensable : sans lui, expo-router n'expose pas « (auth) »
 * comme une route unique et le `Stack.Protected` de la racine ne s'applique à
 * rien — la protection serait silencieusement inopérante.
 */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
