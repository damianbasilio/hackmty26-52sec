import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { usePalette } from './palette';

type Props = {
  children: ReactNode;
  /** Left rail color, used to flag a card that needs attention. */
  accent?: string;
  tone?: 'default' | 'sage' | 'blush' | 'mint';
  style?: ViewStyle;
};

export function Card({ children, accent, tone = 'default', style }: Props) {
  const palette = usePalette();
  const backgroundColor =
    tone === 'sage'
      ? palette.surfaceSage
      : tone === 'blush'
        ? palette.surfaceBlush
        : tone === 'mint'
          ? palette.surfaceMint
          : palette.surface;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor, borderColor: palette.border },
        accent ? { borderTopColor: accent, borderTopWidth: 2 } : null,
        style,
      ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 22,
    gap: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.22,
        shadowRadius: 28,
      },
      android: { elevation: 2 },
      default: { boxShadow: '0 14px 34px rgba(0, 0, 0, 0.22)' },
    }),
  },
});
