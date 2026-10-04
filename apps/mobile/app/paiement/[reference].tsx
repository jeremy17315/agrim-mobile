import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useGuestPaymentStatus, useInitiateGuestPayment } from '@/api/payments';
import { describeError } from '@/api/errors';
import { CheckoutProgress } from '@/components/CheckoutProgress';
import { Banner, Button, Card, Icon, Text } from '@/components/ui';
import { formatXof } from '@/lib/format';
import { getGuestPaymentAccess } from '@/lib/guestPayment';
import { palette, spacing } from '@/theme/tokens';

/**
 * Suite du checkout invité : même passerelle que le site, avec une capacité
 * temporaire stockée localement à la place d'une session client.
 */
export default function GuestPaymentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { reference } = useLocalSearchParams<{ reference: string }>();
  const [accessToken, setAccessToken] = useState<string | null | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const initiate = useInitiateGuestPayment();
  const payment = useGuestPaymentStatus(reference ?? '', accessToken ?? null);

  useEffect(() => {
    let active = true;
    void getGuestPaymentAccess(reference ?? '').then((token) => {
      if (active) setAccessToken(token);
    });
    return () => {
      active = false;
    };
  }, [reference]);

  useEffect(() => {
    if (payment.data?.status !== 'SUCCEEDED' || !reference) return;
    // La capacité reste disponible un court instant pour que la confirmation
    // lise elle aussi le statut réellement confirmé par le serveur.
    router.replace(`/confirmation/${reference}?payment=MOBILE_MONEY`);
  }, [payment.data?.status, reference, router]);

  const beginPayment = async () => {
    if (!reference || !accessToken) return;
    setError(null);
    try {
      const result = await initiate.mutateAsync({
        reference,
        token: accessToken,
      });
      await payment.refetch();
      if (result.checkoutUrl) await Linking.openURL(result.checkoutUrl);
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const status = payment.data?.status;
  const failed = status === 'FAILED' || status === 'EXPIRED';
  const started =
    payment.data?.providerReference !== null &&
    payment.data?.providerReference !== undefined;

  if (accessToken === undefined) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.xl }]}>
        <Text variant="body" color="muted" center>
          Préparation du paiement sécurisé…
        </Text>
      </View>
    );
  }

  if (!accessToken) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.xl }]}>
        <View style={styles.lostAccess}>
          <Icon name="lock-keyhole" size={34} color="gold" />
          <Text variant="h1" center>
            Session de paiement expirée
          </Text>
          <Text variant="body" color="muted" center>
            Pour protéger votre commande, la session de paiement est limitée
            dans le temps. Recommencez simplement votre commande.
          </Text>
          <Button
            label="RETOUR AUX PRODUITS"
            onPress={() => router.replace('/catalogue')}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Retour à la commande"
          hitSlop={12}
          style={styles.backButton}
        >
          <Icon name="arrow-left" size={19} color="ink" />
        </Pressable>
        <Text variant="h3">Paiement sécurisé</Text>
      </View>
      <View style={styles.progress}>
        <CheckoutProgress step={3} />
      </View>

      <View style={styles.content}>
        <View style={styles.intro}>
          <Text variant="micro" color="green" style={styles.stepLabel}>
            ÉTAPE PAIEMENT
          </Text>
          <Text variant="h1">Validez votre règlement</Text>
          <Text variant="body" color="muted">
            Vous allez être redirigé vers la page sécurisée de votre opérateur.
          </Text>
        </View>

        {error || payment.isError ? (
          <Banner
            tone="danger"
            message={error ?? 'Le statut du paiement est indisponible.'}
            icon={<Icon name="triangle-alert" size={15} color="danger" />}
          />
        ) : null}

        <Card style={styles.amountCard}>
          <View style={styles.amountHead}>
            <View style={styles.walletIcon}>
              <Icon name="smartphone" size={22} color="green" />
            </View>
            <View style={styles.flex}>
              <Text variant="h3">Mobile Money</Text>
              <Text variant="caption" color="muted">
                {payment.data?.provider?.replace('_', ' ') ??
                  'Opérateur choisi'}
              </Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.amountRow}>
            <Text variant="bodyStrong">Montant à régler</Text>
            <Text variant="h1" color="green">
              {payment.data ? formatXof(payment.data.amount) : '…'}
            </Text>
          </View>
          {reference ? (
            <Text variant="caption" color="muted">
              Commande {reference}
            </Text>
          ) : null}
        </Card>

        {started && !failed ? (
          <Card style={styles.awaiting} flat>
            <Icon name="clock-3" size={20} color="goldDark" />
            <View style={styles.flex}>
              <Text variant="h3">Paiement en attente de validation</Text>
              <Text variant="caption" color="muted">
                Revenez ici après avoir validé chez votre opérateur : le statut
                se met à jour automatiquement.
              </Text>
            </View>
          </Card>
        ) : null}

        {failed ? (
          <Banner
            tone="warning"
            message="Le paiement n’a pas abouti. Votre commande a été annulée et aucun montant n’est prélevé par AGRIM."
            icon={<Icon name="circle-x" size={16} color="#8A5310" />}
          />
        ) : null}
      </View>

      <View
        style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}
      >
        {failed ? (
          <Button
            label="RETOUR AUX PRODUITS"
            variant="outline"
            onPress={() => router.replace('/catalogue')}
          />
        ) : (
          <Button
            label={
              initiate.isPending
                ? 'OUVERTURE DU PAIEMENT…'
                : started
                  ? 'RÉESSAYER / VÉRIFIER'
                  : 'PAYER MAINTENANT'
            }
            disabled={initiate.isPending || payment.isFetching}
            onPress={() => void beginPayment()}
            icon={<Icon name="shield-check" size={18} color="white" />}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
  },
  progress: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  content: { flex: 1, gap: spacing.lg, padding: spacing.lg },
  intro: { gap: spacing.xs },
  stepLabel: { letterSpacing: 1.4 },
  amountCard: { gap: spacing.md, padding: spacing.lg },
  amountHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  walletIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: palette.greenSoft,
  },
  flex: { flex: 1 },
  divider: { height: 1, backgroundColor: palette.line },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  awaiting: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: palette.goldSoft,
    borderColor: '#EAD9A5',
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: palette.card,
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  lostAccess: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
});
