import { MANUAL_CLOSURE_ALERT_RATE } from '@agrim/contracts';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useExecutiveDashboard,
  type ExecutiveDashboard,
} from '@/api/analytics';
import { ErrorState, Skeleton } from '@/components/states';
import { Card, Icon, Text, type IconName } from '@/components/ui';
import { formatKilograms, formatXof } from '@/lib/format';
import { palette, radius, spacing } from '@/theme/tokens';

/**
 * Direction générale : vue d'ensemble.
 *
 * Écran strictement consultatif. Aucune action n'y est proposée : décider
 * depuis un écran d'agrégats contournerait les contrôles métier des espaces
 * gestionnaire et livreur, où les règles sont écrites.
 *
 * Tous les montants viennent du serveur déjà agrégés — rien n'est recalculé
 * ici, pour qu'aucun chiffre ne puisse diverger d'un écran à l'autre.
 */
export default function DirectionScreen() {
  const insets = useSafeAreaInsets();
  const dashboard = useExecutiveDashboard();

  const data = dashboard.data;

  if (dashboard.isError) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
        <ErrorState
          error={dashboard.error}
          onRetry={() => void dashboard.refetch()}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.hero, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.heroTop}>
          <View style={styles.flex}>
            <Text variant="caption" style={styles.heroEyebrow}>
              Direction générale
            </Text>
            <Text variant="h2" style={styles.heroTitle}>
              Vue d’ensemble
            </Text>
          </View>
          {data ? (
            <View style={styles.monthChip}>
              <Text variant="micro" style={styles.monthChipText}>
                {data.monthLabel}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.revenueBox}>
          <Text variant="micro" style={styles.revenueLabel}>
            CHIFFRE D’AFFAIRES DU MOIS
          </Text>
          {data ? (
            <Text variant="h1" style={styles.revenueValue}>
              {formatXof(data.revenueMonth)}
            </Text>
          ) : (
            <Skeleton height={26} width={180} />
          )}
          {data ? <GrowthBadge value={data.revenueGrowth} /> : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + spacing.xxxl },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={dashboard.isRefetching}
            onRefresh={() => void dashboard.refetch()}
            tintColor={palette.green}
          />
        }
      >
        <View style={styles.kpis}>
          <Kpi
            label="Commandes"
            value={data ? String(data.ordersMonth) : '—'}
            growth={data?.ordersGrowth}
          />
          <Kpi
            label="Nouveaux clients"
            value={data ? String(data.newCustomers) : '—'}
          />
          <Kpi
            label="Panier moyen"
            value={data ? formatXof(data.averageBasket) : '—'}
          />
          <Kpi
            label="Récolte reçue"
            value={data ? formatKilograms(data.productionReceivedKg) : '—'}
          />
        </View>

        <SalesChart points={data?.sales} />
        <CategoryBreakdown rows={data?.categories} />

        {data ? (
          <Alerts
            lowStock={data.lowStockCount}
            lateDeliveries={data.lateDeliveries}
            pendingReviews={data.pendingProductionReviews}
            manualClosures={data.manualClosures}
            manualClosureRate={data.manualClosureRate}
          />
        ) : null}

        <Text variant="micro" color="muted" style={styles.footnote}>
          Chiffres hors commandes annulées. Consultation seule : les actions se
          font depuis les espaces concernés.
        </Text>
      </ScrollView>
    </View>
  );
}

/** Variation vs mois précédent. Sans référence, aucun pourcentage n'est affiché. */
function GrowthBadge({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <Text variant="micro" style={styles.heroMuted}>
        Pas de référence le mois précédent
      </Text>
    );
  }

  const positive = value >= 0;
  return (
    <View style={styles.growthRow}>
      <View style={styles.growthPill}>
        <Icon
          name={positive ? 'trending-up' : 'trending-down'}
          size={11}
          color={positive ? 'green' : 'danger'}
        />
        <Text variant="micro" style={styles.growthText}>
          {positive ? '+' : ''}
          {value} %
        </Text>
      </View>
      <Text variant="micro" style={styles.heroMuted}>
        vs mois précédent
      </Text>
    </View>
  );
}

function Kpi({
  label,
  value,
  growth,
}: {
  label: string;
  value: string;
  growth?: number | null;
}) {
  return (
    <Card style={styles.kpi}>
      <Text variant="micro" color="muted">
        {label}
      </Text>
      <Text variant="h3">{value}</Text>
      {growth !== undefined && growth !== null ? (
        <Text
          variant="micro"
          style={growth >= 0 ? styles.kpiUp : styles.kpiDown}
        >
          {growth >= 0 ? '+' : ''}
          {growth} %
        </Text>
      ) : null}
    </Card>
  );
}

/**
 * Ventes des six derniers mois.
 *
 * Graphique en barres dessiné avec des vues : pas de dépendance graphique pour
 * six valeurs. Les hauteurs sont relatives au mois le plus fort.
 */
