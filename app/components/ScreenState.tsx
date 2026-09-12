import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

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
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => [styles.retry, { backgroundColor: palette.accent, opacity: pressed ? 0.7 : 1 }]}>
        <Text style={styles.retryLabel}>Reintentar</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  text: { fontSize: 14, textAlign: 'center' },
  retry: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 28, borderRadius: 12 },
  retryLabel: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
