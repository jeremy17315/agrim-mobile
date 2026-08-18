import { useNotifications } from '@/api/notifications';
import { useResendOtp } from '@/api/deliveries';
import { Button, Card, Icon, Text } from '@/components/ui';
import { palette, radius, spacing } from '@/theme/tokens';
import {
  DELIVERY_OTP_CONFIG,
  formatOtpForDisplay,
  type OrderStatus,
} from '@agrim/contracts';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * Code de livraison, côté client.
 *
 * Le code n'est jamais poussé en notification (un écran verrouillé est
 * visible de tous) : il n'existe que dans le message consultable en
 * application. Cette carte l'extrait et le met en évidence au moment où le
 * client en a besoin — quand le livreur est en route.
 *
 * Consigne affichée volontairement : le code ne se communique qu'au moment de
 * la remise, jamais par téléphone à l'avance.
 */
export function DeliveryCodeCard({
  reference,
  orderStatus,
}: {
  reference: string;
  orderStatus: OrderStatus;
}) {
  const [resendError, setResendError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  // Le code n'a de sens qu'une fois le livreur parti.
  const isRelevant = orderStatus === 'OUT_FOR_DELIVERY';

  const notifications = useNotifications(isRelevant);
  const resend = useResendOtp(reference);

  const code = useMemo(() => {
    if (!notifications.data) return null;

    // Le message le plus récent fait foi : un renvoi invalide le précédent.
    const message = notifications.data.data.find(
      (item) => item.type === 'DELIVERY_OTP',
    );
    if (!message) return null;

    const match = new RegExp(`\\b(\\d{${DELIVERY_OTP_CONFIG.length}})\\b`).exec(
      message.body,
    );
    return match?.[1] ?? null;
  }, [notifications.data]);

  if (!isRelevant) return null;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Icon name="key-round" size={18} color="gold" />
        <Text variant="h3" style={styles.flex}>
          Votre code de livraison
        </Text>
      </View>

      {code ? (
        <View
          style={styles.codeBox}
          accessibilityRole="text"
          accessibilityLabel={`Votre code de livraison est ${code.split('').join(' ')}`}
        >
          <Text variant="h1" style={styles.code}>
            {formatOtpForDisplay(code)}
          </Text>
        </View>
      ) : (
        <Text variant="caption" color="muted">
          {notifications.isPending
            ? 'Chargement de votre code…'
            : 'Votre code apparaîtra ici dès que le livreur sera en route.'}
        </Text>
      )}

      <Text variant="caption" color="body">
        Communiquez ce code au livreur uniquement à la remise de votre commande.
        Ne le donnez jamais par téléphone à l’avance.
      </Text>

      {resendError ? (
        <Text variant="caption" color="danger">
          {resendError}
        </Text>
      ) : null}

      {resent ? (
        <Text variant="caption" color="green">
          Nouveau code envoyé.
        </Text>
      ) : null}

      <Button
        label="Je n’ai pas reçu mon code"
        variant="ghost"
        size="sm"
        loading={resend.isPending}
        onPress={() => {
          setResendError(null);
          setResent(false);
          resend.mutate(undefined, {
            onSuccess: () => {
              setResent(true);
              void notifications.refetch();
            },
            onError: (error) =>
              setResendError(
                error instanceof Error
                  ? error.message
                  : 'Impossible de renvoyer le code pour le moment.',
              ),
          });
        }}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  codeBox: {
    backgroundColor: palette.goldSoft,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  code: { letterSpacing: 8, color: palette.ink },
});
