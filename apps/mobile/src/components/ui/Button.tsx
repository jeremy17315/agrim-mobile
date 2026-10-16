import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  View,
} from 'react-native';

import { palette, radius, spacing, type TypographyVariant } from '@/theme/tokens';

import { Text } from './Text';

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';
/**
 * `lg` : le grand bouton des écrans à une seule action (porte d'entrée du
 * parcours). Le libellé y est plus grand et la cible plus haute, sans qu'aucun
 * écran n'ait à écrire une taille ou une couleur en dur.
 */
export type ButtonSize = 'sm' | 'md' | 'lg';

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
        boiteDeTaille(size),
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
              variant={libelleDeTaille(size)}
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

/** Boîte du bouton selon sa taille. */
function boiteDeTaille(size: ButtonSize) {
  if (size === 'lg') return styles.lg;
  if (size === 'sm') return styles.sm;
  return styles.md;
}

/** Un grand bouton porte un libellé plus grand, pas seulement plus d'air. */
function libelleDeTaille(size: ButtonSize): TypographyVariant {
  return size === 'lg' ? 'h1' : 'h3';
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
  lg: {
    minHeight: 68,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
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
