import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOrder } from '@/api/orders';
import { ErrorState, Skeleton } from '@/components/states';
import { Card, Icon, Pill, Text } from '@/components/ui';
import { Button } from '@/components/ui';
import { formatXof } from '@/lib/format';
import { palette, radius, spacing } from '@/theme/tokens';

/**
 * Confirmation de commande.
 *
 * Les montants affichés ici viennent du SERVEUR, pas du panier local : c'est
 * le seul récapitulatif qui fasse foi. La référence est mise en évidence car
 * c'est ce que le client donnera au téléphone en cas de question.
 */
export default function ConfirmationScreen() {
  const { reference } = useLocalSearchParams<{ reference: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const order = useOrder(reference ?? '');

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable
          onPress={() => router.replace('/(tabs)')}
          accessibilityRole="button"
          accessibilityLabel="Fermer"
          hitSlop={12}
        >
          <Icon name="x" size={20} color="ink" />
        </Pressable>
        <Text variant="h3">Commande</Text>
      </View>

      {order.isError ? (
        <ErrorState error={order.error} onRetry={() => void order.refetch()} />
      ) : order.isPending ? (
        <View style={styles.loading}>
          <Skeleton height={120} />
          <Skeleton height={90} />
          <Skeleton height={140} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <View style={styles.check}>
              <Icon name="circle-check" size={34} color="white" />
            </View>
            <Text variant="h1" center>
              Commande enregistrée
            </Text>
            <Text variant="caption" color="muted" center>
              Nous vous contactons au plus vite pour la confirmation.
            </Text>
            <View style={styles.reference}>
              <Text variant="micro" color="muted">
                RÉFÉRENCE
              </Text>
              <Text variant="h2" color="greenDeep">
                {order.data.reference}
              </Text>
            </View>
          </View>

          <Card style={styles.card}>
            <View style={styles.row}>
              <Text variant="caption" color="muted">
                Statut
              </Text>
              <Pill label="En attente" tone="gold" />
            </View>
            <View style={styles.row}>
              <Text variant="caption" color="muted">
                Paiement
              </Text>
              <Text variant="caption">
                {order.data.payment?.method === 'CASH_ON_DELIVERY'
                  ? 'À la livraison'
                  : 'À régler'}
              </Text>
            </View>
          </Card>

          <Card style={styles.card}>
            <Text variant="micro" color="muted">
              LIVRAISON
            </Text>
            <Text variant="bodyStrong">{order.data.address.label}</Text>
            <Text variant="caption" color="body">
              {[order.data.address.commune, order.data.address.city]
                .filter(Boolean)
                .join(', ')}
            </Text>
            {order.data.address.landmark ? (
              <Text variant="caption" color="muted">
                Repère : {order.data.address.landmark}
              </Text>
            ) : null}
            <Text variant="caption" color="muted">
              {order.data.address.contactPhone}
            </Text>
          </Card>

          <Card style={styles.card}>
            <Text variant="micro" color="muted">
              ARTICLES
            </Text>
            {order.data.items.map((item) => (
              <View key={item.id} style={styles.row}>
                <Text variant="caption" color="body" style={styles.flex}>
                  {item.quantity} × {item.productName} ({item.variantLabel})
                </Text>
                <Text variant="caption">{formatXof(item.lineTotal)}</Text>
              </View>
            ))}

            <View style={styles.separator} />

            <View style={styles.row}>
              <Text variant="caption" color="muted">
                Sous-total
              </Text>
              <Text variant="bodyStrong">{formatXof(order.data.subtotal)}</Text>
            </View>
            <View style={styles.row}>
              <Text variant="caption" color="muted">
                Livraison
              </Text>
              <Text
                variant="bodyStrong"
                color={order.data.deliveryFee === 0 ? 'green' : 'ink'}
              >
                {order.data.deliveryFee === 0
                  ? 'Offerte'
                  : formatXof(order.data.deliveryFee)}
              </Text>
            </View>

            <View style={styles.separator} />

            <View style={styles.row}>
              <Text variant="h3">Total</Text>
              <Text variant="h1" color="green">
                {formatXof(order.data.total)}
              </Text>
            </View>
          </Card>

          <Button
            label="Retour à l’accueil"
            variant="outline"
            onPress={() => router.replace('/(tabs)')}
          />
        </ScrollView>
      )}
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
  loading: { padding: spacing.lg, gap: spacing.md },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  hero: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.lg },
  check: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: palette.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  reference: {
    alignItems: 'center',
    gap: 2,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: palette.greenSoft,
  },
  card: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  flex: { flex: 1 },
  separator: { height: 1, backgroundColor: palette.line },
});
