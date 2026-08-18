import {
  isCancellableByClient,
  ORDER_PROGRESS_STEPS,
  ORDER_STATUS_PRESENTATION,
  orderProgressIndex,
  type OrderStatus,
} from '@agrim/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { describeError } from '@/api/errors';
import { useCancelOrder, useOrder } from '@/api/orders';
import { OrderStatusPill } from '@/components/OrderStatusPill';
import { DeliveryCodeCard } from '@/components/DeliveryCodeCard';
import { LiveTrackingCard } from '@/components/LiveTrackingCard';
import { ErrorState, Skeleton } from '@/components/states';
import { Banner, Button, Card, Icon, Text } from '@/components/ui';
import { formatDateTime, formatXof } from '@/lib/format';
import { palette, radius, spacing } from '@/theme/tokens';

/**
 * Suivi d'une commande.
 *
 * Tout vient du serveur : montants, statut, chronologie. L'écran n'infère
 * jamais un statut — il affiche ce que l'API dit, et propose l'annulation
 * seulement quand elle est réellement possible (le backend retranche de toute
 * façon).
 */
export default function SuiviCommandeScreen() {
  const { reference, nouvelle } = useLocalSearchParams<{
    reference: string;
    nouvelle?: string;
  }>();
  const justCreated = nouvelle === '1';
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const order = useOrder(reference ?? '');
  const cancelOrder = useCancelOrder();
  const [cancelError, setCancelError] = useState<string | null>(null);

  const confirmCancel = () => {
    Alert.alert(
      'Annuler la commande',
      'Cette action est définitive. Les articles seront remis en stock.',
      [
        { text: 'Retour', style: 'cancel' },
        {
          text: 'Annuler la commande',
          style: 'destructive',
          onPress: () => {
            setCancelError(null);
            cancelOrder.mutate(reference ?? '', {
              onError: (error) => setCancelError(describeError(error)),
            });
          },
        },
      ],
    );
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
        <Text variant="h3" numberOfLines={1} style={styles.flex}>
          {reference}
        </Text>
      </View>

      {order.isError ? (
        <ErrorState error={order.error} onRetry={() => void order.refetch()} />
      ) : order.isPending ? (
        <View style={styles.loading}>
          <Skeleton height={70} />
          <Skeleton height={180} />
          <Skeleton height={140} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {justCreated ? (
            <View style={styles.success}>
              <View style={styles.check}>
                <Icon name="circle-check" size={30} color="white" />
              </View>
              <Text variant="h2" center>
                Commande enregistrée
              </Text>
              <Text variant="caption" color="muted" center>
                Nous vous contactons au plus vite pour la confirmation.
              </Text>
            </View>
          ) : null}

          <Card style={styles.head}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text variant="micro" color="muted">
                  COMMANDE
                </Text>
                <Text variant="h2">{order.data.reference}</Text>
              </View>
              <OrderStatusPill status={order.data.status} />
            </View>
            <Text variant="caption" color="body">
              {ORDER_STATUS_PRESENTATION[order.data.status].description}
            </Text>
            <Text variant="micro" color="muted">
              Passée {formatDateTime(order.data.createdAt)}
            </Text>
          </Card>

          {cancelError ? (
            <Banner
              tone="danger"
              message={cancelError}
              icon={<Icon name="triangle-alert" size={14} color="danger" />}
            />
          ) : null}

          {/* Carte temps réel : uniquement pendant que le livreur roule.
              Hors de cette fenêtre, la chronologie suffit. */}
          <LiveTrackingCard
            reference={order.data.reference}
            orderStatus={order.data.status}
          />

          {/* Code de validation : visible pendant que le livreur roule. */}
          <DeliveryCodeCard
            reference={order.data.reference}
            orderStatus={order.data.status}
          />

          <Card style={styles.card}>
            <Text variant="micro" color="muted">
              SUIVI
            </Text>
            <Timeline status={order.data.status} events={order.data.events} />
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

          {justCreated ? (
            <Button
              label="Retour à l’accueil"
              variant="outline"
              onPress={() => router.replace('/(tabs)')}
            />
          ) : null}

          {isCancellableByClient(order.data.status) ? (
            <Button
              label={
                cancelOrder.isPending ? 'Annulation…' : 'Annuler la commande'
              }
              variant="outline"
              disabled={cancelOrder.isPending}
              onPress={confirmCancel}
            />
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * Chronologie du parcours.
 *
 * Les étapes franchies portent la date réelle issue des événements serveur ;
 * les suivantes restent grisées. Une commande annulée n'affiche pas un
 * parcours qui continue : on montre l'interruption.
 */
function Timeline({
  status,
  events,
}: {
  status: OrderStatus;
  events: { id: string; status: OrderStatus; createdAt: string }[];
}) {
  const dateOf = (step: OrderStatus) =>
    events.find((event) => event.status === step)?.createdAt;

  if (status === 'CANCELLED') {
    const cancelledAt = dateOf('CANCELLED');
    return (
      <View style={styles.timeline}>
        <Step
          label={ORDER_STATUS_PRESENTATION.PENDING.label}
          date={dateOf('PENDING')}
          state="done"
          isLast={false}
        />
        <Step
          label={ORDER_STATUS_PRESENTATION.CANCELLED.label}
          date={cancelledAt}
          state="cancelled"
          isLast
        />
      </View>
    );
  }

  const currentIndex = orderProgressIndex(status);

  return (
    <View style={styles.timeline}>
      {ORDER_PROGRESS_STEPS.map((step, index) => (
        <Step
          key={step}
          label={ORDER_STATUS_PRESENTATION[step].label}
          date={dateOf(step)}
          state={
            index < currentIndex
              ? 'done'
              : index === currentIndex
                ? 'current'
                : 'todo'
          }
          isLast={index === ORDER_PROGRESS_STEPS.length - 1}
        />
      ))}
    </View>
  );
}

function Step({
  label,
  date,
  state,
  isLast,
}: {
  label: string;
  date?: string;
  state: 'done' | 'current' | 'todo' | 'cancelled';
  isLast: boolean;
}) {
  const done = state === 'done';
  const current = state === 'current';
  const cancelled = state === 'cancelled';

  return (
    <View style={styles.step}>
      <View style={styles.stepRail}>
        <View
          style={[
            styles.dot,
            done && styles.dotDone,
            current && styles.dotCurrent,
            cancelled && styles.dotCancelled,
          ]}
        >
          {done ? <Icon name="check" size={11} color="white" /> : null}
          {cancelled ? <Icon name="x" size={11} color="white" /> : null}
        </View>
        {!isLast ? (
          <View style={[styles.line, done && styles.lineDone]} />
        ) : null}
      </View>

      <View style={styles.stepBody}>
        <Text
          variant={current || cancelled ? 'bodyStrong' : 'caption'}
          color={done || current ? 'ink' : cancelled ? 'danger' : 'muted'}
        >
          {label}
        </Text>
        {date ? (
          <Text variant="micro" color="muted">
            {formatDateTime(date)}
          </Text>
        ) : null}
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
  loading: { padding: spacing.lg, gap: spacing.md },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  success: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  check: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: palette.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  head: { gap: spacing.sm },
  card: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  flex: { flex: 1 },
  separator: { height: 1, backgroundColor: palette.line },

  timeline: { marginTop: spacing.xs },
  step: { flexDirection: 'row', gap: spacing.md },
  stepRail: { alignItems: 'center', width: 22 },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: palette.line,
    backgroundColor: palette.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: palette.green, borderColor: palette.green },
  dotCurrent: { borderColor: palette.green, borderWidth: 5 },
  dotCancelled: {
    backgroundColor: palette.danger,
    borderColor: palette.danger,
  },
  line: {
    width: 2,
    flex: 1,
    minHeight: 26,
    backgroundColor: palette.line,
    borderRadius: radius.pill,
  },
  lineDone: { backgroundColor: palette.green },
  stepBody: { flex: 1, paddingBottom: spacing.lg, gap: 1 },
});
