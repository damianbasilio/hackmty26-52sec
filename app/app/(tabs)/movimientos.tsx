import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';

// Placeholder screen. Lane C owns this file.
export default function MovimientosScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Movimientos</Text>
      <Text style={styles.hint}>Pendiente</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 24, fontWeight: 'bold' },
  hint: { fontSize: 12, opacity: 0.6 },
});
