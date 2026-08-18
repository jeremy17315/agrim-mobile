import { COMPANY } from '@agrim/contracts';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Icon, Text } from '@/components/ui';
import { formatPhone } from '@/lib/format';
import { palette, spacing } from '@/theme/tokens';

/** Compte — authentification et profil arrivent à la phase suivante. */
export default function CompteScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <Text variant="h1" style={styles.title}>
        Mon compte
      </Text>

      <View style={styles.body}>
        <Card style={styles.card}>
          <Icon name="circle-user" size={22} color="green" />
          <View style={styles.flex}>
            <Text variant="h3">Connexion requise</Text>
            <Text variant="caption" color="muted">
              Connectez-vous pour suivre vos commandes.
            </Text>
          </View>
        </Card>

        <Card style={styles.card}>
          <Icon name="phone" size={18} color="gold" />
          <View style={styles.flex}>
            <Text variant="h3">{COMPANY.name}</Text>
            <Text variant="caption" color="muted">
              {formatPhone(COMPANY.phone)}
            </Text>
            <Text variant="caption" color="muted">
              {COMPANY.address}
            </Text>
          </View>
        </Card>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  title: { paddingHorizontal: spacing.lg },
  body: { padding: spacing.lg, gap: spacing.md },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1, gap: 2 },
});
