import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  View,
} from 'react-native';

import { palette, radius, spacing } from '@/theme/tokens';

import { Text } from './Text';

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Icône rendue à gauche du libellé. */
  icon?: React.ReactNode;
  fullWidth?: boolean;
};

const BG: Record<ButtonVariant, string> = {
  primary: palette.green,
  outline: 'transparent',
  ghost: 'transparent',
  danger: palette.danger,
};

const FG: Record<ButtonVariant, string> = {
  primary: palette.white,
  outline: palette.green,
  ghost: palette.body,
  danger: palette.white,
};

/**
 * Bouton principal de l'application.
 *
 * Deux points volontaires :
 *  - pendant le chargement, le bouton reste à sa taille (le libellé est masqué
 *    mais conserve sa place) : aucun saut de mise en page ;
 *  - il est réellement désactivé pendant le chargement, ce qui évite les
 *    doubles soumissions — critique sur un tunnel de commande.
 */
export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  fullWidth = true,
  disabled,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled === true || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={label}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        { backgroundColor: BG[variant] },
        variant === 'outline' && styles.outline,
        fullWidth && styles.fullWidth,
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
      ]}
      {...rest}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={FG[variant]} />
        ) : (
          <>
            {icon}
            <Text
              variant={size === 'sm' ? 'h3' : 'h3'}
              style={[styles.label, { color: FG[variant] }]}
            >
              {label}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  md: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  sm: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  outline: {
    borderWidth: 1.5,
    borderColor: palette.green,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  label: {
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.45,
  },
});
