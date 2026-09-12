// Pieces the shared Card / ScreenState / palette trio doesn't cover yet.

import { Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { usePalette } from '@/components/palette';

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

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
      <Text style={[styles.sectionTitle, { color: palette.muted }]}>{children}</Text>
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
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.accent, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
      ]}>
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
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
  const background = tone?.background ?? (selected ? palette.accent : palette.surfaceAlt);
  const color = tone?.color ?? (selected ? '#fff' : palette.muted);
  const content = <Text style={[styles.chipLabel, { color }]}>{label}</Text>;

  if (!onPress) {
    return <View style={[styles.chip, { backgroundColor: background }]}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: background, opacity: pressed ? 0.7 : 1 },
      ]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionRow: {
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
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
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: { color: '#fff', fontSize: 15, fontWeight: '700' },
  chip: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: 999,
    justifyContent: 'center',
  },
  chipLabel: { fontSize: 13, fontWeight: '600' },
});
