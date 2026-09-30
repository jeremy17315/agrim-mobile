import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { callCompany } from '@/lib/contact';
import { useIsOnline } from '@/lib/network';
import { palette, spacing } from '@/theme/tokens';

import { Button } from './ui/Button';
import { Icon } from './ui/Icon';
import { Text } from './ui/Text';

/**
 * Information globale : même sans Internet, le panier et le catalogue déjà
 * enregistrés doivent rester accessibles, tandis que les opérations serveur
 * (connexion, commande, paiement) restent clairement signalées comme bloquées.
 */
export function OfflineBanner() {
  const isOnline = useIsOnline();
  const insets = useSafeAreaInsets();

  if (isOnline) return null;

  return (
    <>
      <StatusBar style="light" />
      <View
        accessibilityRole="alert"
        accessibilityLabel="Mode hors connexion"
        style={[
          styles.banner,
          { paddingTop: Math.max(insets.top, spacing.sm) },
        ]}
      >
        <View style={styles.message}>
          <Icon name="wifi-off" size={17} color="gold" />
          <View style={styles.copy}>
            <Text variant="bodyStrong" color="white">
              Mode hors connexion
            </Text>
            <Text variant="micro" style={styles.detail}>
              Votre panier et le catalogue enregistré restent consultables. Une
              connexion est nécessaire pour commander.
            </Text>
          </View>
        </View>
        <Button
          label="Appeler le fixe"
          size="sm"
          variant="outline"
          fullWidth={false}
          icon={<Icon name="phone" size={14} color="green" />}
          onPress={() => void callCompany()}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: palette.greenDeep,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  message: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  copy: { flex: 1, gap: 2 },
  detail: { color: 'rgba(255,255,255,0.82)' },
});
