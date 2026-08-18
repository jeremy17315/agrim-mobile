import { useState } from 'react';
import { TextInput, type TextInputProps, StyleSheet, View } from 'react-native';

import { palette, radius, spacing, typography } from '@/theme/tokens';

import { Text } from './Text';

export type InputProps = TextInputProps & {
  label: string;
  /** Message d'erreur ; sa présence bascule le champ en état invalide. */
  error?: string;
  /** Aide affichée sous le champ quand il n'y a pas d'erreur. */
  hint?: string;
  required?: boolean;
};

/**
 * Champ de saisie.
 *
 * L'erreur est rendue en texte, pas seulement en couleur : un daltonien doit
 * pouvoir comprendre ce qui ne va pas. `accessibilityLabel` reprend le libellé
 * pour que les lecteurs d'écran annoncent autre chose que « champ de texte ».
 */
export function Input({
  label,
  error,
  hint,
  required = false,
  style,
  onFocus,
  onBlur,
  ...rest
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const invalid = typeof error === 'string' && error.length > 0;

  return (
    <View style={styles.wrapper}>
      <Text variant="micro" color="muted" style={styles.label}>
        {label.toUpperCase()}
        {required ? ' *' : ''}
      </Text>

      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={palette.muted}
        style={[
          styles.input,
          focused && styles.focused,
          invalid && styles.invalid,
          style,
        ]}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...rest}
      />

      {invalid ? (
        <Text variant="caption" color="danger" style={styles.helper}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="muted" style={styles.helper}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xs,
  },
  label: {
    marginLeft: 2,
  },
  input: {
    minHeight: 48,
    backgroundColor: palette.card,
    borderWidth: 1.5,
    borderColor: palette.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: typography.body.fontSize,
    color: palette.ink,
  },
  focused: {
    borderColor: palette.green,
  },
  invalid: {
    borderColor: palette.danger,
  },
  helper: {
    marginLeft: 2,
  },
});
