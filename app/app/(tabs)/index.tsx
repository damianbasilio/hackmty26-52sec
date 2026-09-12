import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { dataSource, dataSourceMode } from '@/src/data';
import { formatCents } from '@/src/format';

// Placeholder home screen. Lane C owns this file.
export default function InicioScreen() {
  const [summary, setSummary] = useState('Cargando…');

  useEffect(() => {
    dataSource
      .getAccounts()
      .then(async (accounts) => {
        const movements = await dataSource.getTransactions({ accountId: accounts[0].id });
        setSummary(`${formatCents(accounts[0].balance_cents)} · ${movements.length} movimientos`);
      })
      .catch((e: Error) => setSummary(`Error: ${e.message}`));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Inicio</Text>
      <Text style={styles.body}>{summary}</Text>
      <Text style={styles.hint}>Fuente de datos: {dataSourceMode}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 24, fontWeight: 'bold' },
  body: { fontSize: 16 },
  hint: { fontSize: 12, opacity: 0.6 },
});
