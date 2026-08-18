import { Tabs } from 'expo-router';

import { Icon } from '@/components/ui';
import { palette, typography } from '@/theme/tokens';

/**
 * Barre d'onglets du parcours client.
 *
 * Les libellés sont courts pour tenir sur les petits écrans sans être tronqués.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.green,
        tabBarInactiveTintColor: palette.muted,
        tabBarStyle: {
          backgroundColor: palette.card,
          borderTopColor: palette.line,
          height: 62,
          paddingTop: 6,
          paddingBottom: 8,
        },
        tabBarLabelStyle: {
          fontSize: typography.micro.fontSize,
          fontWeight: '700',
        },
        sceneStyle: { backgroundColor: palette.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          tabBarIcon: ({ color, size }) => (
            <Icon name="house" size={size - 3} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="catalogue"
        options={{
          title: 'Catalogue',
          tabBarIcon: ({ color, size }) => (
            <Icon name="layout-grid" size={size - 3} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="panier"
        options={{
          title: 'Panier',
          tabBarIcon: ({ color, size }) => (
            <Icon name="shopping-cart" size={size - 3} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="compte"
        options={{
          title: 'Compte',
          tabBarIcon: ({ color, size }) => (
            <Icon name="user" size={size - 3} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
