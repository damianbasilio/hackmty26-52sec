import type { CashflowScore } from '@contracts/types';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Badge } from '@/components/Badge';
import { Text } from '@/components/Themed';
import { usePalette, type Palette } from '@/components/palette';
import { formatLongDay } from '@/src/format';

const MIN_SCORE = 300;
const MAX_SCORE = 850;
const REVEAL_MS = 900;

const BAND_ES: Record<CashflowScore['band'], string> = {
  poor: 'Bajo',
  fair: 'Regular',
  good: 'Bueno',
  very_good: 'Muy bueno',
  excellent: 'Excelente',
};

function bandColor(band: CashflowScore['band'], palette: Palette): string {
  if (band === 'poor') return palette.danger;
  if (band === 'fair') return palette.warning;
  if (band === 'good') return palette.accent;
  return palette.positive;
}

/** Position of a score inside the 300..850 track, as a layout percentage. */
function trackPercent(score: number): number {
  const clamped = Math.min(MAX_SCORE, Math.max(MIN_SCORE, score));
  return ((clamped - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)) * 100;
}

/** Counts up to the real score on mount; the last frame lands exactly on it. */
function useReveal(target: number): number {
  const [value, setValue] = useState(MIN_SCORE);

  useEffect(() => {
    const start = Date.now();
    let frame = requestAnimationFrame(function tick() {
      const t = Math.min(1, (Date.now() - start) / REVEAL_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(MIN_SCORE + (target - MIN_SCORE) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return value;
}

export function ScoreGauge({ score }: { score: CashflowScore }) {
  const palette = usePalette();
  const color = bandColor(score.band, palette);
  const shown = useReveal(score.score);
  const fill = useSharedValue(0);
  const delta = score.previous_score === null ? null : score.score - score.previous_score;

  useEffect(() => {
    fill.value = withTiming(trackPercent(score.score), {
      duration: REVEAL_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [fill, score.score]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value}%` }));

  return (
    <View style={styles.container}>
      <Text style={[styles.eyebrow, { color: palette.muted }]}>Salud de tu flujo de efectivo</Text>

      <Text style={[styles.score, { color }]} accessibilityLabel={`${score.score} puntos`}>
        {shown}
      </Text>

      <View style={styles.badges}>
        <Badge label={BAND_ES[score.band]} color={color} background={palette.surfaceAlt} />
        {delta !== null && (
          <Badge
            label={`${delta >= 0 ? '+' : '−'}${Math.abs(delta)} pts`}
            color={delta >= 0 ? palette.positive : palette.danger}
            background={delta >= 0 ? palette.positiveSoft : palette.dangerSoft}
          />
        )}
      </View>

      <View style={[styles.track, { backgroundColor: palette.track }]}>
        <Animated.View style={[styles.fill, { backgroundColor: color }, fillStyle]} />
        {score.previous_score !== null && (
          <View
            style={[
              styles.marker,
              { backgroundColor: palette.muted, left: `${trackPercent(score.previous_score)}%` },
            ]}
          />
        )}
      </View>

      <View style={styles.scale}>
        <Text style={[styles.scaleLabel, { color: palette.muted }]}>{MIN_SCORE}</Text>
        <Text style={[styles.scaleLabel, { color: palette.muted }]}>{MAX_SCORE}</Text>
      </View>

      {score.previous_score !== null && (
        <Text style={[styles.caption, { color: palette.muted }]}>
          La marca gris es tu score anterior: {score.previous_score}.
        </Text>
      )}

      <Text style={[styles.caption, { color: palette.muted }]}>
        Calculado del {formatLongDay(score.period_start)} al {formatLongDay(score.period_end, true)}.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  eyebrow: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  score: { fontSize: 64, fontWeight: '800', lineHeight: 68, fontVariant: ['tabular-nums'] },
  badges: { flexDirection: 'row', gap: 8 },
  track: { height: 12, borderRadius: 999, overflow: 'hidden', marginTop: 4 },
  fill: { height: '100%', borderRadius: 999 },
  marker: { position: 'absolute', top: 0, bottom: 0, width: 2, opacity: 0.9 },
  scale: { flexDirection: 'row', justifyContent: 'space-between' },
  scaleLabel: { fontSize: 11, fontVariant: ['tabular-nums'] },
  caption: { fontSize: 12, lineHeight: 17 },
});
