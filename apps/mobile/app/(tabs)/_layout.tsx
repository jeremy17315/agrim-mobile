import { Tabs } from 'expo-router';

import { palette } from '@/theme/tokens';

/**
 * Les routes historiques restent techniquement présentes pour les équipes et
 * les liens existants, mais la barre de menu disparaît du parcours public.
 * L'application ouvre directement le catalogue (l'écran d'accueil redirige) :
 * le client ajoute, puis commande, sans étape intermédiaire.
 */
// Ouvre le catalogue en premier : évite l'aller-retour visuel par la route
// d'accueil au démarrage.
export const unstable_settings = { initialRouteName: 'catalogue' };
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: palette.bg },
        tabBarStyle: { display: 'none' },
      }}
    >
      <Tabs.Screen name="catalogue" />
      <Tabs.Screen name="index" />
      <Tabs.Screen name="panier" />
      <Tabs.Screen name="compte" />
    </Tabs>
  );
}
