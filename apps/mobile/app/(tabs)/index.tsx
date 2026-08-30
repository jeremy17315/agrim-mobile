import { COMPANY, SELLING_POINTS } from '@agrim/contracts';
import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCategories, useProducts } from '@/api/catalog';
import { ProductCard } from '@/components/ProductCard';
import { ErrorState, ProductGridSkeleton } from '@/components/states';
import { Banner, Card, Icon, Pill, Text } from '@/components/ui';
import { palette, radius, spacing } from '@/theme/tokens';

/**
 * Accueil client.
 *
 * Trois blocs : identité de marque, gammes, sélection de produits. Les données
 * viennent de l'API — aucune gamme ni aucun prix n'est écrit dans cet écran.
 */
export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const categories = useCategories();
  const featured = useProducts({ featured: true, limit: 4 });

  const refreshing = categories.isFetching && featured.isFetching;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            void categories.refetch();
            void featured.refetch();
          }}
          tintColor={palette.green}
        />
      }
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.headerTop}>
          <View>
            <Text variant="caption" style={styles.headerMuted}>
              Bonjour
            </Text>
            <Text variant="h1" color="white">
              Bienvenue
            </Text>
          </View>
          <View style={styles.bell}>
            <Icon name="bell" size={18} color="white" />
          </View>
        </View>

        <Text variant="caption" style={styles.headerMuted}>
          {COMPANY.brandName} — {COMPANY.brandSignature}
        </Text>

        <View style={styles.argRow}>
          {SELLING_POINTS.slice(0, 2).map((point) => (
            <View key={point} style={styles.arg}>
              <Icon name="check" size={11} color="#7BEFA3" />
              <Text variant="micro" style={styles.argText} numberOfLines={1}>
                {point}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.body}>
        {/* Le seuil de gratuité appartient au site et se compte en KILOS, pas
            en francs (décision du 29 août 2026). L'annoncer ici supposerait de
            connaître une valeur que cet écran n'a pas — et une promesse fausse
            coûte plus cher qu'une bannière en moins. Le montant exact des
            frais s'affiche au récapitulatif, calculé par le serveur. */}
        <Banner
          tone="success"
          message="Riz local de luxe, livré partout en Côte d'Ivoire."
          icon={<Icon name="gift" size={15} color="green" />}
        />

        <Section title="Nos gammes">
          {categories.isError ? (
            <ErrorState
              error={categories.error}
              onRetry={() => void categories.refetch()}
            />
          ) : categories.isPending ? (
            <View style={styles.rangeRow}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <View key={i} style={styles.rangeSkeleton} />
              ))}
            </View>
          ) : (
            <View style={styles.rangeRow}>
              {categories.data.map((category) => (
                <Card
                  key={category.id}
                  style={styles.rangeCard}
                  onTouchEnd={() =>
                    router.push({
                      pathname: '/catalogue',
                      params: { category: category.slug },
                    })
                  }
                >
                  <Icon name="wheat" size={18} color="gold" />
                  <Text variant="h3" numberOfLines={1}>
                    {category.name}
                  </Text>
                  <Text variant="micro" color="muted" numberOfLines={2}>
                    {category.description ?? ''}
                  </Text>
                </Card>
              ))}
            </View>
          )}
        </Section>

        <Section
          title="Sélection du moment"
          action={<Pill label="Populaire" tone="gold" />}
        >
          {featured.isError ? (
            <ErrorState
              error={featured.error}
              onRetry={() => void featured.refetch()}
            />
          ) : featured.isPending ? (
            <ProductGridSkeleton count={2} />
          ) : (
            <View style={styles.grid}>
              {featured.data.data.map((product) => (
                <View key={product.id} style={styles.gridItem}>
                  <ProductCard
                    product={product}
                    onPress={(p) => router.push(`/produit/${p.slug}`)}
                  />
                </View>
              ))}
            </View>
          )}
        </Section>
      </View>
    </ScrollView>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text variant="h2">{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  content: { paddingBottom: spacing.xxxl },
  header: {
    backgroundColor: palette.green,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerMuted: { color: 'rgba(255,255,255,0.72)' },
  bell: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  argRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  arg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    flexShrink: 1,
  },
  argText: { color: 'rgba(255,255,255,0.92)', flexShrink: 1 },
  body: { padding: spacing.lg, gap: spacing.xl },
  section: { gap: spacing.md },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rangeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  rangeCard: { flexBasis: '47%', flexGrow: 1, gap: 4 },
  rangeSkeleton: {
    flexBasis: '47%',
    flexGrow: 1,
    height: 92,
    borderRadius: radius.lg,
    backgroundColor: '#EDEFE9',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  gridItem: { flexBasis: '47%', flexGrow: 1 },
});
