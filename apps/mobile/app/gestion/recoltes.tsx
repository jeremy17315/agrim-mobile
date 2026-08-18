import {
  canTransitionProduction,
  PRODUCTION_STATUS_PRESENTATION,
  productionProgress,
  type ProductionStatus,
} from '@agrim/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useProductionReview,
  useReviewProduction,
  type ReviewableProduction,
} from '@/api/management';
import { EmptyState, ErrorState, Skeleton } from '@/components/states';
import { Button, Card, Icon, Input, Pill, Text } from '@/components/ui';
import { formatKilograms, formatPhone, formatRelativeTime } from '@/lib/format';
import { palette, radius, spacing } from '@/theme/tokens';

/**
 * Revue des déclarations de récolte.
 *
 * Le producteur déclare, la coopérative arbitre : c'est ce qui donne sa valeur
 * à la déclaration comme pièce de suivi. Deux décisions selon l'état — vérifier
 * une déclaration reçue, puis acter la réception physique de la récolte.
 *
 * Un rejet exige un motif : sans explication, le producteur n'a aucun recours.
 */
export default function RecoltesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const review = useProductionReview();
  const decide = useReviewProduction();

  const [rejecting, setRejecting] = useState<ReviewableProduction | null>(null);
  const [note, setNote] = useState('');

  const items = review.data ?? [];

  const submitDecision = (
    item: ReviewableProduction,
    status: ProductionStatus,
  ) => {
    decide.mutate(
      { id: item.id, status },
      {
        onError: () =>
          Alert.alert(
            'Décision non enregistrée',
            'La déclaration n’a pas pu être mise à jour. Réessayez.',
          ),
      },
    );
  };

  const submitRejection = () => {
    if (!rejecting) return;
    const reviewNote = note.trim();

    if (reviewNote.length === 0) {
      Alert.alert('Motif requis', 'Expliquez au producteur ce qui ne va pas.');
      return;
    }

    decide.mutate(
      { id: rejecting.id, status: 'REJECTED', reviewNote },
      {
        onSuccess: () => {
          setRejecting(null);
          setNote('');
        },
        onError: () =>
          Alert.alert(
            'Décision non enregistrée',
            'Le rejet n’a pas pu être enregistré. Réessayez.',
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
          <Text variant="h1">Récoltes</Text>
          <Text variant="caption" color="muted">
            {items.length === 0
              ? 'Déclarations des producteurs'
              : items.length === 1
                ? '1 déclaration à examiner'
                : `${items.length} déclarations à examiner`}
          </Text>
        </View>
      </View>

      {review.isError ? (
        <ErrorState
          error={review.error}
          onRetry={() => void review.refetch()}
        />
      ) : review.isLoading ? (
        <View style={styles.list}>
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index} style={styles.loadingCard}>
              <Skeleton height={13} width={180} />
              <Skeleton height={8} />
            </Card>
          ))}
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + spacing.xxxl },
          ]}
          refreshing={review.isRefetching}
          onRefresh={() => void review.refetch()}
          ListEmptyComponent={
            <EmptyState
              icon="circle-check"
              title="Rien à examiner"
              message="Toutes les déclarations ont été traitées."
            />
          }
          renderItem={({ item }) => (
            <ProductionRow
              item={item}
              pending={decide.isPending}
              onDecide={(status) => submitDecision(item, status)}
              onReject={() => {
                setRejecting(item);
                setNote('');
              }}
            />
          )}
        />
      )}

      {/* Saisie inline : Alert.prompt n'existe pas sur Android. */}
      {rejecting ? (
        <View
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
        >
          <View style={styles.sheetHeader}>
            <Text variant="h3" style={styles.flex}>
              Rejeter la déclaration
            </Text>
            <Pressable
              onPress={() => setRejecting(null)}
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              hitSlop={12}
            >
              <Icon name="x" size={18} color="muted" />
            </Pressable>
          </View>

          <Text variant="caption" color="muted">
            {rejecting.producerName} · {rejecting.season} ·{' '}
            {formatKilograms(rejecting.quantityKg)}
          </Text>

          <Input
            label="Motif du rejet"
            placeholder="Quantité incohérente avec la parcelle déclarée."
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={300}
            required
            autoFocus={Platform.OS !== 'web'}
            hint="Le producteur verra ce message."
          />

          <Button
            label="Confirmer le rejet"
            variant="danger"
            onPress={submitRejection}
            loading={decide.isPending}
          />
        </View>
      ) : null}
    </View>
  );
}

function ProductionRow({
  item,
  pending,
  onDecide,
  onReject,
}: {
  item: ReviewableProduction;
  pending: boolean;
  onDecide: (status: ProductionStatus) => void;
  onReject: () => void;
}) {
  const presentation = PRODUCTION_STATUS_PRESENTATION[item.status];
  const progress = productionProgress(item.quantityKg, item.targetKg);

  // L'étape suivante découle du contrat partagé, jamais d'un test de statut
  // écrit à la main dans l'écran.
  const nextStatus: ProductionStatus | null = canTransitionProduction(
    item.status,
    'CONFIRMED',
  )
    ? 'CONFIRMED'
    : canTransitionProduction(item.status, 'RECEIVED')
      ? 'RECEIVED'
      : null;

  const nextLabel =
    nextStatus === 'CONFIRMED'
      ? 'Vérifier'
      : nextStatus === 'RECEIVED'
        ? 'Marquer réceptionnée'
        : null;

  return (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.flex}>
          <Text variant="bodyStrong">{item.producerName}</Text>
          <Text variant="micro" color="muted">
            {item.farmName} · {item.season}
          </Text>
        </View>
        <Pill tone={presentation.tone} label={presentation.label} />
      </View>

      <View style={styles.figures}>
        <View>
          <Text variant="h3">{formatKilograms(item.quantityKg)}</Text>
          <Text variant="micro" color="muted">
            {item.cropVariety}
          </Text>
        </View>
        {progress !== null ? (
          <Text variant="caption" color="muted">
            {progress} % de l’objectif
          </Text>
        ) : null}
      </View>

      <Text variant="micro" color="muted">
        Déclarée {formatRelativeTime(item.createdAt)}
      </Text>

      <Pressable
        onPress={() => void Linking.openURL(`tel:${item.producerPhone}`)}
        accessibilityRole="button"
        accessibilityLabel={`Appeler ${item.producerName}`}
        style={styles.phone}
        hitSlop={8}
      >
        <Icon name="phone" size={14} color="green" />
        <Text variant="caption" style={styles.phoneText}>
          {formatPhone(item.producerPhone)}
        </Text>
      </Pressable>

      <View style={styles.actions}>
        <View style={styles.flex}>
          <Button
            label="Rejeter"
            variant="ghost"
            size="sm"
            onPress={onReject}
            fullWidth
          />
        </View>
        {nextStatus && nextLabel ? (
          <View style={styles.flex}>
            <Button
              label={nextLabel}
              size="sm"
              onPress={() => onDecide(nextStatus)}
              loading={pending}
              fullWidth
            />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
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
  list: { padding: spacing.lg, gap: spacing.md },
  loadingCard: { gap: spacing.sm, padding: spacing.lg },
  card: { gap: spacing.sm, padding: spacing.lg },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  figures: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  phone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
  },
  phoneText: { color: palette.green },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: palette.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
