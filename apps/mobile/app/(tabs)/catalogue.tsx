import { type Product } from '@agrim/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCategories, useProducts } from '@/api/catalog';
import {
  EmptyState,
  ErrorState,
  ProductGridSkeleton,
} from '@/components/states';
import { Card, Icon, Text } from '@/components/ui';
import { formatWeight, formatXof } from '@/lib/format';
import { resolveProductImageUrl } from '@/lib/productImage';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { useCartItemCount, useCartStore } from '@/store/cart';
import { palette, radius, spacing, typography } from '@/theme/tokens';

/**
 * Vitrine compacte du catalogue : recherche, gammes, cartes produits et ajout
 * rapide. La mise en page reprend les repères d'une boutique mobile moderne,
 * sans introduire de navigation ou de données supplémentaires.
 */
export default function CatalogueScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string }>();
  const addItem = useCartStore((state) => state.addItem);
  const itemCount = useCartItemCount();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | undefined>(params.category);
  const debouncedSearch = useDebouncedValue(search, 350);

  // La gamme peut arriver de l'accueil après le premier rendu. On l'applique
  // pendant le rendu pour éviter une requête supplémentaire, sans écraser un
  // choix effectué manuellement dans la même session.
  const [appliedParam, setAppliedParam] = useState(params.category);
  if (params.category !== appliedParam) {
    setAppliedParam(params.category);
    if (params.category) setCategory(params.category);
  }

  const categories = useCategories();
  const products = useProducts({
    search: debouncedSearch.length > 0 ? debouncedSearch : undefined,
    category,
    // Une seule page complète est conservée localement, afin que recherche et
    // navigation restent possibles après une coupure réseau.
    limit: 100,
  });

  const items = products.data?.data ?? [];
  const total = products.data?.pagination.total ?? 0;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={styles.titleCopy}>
            <Text variant="micro" color="green" style={styles.brand}>
              BÉLIER D’OR
            </Text>
            <Text variant="h1">Choisissez votre riz</Text>
          </View>
          <Pressable
            onPress={() => router.push('/panier')}
            accessibilityRole="button"
            accessibilityLabel={
              itemCount > 0
                ? `Ouvrir le panier, ${itemCount} article${
                    itemCount > 1 ? 's' : ''
                  }`
                : 'Ouvrir le panier'
            }
            style={styles.cartButton}
          >
            <Icon name="shopping-bag" size={19} color="green" />
            {itemCount > 0 ? (
              <View style={styles.cartCount}>
                <Text variant="micro" style={styles.cartCountText}>
                  {itemCount > 9 ? '9+' : itemCount}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        <View style={styles.searchBox}>
          <Icon name="search" size={17} color="muted" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Rechercher votre riz…"
            placeholderTextColor={palette.muted}
            style={styles.searchInput}
            accessibilityLabel="Rechercher un produit"
            returnKeyType="search"
            autoCorrect={false}
          />
          {search.length > 0 ? (
            <Pressable
              onPress={() => setSearch('')}
              accessibilityRole="button"
              accessibilityLabel="Effacer la recherche"
              hitSlop={10}
            >
              <Icon name="x" size={16} color="muted" />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <Chip
            label="Toutes"
            active={category === undefined}
            onPress={() => setCategory(undefined)}
          />
          {(categories.data ?? []).map((entry) => (
            <Chip
              key={entry.id}
              label={entry.name}
              active={category === entry.slug}
              onPress={() =>
                setCategory(category === entry.slug ? undefined : entry.slug)
              }
            />
          ))}
        </ScrollView>
      </View>

      {products.isError && !products.data ? (
        <ErrorState
          error={products.error}
          onRetry={() => void products.refetch()}
        />
      ) : products.isPending ? (
        <View style={styles.list}>
          <ProductGridSkeleton count={4} />
        </View>
      ) : items.length === 0 ? (
        <EmptyState
          icon="search-x"
          title="Aucun résultat"
          message={
            debouncedSearch.length > 0
              ? `Rien ne correspond à « ${debouncedSearch} ». Essayez un autre terme.`
              : 'Aucun produit dans cette gamme pour le moment.'
          }
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.listHeading}>
              <Text variant="h2">Nos produits</Text>
              <Text variant="caption" color="muted">
                {total} produit{total > 1 ? 's' : ''}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.cell}>
              <QuickProductCard
                product={item}
                onOpen={() => router.push(`/produit/${item.slug}`)}
                onAdd={() => {
                  const variant = item.variants.find(
                    (value) => value.isAvailable && value.stock > 0,
                  );
                  if (variant) addItem(item, variant);
                }}
              />
            </View>
          )}
        />
      )}
    </View>
  );
}

function QuickProductCard({
  product,
  onAdd,
  onOpen,
}: {
  product: Product;
  onAdd: () => void;
  onOpen: () => void;
}) {
  const variant = product.variants.find(
    (value) => value.isAvailable && value.stock > 0,
  );
  const [imageBroken, setImageBroken] = useState(false);
  const imageUrl = resolveProductImageUrl(product.imageUrl);

  return (
    <Card style={styles.productCard} padded={false} flat>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Voir ${product.name}`}
        style={styles.productPressable}
      >
        <View style={styles.productVisual}>
          {imageUrl && !imageBroken ? (
            <Image
              source={{ uri: imageUrl }}
              style={styles.productImage}
              resizeMode="cover"
              onError={() => setImageBroken(true)}
            />
          ) : (
            <Icon name="wheat" size={42} color="gold" />
          )}
          {product.isFeatured ? (
            <View style={styles.popularBadge}>
              <Text variant="micro" style={styles.popularText}>
                POPULAIRE
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.productBody}>
          <Text variant="h3" numberOfLines={2}>
            {product.name}
          </Text>
          <Text variant="caption" color="muted" numberOfLines={1}>
            {variant
              ? formatWeight(variant.weightGrams)
              : 'Format indisponible'}
          </Text>
        </View>
      </Pressable>

      <View style={styles.productFooter}>
        {variant ? (
          <Text variant="h2" color="green">
            {formatXof(variant.price)}
          </Text>
        ) : (
          <Text variant="caption" color="muted">
            Indisponible
          </Text>
        )}
        {variant ? (
          <Pressable
            onPress={onAdd}
            accessibilityRole="button"
            accessibilityLabel={`Ajouter ${product.name} au panier`}
            style={styles.addButton}
          >
            <Icon name="plus" size={18} color="white" />
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Filtrer par ${label}`}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text
        variant="caption"
        style={{ color: active ? palette.white : palette.body }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
    backgroundColor: palette.bg,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  titleCopy: { gap: 3 },
  brand: { letterSpacing: 1.5 },
  cartButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
  },
  cartCount: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderRadius: radius.pill,
    backgroundColor: palette.green,
    borderWidth: 1.5,
    borderColor: palette.bg,
  },
  cartCountText: { color: palette.white, fontSize: 8 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: palette.ink,
  },
  chips: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
  },
  chipActive: { backgroundColor: palette.green, borderColor: palette.green },
  list: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
  listHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  row: { gap: spacing.md },
  cell: { flex: 1 },
  productCard: { overflow: 'hidden' },
  productPressable: { gap: spacing.sm },
  productVisual: {
    height: 132,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: palette.goldSoft,
  },
  productImage: { width: '100%', height: '100%' },
  productBody: { minHeight: 57, gap: 3, paddingHorizontal: spacing.md },
  productFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  addButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: palette.green,
  },
  popularBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.gold,
  },
  popularText: { color: palette.greenDeep, fontSize: 8 },
});