function SalesChart({ points }: { points?: ExecutiveDashboard['sales'] }) {
  if (!points) {
    return (
      <Card style={styles.card}>
        <Skeleton height={13} width={140} />
        <Skeleton height={88} />
      </Card>
    );
  }

  const peak = Math.max(...points.map((p) => p.revenue), 1);
  const hasSales = points.some((p) => p.revenue > 0);

  return (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <Text variant="h3">Ventes · 6 derniers mois</Text>
      </View>

      {hasSales ? (
        <View
          style={styles.chart}
          accessibilityRole="image"
          accessibilityLabel={points
            .map((p) => `${p.label} : ${formatXof(p.revenue)}`)
            .join(', ')}
        >
          {points.map((point, index) => {
            const isCurrent = index === points.length - 1;
            const height = Math.max(4, Math.round((point.revenue / peak) * 78));

            return (
              <View key={point.month} style={styles.chartColumn}>
                <View
                  style={[
                    styles.bar,
                    {
                      height,
                      backgroundColor: isCurrent
                        ? palette.green
                        : palette.greenSoft,
                    },
                  ]}
                />
                <Text variant="micro" color="muted">
                  {point.label}
                </Text>
              </View>
            );
          })}
        </View>
      ) : (
        <Text variant="caption" color="muted">
          Aucune vente enregistrée sur la période.
        </Text>
      )}
    </Card>
  );
}

function CategoryBreakdown({
  rows,
}: {
  rows?: ExecutiveDashboard['categories'];
}) {
  if (!rows) {
    return (
      <Card style={styles.card}>
        <Skeleton height={13} width={160} />
        <Skeleton height={40} />
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <Text variant="h3">Répartition par gamme</Text>

      {rows.length === 0 ? (
        <Text variant="caption" color="muted">
          Aucune vente à répartir ce mois-ci.
        </Text>
      ) : (
        rows.map((row) => (
          <View key={row.categoryId} style={styles.shareRow}>
            <View style={styles.shareHeader}>
              <Text variant="caption" style={styles.flex}>
                {row.name}
              </Text>
              <Text variant="caption" color="ink">
                {row.share} %
              </Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.trackFill, { width: `${row.share}%` }]} />
            </View>
          </View>
        ))
      )}
    </Card>
  );
}

/** Une alerte n'apparaît que s'il y a réellement matière à s'inquiéter. */
function Alerts({
  lowStock,
  lateDeliveries,
  pendingReviews,
  manualClosures,
  manualClosureRate,
}: {
  lowStock: number;
  lateDeliveries: number;
  pendingReviews: number;
  manualClosures: number;
  manualClosureRate: number;
}) {
  const items: { icon: IconName; text: string; tone: 'danger' | 'warn' }[] = [];

  if (lowStock > 0) {
    items.push({
      icon: 'triangle-alert',
      tone: 'danger',
      text:
        lowStock === 1
          ? '1 variante sous son seuil de stock'
          : `${lowStock} variantes sous leur seuil de stock`,
    });
  }
  if (lateDeliveries > 0) {
    items.push({
      icon: 'clock',
      tone: 'warn',
      text:
        lateDeliveries === 1
          ? '1 livraison au-delà du délai de référence'
          : `${lateDeliveries} livraisons au-delà du délai de référence`,
    });
  }
  if (manualClosures > 0) {
    // Le seuil vient du contrat : au-delà, ce n'est plus une exception.
    const excessive = manualClosureRate >= MANUAL_CLOSURE_ALERT_RATE;
    items.push({
      icon: 'shield-alert',
      tone: excessive ? 'danger' : 'warn',
      text:
        `${manualClosures} ${manualClosures === 1 ? 'livraison close' : 'livraisons closes'} sans code client ` +
        `(${manualClosureRate} % du mois)` +
        (excessive ? ' — le parcours par code est à revoir' : ''),
    });
  }
  if (pendingReviews > 0) {
    items.push({
      icon: 'wheat',
      tone: 'warn',
      text:
        pendingReviews === 1
          ? '1 déclaration de récolte à examiner'
          : `${pendingReviews} déclarations de récolte à examiner`,
    });
  }

  if (items.length === 0) {
    return (
      <Card style={styles.okCard}>
        <Icon name="circle-check" size={16} color="green" />
        <Text variant="caption" color="body" style={styles.flex}>
          Aucun point de vigilance.
        </Text>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <Text variant="h3">Points de vigilance</Text>
      {items.map((item) => (
        <View key={item.text} style={styles.alertRow}>
          <Icon name={item.icon} size={15} color={item.tone} />
          <Text variant="caption" color="body" style={styles.flex}>
            {item.text}
          </Text>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  hero: {
    backgroundColor: palette.greenDark,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroEyebrow: { color: 'rgba(255,255,255,0.7)' },
  heroTitle: { color: palette.white },
  heroMuted: { color: 'rgba(255,255,255,0.6)' },
  monthChip: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  monthChipText: { color: palette.white },
  revenueBox: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  revenueLabel: { color: 'rgba(255,255,255,0.68)', letterSpacing: 0.6 },
  revenueValue: { color: palette.white },
  growthRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  growthPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  growthText: { color: palette.ink },
  body: { padding: spacing.lg, gap: spacing.md },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kpi: {
    flexGrow: 1,
    flexBasis: '46%',
    padding: spacing.md,
    gap: 2,
  },
  kpiUp: { color: palette.green700 },
  kpiDown: { color: palette.danger },
  card: { padding: spacing.lg, gap: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    height: 96,
  },
  chartColumn: { flex: 1, alignItems: 'center', gap: spacing.xs },
  bar: { width: '100%', borderTopLeftRadius: 5, borderTopRightRadius: 5 },
  shareRow: { gap: spacing.xs },
  shareHeader: { flexDirection: 'row', alignItems: 'center' },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.line,
    overflow: 'hidden',
  },
  trackFill: { height: '100%', backgroundColor: palette.green },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  okCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  footnote: { marginTop: spacing.xs },
});
