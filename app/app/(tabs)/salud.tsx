import type { CashflowScore } from '@contracts/types';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View as RawView } from 'react-native';

import { Card } from '@/components/Card';
import { ScoreBreakdown } from '@/components/ScoreBreakdown';
import { ScoreGauge } from '@/components/ScoreGauge';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';
import { dataSource } from '@/src/data';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; score: CashflowScore };

export default function SaludScreen() {
  const palette = usePalette();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const accounts = await dataSource.getAccounts();
      const account = accounts.find((a) => a.type === 'checking') ?? accounts[0];
      setState({ kind: 'ready', score: await dataSource.getScore(account.id) });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (state.kind === 'loading') return <LoadingState label="Calculando tu salud financiera…" />;
  if (state.kind === 'error') return <ErrorState message={state.message} onRetry={retry} />;

  const { score } = state;

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.accent} />}>
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
