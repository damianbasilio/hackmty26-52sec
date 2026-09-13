import { SymbolView } from 'expo-symbols';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion, SlideInDown } from 'react-native-reanimated';

import { MotionPressable } from '@/components/Motion';
import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';

export type SheetOption = { key: string; label: string; detail?: string };

/** Lista para elegir una sola opción. Reemplaza las filas de chips que saturaban la pantalla. */
export function OptionSheet({
  visible,
  title,
  options,
  selectedKey,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: SheetOption[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  return (
    <Modal animationType="none" onRequestClose={onClose} transparent visible={visible}>
      <Animated.View entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)} style={styles.backdrop}>
        <Pressable accessibilityLabel="Cerrar" onPress={onClose} style={StyleSheet.absoluteFill} />
        <Animated.View
          entering={SlideInDown.duration(260).reduceMotion(ReduceMotion.System)}
          style={[styles.sheet, { backgroundColor: palette.surface }]}>
          <View style={[styles.handle, { backgroundColor: palette.border }]} />
          <Text style={styles.title}>{title}</Text>
          <ScrollView bounces={false} style={styles.list}>
            {options.map((option, index) => {
              const selected = option.key === selectedKey;
              return (
                <MotionPressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onSelect(option.key)}
                  pressedScale={0.985}
                  style={[
                    styles.option,
                    index > 0 ? { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth } : null,
                  ]}>
                  <View style={styles.optionCopy}>
                    <Text style={[styles.optionLabel, selected ? { color: palette.accent } : null]}>{option.label}</Text>
                    {option.detail ? (
                      <Text style={[styles.optionDetail, { color: palette.muted }]}>{option.detail}</Text>
                    ) : null}
                  </View>
                  {selected ? (
                    <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} tintColor={palette.accent} size={17} />
                  ) : null}
                </MotionPressable>
              );
            })}
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 16, 36, 0.42)' },
  sheet: { maxHeight: '75%', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 30, gap: 10 },
  handle: { alignSelf: 'center', width: 38, height: 5, borderRadius: 999 },
  title: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  list: { flexGrow: 0 },
  option: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6 },
  optionCopy: { flex: 1, gap: 2 },
  optionLabel: { fontSize: 16, fontWeight: '600' },
  optionDetail: { fontSize: 13, fontVariant: ['tabular-nums'] },
});
