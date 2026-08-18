import { View, type ViewProps, StyleSheet } from 'react-native';

import { palette, radius, shadow, spacing } from '@/theme/tokens';

export type CardProps = ViewProps & {
  /** `flat` retire l'ombre : utile dans une liste dense. */
  flat?: boolean;
  padded?: boolean;
};

/** Surface blanche standard : listes, blocs de formulaire, encarts. */
export function Card({
  flat = false,
  padded = true,
  style,
  ...rest
}: CardProps) {
  return (
    <View
      style={[
        styles.base,
        padded && styles.padded,
        !flat && shadow.card,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: palette.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
  },
  padded: {
    padding: spacing.md,
  },
});
