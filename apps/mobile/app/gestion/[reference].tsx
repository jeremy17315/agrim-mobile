import {
  awaitsCourierAssignment,
  isCancellableByManager,
  managerActionFor,
  ORDER_STATUS_PRESENTATION,
  type OrderStatus,
} from '@agrim/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useCouriers,
  useManagedOrders,
  useUpdateOrderStatus,
  useAssignCourier,
} from '@/api/management';
import { OrderStatusPill } from '@/components/OrderStatusPill';
import { EmptyState, ErrorState, Skeleton } from '@/components/states';
import { Button, Card, Icon, Text } from '@/components/ui';
import { formatPhone, formatRelativeTime, formatXof } from '@/lib/format';
import { palette, radius, spacing } from '@/theme/tokens';

/**
 * Détail d'une commande côté gestion.
 *
 * Écran de décision : le gestionnaire y trouve de quoi préparer le colis,
 * joindre le client, et faire avancer la commande. Le détail lui-même est
 * chargé via la file (déjà en cache) — inutile d'ajouter un aller-retour pour
 * une information que l'écran précédent possède.
 */
export default function GestionCommandeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { reference } = useLocalSearchParams<{ reference: string }>();

  const orders = useManagedOrders({ search: reference });
  const couriers = useCouriers();
  const updateStatus = useUpdateOrderStatus();
  const assignCourier = useAssignCourier();

  const order = orders.data?.find((o) => o.reference === reference);
  const action = order ? managerActionFor(order.status) : null;
  const needsCourier = order ? awaitsCourierAssignment(order.status) : false;
  const canCancel = order ? isCancellableByManager(order.status) : false;
  const busy = updateStatus.isPending || assignCourier.isPending;

  const advance = (next: OrderStatus) => {
    if (!order) return;
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

  const confirmCancel = () => {
    if (!order) return;
    Alert.alert(
      'Annuler la commande',
      `${order.reference} sera annulée et le stock restitué. Le client en sera informé.`,
      [
        { text: 'Revenir', style: 'cancel' },
        {
          text: 'Annuler la commande',
          style: 'destructive',
          onPress: () =>
            updateStatus.mutate(
              { reference: order.reference, status: 'CANCELLED' },
              {
                onSuccess: () => router.back(),
                onError: () =>
                  Alert.alert(
                    'Annulation impossible',
                    'Cette commande est peut-être déjà partie en livraison.',
                  ),
              },
            ),
        },
      ],
    );
  };

  const chooseCourier = () => {
    if (!order) return;
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

  /** Le téléphone reste le canal le plus sûr en cas de doute sur l'adresse. */
  const callCustomer = () => {
    if (!order) return;
    void Linking.openURL(`tel:${order.customerPhone}`);
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          hitSlop={12}
        >
          <Icon name="arrow-left" size={19} color="ink" />
        </Pressable>
        <Text variant="h1" style={styles.reference}>
          {reference}
        </Text>
      </View>

      {orders.isError ? (
        <ErrorState
          error={orders.error}
          onRetry={() => void orders.refetch()}
        />
      ) : orders.isLoading ? (
        <View style={styles.body}>
          <Card style={styles.card}>
            <Skeleton height={14} width={160} />
            <Skeleton height={10} width={220} />
          </Card>
        </View>
      ) : !order ? (
        <EmptyState
          icon="package"
          title="Commande introuvable"
          message="Elle a peut-être été traitée ou annulée."
        />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.body,
            { paddingBottom: insets.bottom + spacing.xxxl },
          ]}
        >
          <Card style={styles.card}>
            <View style={styles.rowBetween}>
              <OrderStatusPill status={order.status} />
              <Text variant="caption" color="muted">
                {formatRelativeTime(order.createdAt)}
              </Text>
            </View>
            <Text variant="caption" color="body">
              {ORDER_STATUS_PRESENTATION[order.status].description}
            </Text>
          </Card>

          <Card style={styles.card}>
            <Text variant="h3">Client</Text>
            <View style={styles.row}>
              <Icon name="user" size={14} color="muted" />
              <Text variant="body" style={styles.flex}>
                {order.customerName}
              </Text>
            </View>
            <Pressable
              onPress={callCustomer}
              accessibilityRole="button"
              accessibilityLabel={`Appeler ${order.customerName}`}
              style={styles.row}
              hitSlop={8}
            >
              <Icon name="phone" size={14} color="green" />
              <Text variant="body" color="green">
                {formatPhone(order.customerPhone)}
              </Text>
            </Pressable>
            {order.city ? (
              <View style={styles.row}>
                <Icon name="map-pin" size={14} color="muted" />
                <Text variant="caption" color="muted" style={styles.flex}>
                  {order.city}
                </Text>
              </View>
            ) : null}
          </Card>

          <Card style={styles.card}>
            <View style={styles.rowBetween}>
              <Text variant="h3">Contenu</Text>
              <Text variant="caption" color="muted">
                {order.itemCount} {order.itemCount > 1 ? 'articles' : 'article'}
              </Text>
            </View>
            <View style={styles.total}>
              <Text variant="body" style={styles.flex}>
                Total
              </Text>
              <Text variant="h2" color="green">
                {formatXof(order.total)}
              </Text>
            </View>
          </Card>

          {order.hasCourier ? (
            <View style={styles.assigned}>
              <Icon name="truck" size={15} color="green" />
              <Text variant="caption" color="body" style={styles.flex}>
                Un livreur est affecté à cette commande.
              </Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            {needsCourier && !order.hasCourier ? (
              <Button
                label="Assigner un livreur"
                onPress={chooseCourier}
                loading={busy}
              />
            ) : action ? (
              <Button
                label={action.label}
                onPress={() => advance(action.next)}
                loading={busy}
              />
            ) : null}

            {canCancel ? (
              <Button
                label="Annuler la commande"
                variant="outline"
                onPress={confirmCancel}
                disabled={busy}
              />
            ) : null}
          </View>

          {/* Rappel du partage des rôles, pour éviter l'attente inutile. */}
          {order.status === 'READY' && order.hasCourier ? (
            <Text variant="caption" color="muted">
              La suite dépend du livreur : la commande passera en livraison dès
              qu’il aura récupéré le colis.
            </Text>
          ) : null}
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
  reference: { fontVariant: ['tabular-nums'] },
  body: { padding: spacing.lg, paddingTop: 0, gap: spacing.md },
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  total: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.line,
    paddingTop: spacing.sm,
  },
  assigned: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.greenSoft,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  actions: { gap: spacing.sm },
  flex: { flex: 1 },
});
