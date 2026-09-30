import { Tabs } from 'expo-router';

import { palette } from '@/theme/tokens';

/**
 * Les routes historiques restent techniquement présentes pour les équipes et
 * les liens existants, mais la barre de menu disparaît du parcours public.
 * Le client avance uniquement par les actions « Commencer », « Panier » et
 * « Commander ».
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: palette.bg },
        tabBarStyle: { display: 'none' },
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="catalogue" />
      <Tabs.Screen name="panier" />
      <Tabs.Screen name="compte" />
    </Tabs>
  );
}
