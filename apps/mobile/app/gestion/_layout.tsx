import { Stack } from 'expo-router';

/** Back-office : protégé au niveau de la racine, comme les autres groupes. */
export default function GestionLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
