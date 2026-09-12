import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { MotionPressable } from '@/components/Motion';
import { Text } from '@/components/Themed';
import { usePalette } from './palette';

export function LoadingState({ label }: { label: string }) {
  const palette = usePalette();
  return (
    <View style={[styles.center, { backgroundColor: palette.background }]}>
      <ActivityIndicator color={palette.accent} />
      <Text style={[styles.text, { color: palette.muted }]}>{label}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const palette = usePalette();
  return (
    <View style={[styles.center, { backgroundColor: palette.background }]}>
      <Text style={styles.title}>No pudimos cargar esta pantalla</Text>
      <Text style={[styles.text, { color: palette.muted }]}>{message}</Text>
      <MotionPressable
        accessibilityRole="button"
        onPress={onRetry}
        style={[styles.retry, { backgroundColor: palette.accentDeep }]}>
        <Text style={styles.retryLabel}>Reintentar</Text>
      </MotionPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  text: { fontSize: 14, textAlign: 'center' },
  retry: { minHeight: 50, justifyContent: 'center', paddingHorizontal: 28, borderRadius: 16 },
  retryLabel: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
