import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';

// Placeholder screen. Lane D owns this file.
export default function SaludScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Salud financiera</Text>
      <Text style={styles.hint}>Pendiente</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 24, fontWeight: 'bold' },
  hint: { fontSize: 12, opacity: 0.6 },
});
