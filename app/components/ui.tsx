// Pieces the shared Card / ScreenState / palette trio doesn't cover yet.

import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View as PlainView, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Text, View } from '@/components/Themed';
import { MotionPressable } from '@/components/Motion';
import { usePalette } from '@/components/palette';

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const palette = usePalette();
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.sectionTitle, { color: palette.ink }]}>{children}</Text>
      {action}
    </View>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  const palette = usePalette();
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={[styles.emptyHint, { color: palette.muted }]}>{hint}</Text> : null}
    </View>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

export function Button({ label, onPress, disabled }: ButtonProps) {
  const palette = usePalette();
  return (
    <MotionPressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { backgroundColor: palette.primary, opacity: disabled ? 0.5 : 1 }]}>
      <Text style={[styles.buttonLabel, { color: palette.onPrimary }]}>{label}</Text>
    </MotionPressable>
  );
}

export function Chip({
  label,
  selected = false,
  onPress,
  tone,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  tone?: { background: string; color: string };
}) {
  const palette = usePalette();
  const background = tone?.background ?? (selected ? palette.primary : palette.surfaceAlt);
  const color = tone?.color ?? (selected ? palette.onPrimary : palette.muted);
  const content = <Text style={[styles.chipLabel, { color }]}>{label}</Text>;

  if (!onPress) {
    return <View style={[styles.chip, { backgroundColor: background }]}>{content}</View>;
  }
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      pressedScale={0.96}
      style={[styles.chip, { backgroundColor: background }]}>
      {content}
    </MotionPressable>
  );
}

const CHEVRON_ROTATION = { right: 0, down: 90, left: 180, up: -90 } as const;

/** Un solo glifo girado: los caracteres ›, ⌄ y ⌃ no se alinean igual en cada fuente. */
export function Chevron({
  direction = 'right',
  color,
  size = 14,
}: {
  direction?: keyof typeof CHEVRON_ROTATION;
  color?: string;
  size?: number;
}) {
  const palette = usePalette();
  const rotation = useSharedValue<number>(CHEVRON_ROTATION[direction]);

  useEffect(() => {
    rotation.value = withTiming(CHEVRON_ROTATION[direction], {
      duration: 220,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });
  }, [direction, rotation]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.chevron, animatedStyle]}>
      <SymbolView
        name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
        tintColor={color ?? palette.muted}
        size={size}
      />
    </Animated.View>
  );
}

const COLLAPSE_MS = 260;

/**
 * Abre y cierra animando la altura medida del contenido. El contenido va en
 * absoluto para que su medida no dependa de la altura animada: con un layout
 * transition la lista se volvía a medir cada cuadro y crecía sin fin.
 */
export function Collapsible({
  open,
  children,
  style,
}: {
  open: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const [mounted, setMounted] = useState(open);
  const measured = useSharedValue(0);
  const progress = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, {
      duration: COLLAPSE_MS,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });
    if (open) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), COLLAPSE_MS);
    return () => clearTimeout(timer);
  }, [open, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: measured.value * progress.value,
    opacity: progress.value,
  }));

  if (!mounted) return null;

  return (
    <Animated.View
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      pointerEvents={open ? 'auto' : 'none'}
      style={[styles.collapsible, animatedStyle]}>
      <PlainView
        onLayout={(event) => {
          measured.value = event.nativeEvent.layout.height;
        }}
        style={[styles.collapsibleContent, style]}>
        {children}
      </PlainView>
    </Animated.View>
  );
}

/** Aviso que se va solo o con la X. Sin esto un error viejo se quedaba pegado en pantalla. */
export function Banner({
  text,
  tone = 'danger',
  onDismiss,
  autoHideMs = 6000,
}: {
  text: string;
  tone?: 'danger' | 'positive';
  onDismiss: () => void;
  autoHideMs?: number;
}) {
  const palette = usePalette();
  const dismiss = useRef(onDismiss);

  useEffect(() => {
    dismiss.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!autoHideMs) return;
    const timer = setTimeout(() => dismiss.current(), autoHideMs);
    return () => clearTimeout(timer);
  }, [autoHideMs, text]);

  const colors = tone === 'positive'
    ? { background: palette.positiveSoft, color: palette.positive }
    : { background: palette.dangerSoft, color: palette.danger };

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      entering={FadeInDown.duration(220).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(160).reduceMotion(ReduceMotion.System)}
      style={[styles.banner, { backgroundColor: colors.background }]}>
      <SymbolView
        name={tone === 'positive'
          ? { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }
          : { ios: 'exclamationmark.circle.fill', android: 'error', web: 'error' }}
        tintColor={colors.color}
        size={18}
      />
      <Text style={[styles.bannerText, { color: colors.color }]}>{text}</Text>
      <MotionPressable
        accessibilityLabel="Cerrar mensaje"
        accessibilityRole="button"
        hitSlop={10}
        onPress={() => dismiss.current()}
        pressedScale={0.9}
        style={styles.bannerClose}>
        <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} tintColor={colors.color} size={13} />
      </MotionPressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sectionRow: {
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    marginTop: spacing.md,
  },
  sectionTitle: { fontSize: 21, fontWeight: '700', letterSpacing: -0.4 },
  empty: {
    backgroundColor: 'transparent',
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  emptyHint: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  button: {
    minHeight: 48,
    paddingHorizontal: 28,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: { fontSize: 16, fontWeight: '700' },
  chip: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: 14,
    justifyContent: 'center',
  },
  chipLabel: { fontSize: 13, fontWeight: '600' },
  chevron: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  collapsible: { overflow: 'hidden' },
  collapsibleContent: { position: 'absolute', top: 0, left: 0, right: 0 },
  banner: {
    minHeight: 48,
    borderRadius: 15,
    paddingLeft: 13,
    paddingRight: 6,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  bannerClose: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
});
