import type { CashflowComponent } from '@contracts/types';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/components/Themed';
import { usePalette, type Palette } from '@/components/palette';

function valueColor(value: number, palette: Palette): string {
  if (value >= 80) return palette.positive;
  if (value >= 60) return palette.accent;
  if (value >= 40) return palette.warning;
  return palette.danger;
}

function ComponentRow({ component, index }: { component: CashflowComponent; index: number }) {
  const palette = usePalette();
  const color = valueColor(component.value, palette);
  const fill = useSharedValue(0);

  useEffect(() => {
    fill.value = withDelay(
      55 * index,
      withTiming(component.value, {
        duration: 480,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [component.value, fill, index]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value}%` }));

  return (
    <View style={styles.row}>
      <View style={styles.head}>
        <Text style={styles.label}>{component.label}</Text>
        <Text style={[styles.points, { color }]}>{component.points} pts</Text>
      </View>

      <View style={[styles.track, { backgroundColor: palette.track }]}>
        <Animated.View style={[styles.fill, { backgroundColor: color }, fillStyle]} />
      </View>

      <Text style={[styles.meta, { color: palette.muted }]}>
        {component.value} de 100 · pesa {Math.round(component.weight * 100)}% del total
      </Text>

      <Text style={[styles.explanation, { color: palette.muted }]}>{component.explanation}</Text>
    </View>
  );
}

export function ScoreBreakdown({ components }: { components: CashflowComponent[] }) {
  return (
    <View style={styles.list}>
      {components.map((component, index) => (
        <ComponentRow key={component.key} component={component} index={index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 22 },
  row: { gap: 7 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  label: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  points: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  track: { height: 7, borderRadius: 999, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
  meta: { fontSize: 12, fontVariant: ['tabular-nums'] },
  explanation: { fontSize: 13, lineHeight: 19 },
});
