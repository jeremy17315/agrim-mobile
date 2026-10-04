import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useGuestPaymentStatus } from '@/api/payments';
import { CheckoutProgress } from '@/components/CheckoutProgress';
import { Button, Card, Icon, Text } from '@/components/ui';
import {
  clearGuestPaymentAccess,
  getGuestPaymentAccess,
} from '@/lib/guestPayment';
import { callMobileSupport } from '@/lib/contact';
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
  // Sans capacité locale, il serait malhonnête d'afficher « en cours » :
  // l'application ne peut plus demander le statut de cette commande invitée.
  const cannotVerifyMobilePayment = isMobileMoney && accessToken === null;
  const mobilePaymentStatusUnavailable =
    isMobileMoney && accessToken !== undefined && mobilePayment.isError;

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
      : cannotVerifyMobilePayment
        ? 'Vérification nécessaire'
        : mobilePaymentStatusUnavailable
          ? 'Statut du paiement indisponible'
          : 'Validation du paiement'
    : 'Commande reçue !';
  const intro = isMobileMoney
    ? mobilePaid
      ? 'Votre règlement Mobile Money est confirmé. Notre équipe prépare maintenant votre livraison.'
      : cannotVerifyMobilePayment
        ? 'Votre commande n’est pas marquée comme payée. Appelez AGRIM avec votre référence avant de recommencer un paiement.'
        : mobilePaymentStatusUnavailable
          ? 'Nous ne pouvons pas vérifier le règlement pour le moment. Réessayez dès que votre connexion revient.'
          : 'Votre règlement Mobile Money est en cours de vérification auprès de l’opérateur.'
    : 'Merci. Notre équipe prépare la suite et vous appellera si un détail de livraison doit être précisé.';

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.xl }]}>
      <CheckoutProgress step={4} />
      <View
        style={[
          styles.successMark,
          isMobileMoney && !mobilePaid && styles.pendingMark,
        ]}
      >
        <Icon
          name={isMobileMoney && !mobilePaid ? 'clock-3' : 'circle-check'}
          size={55}
          color={isMobileMoney && !mobilePaid ? 'goldDark' : 'green'}
        />
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
                  : cannotVerifyMobilePayment
                    ? 'À VÉRIFIER'
                    : mobilePaymentStatusUnavailable
                      ? 'INDISPONIBLE'
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
                : cannotVerifyMobilePayment
                  ? 'Paiement Mobile Money à vérifier'
                  : mobilePaymentStatusUnavailable
                    ? 'Statut Mobile Money indisponible'
                    : 'Paiement Mobile Money à vérifier'
              : 'Paiement à la livraison'
          }
          detail={
            isMobileMoney
              ? mobilePaid
                ? 'Confirmation reçue directement de l’opérateur.'
                : cannotVerifyMobilePayment
                  ? 'Contactez AGRIM avec votre référence avant toute nouvelle tentative.'
                  : mobilePaymentStatusUnavailable
                    ? 'Réessayez la vérification dès que votre connexion revient.'
                    : 'Nous attendons la confirmation de l’opérateur.'
              : 'Vous réglerez votre commande à sa réception.'
          }
          active={!isMobileMoney || mobilePaid}
        />
        <StatusStep
          icon="clipboard-check"
          title={
            isMobileMoney && !mobilePaid
              ? 'Commande en attente de paiement'
              : 'Commande reçue'
          }
          detail={
            isMobileMoney && !mobilePaid
              ? 'La préparation commencera après la confirmation du règlement.'
              : 'Votre demande est enregistrée pour préparation.'
          }
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

      <Pressable
        onPress={() => void callMobileSupport()}
        accessibilityRole="button"
        accessibilityLabel="Appeler AGRIM pour le suivi de cette commande"
        style={styles.help}
      >
        <Icon name="phone-call" size={17} color="green" />
        <Text variant="caption" color="body" style={styles.helpCopy}>
          Gardez cette référence. Besoin d’aide ? Appelez AGRIM.
        </Text>
        <Icon name="chevron-right" size={16} color="muted" />
      </Pressable>

      <View style={styles.action}>
        {isMobileMoney && !mobilePaid ? (
          cannotVerifyMobilePayment ? (
            <Button
              label="APPELER AGRIM"
              onPress={() => void callMobileSupport()}
              icon={<Icon name="phone" size={17} color="white" />}
            />
          ) : (
            <>
              <Button
                label={
                  mobilePayment.isFetching
                    ? 'VÉRIFICATION…'
                    : mobilePaymentStatusUnavailable
                      ? 'RÉESSAYER LA VÉRIFICATION'
                      : 'ACTUALISER LE PAIEMENT'
                }
                disabled={accessToken === undefined || mobilePayment.isFetching}
                onPress={() => void mobilePayment.refetch()}
                icon={<Icon name="refresh-cw" size={17} color="white" />}
              />
              <Button
                label="VOIR LE PAIEMENT"
                variant="outline"
                onPress={() => router.replace(`/paiement/${reference}`)}
                icon={<Icon name="smartphone" size={17} color="green" />}
              />
            </>
          )
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
  pendingMark: { backgroundColor: palette.goldSoft },
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
  action: { gap: spacing.sm, marginTop: 'auto', paddingTop: spacing.xl },
});
