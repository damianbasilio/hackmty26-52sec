import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';

const PALETTES = {
  light: {
    background: '#F4F6F9',
    card: '#FFFFFF',
    text: '#10161D',
    muted: '#68727F',
    border: '#E2E7ED',
    chip: '#ECF0F5',
    accent: '#0B62C4',
    accentText: '#FFFFFF',
    positive: '#0E7A4B',
    negative: '#10161D',
    info: '#0B62C4',
    warning: '#A4620A',
    critical: '#B3261E',
    infoBg: '#E6F0FB',
    warningBg: '#FBF1E0',
    criticalBg: '#FBE9E7',
  },
  dark: {
    background: '#0B0E13',
    card: '#161C24',
    text: '#F1F4F8',
    muted: '#97A2AF',
    border: '#242C36',
    chip: '#212A34',
    accent: '#5BA7FF',
    accentText: '#08111C',
    positive: '#4ED08A',
    negative: '#F1F4F8',
    info: '#5BA7FF',
    warning: '#E8B45E',
    critical: '#FF8A80',
    infoBg: '#12263C',
    warningBg: '#2E2413',
    criticalBg: '#33191A',
  },
};

export type Palette = typeof PALETTES.light;

export function usePalette(): Palette {
  return PALETTES[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

type CardProps = {
  children: React.ReactNode;
  style?: ViewStyle;
};

export function Card({ children, style }: CardProps) {
  const p = usePalette();
  return (
    <View style={[styles.card, { backgroundColor: p.card, borderColor: p.border }, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const p = usePalette();
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.sectionTitle, { color: p.text }]}>{children}</Text>
      {action}
    </View>
  );
}

export function LoadingState({ label = 'Cargando…' }: { label?: string }) {
  const p = usePalette();
  return (
    <View style={[styles.state, { backgroundColor: p.background }]}>
      <ActivityIndicator color={p.accent} />
      <Text style={[styles.stateText, { color: p.muted }]}>{label}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const p = usePalette();
  return (
    <View style={[styles.state, { backgroundColor: p.background }]}>
      <Text style={[styles.stateTitle, { color: p.text }]}>No pudimos cargar esto</Text>
      <Text style={[styles.stateText, { color: p.muted }]}>{message}</Text>
      <Button label="Reintentar" onPress={onRetry} />
    </View>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  const p = usePalette();
  return (
    <View style={[styles.state, { backgroundColor: 'transparent' }]}>
      <Text style={[styles.stateTitle, { color: p.text }]}>{title}</Text>
      {hint ? <Text style={[styles.stateText, { color: p.muted }]}>{hint}</Text> : null}
    </View>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'solid' | 'outline';
};

export function Button({ label, onPress, disabled, variant = 'solid' }: ButtonProps) {
  const p = usePalette();
  const solid = variant === 'solid';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: solid ? p.accent : 'transparent',
          borderColor: solid ? p.accent : p.border,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}>
      <Text style={[styles.buttonLabel, { color: solid ? p.accentText : p.text }]}>{label}</Text>
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
  const p = usePalette();
  const background = tone?.background ?? (selected ? p.accent : p.chip);
  const color = tone?.color ?? (selected ? p.accentText : p.muted);
  const content = <Text style={[styles.chipLabel, { color }]}>{label}</Text>;

  if (!onPress) {
    return <View style={[styles.chip, { backgroundColor: background }]}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, { backgroundColor: background, opacity: pressed ? 0.7 : 1 }]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sectionRow: {
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  stateTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  stateText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  button: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: { fontSize: 15, fontWeight: '600' },
  chip: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: 999,
    justifyContent: 'center',
  },
  chipLabel: { fontSize: 13, fontWeight: '600' },
});
