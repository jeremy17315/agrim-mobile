import { View, type ViewProps, StyleSheet } from 'react-native';

import { palette, radius, spacing } from '@/theme/tokens';

import { Text } from './Text';

export type PillTone = 'green' | 'gold' | 'info' | 'danger' | 'warn' | 'neutral';

export type PillProps = ViewProps & {
  label: string;
  tone?: PillTone;
  icon?: React.ReactNode;
};

const TONES: Record<PillTone, { bg: string; fg: string }> = {
  green: { bg: palette.greenSoft, fg: palette.green },
  gold: { bg: palette.goldSoft, fg: palette.goldDark },
  info: { bg: '#E4EFF4', fg: palette.info },
  danger: { bg: '#FBE9E7', fg: palette.danger },
  warn: { bg: '#FDF1DF', fg: '#9A5E10' },
  neutral: { bg: palette.bg, fg: palette.body },
};

/** Étiquette de statut : « En transit », « Stock faible », « Livrée »… */
export function Pill({ label, tone = 'neutral', icon, style, ...rest }: PillProps) {
  const { bg, fg } = TONES[tone];

  return (
    <View style={[styles.base, { backgroundColor: bg }, style]} {...rest}>
      {icon}
      <Text variant="micro" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
});
