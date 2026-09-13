import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';

import { usePalette } from '@/components/palette';

const PIN_LENGTH = 6;

/**
 * Seis casillas y un TextInput invisible debajo. El input visible con
 * letterSpacing y secureTextEntry se desalineaba y cortaba los puntos en iOS.
 */
export function PinEntry({
  value,
  onChange,
  onComplete,
  autoFocus = false,
  disabled = false,
  errorKey = 0,
  accessibilityLabel = 'PIN de 6 dígitos',
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Súbelo para sacudir las casillas tras un PIN incorrecto. */
  errorKey?: number;
  accessibilityLabel?: string;
}) {
  const palette = usePalette();
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const shake = useSharedValue(0);

  useEffect(() => {
    if (errorKey === 0) return;
    const step = { duration: 55, reduceMotion: ReduceMotion.System };
    shake.value = withSequence(
      withTiming(-10, step),
      withTiming(10, step),
      withTiming(-6, step),
      withTiming(6, step),
      withTiming(0, step),
    );
  }, [errorKey, shake]);

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: `${value.length} de ${PIN_LENGTH} dígitos` }}
      disabled={disabled}
      onPress={() => input.current?.focus()}>
      <Animated.View style={[styles.row, shakeStyle]}>
        {Array.from({ length: PIN_LENGTH }, (_, index) => {
          const filled = index < value.length;
          const current = focused && index === Math.min(value.length, PIN_LENGTH - 1);
          return (
            <View
              key={index}
              style={[
                styles.cell,
                {
                  backgroundColor: palette.surfaceAlt,
                  borderColor: current ? palette.primary : palette.border,
                  borderWidth: current ? 2 : StyleSheet.hairlineWidth,
                },
              ]}>
              {filled ? (
                <Animated.View
                  entering={ZoomIn.duration(140).reduceMotion(ReduceMotion.System)}
                  style={[styles.dot, { backgroundColor: palette.ink }]}
                />
              ) : null}
            </View>
          );
        })}
      </Animated.View>
      <TextInput
        ref={input}
        autoComplete="off"
        autoFocus={autoFocus}
        caretHidden
        contextMenuHidden
        editable={!disabled}
        keyboardType="number-pad"
        maxLength={PIN_LENGTH}
        onBlur={() => setFocused(false)}
        onChangeText={(text) => {
          const digits = text.replace(/\D/g, '').slice(0, PIN_LENGTH);
          onChange(digits);
          if (digits.length === PIN_LENGTH) onComplete?.(digits);
        }}
        onFocus={() => setFocused(true)}
        style={styles.hiddenInput}
        textContentType="none"
        value={value}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: 9 },
  cell: { width: 44, height: 56, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 13, height: 13, borderRadius: 7 },
  hiddenInput: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
