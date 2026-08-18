import { Stack } from 'expo-router';

/** Historique et suivi : réservés à un utilisateur connecté. */
export default function CommandesLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
