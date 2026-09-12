import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePalette } from '@/components/palette';

export function PremiumSurface({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const palette = usePalette();

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: palette.background }, style]}>
      <View
        pointerEvents="none"
        style={[styles.coolLight, { backgroundColor: palette.ambientCool }]}
      />
      <View
        pointerEvents="none"
        style={[styles.warmLight, { backgroundColor: palette.ambientWarm }]}
      />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, overflow: 'hidden' },
  coolLight: {
    position: 'absolute',
    width: 360,
    height: 360,
    borderRadius: 180,
    top: -210,
    right: -170,
    opacity: 0.62,
  },
  warmLight: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    bottom: -190,
    left: -170,
    opacity: 0.42,
  },
});
