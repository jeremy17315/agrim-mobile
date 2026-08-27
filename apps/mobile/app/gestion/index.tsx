import {
  awaitsCourierAssignment,
  managerActionFor,
  type OrderStatus,
} from '@agrim/contracts';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useCouriers,
  useManagedOrders,
  useManagerDashboard,
  useUpdateOrderStatus,
  useAssignCourier,
  type ManagedOrder,
} from '@/api/management';
import { EmptyState, ErrorState, Skeleton } from '@/components/states';
import { OrderStatusPill } from '@/components/OrderStatusPill';
import { Banner, Button, Card, Icon, Text } from '@/components/ui';
import { formatRelativeTime, formatXof } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { palette, radius, spacing } from '@/theme/tokens';

/**
 * Tableau de bord opérationnel.
 *
 * Objectif : voir en un écran ce qui bloque et agir sans naviguer. Chaque
 * carte porte l'action attendue à cet instant — le gestionnaire n'a pas à
 * connaître la machine à états.
 */
export default function GestionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const dashboard = useManagerDashboard();
  const orders = useManagedOrders();
  const couriers = useCouriers();
  const updateStatus = useUpdateOrderStatus();
  const assignCourier = useAssignCourier();

  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([dashboard.refetch(), orders.refetch()]);
    setRefreshing(false);
  }, [dashboard, orders]);

  const advance = (order: ManagedOrder, next: OrderStatus) => {
    updateStatus.mutate(
      { reference: order.reference, status: next },
      {
        onError: () =>
          Alert.alert(
            'Action impossible',
            'La commande a peut-être changé entre-temps. Rafraîchissez la liste.',
          ),
      },
    );
  };

  /**
   * Assignation : le choix du livreur se fait sur sa charge courante, pour
   * éviter d'empiler les courses sur la même personne.
   */
  const chooseCourier = (order: ManagedOrder) => {
    const available = couriers.data ?? [];
    if (available.length === 0) {
      Alert.alert('Aucun livreur', 'Aucun livreur actif n’est disponible.');
      return;
    }

    Alert.alert(`Assigner ${order.reference}`, 'Choisissez un livreur.', [
      ...available.slice(0, 3).map((courier) => ({
        text: `${courier.firstName} ${courier.lastName} (${courier.activeDeliveries})`,
        onPress: () =>
          assignCourier.mutate(
            { reference: order.reference, courierId: courier.id },
            {
              onError: () =>
                Alert.alert(
                  'Assignation impossible',
                  'Cette course est peut-être déjà prise en charge.',
                ),
            },
          ),
      })),
      { text: 'Annuler', style: 'cancel' as const },
    ]);
  };

  const isLoading = dashboard.isLoading || orders.isLoading;
  const error = dashboard.error ?? orders.error;

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.flex}>
          <Text variant="h1">Tableau de bord</Text>
          {user ? (
            <Text variant="caption" color="muted">
              {user.firstName} {user.lastName} · Gestion
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => router.push('/gestion/recoltes')}
          accessibilityRole="button"
          accessibilityLabel="Récoltes à examiner"
          hitSlop={12}
          style={styles.headerAction}
        >
          <Icon name="wheat" size={20} color="ink" />
        </Pressable>
        <Pressable
          onPress={() => router.push('/gestion/stocks')}
          accessibilityRole="button"
          accessibilityLabel="Stocks"
          hitSlop={12}
        >
          <Icon name="boxes" size={20} color="ink" />
        </Pressable>
      </View>

      {error ? (
        <ErrorState error={error} onRetry={() => void refresh()} />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.body,
            { paddingBottom: insets.bottom + spacing.xxxl },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={palette.green}
            />
          }
        >
          {/* Une alerte n'apparaît que s'il y a réellement matière à agir. */}
          {!isLoading && dashboard.data ? (
            <AlertBanner
              lowStock={dashboard.data.lowStockCount}
              stale={dashboard.data.stalePendingCount}
              onPressStock={() => router.push('/gestion/stocks')}
            />
          ) : null}

          <View style={styles.kpis}>
            <Kpi
              label="CA du jour"
              value={
                isLoading ? '—' : formatXof(dashboard.data?.revenueToday ?? 0)
              }
            />
            <Kpi
              label="Commandes"
              value={isLoading ? '—' : String(dashboard.data?.ordersToday ?? 0)}
            />
            <Kpi
              label="À préparer"
              value={isLoading ? '—' : String(dashboard.data?.toPrepare ?? 0)}
            />
            <Kpi
              label="Livraisons"
              value={
                isLoading ? '—' : String(dashboard.data?.activeDeliveries ?? 0)
              }
            />
          </View>

          <View style={styles.sectionHeader}>
            <Text variant="h2">File de préparation</Text>
            {orders.data ? (
              <View style={styles.count}>
                <Text variant="micro" color="white">
                  {orders.data.length}
                </Text>
              </View>
            ) : null}
          </View>

          {isLoading ? (
            <Card style={styles.loadingCard}>
              <Skeleton height={14} width={140} />
              <Skeleton height={10} width={200} />
            </Card>
          ) : orders.data && orders.data.length > 0 ? (
            orders.data.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                busy={updateStatus.isPending || assignCourier.isPending}
                onAdvance={(next) => advance(order, next)}
                onAssign={() => chooseCourier(order)}
                onOpen={() => router.push(`/gestion/${order.reference}`)}
              />
            ))
          ) : (
            <EmptyState
              icon="circle-check"
              title="Rien en attente"
              message="Toutes les commandes du jour sont traitées."
            />
          )}
        </ScrollView>
      )}
    </View>
  );
}

