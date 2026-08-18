import { Stack } from 'expo-router';

/** Espace livreur : protégé au niveau de la racine, comme les autres groupes. */
export default function TourneeLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
