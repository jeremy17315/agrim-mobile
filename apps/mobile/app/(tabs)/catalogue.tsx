import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCategories, useProducts } from '@/api/catalog';
import { ProductCard } from '@/components/ProductCard';
import {
  EmptyState,
  ErrorState,
  ProductGridSkeleton,
} from '@/components/states';
import { Icon, Text } from '@/components/ui';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { palette, radius, spacing, typography } from '@/theme/tokens';

/**
 * Catalogue : recherche, filtre par gamme, grille de produits.
 *
 * La recherche est temporisée : sans cela, chaque frappe déclencherait une
 * requête — coûteux en data et inutile.
 */
export default function CatalogueScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string }>();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | undefined>(params.category);
  const debouncedSearch = useDebouncedValue(search, 350);

  // La gamme peut arriver depuis l'accueil après le premier rendu.
  useEffect(() => {
    if (params.category) setCategory(params.category);
  }, [params.category]);

  const categories = useCategories();
  const products = useProducts({
    search: debouncedSearch.length > 0 ? debouncedSearch : undefined,
    category,
    limit: 20,
  });

  const items = products.data?.data ?? [];
  const total = products.data?.pagination.total ?? 0;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text variant="h1">Catalogue</Text>

        <View style={styles.searchBox}>
          <Icon name="search" size={16} color="muted" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Rechercher un riz…"
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
              <Icon name="x" size={15} color="muted" />
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
          {(categories.data ?? []).map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              active={category === c.slug}
              onPress={() =>
                setCategory(category === c.slug ? undefined : c.slug)
              }
            />
          ))}
        </ScrollView>
      </View>

      {products.isError ? (
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
            <Text variant="caption" color="muted" style={styles.count}>
              {total} produit{total > 1 ? 's' : ''}
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.cell}>
              <ProductCard
                product={item}
                onPress={(p) => router.push(`/produit/${p.slug}`)}
              />
            </View>
          )}
        />
      )}
    </View>
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
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text
        variant="micro"
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
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.md,
    backgroundColor: palette.bg,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.card,
    borderWidth: 1.5,
    borderColor: palette.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 46,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: palette.ink,
  },
  chips: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
  },
  chipActive: { backgroundColor: palette.green, borderColor: palette.green },
  list: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
  row: { gap: spacing.md },
  cell: { flex: 1 },
  count: { marginBottom: spacing.xs },
});
