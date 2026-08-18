import { View, type ViewProps, StyleSheet } from 'react-native';

import { palette, radius, spacing } from '@/theme/tokens';

import { Text } from './Text';

export type BannerTone = 'success' | 'warning' | 'danger' | 'info';

export type BannerProps = ViewProps & {
  message: string;
  tone?: BannerTone;
  icon?: React.ReactNode;
};

const TONES: Record<BannerTone, { bg: string; fg: string; border: string }> = {
  success: { bg: palette.greenSoft, fg: palette.green, border: '#CFE0CA' },
  warning: { bg: '#FDF1DF', fg: '#8A5310', border: '#F2DFBC' },
  danger: { bg: '#FBE9E7', fg: palette.danger, border: '#F3D2CE' },
  info: { bg: '#E4EFF4', fg: '#1F5670', border: '#CBE0E9' },
};

/** Bandeau d'information contextuelle : hors ligne, promotion, alerte stock. */
export function Banner({ message, tone = 'info', icon, style, ...rest }: BannerProps) {
  const t = TONES[tone];

  return (
    <View
      accessibilityRole="alert"
      style={[styles.base, { backgroundColor: t.bg, borderColor: t.border }, style]}
      {...rest}
    >
      {icon}
      <Text variant="caption" style={[styles.message, { color: t.fg }]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  message: {
    flex: 1,
    lineHeight: 17,
  },
});
