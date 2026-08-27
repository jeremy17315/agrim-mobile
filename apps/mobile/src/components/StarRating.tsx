import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui';
import { spacing } from '@/theme/tokens';

export type StarRatingProps = {
  value: number;
  onChange?: (rating: number) => void;
  size?: number;
  /** Si vrai, chaque étoile est cochéable. */
  interactive?: boolean;
};

/**
 * Cinq étoiles. En lecture, elles illustrent une note ; en saisie, un tap
 * sur la n-ième coche 1…n étoiles.
 */
export function StarRating({
  value,
  onChange,
  size = 22,
  interactive = false,
}: StarRatingProps) {
  return (
    <View
      style={styles.row}
      accessible={!interactive}
      accessibilityLabel={
        interactive
          ? undefined
          : `${value} étoile${value > 1 ? 's' : ''} sur 5`
      }
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        return (
          <Pressable
            key={n}
            disabled={!interactive}
            onPress={() => onChange?.(n)}
            accessibilityRole={interactive ? 'button' : 'none'}
            accessibilityLabel={
              interactive ? `${n} étoile${n > 1 ? 's' : ''}` : undefined
            }
            accessibilityState={
              interactive ? { selected: n === value } : undefined
            }
            hitSlop={6}
            style={styles.star}
          >
            <Icon name="star" size={size} color={filled ? 'gold' : 'line'} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  star: { padding: 2 },
});
