import { StyleSheet, View } from 'react-native';

import { Button, Icon, Text, type IconName } from '@/components/ui';
import { describeError } from '@/api/errors';
import { palette, radius, spacing } from '@/theme/tokens';

/**
 * États transverses : chargement, erreur, vide.
 *
 * Centralisés pour que chaque écran affiche la même chose dans la même
 * situation — un catalogue qui échoue et un panier qui échoue ne doivent pas
 * se comporter différemment.
 */

/** Bloc gris animé occupant la place du contenu à venir. */
export function Skeleton({
  height = 16,
  width,
}: {
  height?: number;
  width?: number | string;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.skeleton,
        { height },
        width === undefined ? null : { width: width as number },
      ]}
    />
  );
}

/** Grille de vignettes fantômes, pendant le chargement du catalogue. */
export function ProductGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={styles.grid}>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={styles.skeletonCard}>
          <Skeleton height={96} />
          <View style={styles.skeletonBody}>
            <Skeleton height={12} width={140} />
            <Skeleton height={10} width={100} />
            <Skeleton height={18} width={70} />
          </View>
        </View>
      ))}
    </View>
  );
}

export type ErrorStateProps = {
  error: unknown;
  onRetry?: () => void;
};

/** Erreur réseau ou serveur, avec une action de reprise. */
export function ErrorState({ error, onRetry }: ErrorStateProps) {
  return (
    <View style={styles.centered}>
      <View style={[styles.bubble, { backgroundColor: '#FBE9E7' }]}>
        <Icon name="triangle-alert" size={26} color="danger" />
      </View>
      <Text variant="h3" center>
        Impossible de charger
      </Text>
      <Text variant="caption" color="muted" center>
        {describeError(error)}
      </Text>
      {onRetry ? (
        <Button
          label="Réessayer"
          variant="outline"
          size="sm"
          fullWidth={false}
          onPress={onRetry}
          icon={<Icon name="refresh-cw" size={14} color="green" />}
        />
      ) : null}
    </View>
  );
}

export type EmptyStateProps = {
  icon?: IconName;
  title: string;
  message?: string;
  action?: React.ReactNode;
};

/** Absence de résultat : recherche infructueuse, panier vide, aucune commande. */
export function EmptyState({
  icon = 'inbox',
  title,
  message,
  action,
}: EmptyStateProps) {
  return (
    <View style={styles.centered}>
      <View style={styles.bubble}>
        <Icon name={icon} size={26} color="green" />
      </View>
      <Text variant="h3" center>
        {title}
      </Text>
      {message ? (
        <Text variant="caption" color="muted" center>
          {message}
        </Text>
      ) : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: '#EDEFE9',
    borderRadius: radius.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  skeletonCard: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: palette.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: 'hidden',
  },
  skeletonBody: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
  },
  bubble: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: palette.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
});
