import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion, SlideInDown } from 'react-native-reanimated';

import { MotionPressable } from '@/components/Motion';
import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';
import { formatMonthName } from '@/src/format';

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export type QuickRange = { key: string; label: string };

function monthKeyOf(day: string): string {
  return day.slice(0, 7);
}

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

/** Celdas del mes empezando en lunes; null son los huecos antes del día 1. */
function monthCells(monthKey: string): (string | null)[] {
  const [year, month] = monthKey.split('-').map(Number);
  const leading = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: days }, (_, index) => `${monthKey}-${String(index + 1).padStart(2, '0')}`),
  ];
}

/** Calendario propio: sin dependencias nativas y con los días que tienen movimientos marcados. */
export function CalendarPicker({
  visible,
  selectedDay,
  today,
  markedDays,
  quickRanges = [],
  selectedQuickKey,
  onSelectDay,
  onSelectQuick,
  onClose,
}: {
  visible: boolean;
  selectedDay: string | null;
  today: string;
  markedDays: Set<string>;
  quickRanges?: QuickRange[];
  selectedQuickKey?: string | null;
  onSelectDay: (day: string) => void;
  onSelectQuick?: (key: string) => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  const [month, setMonth] = useState(monthKeyOf(selectedDay ?? today));

  useEffect(() => {
    if (visible) setMonth(monthKeyOf(selectedDay ?? today));
  }, [selectedDay, today, visible]);

  const cells = useMemo(() => monthCells(month), [month]);
  const canGoForward = month < monthKeyOf(today);
  const title = `${formatMonthName(month).charAt(0).toUpperCase()}${formatMonthName(month).slice(1)} ${month.slice(0, 4)}`;

  return (
    <Modal animationType="none" onRequestClose={onClose} transparent visible={visible}>
      <Animated.View entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)} style={styles.backdrop}>
        <Pressable accessibilityLabel="Cerrar calendario" onPress={onClose} style={StyleSheet.absoluteFill} />
        <Animated.View
          entering={SlideInDown.duration(260).reduceMotion(ReduceMotion.System)}
          style={[styles.sheet, { backgroundColor: palette.surface }]}>
          <View style={[styles.handle, { backgroundColor: palette.border }]} />
          <Text style={styles.sheetTitle}>Elige una fecha</Text>

          {quickRanges.length > 0 ? (
            <View style={styles.quickRow}>
              {quickRanges.map((range) => {
                const active = selectedQuickKey === range.key;
                return (
                  <MotionPressable
                    key={range.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => onSelectQuick?.(range.key)}
                    style={[styles.quick, { backgroundColor: active ? palette.primary : palette.surfaceAlt }]}>
                    <Text style={[styles.quickLabel, { color: active ? palette.onPrimary : palette.ink }]}>{range.label}</Text>
                  </MotionPressable>
                );
              })}
            </View>
          ) : null}

          <View style={styles.monthHeader}>
            <MotionPressable
              accessibilityLabel="Mes anterior"
              hitSlop={8}
              onPress={() => setMonth((current) => shiftMonth(current, -1))}
              style={styles.monthButton}>
              <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} tintColor={palette.ink} size={17} />
            </MotionPressable>
            <Text style={styles.monthTitle}>{title}</Text>
            <MotionPressable
              accessibilityLabel="Mes siguiente"
              disabled={!canGoForward}
              hitSlop={8}
              onPress={() => setMonth((current) => shiftMonth(current, 1))}
              style={[styles.monthButton, { opacity: canGoForward ? 1 : 0.3 }]}>
              <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} tintColor={palette.ink} size={17} />
            </MotionPressable>
          </View>

          <View style={styles.grid}>
            {WEEKDAYS.map((weekday, index) => (
              <View key={`${weekday}-${index}`} style={styles.cell}>
                <Text style={[styles.weekday, { color: palette.muted }]}>{weekday}</Text>
              </View>
            ))}
            {cells.map((day, index) => {
              if (!day) return <View key={`empty-${index}`} style={styles.cell} />;
              const selected = day === selectedDay;
              const future = day > today;
              const marked = markedDays.has(day);
              return (
                <View key={day} style={styles.cell}>
                  <MotionPressable
                    accessibilityLabel={`${Number(day.slice(8))} de ${formatMonthName(day)}${marked ? ', con movimientos' : ''}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: future }}
                    disabled={future}
                    onPress={() => onSelectDay(day)}
                    pressedScale={0.9}
                    style={[
                      styles.day,
                      selected ? { backgroundColor: palette.primary } : null,
                      day === today && !selected ? { borderColor: palette.primary, borderWidth: 1.5 } : null,
                      { opacity: future ? 0.3 : 1 },
                    ]}>
                    <Text style={[styles.dayLabel, { color: selected ? palette.onPrimary : palette.ink }]}>{Number(day.slice(8))}</Text>
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: marked ? (selected ? palette.onPrimary : palette.accent) : 'transparent' },
                      ]}
                    />
                  </MotionPressable>
                </View>
              );
            })}
          </View>

          <Text style={[styles.legend, { color: palette.muted }]}>Los días con punto tienen movimientos.</Text>

          <MotionPressable
            accessibilityRole="button"
            onPress={onClose}
            style={[styles.closeButton, { borderColor: palette.border }]}>
            <Text style={[styles.closeLabel, { color: palette.accent }]}>Cerrar</Text>
          </MotionPressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 16, 36, 0.42)' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 34, gap: 14 },
  handle: { alignSelf: 'center', width: 38, height: 5, borderRadius: 999 },
  sheetTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  quickRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  quick: { minHeight: 38, borderRadius: 14, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontSize: 13, fontWeight: '700' },
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  monthTitle: { fontSize: 16, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 2 },
  weekday: { fontSize: 12, fontWeight: '700', paddingBottom: 6 },
  day: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  dayLabel: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 1 },
  legend: { fontSize: 12, textAlign: 'center' },
  closeButton: { minHeight: 48, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  closeLabel: { fontSize: 15, fontWeight: '700' },
});
