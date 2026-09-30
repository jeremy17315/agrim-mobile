import { Stack } from 'expo-router';

/** Checkout public : regroupé pour garder un écran sans en-tête système. */
export default function CommandeLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
