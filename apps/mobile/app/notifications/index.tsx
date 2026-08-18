import type { NotificationType } from '@agrim/contracts';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useMarkNotificationsRead,
  useNotifications,
  type NotificationItem,
} from '@/api/notifications';
import { useOrders } from '@/api/orders';
import { EmptyState, ErrorState, Skeleton } from '@/components/states';
import { Card, Icon, Text, type IconName } from '@/components/ui';
import { formatRelativeTime } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { palette, radius, spacing } from '@/theme/tokens';

/**
 * Centre de notifications.
 *
 * Les notifications sont marquées comme lues à la sortie de l'écran, pas à
 * l'entrée : le client doit pouvoir repérer d'un coup d'œil ce qui est nouveau
 * pendant qu'il lit, sans que la pastille disparaisse sous ses yeux.
 */
export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.accessToken !== null);

  const notifications = useNotifications(isAuthenticated);
  const markRead = useMarkNotificationsRead();
  const orders = useOrders(isAuthenticated);

  const hasUnread = (notifications.data?.meta.unread ?? 0) > 0;

  // La ref sert a lire l'etat au moment ou l'ecran perd le focus, sans
  // reabonner l'effet a chaque changement. Elle est mise a jour apres le
  // rendu : ecrire une ref pendant le rendu casse le rendu concurrent.
  const hasUnreadRef = useRef(hasUnread);
  useEffect(() => {
    hasUnreadRef.current = hasUnread;
  }, [hasUnread]);

  useFocusEffect(
    useCallback(() => {
      // Au retrait du focus uniquement.
      return () => {
        if (hasUnreadRef.current) markRead.mutate(undefined);
      };
      // `markRead` est stable pour une instance de mutation donnée.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  /**
   * Une notification liée à une commande doit y mener. L'identifiant interne
   * ne sert à rien à la navigation : on retrouve la référence dans
   * l'historique déjà chargé, et à défaut on ouvre la liste.
   */
  const openTarget = (item: NotificationItem) => {
    if (!item.orderId) return;
    const match = orders.data?.data.find((order) => order.id === item.orderId);

    if (match) router.push(`/commandes/${match.reference}`);
    else router.push('/commandes');
  };

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
        <Text variant="h1">Notifications</Text>
      </View>

      {!isAuthenticated ? (
        <EmptyState
          icon="bell"
          title="Connexion requise"
          message="Connectez-vous pour suivre vos commandes et vos livraisons."
        />
      ) : notifications.isError ? (
        <ErrorState
          error={notifications.error}
          onRetry={() => void notifications.refetch()}
        />
      ) : notifications.isLoading ? (
        <View style={styles.loading}>
          {Array.from({ length: 5 }).map((_, index) => (
            <Card key={index} style={styles.skeletonRow}>
              <Skeleton height={34} width={34} />
              <View style={styles.flex}>
                <Skeleton height={12} width={160} />
                <Skeleton height={10} width={220} />
              </View>
            </Card>
          ))}
        </View>
      ) : (
        <FlatList
          data={notifications.data?.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshing={notifications.isRefetching}
          onRefresh={() => void notifications.refetch()}
          ListEmptyComponent={
            <EmptyState
              icon="bell"
              title="Aucune notification"
              message="Vous serez prévenu de chaque étape de vos commandes."
            />
          }
          renderItem={({ item }) => (
            <NotificationRow item={item} onPress={() => openTarget(item)} />
          )}
        />
      )}
    </View>
  );
}

function NotificationRow({
  item,
  onPress,
}: {
  item: NotificationItem;
  onPress: () => void;
}) {
  const { icon, tint } = PRESENTATION[item.type];
  const actionable = item.orderId !== null;

  return (
    <Pressable
      onPress={actionable ? onPress : undefined}
      disabled={!actionable}
      accessibilityRole={actionable ? 'button' : undefined}
      accessibilityLabel={`${item.title}. ${item.body}`}
    >
      <Card style={[styles.row, item.isRead ? null : styles.unread]}>
        <View style={[styles.bubble, { backgroundColor: tint.bg }]}>
          <Icon name={icon} size={17} color={tint.icon} />
        </View>
        <View style={styles.flex}>
          <View style={styles.titleLine}>
            <Text variant="h3" style={styles.flex} numberOfLines={1}>
              {item.title}
            </Text>
            {item.isRead ? null : <View style={styles.dot} />}
          </View>
          <Text variant="caption" color="body">
            {item.body}
          </Text>
          <Text variant="micro" color="muted">
            {formatRelativeTime(item.createdAt)}
          </Text>
        </View>
        {actionable ? (
          <Icon name="chevron-right" size={16} color="muted" />
        ) : null}
      </Card>
    </Pressable>
  );
}

/**
 * Présentation par type. Un incident (échec de paiement) doit se distinguer
 * d'une bonne nouvelle sans reposer uniquement sur la couleur.
 */
const PRESENTATION: Record<
  NotificationType,
  { icon: IconName; tint: { bg: string; icon: 'green' | 'gold' | 'danger' } }
> = {
  ORDER_CREATED: {
    icon: 'receipt',
    tint: { bg: palette.greenSoft, icon: 'green' },
  },
  ORDER_CONFIRMED: {
    icon: 'circle-check',
    tint: { bg: palette.greenSoft, icon: 'green' },
  },
  ORDER_PREPARING: {
    icon: 'package',
    tint: { bg: palette.goldSoft, icon: 'gold' },
  },
  ORDER_READY: {
    icon: 'package-check',
    tint: { bg: palette.goldSoft, icon: 'gold' },
  },
  ORDER_OUT_FOR_DELIVERY: {
    icon: 'truck',
    tint: { bg: palette.greenSoft, icon: 'green' },
  },
  ORDER_DELIVERED: {
    icon: 'house',
    tint: { bg: palette.greenSoft, icon: 'green' },
  },
  ORDER_CANCELLED: {
    icon: 'circle-x',
    tint: { bg: '#FBEAE7', icon: 'danger' },
  },
  DELIVERY_ASSIGNED: {
    icon: 'map-pin',
    tint: { bg: palette.greenSoft, icon: 'green' },
  },
  DELIVERY_OTP: {
    icon: 'key-round',
    tint: { bg: palette.goldSoft, icon: 'gold' },
  },
  PAYMENT_SUCCEEDED: {
    icon: 'credit-card',
    tint: { bg: palette.greenSoft, icon: 'green' },
  },
  PAYMENT_FAILED: {
    icon: 'triangle-alert',
    tint: { bg: '#FBEAE7', icon: 'danger' },
  },
  LOW_STOCK: {
    icon: 'triangle-alert',
    tint: { bg: palette.goldSoft, icon: 'gold' },
  },
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  list: { padding: spacing.lg, paddingTop: 0, gap: spacing.sm },
  loading: { padding: spacing.lg, paddingTop: 0, gap: spacing.sm },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  unread: {
    borderLeftWidth: 3,
    borderLeftColor: palette.gold,
  },
  bubble: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.gold,
  },
  flex: { flex: 1 },
});