function AlertBanner({
  lowStock,
  stale,
  onPressStock,
}: {
  lowStock: number;
  stale: number;
  onPressStock: () => void;
}) {
  const parts: string[] = [];
  if (lowStock > 0) {
    parts.push(
      lowStock === 1 ? '1 stock faible' : `${lowStock} stocks faibles`,
    );
  }
  if (stale > 0) {
    parts.push(
      stale === 1
        ? '1 commande en attente depuis plus d’une heure'
        : `${stale} commandes en attente depuis plus d’une heure`,
    );
  }
  if (parts.length === 0) return null;

  return (
    <Pressable
      onPress={onPressStock}
      accessibilityRole="button"
      accessibilityLabel={`Alertes : ${parts.join(', ')}`}
    >
      <View style={styles.alert}>
        <Icon name="triangle-alert" size={15} color="danger" />
        <Text variant="caption" color="body" style={styles.flex}>
          {parts.join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card style={styles.kpi}>
      <Text variant="micro" color="muted">
        {label.toUpperCase()}
      </Text>
      <Text variant="h2">{value}</Text>
    </Card>
  );
}

function OrderRow({
  order,
  busy,
  onAdvance,
  onAssign,
  onOpen,
}: {
  order: ManagedOrder;
  busy: boolean;
  onAdvance: (next: OrderStatus) => void;
  onAssign: () => void;
  onOpen: () => void;
}) {
  const action = managerActionFor(order.status);
  const needsCourier = awaitsCourierAssignment(order.status);

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Ouvrir ${order.reference}`}
      >
        <View style={styles.cardHeader}>
          <Text variant="bodyStrong" style={styles.reference}>
            {order.reference}
          </Text>
          <OrderStatusPill status={order.status} />
        </View>

        <Text variant="caption" color="muted">
          {order.customerName} · {order.itemCount}{' '}
          {order.itemCount > 1 ? 'articles' : 'article'}
          {order.city ? ` · ${order.city}` : ''}
        </Text>

        {/*
          Sans ce bandeau, une commande revenue d'une tentative ratée serait
          indiscernable d'une commande jamais partie : toutes deux sont à
          « prête ». Le gestionnaire relancerait un livreur sans savoir qu'il
          s'agit d'un second passage, ni pourquoi le premier a échoué.
        */}
        {order.awaitingRetry ? (
          <Banner
            tone="warning"
            style={styles.retryBanner}
            icon={<Icon name="package-x" size={14} color="gold" />}
            message={
              order.deliveryFailureReason
                ? `Livraison non aboutie : ${order.deliveryFailureReason}`
                : 'Livraison non aboutie. À replanifier ou à annuler.'
            }
          />
        ) : null}
      </Pressable>

      <View style={styles.cardFooter}>
        <View style={styles.flex}>
          <Text variant="caption" color="muted">
            {formatRelativeTime(order.createdAt)}
          </Text>
          <Text variant="bodyStrong">{formatXof(order.total)}</Text>
        </View>

        {/* Une commande prête attend un livreur, pas un changement d'état. */}
        {needsCourier ? (
          order.hasCourier ? (
            <View style={styles.assigned}>
              <Icon name="check" size={13} color="green" />
              <Text variant="caption" color="green">
                Assignée
              </Text>
            </View>
          ) : (
            <Button
              label={order.awaitingRetry ? 'Réassigner' : 'Assigner'}
              size="sm"
              onPress={onAssign}
              disabled={busy}
            />
          )
        ) : action ? (
          <Button
            label={action.label}
            size="sm"
            onPress={() => onAdvance(action.next)}
            disabled={busy}
          />
        ) : null}
      </View>
    </Card>
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
  body: { padding: spacing.lg, paddingTop: 0, gap: spacing.md },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#FBEAE7',
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kpi: { flexBasis: '47%', flexGrow: 1, gap: 2 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  count: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { gap: spacing.sm },
  loadingCard: { gap: spacing.sm },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: 4,
  },
  reference: { fontVariant: ['tabular-nums'] },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  assigned: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  retryBanner: { marginTop: spacing.sm },
  flex: { flex: 1 },
  headerAction: { marginRight: spacing.md },
});
