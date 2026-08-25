import type { Product } from '@agrim/contracts';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { Icon, Pill, Text } from '@/components/ui';
import { formatXof } from '@/lib/format';
import { palette, radius, shadow, spacing } from '@/theme/tokens';

export type ProductCardProps = {
  product: Product;
  onPress?: (product: Product) => void;
};

/**
 * Vignette produit du catalogue.
 *
 * Le prix affiché est celui du format le MOINS cher, précédé de « dès » :
 * annoncer le prix du 22,5 kg ferait fuir, annoncer celui du 900 g sans
 * mention induirait en erreur au moment du panier.
 */
export function ProductCard({ product, onPress }: ProductCardProps) {
  const available = product.variants.filter(
    (v) => v.isAvailable && v.stock > 0,
  );
  const cheapestVariant = available.reduce<Product['variants'][number] | null>(
    (min, v) => (min === null || v.price < min.price ? v : min),
    null,
  );
  const cheapest = cheapestVariant?.price ?? null;
  const showPromo =
    cheapestVariant !== null &&
    cheapestVariant.originalPrice !== null &&
    cheapestVariant.originalPrice !== cheapestVariant.price;
  const outOfStock = available.length === 0;
  const [photoCassée, setPhotoCassée] = useState(false);
  const photo = product.imageUrl && !photoCassée ? product.imageUrl : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, à partir de ${
        cheapest === null ? 'prix indisponible' : formatXof(cheapest)
      }`}
      onPress={() => onPress?.(product)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.thumb}>
        {photo ? (
          <Image
            source={{ uri: photo }}
            style={styles.photo}
            resizeMode="cover"
            onError={() => setPhotoCassée(true)}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <>
            <Text variant="micro" color="green" center>
              {product.brand}
            </Text>
            <Text variant="h3" color="greenDeep" center numberOfLines={2}>
              {product.category.name}
            </Text>
          </>
        )}
        {product.isFeatured ? (
          <View style={styles.badge}>
            <Pill label="Populaire" tone="gold" />
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <Text variant="h3" numberOfLines={2}>
          {product.name}
        </Text>
        {product.shortDescription ? (
          <Text variant="caption" color="muted" numberOfLines={2}>
            {product.shortDescription}
          </Text>
        ) : null}

        <View style={styles.footer}>
          {outOfStock ? (
            <Pill label="Rupture" tone="danger" />
          ) : (
            <View>
              <Text variant="micro" color="muted">
                DÈS
              </Text>
              {showPromo ? (
                <Text variant="caption" color="muted" style={styles.strike}>
                  {formatXof(cheapestVariant!.originalPrice!)}
                </Text>
              ) : null}
              <Text variant="h2" color="green">
                {cheapest === null ? '—' : formatXof(cheapest)}
              </Text>
            </View>
          )}
          <View style={styles.formats}>
            <Icon name="package" size={12} color="muted" />
            <Text variant="micro" color="muted">
              {product.variants.length} formats
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: palette.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: 'hidden',
    ...shadow.card,
  },
  pressed: {
    opacity: 0.9,
  },
  thumb: {
    height: 96,
    backgroundColor: palette.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: spacing.sm,
    overflow: 'hidden',
  },
  photo: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  badge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
  },
  body: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  formats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  strike: {
    textDecorationLine: 'line-through',
  },
});
