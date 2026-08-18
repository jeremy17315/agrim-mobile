import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, Skeleton } from '@/components/states';
import { Banner, Button, Card, Icon, Text } from '@/components/ui';
import { formatWeight, formatXof } from '@/lib/format';
import {
  DELIVERY_RULES,
  useAmountUntilFreeDelivery,
  useCartStore,
  useCartTotals,
  type CartLineItem,
} from '@/store/cart';
import { palette, radius, shadow, spacing } from '@/theme/tokens';

/**
 * Panier local-first.
 *
 * Tout est instantané : aucune requête réseau pour modifier une quantité.
 * Le récapitulatif rappelle que les montants seront confirmés à la commande —
 * le serveur reste l'autorité sur les prix.
 */
export default function PanierScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const items = useCartStore((s) => s.items);
  const hydrated = useCartStore((s) => s.hydrated);
  const increment = useCartStore((s) => s.increment);
  const decrement = useCartStore((s) => s.decrement);
  const removeItem = useCartStore((s) => s.removeItem);
  const clear = useCartStore((s) => s.clear);

  const totals = useCartTotals();
  const remaining = useAmountUntilFreeDelivery();
  const progress = Math.min(
    1,
    totals.subtotal / DELIVERY_RULES.freeDeliveryThreshold,
  );

  const confirmClear = () => {
    Alert.alert('Vider le panier', 'Tous les articles seront retirés.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Vider', style: 'destructive', onPress: () => clear() },
    ]);
  };

  // Tant que le disque n'est pas relu, afficher « panier vide » serait faux.
  if (!hydrated) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
        <Text variant="h1" style={styles.title}>
          Panier
        </Text>
        <View style={styles.loading}>
          <Skeleton height={86} />
          <Skeleton height={86} />
        </View>
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
        <Text variant="h1" style={styles.title}>
          Panier
        </Text>
        <EmptyState
          icon="shopping-cart"
          title="Votre panier est vide"
          message="Parcourez le catalogue pour ajouter du riz BOAGNI."
          action={
            <Button
              label="Voir le catalogue"
              variant="outline"
              size="sm"
              fullWidth={false}
              onPress={() => router.push('/catalogue')}
            />
          }
        />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Text variant="h1">Panier</Text>
        <Pressable
          onPress={confirmClear}
          accessibilityRole="button"
          accessibilityLabel="Vider le panier"
          hitSlop={10}
        >
          <Text variant="caption" color="danger">
            Vider
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {remaining > 0 ? (
          <Card style={styles.franco}>
            <View style={styles.francoHead}>
              <Icon name="truck" size={15} color="green" />
              <Text variant="caption" color="body" style={styles.flex}>
                Plus que{' '}
                <Text variant="bodyStrong">{formatXof(remaining)}</Text> pour la
                livraison offerte
              </Text>
            </View>
            <View style={styles.bar}>
              <View
                style={[
                  styles.barFill,
                  { width: `${Math.round(progress * 100)}%` },
                ]}
              />
            </View>
          </Card>
        ) : (
          <Banner
            tone="success"
            message="Livraison offerte : le seuil est atteint."
            icon={<Icon name="gift" size={15} color="green" />}
          />
        )}

        {items.map((item) => (
          <CartLine
            key={item.variantId}
            item={item}
            onIncrement={() => increment(item.variantId)}
            onDecrement={() => decrement(item.variantId)}
            onRemove={() => removeItem(item.variantId)}
            onOpen={() => router.push(`/produit/${item.productSlug}`)}
          />
        ))}

        <Card style={styles.summary}>
          <SummaryRow label="Sous-total" value={formatXof(totals.subtotal)} />
          <SummaryRow
            label="Livraison"
            value={
              totals.deliveryFee === 0
                ? 'Offerte'
                : formatXof(totals.deliveryFee)
            }
            highlight={totals.deliveryFee === 0}
          />
          <View style={styles.separator} />
          <View style={styles.totalRow}>
            <Text variant="h3">Total</Text>
            <Text variant="h1" color="green">
              {formatXof(totals.total)}
            </Text>
          </View>
          <Text variant="micro" color="muted">
            Montant confirmé par AGRIM au moment de la commande.
          </Text>
        </Card>
      </ScrollView>

      <View
        style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}
      >
        <View>
          <Text variant="micro" color="muted">
            TOTAL
          </Text>
          <Text variant="h1" color="green">
            {formatXof(totals.total)}
          </Text>
        </View>
        <View style={styles.flex}>
          <Button
            label="Commander"
            icon={<Icon name="arrow-right" size={16} color="white" />}
            onPress={() =>
              Alert.alert(
                'Bientôt disponible',
                'Le tunnel de commande arrive à la prochaine étape.',
              )
            }
          />
        </View>
      </View>
    </View>
  );
}

function CartLine({
  item,
  onIncrement,
  onDecrement,
  onRemove,
  onOpen,
}: {
  item: CartLineItem;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const lineTotal = item.unitPrice * item.quantity;

  return (
    <Card style={styles.line}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Voir ${item.productName}`}
        style={styles.thumb}
      >
        <Icon name="wheat" size={20} color="gold" />
      </Pressable>

      <View style={styles.lineBody}>
        <View style={styles.lineHead}>
          <Text variant="h3" numberOfLines={2} style={styles.flex}>
            {item.productName}
          </Text>
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={`Retirer ${item.productName} ${item.variantLabel}`}
            hitSlop={10}
          >
            <Icon name="trash-2" size={15} color="muted" />
          </Pressable>
        </View>

        <Text variant="caption" color="muted">
          {formatWeight(item.weightGrams)} · {formatXof(item.unitPrice)} l’unité
        </Text>

        <View style={styles.lineFoot}>
          <View style={styles.stepper}>
            <Pressable
              onPress={onDecrement}
              accessibilityRole="button"
              accessibilityLabel="Diminuer la quantité"
              style={styles.stepButton}
              hitSlop={6}
            >
              <Icon
                name={item.quantity === 1 ? 'trash-2' : 'minus'}
                size={14}
                color="green"
              />
            </Pressable>
            <Text variant="h3" style={styles.quantity}>
              {item.quantity}
            </Text>
            <Pressable
              onPress={onIncrement}
              accessibilityRole="button"
              accessibilityLabel="Augmenter la quantité"
              style={styles.stepButton}
              hitSlop={6}
            >
              <Icon name="plus" size={14} color="green" />
            </Pressable>
          </View>

          <Text variant="h2" color="ink">
            {formatXof(lineTotal)}
          </Text>
        </View>
      </View>
    </Card>
  );
}

function SummaryRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text variant="caption" color="muted">
        {label}
      </Text>
      <Text variant="bodyStrong" color={highlight ? 'green' : 'ink'}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  title: { paddingHorizontal: spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  loading: { padding: spacing.lg, gap: spacing.md },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  flex: { flex: 1 },

  franco: { gap: spacing.sm },
  francoHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bar: {
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: palette.greenSoft,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: palette.gold,
    borderRadius: radius.pill,
  },

  line: { flexDirection: 'row', gap: spacing.md },
  thumb: {
    width: 58,
    height: 58,
    borderRadius: radius.md,
    backgroundColor: palette.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineBody: { flex: 1, gap: 3 },
  lineHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  lineFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.bg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.line,
  },
  stepButton: {
    width: 34,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantity: { minWidth: 22, textAlign: 'center' },

  summary: { gap: spacing.sm },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  separator: { height: 1, backgroundColor: palette.line },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: palette.card,
    borderTopWidth: 1,
    borderTopColor: palette.line,
    ...shadow.floating,
  },
});
