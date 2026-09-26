import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Icon, Text } from '@/components/ui';
import { palette, spacing } from '@/theme/tokens';

/** Confirmation publique : aucun compte n'est nécessaire pour la consulter. */
export default function GuestOrderConfirmationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { reference } = useLocalSearchParams<{ reference?: string }>();

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.content}>
        <View style={styles.icon}>
          <Icon name="circle-check" size={46} color="white" />
        </View>
        <Text variant="display" color="greenDeep" center>Commande reçue !</Text>
        <Text variant="body" color="body" center>
          Merci pour votre commande.
        </Text>
        <Card style={styles.message}>
          <Text variant="body" color="body" center>
            AGRIM vous contactera au numéro indiqué afin de confirmer les modalités de livraison et, lorsque nécessaire, les frais de livraison.
          </Text>
          {reference ? (
            <View style={styles.reference}>
              <Text variant="micro" color="muted" center>RÉFÉRENCE DE COMMANDE</Text>
              <Text variant="h2" color="green" center>{reference}</Text>
            </View>
          ) : null}
        </Card>
        <Button label="RETOURNER AUX PRODUITS" onPress={() => router.replace('/catalogue')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg, justifyContent: 'center', paddingHorizontal: spacing.lg },
  content: { alignItems: 'center', gap: spacing.md },
  icon: { width: 82, height: 82, borderRadius: 41, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.green },
  message: { alignSelf: 'stretch', gap: spacing.md, marginVertical: spacing.md },
  reference: { gap: spacing.xs, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: palette.line },
});
