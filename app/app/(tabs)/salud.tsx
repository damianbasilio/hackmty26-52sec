import { RefreshControl, ScrollView, StyleSheet, View as RawView } from 'react-native';

import { Card } from '@/components/Card';
import { ScoreBreakdown } from '@/components/ScoreBreakdown';
import { ScoreGauge } from '@/components/ScoreGauge';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';
import { useAsync } from '@/components/useAsync';
import { dataSource } from '@/src/data';

export default function SaludScreen() {
  const palette = usePalette();

  const { data, error, loading, reload } = useAsync(async () => {
    const accounts = await dataSource.getAccounts();
    const checking = accounts.find((a) => a.type === 'checking') ?? accounts[0];
    if (!checking) throw new Error('No hay cuentas disponibles.');
    return dataSource.getScore(checking.id);
  });

  // pantalla completa solo en la primera carga; al refrescar se queda el contenido
  if (loading && !data) return <LoadingState label="Calculando tu salud financiera…" />;
  if (error || !data) return <ErrorState message={error ?? 'Sin datos.'} onRetry={reload} />;

  const score = data;

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={palette.accent} />}>
      <Card>
        <ScoreGauge score={score} />
      </Card>

      <Card>
        <Text style={styles.explanation}>{score.explanation}</Text>
      </Card>

      <Card>
        <Text style={[styles.sectionTitle, { color: palette.muted }]}>De dónde salen los puntos</Text>
        <ScoreBreakdown components={score.components} />
      </Card>

      {score.top_actions.length > 0 && (
        <Card>
          <Text style={[styles.sectionTitle, { color: palette.muted }]}>Qué mueve más la aguja</Text>
          {score.top_actions.map((action, i) => (
            <RawView key={action} style={styles.action}>
              <RawView style={[styles.rank, { backgroundColor: palette.accent }]}>
                <Text style={styles.rankText}>{i + 1}</Text>
              </RawView>
              <Text style={styles.actionText}>{action}</Text>
            </RawView>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  explanation: { fontSize: 15, lineHeight: 22 },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  action: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 44, paddingVertical: 4 },
  rank: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rankText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  actionText: { fontSize: 14, lineHeight: 20, flex: 1 },
});
