import type { CashflowScore } from '@contracts/types';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import { Text } from '@/components/Themed';
import { usePalette, type Palette } from '@/components/palette';

const MIN_SCORE = 300;
const MAX_SCORE = 850;
const REVEAL_MS = 720;
const SEGMENTS = 120;

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
  if (band === 'good') return palette.positive;
  return palette.positive;
}

function progress(score: number): number {
  const clamped = Math.min(MAX_SCORE, Math.max(MIN_SCORE, score));
  return (clamped - MIN_SCORE) / (MAX_SCORE - MIN_SCORE);
}

function mixHex(from: string, to: string, amount: number): string {
  const start = from.replace('#', '');
  const end = to.replace('#', '');
  if (start.length !== 6 || end.length !== 6) return amount < 0.5 ? from : to;

  const channel = (offset: number) => {
    const a = Number.parseInt(start.slice(offset, offset + 2), 16);
    const b = Number.parseInt(end.slice(offset, offset + 2), 16);
    return Math.round(a + (b - a) * amount).toString(16).padStart(2, '0');
  };

  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

function segmentColor(index: number, palette: Palette): string {
  const ratio = index / (SEGMENTS - 1);
  if (ratio < 0.52) return mixHex(palette.danger, palette.warning, ratio / 0.52);
  return mixHex(palette.warning, palette.positive, (ratio - 0.52) / 0.48);
}

function arcStyle(ratio: number, radius = 96): ViewStyle {
  const angle = 196 + ratio * 148;
  const radians = (angle * Math.PI) / 180;
  return {
    left: 132 + radius * Math.cos(radians) - 4,
    top: 120 + radius * Math.sin(radians) - 11,
    transform: [{ rotate: `${angle + 90}deg` }],
  };
}

function useReveal(target: number): number {
  const [value, setValue] = useState(MIN_SCORE);

  useEffect(() => {
    let frame = 0;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      if (reduced) {
        setValue(target);
        return;
      }
      const start = Date.now();
      frame = requestAnimationFrame(function tick() {
        const elapsed = Math.min(1, (Date.now() - start) / REVEAL_MS);
        const eased = 1 - Math.pow(1 - elapsed, 3);
        setValue(Math.round(MIN_SCORE + (target - MIN_SCORE) * eased));
        if (elapsed < 1) frame = requestAnimationFrame(tick);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [target]);

  return value;
}

export function ScoreGauge({ score }: { score: CashflowScore }) {
  const palette = usePalette();
  const shown = useReveal(score.score);
  // El arco se llena y el marcador viaja junto con el número que cuenta.
  const shownProgress = progress(shown);
  const delta = score.previous_score === null ? null : score.score - score.previous_score;
  const color = bandColor(score.band, palette);

  return (
    <View style={styles.container}>
      <View
        style={styles.gauge}
        accessible
        accessibilityLabel={`${score.score} puntos, ${BAND_ES[score.band]}`}>
        <Animated.View
          entering={FadeIn.duration(260).reduceMotion(ReduceMotion.System)}
          style={styles.arcLayer}>
          {Array.from({ length: SEGMENTS }, (_, index) => (
            <View
              key={index}
              style={[
                styles.segment,
                arcStyle(index / (SEGMENTS - 1)),
                { backgroundColor: index / (SEGMENTS - 1) <= shownProgress ? segmentColor(index, palette) : palette.track },
              ]}
            />
          ))}
        </Animated.View>
        <Animated.View
          entering={FadeIn.delay(300).duration(220).reduceMotion(ReduceMotion.System)}
          style={[styles.currentMarker, arcStyle(shownProgress)]}>
          <View style={[styles.markerCore, { backgroundColor: palette.surface }]} />
        </Animated.View>

        <View style={styles.scoreGroup}>
          <Text style={[styles.score, { color: palette.ink }]}>{shown}</Text>
          <View style={[styles.bandPill, { backgroundColor: palette.positiveSoft }]}>
            <Text style={[styles.band, { color }]}>{BAND_ES[score.band]}</Text>
          </View>
        </View>
      </View>

      <View style={styles.scale}>
        <Text style={[styles.scaleLabel, { color: palette.muted }]}>{MIN_SCORE}</Text>
        <Text style={[styles.scaleLabel, { color: palette.muted }]}>{MAX_SCORE}</Text>
      </View>

      {delta !== null && (
        <Text style={[styles.delta, { color: delta >= 0 ? palette.positive : palette.danger }]}>
          {delta >= 0 ? '↑ +' : '↓ −'}{Math.abs(delta)} pts
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  gauge: { width: 264, height: 148, position: 'relative' },
  arcLayer: { position: 'absolute', inset: 0 },
  segment: { position: 'absolute', width: 7, height: 20, borderRadius: 999 },
  currentMarker: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    marginLeft: -11,
    marginTop: -4,
    borderWidth: 4,
    borderColor: '#2E86C9',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1A5D91',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
  },
  markerCore: { width: 13, height: 13, borderRadius: 7 },
  scoreGroup: { position: 'absolute', left: 0, right: 0, top: 57, alignItems: 'center', gap: 3 },
  score: { fontSize: 55, lineHeight: 59, fontWeight: '700', letterSpacing: -2.2, fontVariant: ['tabular-nums'] },
  bandPill: { borderRadius: 999, paddingHorizontal: 17, paddingVertical: 4 },
  band: { fontSize: 14, fontWeight: '600' },
  scale: { width: 252, flexDirection: 'row', justifyContent: 'space-between', marginTop: -2 },
  scaleLabel: { fontSize: 12, fontVariant: ['tabular-nums'] },
  delta: { fontSize: 17, fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
});
