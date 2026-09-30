import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Icon, Text } from '@/components/ui';
import { palette, radius, shadow, spacing } from '@/theme/tokens';

/**
 * Fin du parcours invité. L'écran reprend un récapitulatif de suivi lisible,
 * sans créer de compte ni promettre un suivi GPS qui n'existe pas encore.
 */
export default function ConfirmationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { reference } = useLocalSearchParams<{ reference: string }>();

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.xl }]}>
      <View style={styles.successMark}>
        <Icon name="circle-check" size={55} color="green" />
      </View>
      <Text variant="h1" center>
        Commande confirmée !
      </Text>
      <Text variant="body" color="muted" center style={styles.intro}>
        Merci. Notre équipe prépare la suite et vous appellera si un détail de
        livraison doit être précisé.
      </Text>

      <Card style={styles.orderCard}>
        <View style={styles.referenceRow}>
          <View>
            <Text variant="micro" color="muted">
              RÉFÉRENCE DE COMMANDE
            </Text>
            <Text variant="h3" color="green">
              {reference ?? '—'}
            </Text>
          </View>
          <View style={styles.receivedPill}>
            <Text variant="micro" style={styles.receivedText}>
              REÇUE
            </Text>
          </View>
        </View>

        <View style={styles.divider} />
        <StatusStep
          icon="clipboard-check"
          title="Commande reçue"
          detail="Votre demande est enregistrée."
          active
        />
        <StatusStep
          icon="phone-call"
          title="Confirmation de livraison"
          detail="Nous vous contactons si nécessaire."
        />
        <StatusStep
          icon="truck"
          title="Livraison"
          detail="Paiement comptant à la réception."
        />
      </Card>

      <View style={styles.help}>
        <Icon name="message-circle" size={17} color="green" />
        <Text variant="caption" color="body" style={styles.helpCopy}>
          Gardez cette référence si vous devez joindre notre équipe.
        </Text>
      </View>

      <View style={styles.action}>
        <Button
          label="RETOUR AUX PRODUITS"
          onPress={() => router.replace('/catalogue')}
          icon={<Icon name="shopping-bag" size={17} color="white" />}
        />
      </View>
    </View>
  );
}

function StatusStep({
  icon,
  title,
  detail,
  active = false,
}: {
  icon: 'clipboard-check' | 'phone-call' | 'truck';
  title: string;
  detail: string;
  active?: boolean;
}) {
  return (
    <View style={styles.step}>
      <View style={[styles.stepIcon, active && styles.stepIconActive]}>
        <Icon name={icon} size={17} color={active ? 'white' : 'muted'} />
      </View>
      <View style={styles.stepCopy}>
        <Text variant="h3" color={active ? 'green' : 'ink'}>
          {title}
        </Text>
        <Text variant="caption" color="muted">
          {detail}
        </Text>
      </View>
      {active ? <Icon name="check" size={17} color="green" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'stretch',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    backgroundColor: palette.bg,
  },
  successMark: {
    width: 96,
    height: 96,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xxl,
    marginBottom: spacing.lg,
    borderRadius: 48,
    backgroundColor: palette.greenSoft,
  },
  intro: { marginTop: spacing.sm, lineHeight: 19 },
  orderCard: {
    gap: spacing.md,
    marginTop: spacing.xxl,
    padding: spacing.lg,
    ...shadow.card,
  },
  referenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  receivedPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: palette.greenSoft,
  },
  receivedText: { color: palette.green, fontSize: 8 },
  divider: { height: 1, backgroundColor: palette.line },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.line,
  },
  stepIconActive: {
    backgroundColor: palette.green,
    borderColor: palette.green,
  },
  stepCopy: { flex: 1, gap: 2 },
  help: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  helpCopy: { flex: 1, lineHeight: 17 },
  action: { marginTop: 'auto', paddingTop: spacing.xl },
});
