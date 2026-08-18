import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/states';
import { Text } from '@/components/ui';
import { palette, spacing } from '@/theme/tokens';

/** Panier — le contenu réel arrive à la phase 10 (panier local-first). */
export default function PanierScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <Text variant="h1" style={styles.title}>
        Panier
      </Text>
      <EmptyState
        icon="shopping-cart"
        title="Votre panier est vide"
        message="Parcourez le catalogue pour ajouter du riz BOAGNI."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  title: { paddingHorizontal: spacing.lg },
});
