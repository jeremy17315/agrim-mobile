import { useDeliveryTracking } from '@/api/deliveries';
import { MapView, boundsOf, type MapMarker } from '@/components/map';
import { Card, Icon, Text } from '@/components/ui';
import {
  formatDistance,
  formatDuration,
  formatRelativeTime,
} from '@/lib/format';
import { palette, radius, spacing } from '@/theme/tokens';
import type { OrderStatus } from '@agrim/contracts';
import { StyleSheet, View } from 'react-native';

/**
 * Carte de suivi temps réel, côté client.
 *
 * Ne s'affiche que pendant la fenêtre où le suivi a du sens : une commande en
 * préparation n'a pas de position à montrer, une commande livrée non plus.
 * Hors de cette fenêtre, le composant ne rend rien et n'interroge pas le
 * réseau.
 */

export type LiveTrackingCardProps = {
  reference: string;
  orderStatus: OrderStatus;
};

export function LiveTrackingCard({
  reference,
  orderStatus,
}: LiveTrackingCardProps) {
  // Seule une commande en cours de livraison justifie une carte.
  const shouldTrack = orderStatus === 'OUT_FOR_DELIVERY';
  const { data, isPending } = useDeliveryTracking(reference, shouldTrack);

  if (!shouldTrack) return null;

  if (isPending || !data) {
    return (
      <Card style={styles.card}>
        <Text variant="micro" color="muted">
          LIVRAISON EN COURS
        </Text>
        <Text variant="caption" color="muted">
          Recherche de la position du livreur…
        </Text>
      </Card>
    );
  }

  const position = data.currentPosition;
  const destination =
    data.destination.latitude !== null && data.destination.longitude !== null
      ? {
          latitude: data.destination.latitude,
          longitude: data.destination.longitude,
        }
      : null;

  const markers: MapMarker[] = [];
  if (position) {
    markers.push({
      id: 'courier',
      latitude: position.latitude,
      longitude: position.longitude,
      heading: position.heading,
      kind: 'courier',
      title: data.courier?.firstName ?? 'Livreur',
    });
  }
  if (destination) {
    markers.push({
      id: 'destination',
      ...destination,
      kind: 'destination',
      title: 'Votre adresse',
    });
  }

  const viewport = boundsOf(
    markers.map((m) => ({
      latitude: m.latitude,
      longitude: m.longitude,
    })),
  );

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text variant="micro" color="muted">
          LIVRAISON EN COURS
        </Text>
        {/* L'état de fraîcheur est explicite : une carte muette inquiète
            davantage qu'un message honnête. */}
        <View style={styles.liveRow}>
          <View
            style={[styles.dot, data.isLive ? styles.dotLive : styles.dotStale]}
          />
          <Text variant="micro" color={data.isLive ? 'green' : 'muted'}>
            {data.isLive ? 'En direct' : 'Position indisponible'}
          </Text>
        </View>
      </View>

      {data.courier ? (
        <Text variant="body" color="body">
          {data.courier.firstName} vous livre votre commande.
        </Text>
      ) : null}

      {viewport ? (
        <>
          <MapView viewport={viewport} markers={markers} height={200} />
          {/* La carte peut n'afficher que la destination : sans ce message, le
              client croirait voir le livreur alors qu'aucune position n'est
              encore remontée. */}
          {!position ? (
            <View style={styles.pending}>
              <Icon name="loader" size={14} color="muted" />
              <Text variant="micro" color="muted">
                Position du livreur en attente
              </Text>
            </View>
          ) : null}
        </>
      ) : (
        <View style={styles.noPosition}>
          <Icon name="map-pin-off" size={20} color="muted" />
          <Text variant="caption" color="muted" center>
            La position n’est pas encore disponible.
          </Text>
        </View>
      )}

      {data.isLive && data.remainingMeters !== null ? (
        <View style={styles.metrics}>
          <View style={styles.metric}>
            <Icon name="route" size={15} color="green" />
            <Text variant="caption" color="body">
              {formatDistance(data.remainingMeters)}
            </Text>
          </View>
          {data.etaSeconds !== null ? (
            <View style={styles.metric}>
              <Icon name="clock" size={15} color="green" />
              <Text variant="caption" color="body">
                Environ {formatDuration(data.etaSeconds)}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {data.lastUpdateAt ? (
        <Text variant="micro" color="muted">
          Mise à jour {formatRelativeTime(data.lastUpdateAt)}
        </Text>
      ) : null}

      {/* L'estimation est annoncée comme telle : elle repose sur une distance
          à vol d'oiseau, pas sur un itinéraire routier. */}
      {data.isLive && data.etaSeconds !== null ? (
        <Text variant="micro" color="muted">
          Estimation indicative, hors conditions de circulation.
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 7, height: 7, borderRadius: 999 },
  dotLive: { backgroundColor: palette.green700 },
  dotStale: { backgroundColor: palette.muted },
  noPosition: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
    backgroundColor: palette.greenSoft,
    borderRadius: radius.md,
  },
  pending: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  metrics: { flexDirection: 'row', gap: spacing.md },
  metric: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
