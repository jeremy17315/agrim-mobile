import { useDeliveryCode, useResendOtp } from '@/api/deliveries';
import { Button, Card, Icon, Text } from '@/components/ui';
import { palette, radius, spacing } from '@/theme/tokens';
import { formatOtpForDisplay, type OrderStatus } from '@agrim/contracts';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * Code de livraison, côté client.
 *
 * Le code n'est jamais poussé en notification (un écran verrouillé est visible
 * de tous) et n'est pas stocké en clair : il est chiffré en base et demandé au
 * serveur au moment où le client en a besoin — quand le livreur est en route.
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

  const otp = useDeliveryCode(reference, isRelevant);
  const resend = useResendOtp(reference);

  const code = otp.data?.code ?? null;

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
          {otp.isPending
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
              void otp.refetch();
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
