import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useGuestPaymentStatus } from '@/api/payments';
import { Button, Card, Icon, Text } from '@/components/ui';
import {
  clearGuestPaymentAccess,
  getGuestPaymentAccess,
} from '@/lib/guestPayment';
import { palette, radius, shadow, spacing } from '@/theme/tokens';

/**
 * Fin du parcours invité. L'écran reprend un récapitulatif de suivi lisible,
 * sans créer de compte ni promettre un suivi GPS qui n'existe pas encore.
 */
export default function ConfirmationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { reference, payment: paymentType } = useLocalSearchParams<{
    reference: string;
    payment?: string;
  }>();
  const isMobileMoney = paymentType === 'MOBILE_MONEY';
  const [accessToken, setAccessToken] = useState<string | null | undefined>(
    isMobileMoney ? undefined : null,
  );
  const mobilePayment = useGuestPaymentStatus(
    reference ?? '',
    isMobileMoney ? (accessToken ?? null) : null,
  );
  const mobilePaid = mobilePayment.data?.status === 'SUCCEEDED';

  useEffect(() => {
    if (!isMobileMoney) return;
    let active = true;
    void getGuestPaymentAccess(reference ?? '').then((token) => {
      if (active) setAccessToken(token);
    });
    return () => {
      active = false;
    };
  }, [isMobileMoney, reference]);

  useEffect(() => {
    if (!isMobileMoney || !mobilePaid || !reference) return;
    // Le statut est maintenant rendu à l'écran ; la capacité n'a plus à vivre
    // dans le coffre natif au-delà de cette confirmation.
    void clearGuestPaymentAccess(reference);
  }, [isMobileMoney, mobilePaid, reference]);

  const title = isMobileMoney
    ? mobilePaid
      ? 'Paiement confirmé !'
      : 'Validation du paiement'
    : 'Commande reçue !';
  const intro = isMobileMoney
    ? mobilePaid
      ? 'Votre règlement Mobile Money est confirmé. Notre équipe prépare maintenant votre livraison.'
      : 'Votre règlement Mobile Money est en cours de vérification auprès de l’opérateur.'
    : 'Merci. Notre équipe prépare la suite et vous appellera si un détail de livraison doit être précisé.';

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.xl }]}>
      <View style={styles.successMark}>
        <Icon name="circle-check" size={55} color="green" />
      </View>
      <Text variant="h1" center>
        {title}
      </Text>
      <Text variant="body" color="muted" center style={styles.intro}>
        {intro}
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
          <View
            style={[
              styles.receivedPill,
              isMobileMoney && !mobilePaid && styles.awaitingPill,
            ]}
          >
            <Text
              variant="micro"
              style={[
                styles.receivedText,
                isMobileMoney && !mobilePaid && styles.awaitingText,
              ]}
            >
              {isMobileMoney
                ? mobilePaid
                  ? 'PAYÉ'
                  : 'EN VÉRIFICATION'
                : 'À LA LIVRAISON'}
            </Text>
          </View>
        </View>

        <View style={styles.divider} />
        <StatusStep
          icon={isMobileMoney ? 'smartphone' : 'banknote'}
          title={
            isMobileMoney
              ? mobilePaid
                ? 'Paiement Mobile Money confirmé'
                : 'Paiement Mobile Money à vérifier'
              : 'Paiement à la livraison'
          }
          detail={
            isMobileMoney
              ? mobilePaid
                ? 'Confirmation reçue directement de l’opérateur.'
                : 'Nous attendons la confirmation de l’opérateur.'
              : 'Vous réglerez votre commande à sa réception.'
          }
          active={!isMobileMoney || mobilePaid}
        />
        <StatusStep
          icon="clipboard-check"
          title="Commande reçue"
          detail="Votre demande est enregistrée pour préparation."
          active={!isMobileMoney || mobilePaid}
        />
        <StatusStep
          icon="phone-call"
          title="Confirmation de livraison"
          detail="Nous vous contactons si nécessaire."
        />
        <StatusStep
          icon="truck"
          title="Livraison"
          detail={
            isMobileMoney && mobilePaid
              ? 'Votre règlement est déjà confirmé.'
              : 'La livraison suivra la validation du paiement.'
          }
        />
      </Card>

      <View style={styles.help}>
        <Icon name="message-circle" size={17} color="green" />
        <Text variant="caption" color="body" style={styles.helpCopy}>
          Gardez cette référence si vous devez joindre notre équipe.
        </Text>
      </View>

      <View style={styles.action}>
        {isMobileMoney && !mobilePaid ? (
          <Button
            label="VOIR LE PAIEMENT"
            onPress={() => router.replace(`/paiement/${reference}`)}
            icon={<Icon name="smartphone" size={17} color="white" />}
          />
        ) : (
          <Button
            label="RETOUR AUX PRODUITS"
            onPress={() => router.replace('/catalogue')}
            icon={<Icon name="shopping-bag" size={17} color="white" />}
          />
        )}
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
  icon: 'clipboard-check' | 'phone-call' | 'truck' | 'smartphone' | 'banknote';
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
  awaitingPill: { backgroundColor: palette.goldSoft },
  awaitingText: { color: palette.goldDark },
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
