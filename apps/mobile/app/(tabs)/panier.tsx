import { cleanProductName, COMPANY } from '@agrim/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CheckoutProgress } from '@/components/CheckoutProgress';
import { EmptyState, Skeleton } from '@/components/states';
import { Banner, Button, Card, Icon, Text } from '@/components/ui';
import { callMobileSupport } from '@/lib/contact';
import { formatWeight, formatXof } from '@/lib/format';
import { useIsOnline } from '@/lib/network';
import { resolveProductImageUrl } from '@/lib/productImage';
import { useCartStore, useCartTotals, type CartLineItem } from '@/store/cart';
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

  const isOnline = useIsOnline();
  const items = useCartStore((s) => s.items);
  const hydrated = useCartStore((s) => s.hydrated);
  const increment = useCartStore((s) => s.increment);
  const decrement = useCartStore((s) => s.decrement);
  const removeItem = useCartStore((s) => s.removeItem);
  const clear = useCartStore((s) => s.clear);

  const totals = useCartTotals();

  /** Le checkout public demande les coordonnées de livraison, pas un compte. */
  const goToCheckout = () => {
    if (!isOnline) return;
    router.push('/commande');
  };

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
          message="Parcourez les produits pour ajouter votre riz Bélier d’Or."
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
      <View style={styles.progress}>
        <CheckoutProgress step={1} />
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <Button
          label="Continuer mes achats"
          variant="outline"
          size="sm"
          fullWidth={false}
          icon={<Icon name="arrow-left" size={14} color="green" />}
          onPress={() => router.push('/catalogue')}
        />
        {!isOnline ? (
          <View style={styles.offlineSupport}>
            <Banner
              tone="warning"
              message="Vous pouvez modifier votre panier hors connexion. Pour commander, appelez AGRIM."
              icon={<Icon name="wifi-off" size={15} color="#8A5310" />}
            />
            <Button
              label="APPELER AGRIM · 07 00 05 04 52"
              variant="outline"
              size="sm"
              fullWidth={false}
              onPress={() => void callMobileSupport()}
              icon={<Icon name="phone" size={15} color="green" />}
            />
          </View>
        ) : null}
        {/* Le site, de la mise au panier jusqu'au paiement, n'ajoute AUCUN
            frais au total payable : son tiroir de panier écrit « Applicable
            selon la zone », et sa page de commande « À confirmer ». On
            reprend ses mots. Ce qui est annoncé ici n'est pas un montant :
            c'est le moment et le lieu où il sera convenu — par téléphone. */}
        <Banner
          tone="info"
          message="Les frais de livraison sont confirmés par téléphone selon votre zone : ils ne sont pas ajoutés au total en ligne."
          icon={<Icon name="truck" size={15} color="info" />}
        />

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
          {/* Formulation du site, tiroir de panier : aucun montant, aucune
              promesse de gratuité — seulement la dépendance à la zone. */}
          <SummaryRow label="Livraison" value="Applicable selon la zone" />
          <View style={styles.separator} />
          <View style={styles.totalRow}>
            <Text variant="h3">Sous-total</Text>
            <Text variant="h1" color="green">
              {formatXof(totals.subtotal)}
            </Text>
          </View>
          <Text variant="micro" color="muted">
            Frais de livraison confirmés par {COMPANY.name} — ils ne s’ajoutent
            pas à ce total.
          </Text>
        </Card>
      </ScrollView>

      <View
        style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}
      >
        <View>
          <Text variant="micro" color="muted">
            SOUS-TOTAL
          </Text>
          <Text variant="h1" color="green">
            {formatXof(totals.subtotal)}
          </Text>
        </View>
        <View style={styles.flex}>
          <Button
            label={
              isOnline ? 'CONTINUER VERS LA LIVRAISON' : 'CONNEXION NÉCESSAIRE'
            }
            disabled={!isOnline}
            icon={
              isOnline ? (
                <Icon name="arrow-right" size={16} color="white" />
              ) : undefined
            }
            onPress={goToCheckout}
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
      <CartThumbnail item={item} onPress={onOpen} />

      <View style={styles.lineBody}>
        <View style={styles.lineHead}>
          <Text variant="h3" numberOfLines={2} style={styles.flex}>
            {cleanProductName(item.productName)}
          </Text>
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={`Retirer ${cleanProductName(item.productName)} ${item.variantLabel}`}
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

function CartThumbnail({
  item,
  onPress,
}: {
  item: CartLineItem;
  onPress: () => void;
}) {
  const [imageBroken, setImageBroken] = useState(false);
  const imageUrl = resolveProductImageUrl(item.productImageUrl);
  const photo = imageUrl && !imageBroken;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Voir ${cleanProductName(item.productName)}`}
      style={styles.thumb}
    >
      {photo ? (
        <Image
          source={{ uri: imageUrl ?? undefined }}
          style={styles.thumbImage}
          resizeMode="cover"
          onError={() => setImageBroken(true)}
        />
      ) : (
        <Icon name="wheat" size={20} color="gold" />
      )}
    </Pressable>
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
  progress: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  offlineSupport: { gap: spacing.sm, alignItems: 'flex-start' },
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
    width: 66,
    height: 66,
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: palette.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImage: { width: '100%', height: '100%' },
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
