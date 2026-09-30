import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Icon, Text } from '@/components/ui';
import { palette, radius, spacing } from '@/theme/tokens';

/** Fin du parcours invité : une confirmation simple, sans proposer de compte. */
export default function ConfirmationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { reference } = useLocalSearchParams<{ reference: string }>();

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.xl }]}>
      <View style={styles.card}>
        <View style={styles.icon}>
          <Icon name="circle-check" size={58} color="green" />
        </View>
        <Text variant="h1" center>
          Commande confirmée !
        </Text>
        <Text variant="body" color="muted" center>
          Merci pour votre commande. Notre équipe vous contactera si nécessaire
          pour confirmer la livraison.
        </Text>
        {reference ? (
          <View style={styles.reference}>
            <Text variant="micro" color="muted">
              NUMÉRO DE COMMANDE
            </Text>
            <Text variant="h3" color="green">
              {reference}
            </Text>
          </View>
        ) : null}
        <Button
          label="RETOUR AUX PRODUITS"
          onPress={() => router.replace('/catalogue')}
          icon={<Icon name="shopping-bag" size={17} color="white" />}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxxl,
    backgroundColor: palette.bg,
  },
  card: {
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
  },
  icon: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 48,
    backgroundColor: palette.greenSoft,
  },
  reference: { alignItems: 'center', gap: 3 },
});
