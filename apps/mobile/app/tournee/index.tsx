import { useMyDeliveries, type Delivery } from '@/api/deliveries';
import { Card, Icon, Pill, Text, type PillTone } from '@/components/ui';
import { EmptyState, ErrorState, Skeleton } from '@/components/states';
import { formatDateTime, formatXof } from '@/lib/format';
import { palette, radius, spacing } from '@/theme/tokens';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Tournée du livreur.
 *
 * Priorité à la lisibilité en extérieur, souvent d'une seule main : peu
 * d'informations par carte, une action évidente, des zones tactiles larges.
 */

/** Présentation des statuts de course, décidée par l'interface. */
const STATUS_PRESENTATION: Record<
  Delivery['status'],
  { label: string; tone: PillTone }
> = {
  UNASSIGNED: { label: 'Non affectée', tone: 'neutral' },
  ASSIGNED: { label: 'À accepter', tone: 'warn' },
  ACCEPTED: { label: 'Acceptée', tone: 'info' },
  IN_TRANSIT: { label: 'En route', tone: 'info' },
  ARRIVED: { label: 'Sur place', tone: 'warn' },
  OTP_VERIFIED: { label: 'Code validé', tone: 'green' },
  DELIVERED: { label: 'Livrée', tone: 'green' },
  FAILED: { label: 'Échec', tone: 'danger' },
};

function DeliveryCard({ delivery }: { delivery: Delivery }) {
  const router = useRouter();
  const presentation = STATUS_PRESENTATION[delivery.status];
  const itemCount = delivery.order.items.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );

  return (
    <Pressable
      onPress={() => router.push(`/tournee/${delivery.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Course ${delivery.order.reference}`}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <Card style={styles.card}>
        <View style={styles.cardHeader}>
          <Text variant="h3">{delivery.order.reference}</Text>
          <Pill tone={presentation.tone} label={presentation.label} />
        </View>

        <View style={styles.row}>
          <Icon name="map-pin" size={15} color="muted" />
          <Text variant="body" color="body" style={styles.rowText}>
            {delivery.address.label} · {delivery.address.city}
          </Text>
        </View>

        {delivery.address.landmark ? (
          <View style={styles.row}>
            <Icon name="milestone" size={15} color="muted" />
            <Text variant="caption" color="muted" style={styles.rowText}>
              {delivery.address.landmark}
            </Text>
          </View>
        ) : null}

        <View style={styles.footer}>
          <Text variant="caption" color="muted">
            {itemCount} article{itemCount > 1 ? 's' : ''}
            {delivery.assignedAt
              ? ` · ${formatDateTime(delivery.assignedAt)}`
              : ''}
          </Text>
          <Text variant="h3" color="green">
            {formatXof(delivery.order.total)}
          </Text>
        </View>

        {/* Le montant à encaisser prime : le livreur ne doit pas avoir à
            chercher s'il repart avec de l'argent. */}
        {delivery.order.payment?.method === 'CASH_ON_DELIVERY' &&
        delivery.order.payment.status !== 'PAID' ? (
          <View style={styles.cashNotice}>
            <Icon name="banknote" size={15} color="warn" />
            <Text variant="caption" color="body" style={styles.rowText}>
              À encaisser à la livraison
            </Text>
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

export default function TourneeScreen() {
  const insets = useSafeAreaInsets();
  const [includeDone, setIncludeDone] = useState(false);
  const query = useMyDeliveries(includeDone);

  const toggle = useCallback(() => setIncludeDone((value) => !value), []);

  if (query.isPending) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
        <Text variant="h1">Ma tournée</Text>
        <View style={styles.skeletons}>
          <Skeleton height={128} />
          <Skeleton height={128} />
          <Skeleton height={128} />
        </View>
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={[
        styles.list,
        {
          paddingTop: insets.top + spacing.md,
          paddingBottom: insets.bottom + spacing.xl,
        },
      ]}
      data={query.data}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <DeliveryCard delivery={item} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text variant="h1">Ma tournée</Text>
          <Pressable
            onPress={toggle}
            accessibilityRole="switch"
            accessibilityState={{ checked: includeDone }}
            style={styles.filter}
          >
            <Icon
              name={includeDone ? 'check-square' : 'square'}
              size={16}
              color={includeDone ? 'green' : 'muted'}
            />
            <Text variant="caption" color="body">
              Voir les courses terminées
            </Text>
          </Pressable>
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          icon="package-check"
          title="Aucune course en cours"
          message="Les livraisons qui vous seront affectées apparaîtront ici."
        />
      }
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          tintColor={palette.green}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  list: { paddingHorizontal: spacing.md, gap: spacing.sm },
  header: { gap: spacing.sm, marginBottom: spacing.xs },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  skeletons: { gap: spacing.sm, marginTop: spacing.md },
  card: { gap: spacing.xs },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  rowText: { flex: 1 },
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  cashNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: palette.goldSoft,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.xs,
  },
  pressed: { opacity: 0.85 },
});
