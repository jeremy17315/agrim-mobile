import { Tabs } from 'expo-router';

import { palette } from '@/theme/tokens';

/**
 * Le catalogue est la première route du parcours public : il s'ouvre dès le
 * lancement, sans écran intermédiaire. La barre de menu disparaît : le client
 * avance uniquement par les actions « Ajouter », « Panier » et « Commander ».
 */
export const unstable_settings = {
  initialRouteName: 'catalogue',
};

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: palette.bg },
        tabBarStyle: { display: 'none' },
      }}
    >
      {/* Redirection de sécurité vers le catalogue : masquée du parcours. */}
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="catalogue" />
      <Tabs.Screen name="panier" />
      <Tabs.Screen name="compte" />
    </Tabs>
  );
}
