import {
  Text as RNText,
  type TextProps as RNTextProps,
  StyleSheet,
} from 'react-native';

import {
  palette,
  typography,
  type PaletteColor,
  type TypographyVariant,
} from '@/theme/tokens';

export type TextProps = RNTextProps & {
  variant?: TypographyVariant;
  color?: PaletteColor;
  center?: boolean;
};

/**
 * Texte de l'application.
 *
 * Passer par ce composant plutôt que par `Text` de React Native garantit que
 * toute taille et toute couleur viennent des tokens. C'est aussi le point
 * d'entrée unique si l'on doit un jour brider `allowFontScaling` ou changer de
 * police.
 */
export function Text({
  variant = 'body',
  color = 'ink',
  center = false,
  style,
  ...rest
}: TextProps) {
  return (
    <RNText
      style={[
        styles.base,
        typography[variant],
        { color: palette[color] },
        center && styles.center,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    // Sans cette valeur, les accents français (É, À) sont rognés sur Android.
    includeFontPadding: false,
  },
  center: {
    textAlign: 'center',
  },
});
