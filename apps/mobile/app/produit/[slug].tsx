import { SELLING_POINTS, type ProductVariant } from '@agrim/contracts';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useProduct } from '@/api/catalog';
import { ErrorState, Skeleton } from '@/components/states';
import { Banner, Button, Card, Icon, Pill, Text } from '@/components/ui';
import { formatWeight, formatXof } from '@/lib/format';
import { MAX_QUANTITY_PER_LINE, useCartStore } from '@/store/cart';
import { palette, radius, shadow, spacing } from '@/theme/tokens';

/**
 * Fiche produit.
 *
 * Le format sélectionné pilote le prix affiché et le bouton d'ajout. Un format
 * en rupture reste visible mais non sélectionnable : le masquer donnerait
 * l'impression que le produit n'existe pas dans cette taille.
 */
export default function ProductScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const product = useProduct(slug ?? '');
  const addItem = useCartStore((s) => s.addItem);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  // Confirmation brève après l'ajout : le client doit voir que son geste a
  // abouti sans quitter la fiche.
  const [justAdded, setJustAdded] = useState(false);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sans ce nettoyage, quitter la fiche juste après un ajout déclencherait un
  // setState sur un composant démonté.
  useEffect(
    () => () => {
      if (addedTimer.current) clearTimeout(addedTimer.current);
    },
    [],
  );

  const variants = useMemo(() => product.data?.variants ?? [], [product.data]);

  // Par défaut : le premier format réellement disponible.
  const selected: ProductVariant | undefined =
    variants.find((v) => v.id === selectedId) ??
    variants.find((v) => v.isAvailable && v.stock > 0) ??
    variants[0];

  const canOrder =
    selected !== undefined && selected.isAvailable && selected.stock > 0;

  const maxQuantity = selected
    ? Math.min(MAX_QUANTITY_PER_LINE, Math.max(1, selected.stock))
    : 1;

  const handleAdd = () => {
    if (!product.data || !selected || !canOrder) return;
    addItem(product.data, selected, quantity);
    setJustAdded(true);
    setQuantity(1);

    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setJustAdded(false), 2200);
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          hitSlop={12}
          style={styles.backButton}
        >
          <Icon name="arrow-left" size={19} color="ink" />
        </Pressable>
        <Text variant="h3" numberOfLines={1} style={styles.headerTitle}>
          {product.data?.name ?? 'Produit'}
        </Text>
      </View>

      {product.isError ? (
        <ErrorState
          error={product.error}
          onRetry={() => void product.refetch()}
        />
      ) : product.isPending ? (
        <View style={styles.loading}>
          <Skeleton height={168} />
          <Skeleton height={18} width={200} />
          <Skeleton height={12} width={260} />
          <Skeleton height={54} />
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.hero}>
              <Text variant="micro" color="green">
                {product.data.brand}
              </Text>
              <Text variant="display" color="greenDeep" center>
                {product.data.category.name}
              </Text>
              {product.data.isFeatured ? (
                <Pill label="Populaire" tone="gold" />
              ) : null}
            </View>

            <View style={styles.section}>
              <Text variant="h1">{product.data.name}</Text>
              {product.data.shortDescription ? (
                <Text variant="body" color="body">
                  {product.data.shortDescription}
                </Text>
              ) : null}
            </View>

            <View style={styles.section}>
              <Text variant="micro" color="muted">
                CHOISIR LE FORMAT
              </Text>
              <View style={styles.formats}>
                {variants.map((variant) => {
                  const disabled = !variant.isAvailable || variant.stock === 0;
                  const active = selected?.id === variant.id;
                  const hasPromo =
                    variant.originalPrice !== null &&
                    variant.originalPrice !== variant.price;
                  return (
                    <Pressable
                      key={variant.id}
                      disabled={disabled}
                      onPress={() => {
                        setSelectedId(variant.id);
                        setQuantity(1);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active, disabled }}
                      accessibilityLabel={`${variant.label}, ${formatXof(variant.price)}${
                        disabled ? ', indisponible' : ''
                      }`}
                      style={[
                        styles.format,
                        active && styles.formatActive,
                        disabled && styles.formatDisabled,
                      ]}
                    >
                      <Text variant="h3" color={active ? 'green' : 'ink'}>
                        {formatWeight(variant.weightGrams)}
                      </Text>
                      {hasPromo ? (
                        <Text
                          variant="micro"
                          color="muted"
                          style={styles.strike}
                        >
                          {formatXof(variant.originalPrice!)}
                        </Text>
                      ) : null}
                      <Text
                        variant="caption"
                        color={active ? 'green' : 'muted'}
                      >
                        {formatXof(variant.price)}
                      </Text>
                      {disabled ? <Pill label="Rupture" tone="danger" /> : null}
                    </Pressable>
                  );
                })}
              </View>

              {selected && selected.stock > 0 && selected.stock <= 10 ? (
                <Banner
                  tone="warning"
                  message={`Plus que ${selected.stock} unités en stock pour ce format.`}
                  icon={
                    <Icon name="triangle-alert" size={14} color="#8A5310" />
                  }
                />
              ) : null}
            </View>

            {canOrder ? (
              <View style={styles.section}>
                <Text variant="micro" color="muted">
                  QUANTITÉ
                </Text>
                <View style={styles.quantityRow}>
                  <View style={styles.stepper}>
                    <Pressable
                      onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                      disabled={quantity <= 1}
                      accessibilityRole="button"
                      accessibilityLabel="Diminuer la quantité"
                      style={styles.stepButton}
                      hitSlop={6}
                    >
                      <Icon
                        name="minus"
                        size={15}
                        color={quantity <= 1 ? 'muted' : 'green'}
                      />
                    </Pressable>
                    <Text variant="h2" style={styles.quantityValue}>
                      {quantity}
                    </Text>
                    <Pressable
                      onPress={() =>
                        setQuantity((q) => Math.min(maxQuantity, q + 1))
                      }
                      disabled={quantity >= maxQuantity}
                      accessibilityRole="button"
                      accessibilityLabel="Augmenter la quantité"
                      style={styles.stepButton}
                      hitSlop={6}
                    >
                      <Icon
                        name="plus"
                        size={15}
                        color={quantity >= maxQuantity ? 'muted' : 'green'}
                      />
                    </Pressable>
                  </View>
                  <Text variant="caption" color="muted">
                    Sous-total {formatXof(selected.price * quantity)}
                  </Text>
                </View>
              </View>
            ) : null}

            {justAdded ? (
              <Banner
                tone="success"
                message="Ajouté au panier."
                icon={<Icon name="circle-check" size={14} color="green" />}
              />
            ) : null}

            {product.data.description ? (
              <View style={styles.section}>
                <Text variant="micro" color="muted">
                  DESCRIPTION
                </Text>
                <Text variant="body" color="body">
                  {product.data.description}
                </Text>
              </View>
            ) : null}

            <Card style={styles.args}>
              {SELLING_POINTS.map((point) => (
                <View key={point} style={styles.argRow}>
                  <Icon name="check" size={13} color="green" />
                  <Text variant="caption" color="body" style={styles.argText}>
                    {point}
                  </Text>
                </View>
              ))}
            </Card>
          </ScrollView>

          <View
            style={[
              styles.footer,
              { paddingBottom: insets.bottom + spacing.md },
            ]}
          >
            <View>
              <Text variant="micro" color="muted">
                PRIX
              </Text>
              {selected &&
              selected.originalPrice !== null &&
              selected.originalPrice !== selected.price ? (
                <Text variant="caption" color="muted" style={styles.strike}>
                  {formatXof(selected.originalPrice)}
                </Text>
              ) : null}
              <Text variant="h1" color="green">
                {selected ? formatXof(selected.price) : '—'}
              </Text>
            </View>
            <View style={styles.footerAction}>
              <Button
                label={canOrder ? 'Ajouter au panier' : 'Indisponible'}
                disabled={!canOrder}
                onPress={handleAdd}
                icon={
                  canOrder ? (
                    <Icon name="shopping-cart" size={16} color="white" />
                  ) : undefined
                }
              />
            </View>
          </View>
        </>
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
    backgroundColor: palette.card,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  backButton: { padding: 2 },
  headerTitle: { flex: 1 },
  loading: { padding: spacing.lg, gap: spacing.md },
  content: {
    padding: spacing.lg,
    gap: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  hero: {
    height: 168,
    borderRadius: radius.xl,
    backgroundColor: palette.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  section: { gap: spacing.sm },
  formats: { flexDirection: 'row', gap: spacing.sm },
  format: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: palette.line,
    backgroundColor: palette.card,
  },
  formatActive: { borderColor: palette.green, backgroundColor: '#FCFEFB' },
  formatDisabled: { opacity: 0.5 },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.card,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.line,
  },
  stepButton: {
    width: 42,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityValue: { minWidth: 30, textAlign: 'center' },
  args: { gap: spacing.sm },
  argRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  argText: { flex: 1, lineHeight: 17 },
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
  footerAction: { flex: 1 },
  strike: { textDecorationLine: 'line-through' },
});
