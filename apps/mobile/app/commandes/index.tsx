import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOrders, type OrderSummary } from '@/api/orders';
import { OrderStatusPill } from '@/components/OrderStatusPill';
import { EmptyState, ErrorState, Skeleton } from '@/components/states';
import { Button, Card, Icon, Text } from '@/components/ui';
import { formatRelativeTime, formatXof } from '@/lib/format';
import { palette, spacing } from '@/theme/tokens';

/**
 * Historique des commandes.
 *
 * Liste volontairement allégée (pas le détail des articles) : sur un réseau
 * lent, charger chaque ligne serait coûteux pour une information que le client
 * ne lit qu'en ouvrant la commande.
 */
export default function CommandesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const orders = useOrders();

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          hitSlop={12}
        >
          <Icon name="arrow-left" size={19} color="ink" />
        </Pressable>
        <Text variant="h1">Mes commandes</Text>
      </View>

      {orders.isError ? (
        <ErrorState
          error={orders.error}
          onRetry={() => void orders.refetch()}
        />
      ) : orders.isPending ? (
        <View style={styles.loading}>
          <Skeleton height={92} />
          <Skeleton height={92} />
          <Skeleton height={92} />
        </View>
      ) : orders.data.data.length === 0 ? (
        <EmptyState
          icon="package"
          title="Aucune commande"
          message="Vos commandes apparaîtront ici."
          action={
            <Button
              label="Voir le catalogue"
              variant="outline"
              size="sm"
              fullWidth={false}
              onPress={() => router.replace('/catalogue')}
            />
          }
        />
      ) : (
        <FlatList
          data={orders.data.data}
          keyExtractor={(order) => order.id}
          contentContainerStyle={styles.list}
          refreshing={orders.isFetching}
          onRefresh={() => void orders.refetch()}
          renderItem={({ item }) => (
            <OrderRow
              order={item}
              onPress={() => router.push(`/commandes/${item.reference}`)}
            />
          )}
        />
      )}
    </View>
  );
}

function OrderRow({
  order,
  onPress,
}: {
  order: OrderSummary;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Commande ${order.reference}, ${formatXof(order.total)}`}
    >
      <Card style={styles.row}>
        <View style={styles.rowHead}>
          <Text variant="h3" style={styles.flex}>
            {order.reference}
          </Text>
          <OrderStatusPill status={order.status} />
        </View>

        <View style={styles.rowFoot}>
          <Text variant="caption" color="muted">
            {order.itemCount} article{order.itemCount > 1 ? 's' : ''} ·{' '}
            {formatRelativeTime(order.createdAt)}
          </Text>
          <Text variant="h3" color="green">
            {formatXof(order.total)}
          </Text>
        </View>
      </Card>
    </Pressable>
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
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  row: { gap: spacing.sm },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  flex: { flex: 1 },
});
