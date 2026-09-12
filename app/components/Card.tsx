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
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    gap: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#001A3D',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.07,
        shadowRadius: 22,
      },
      android: { elevation: 3 },
      default: { boxShadow: '0 10px 28px rgba(0, 26, 61, 0.08)' },
    }),
  },
});
