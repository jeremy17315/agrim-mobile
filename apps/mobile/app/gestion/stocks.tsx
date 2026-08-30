import {
  stockLevel,
  stockRatio,
  STOCK_LEVEL_PRESENTATION,
} from '@agrim/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAdjustStock, useStock, type StockItem } from '@/api/management';
import { EmptyState, ErrorState, Skeleton } from '@/components/states';
import { Button, Card, Icon, Input, Pill, Text } from '@/components/ui';
import { formatWeight } from '@/lib/format';
import { palette, radius, spacing } from '@/theme/tokens';

/**
 * Mouvements qu'un gestionnaire peut saisir.
 *
 * `COMMANDE` et `ANNULATION` n'y figurent pas : ils décrivent ce que le
 * système fait seul, et les proposer ici permettrait de maquiller une
 * démarque en vente.
 */
const MOVEMENT_CHOICES = [
  { value: 'ENTREE', label: 'Réception' },
  { value: 'SORTIE', label: 'Retrait' },
  { value: 'AJUSTEMENT', label: 'Correction' },
] as const;

type MovementChoice = (typeof MOVEMENT_CHOICES)[number]['value'];

const MOVEMENT_PLACEHOLDER: Record<MovementChoice, string> = {
  ENTREE: 'Livraison fournisseur',
  SORTIE: 'Casse, don, prélèvement',
  AJUSTEMENT: 'Comptage physique du 29/08',
};

/**
 * Stocks par variante.
 *
 * Le seuil d'alerte appartient à chaque variante : un 22,5 kg ne se
 * réapprovisionne pas au rythme d'un 900 g. Comparer tout à un même nombre
 * produirait des alertes permanentes, donc ignorées.
 */
