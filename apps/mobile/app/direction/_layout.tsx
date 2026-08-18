import { Stack } from 'expo-router';

/** Espace direction : protégé au niveau de la racine, comme les autres groupes. */
export default function DirectionLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