export default function StocksScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const stock = useStock(onlyAlerts);
  const adjust = useAdjustStock();

  const [editing, setEditing] = useState<StockItem | null>(null);
  const [amount, setAmount] = useState('');
  const [movement, setMovement] = useState<MovementChoice>('ENTREE');
  const [reason, setReason] = useState('');

  const alertCount =
    stock.data?.filter((i) => i.stock <= i.lowStockThreshold).length ?? 0;

  const closeSheet = () => {
    setEditing(null);
    setAmount('');
    setReason('');
    setMovement('ENTREE');
  };

  const submit = () => {
    if (!editing) return;
    const saisie = Number(amount.replace(/[^0-9]/g, ''));
    if (!Number.isFinite(saisie) || saisie <= 0) {
      Alert.alert('Quantité invalide', 'Indiquez une quantité supérieure à zéro.');
      return;
    }

    // Le signe se déduit du geste choisi : on ne demande jamais à quelqu'un de
    // taper « −3 » sur un pavé numérique.
    const sortie = movement !== 'ENTREE';
    const delta = sortie ? -saisie : saisie;

    // Le serveur refuse un ajustement sans motif ; l'annoncer ici évite un
    // aller-retour réseau pour se le faire dire.
    if (movement === 'AJUSTEMENT' && !reason.trim()) {
      Alert.alert(
        'Motif obligatoire',
        'Expliquez la correction : c’est ce qui rend l’inventaire vérifiable.',
      );
      return;
    }

    // Contrôle local de courtoisie seulement : c'est PostgreSQL qui tranche,
    // et un retrait concurrent peut très bien vider le rayon d'ici là.
    if (sortie && saisie > editing.stock) {
      Alert.alert(
        'Retrait impossible',
        `Il ne reste que ${editing.stock} unité(s) en stock.`,
      );
      return;
    }

    adjust.mutate(
      {
        variantId: editing.variantId,
        delta,
        type: movement,
        reason: reason.trim() || undefined,
      },
      {
        onSuccess: closeSheet,
        onError: (error) =>
          Alert.alert(
            'Enregistrement impossible',
            error instanceof Error
              ? error.message
              : 'Le stock n’a pas pu être mis à jour. Réessayez.',
          ),
      },
    );
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          hitSlop={12}
        >
          <Icon name="arrow-left" size={19} color="ink" />
        </Pressable>
        <View style={styles.flex}>
          <Text variant="h1">Stocks</Text>
          {stock.data ? (
            <Text variant="caption" color="muted">
              {stock.data.length}{' '}
              {stock.data.length > 1 ? 'variantes' : 'variante'}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => setOnlyAlerts((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: onlyAlerts }}
          accessibilityLabel="Afficher uniquement les alertes"
          hitSlop={12}
        >
          <Icon name="funnel" size={19} color={onlyAlerts ? 'green' : 'ink'} />
        </Pressable>
      </View>

      {stock.isError ? (
        <ErrorState error={stock.error} onRetry={() => void stock.refetch()} />
      ) : stock.isLoading ? (
        <View style={styles.list}>
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index} style={styles.loadingCard}>
              <Skeleton height={13} width={160} />
              <Skeleton height={8} />
            </Card>
          ))}
        </View>
      ) : (
        <FlatList
          data={stock.data ?? []}
          keyExtractor={(item) => item.variantId}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + spacing.xxxl },
          ]}
          refreshing={stock.isRefetching}
          onRefresh={() => void stock.refetch()}
          ListHeaderComponent={
            !onlyAlerts && alertCount > 0 ? (
              <View style={styles.banner}>
                <Icon name="triangle-alert" size={14} color="warn" />
                <Text variant="caption" color="body" style={styles.flex}>
                  {alertCount === 1
                    ? '1 variante sous le seuil d’alerte'
                    : `${alertCount} variantes sous le seuil d’alerte`}
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="circle-check"
              title={onlyAlerts ? 'Aucune alerte' : 'Aucune variante'}
              message={
                onlyAlerts
                  ? 'Tous les stocks sont au-dessus de leur seuil.'
                  : undefined
              }
            />
          }
          renderItem={({ item }) => (
            <StockRow
              item={item}
              onReplenish={() => {
                setEditing(item);
                setAmount('');
              }}
            />
          )}
        />
      )}

      {/* Saisie inline plutôt qu'Alert.prompt, indisponible sur Android. */}
      {editing ? (
        <View
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
        >
          <View style={styles.sheetHeader}>
            <Text variant="h3" style={styles.flex}>
              {editing.productName} {editing.label}
            </Text>
            <Pressable
              onPress={closeSheet}
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              hitSlop={12}
            >
              <Icon name="x" size={18} color="muted" />
            </Pressable>
          </View>

          <Text variant="caption" color="muted">
            Stock actuel : {editing.stock} unités · seuil{' '}
            {editing.lowStockThreshold}
          </Text>

          {/* Le geste d'abord, la quantité ensuite : c'est lui qui décide du
              signe, et une saisie négative sur pavé numérique est un piège. */}
          <View
            style={styles.choices}
            accessibilityRole="radiogroup"
            accessibilityLabel="Nature du mouvement"
          >
            {MOVEMENT_CHOICES.map((choice) => {
              const active = movement === choice.value;
              return (
                <Pressable
                  key={choice.value}
                  onPress={() => setMovement(choice.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  style={[styles.choice, active && styles.choiceActive]}
                >
                  <Text
                    variant="caption"
                    color={active ? 'white' : 'body'}
                    numberOfLines={1}
                  >
                    {choice.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Input
            label={
              movement === 'ENTREE'
                ? 'Apport (unités)'
                : movement === 'AJUSTEMENT'
                  ? 'Écart constaté (unités)'
                  : 'Retrait (unités)'
            }
            placeholder="50"
            keyboardType="number-pad"
            value={amount}
            onChangeText={setAmount}
            autoFocus={Platform.OS !== 'web'}
          />

          <Input
            label={
              movement === 'AJUSTEMENT' ? 'Motif (obligatoire)' : 'Motif'
            }
            placeholder={MOVEMENT_PLACEHOLDER[movement]}
            value={reason}
            onChangeText={setReason}
            maxLength={300}
          />

          <Button
            label="Enregistrer le mouvement"
            onPress={submit}
            loading={adjust.isPending}
          />

          <Text variant="caption" color="muted">
            Le mouvement est enregistré à votre nom dans l’historique de la
            variante.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function StockRow({
  item,
  onReplenish,
}: {
  item: StockItem;
  onReplenish: () => void;
}) {
  const level = stockLevel(item.stock, item.lowStockThreshold);
  const presentation = STOCK_LEVEL_PRESENTATION[level];
  const ratio = stockRatio(item.stock, item.lowStockThreshold);

  const barColor =
    level === 'OK'
      ? palette.green
      : level === 'LOW'
        ? palette.warn
        : palette.danger;

  return (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.flex}>
          <Text variant="bodyStrong">
            {item.productName} · {formatWeight(item.weightGrams)}
          </Text>
          <Text variant="micro" color="muted" style={styles.sku}>
            {item.sku}
          </Text>
        </View>
        <Pill tone={presentation.tone} label={presentation.label} />
      </View>

      <View style={styles.bar}>
        <View
          style={[
            styles.barFill,
            { width: `${ratio}%`, backgroundColor: barColor },
          ]}
        />
      </View>

      <View style={styles.cardFooter}>
        <Text variant="caption" color="muted" style={styles.flex}>
          {item.stock} unités · seuil {item.lowStockThreshold}
        </Text>
        <Pressable
          onPress={onReplenish}
          accessibilityRole="button"
          accessibilityLabel={`Réapprovisionner ${item.productName} ${item.label}`}
          hitSlop={8}
        >
          <Text variant="caption" color="green">
            Réapprovisionner
          </Text>
        </Pressable>
      </View>
    </Card>
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
  },
  list: { padding: spacing.lg, paddingTop: 0, gap: spacing.sm },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.goldSoft,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  card: { gap: spacing.sm },
  loadingCard: { gap: spacing.sm },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  sku: { fontVariant: ['tabular-nums'] },
  bar: {
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: palette.line,
    overflow: 'hidden',
  },
  barFill: { height: '100%' },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderColor: palette.line,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  choices: { flexDirection: 'row', gap: spacing.xs },
  choice: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: 'center',
  },
  choiceActive: {
    backgroundColor: palette.green,
    borderColor: palette.green,
  },
});
