import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, LinearTransition, ReduceMotion } from 'react-native-reanimated';

import { Card } from '@/components/Card';
import { MotionPressable, Reveal } from '@/components/Motion';
import { PremiumSurface } from '@/components/PremiumSurface';
import { ScoreBreakdown } from '@/components/ScoreBreakdown';
import { ScoreGauge } from '@/components/ScoreGauge';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';
import { SectionTitle } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { dataSource } from '@/src/data';
import { formatLongDay } from '@/src/format';

function splitAction(action: string): { title: string; detail: string } {
  const [title, ...rest] = action.split(':');
  return { title, detail: rest.join(':').trim() };
}

export default function SaludScreen() {
  const palette = usePalette();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const { data, error, loading, reload } = useAsync(async () => {
    const accounts = await dataSource.getAccounts();
    const checking = accounts.find((account) => account.type === 'checking') ?? accounts[0];
    if (!checking) throw new Error('No hay cuentas disponibles.');
    return dataSource.getScore(checking.id);
  });

  if (loading && !data) return <LoadingState label="Calculando tu salud financiera…" />;
  if (error || !data) return <ErrorState message={error ?? 'Sin datos.'} onRetry={reload} />;

  const score = data;
  const firstAction = score.top_actions[0] ? splitAction(score.top_actions[0]) : null;
  const remainingActions = score.top_actions.slice(1);

  return (
    <PremiumSurface>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={palette.accent} />}>
        <Reveal>
          <Text style={styles.title}>Salud financiera</Text>
        </Reveal>

        <Reveal delay={55}>
          <Card style={styles.scoreCard}>
            <ScoreGauge score={score} />
            <Text style={[styles.scoreSummary, { color: palette.ink }]}>
              Tu ingreso es estable; tu colchón todavía puede crecer.
            </Text>
          </Card>
        </Reveal>

        <Animated.View
          layout={LinearTransition.springify().damping(24).stiffness(220).reduceMotion(ReduceMotion.System)}>
          <Card style={styles.disclosureCard}>
            <MotionPressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showBreakdown }}
              onPress={() => setShowBreakdown((current) => !current)}
              style={styles.disclosure}>
              <View style={[styles.disclosureIcon, { backgroundColor: palette.surfaceSage }]}>
                <Text style={[styles.disclosureIconText, { color: palette.muted }]}>▤</Text>
              </View>
              <Text style={styles.disclosureTitle}>Ver cómo se calcula</Text>
              <Text style={[styles.chevron, { color: palette.muted }]}>{showBreakdown ? '⌄' : '›'}</Text>
            </MotionPressable>

            {showBreakdown && (
              <Animated.View
                entering={FadeIn.duration(200).reduceMotion(ReduceMotion.System)}
                style={[styles.breakdown, { borderColor: palette.border }]}>
                <Text style={[styles.fullExplanation, { color: palette.muted }]}>{score.explanation}</Text>
                <ScoreBreakdown components={score.components} />
                <Text style={[styles.period, { color: palette.muted }]}>
                  Calculado del {formatLongDay(score.period_start)} al {formatLongDay(score.period_end, true)}.
                </Text>
              </Animated.View>
            )}
          </Card>
        </Animated.View>

        {firstAction && (
          <View style={styles.section}>
            <SectionTitle>Siguiente mejor acción</SectionTitle>
            <Card tone="sage" style={styles.actionCard}>
              <View style={[styles.actionIcon, { backgroundColor: palette.dangerSoft }]}>
                <Text style={[styles.actionIconText, { color: palette.danger }]}>⊘</Text>
              </View>
              <View style={styles.actionCopy}>
                <Text style={styles.actionTitle}>{firstAction.title}</Text>
                {firstAction.detail ? (
                  <Text style={[styles.actionDetail, { color: palette.muted }]}>{firstAction.detail}</Text>
                ) : null}
              </View>
              <Text style={[styles.chevron, { color: palette.muted }]}>›</Text>
            </Card>

            {remainingActions.length > 0 && (
              <MotionPressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showMoreActions }}
                onPress={() => setShowMoreActions((current) => !current)}
                style={[styles.moreButton, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <Text style={styles.moreLabel}>
                  {showMoreActions ? 'Ocultar acciones' : `Ver ${remainingActions.length} acciones más`}
                </Text>
                <Text style={[styles.chevron, { color: palette.muted }]}>{showMoreActions ? '⌃' : '›'}</Text>
              </MotionPressable>
            )}

            {showMoreActions && (
              <Animated.View
                entering={FadeIn.duration(200).reduceMotion(ReduceMotion.System)}
                style={styles.moreActions}>
                {remainingActions.map((action, index) => {
                  const item = splitAction(action);
                  return (
                    <Card key={action} tone="sage" style={styles.secondaryAction}>
                      <View style={[styles.rank, { backgroundColor: palette.accentSoft }]}>
                        <Text style={[styles.rankText, { color: palette.accentDeep }]}>{index + 2}</Text>
                      </View>
                      <View style={styles.actionCopy}>
                        <Text style={styles.actionTitle}>{item.title}</Text>
                        {item.detail ? (
                          <Text style={[styles.actionDetail, { color: palette.muted }]}>{item.detail}</Text>
                        ) : null}
                      </View>
                    </Card>
                  );
                })}
              </Animated.View>
            )}
          </View>
        )}
      </ScrollView>
    </PremiumSurface>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 16, gap: 20, paddingBottom: 132 },
  title: { fontSize: 36, lineHeight: 42, fontWeight: '700', letterSpacing: -1.35 },
  scoreCard: { alignItems: 'center', paddingTop: 24, paddingBottom: 22 },
  scoreSummary: { maxWidth: 278, marginTop: 12, fontSize: 16, lineHeight: 22, textAlign: 'center' },
  disclosureCard: { padding: 10, gap: 0 },
  disclosure: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  disclosureIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  disclosureIconText: { fontSize: 18, fontWeight: '600' },
  disclosureTitle: { flex: 1, fontSize: 15, fontWeight: '600' },
  chevron: { width: 16, fontSize: 25, fontWeight: '300', textAlign: 'center' },
  breakdown: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingTop: 18, marginTop: 8, gap: 20 },
  fullExplanation: { fontSize: 13, lineHeight: 19 },
  period: { fontSize: 11, lineHeight: 16 },
  section: { gap: 12 },
  actionCard: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 106 },
  actionIcon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  actionIconText: { fontSize: 30, fontWeight: '500' },
  actionCopy: { flex: 1, gap: 5 },
  actionTitle: { fontSize: 17, lineHeight: 22, fontWeight: '700', letterSpacing: -0.25 },
  actionDetail: { fontSize: 13, lineHeight: 18 },
  moreButton: { minHeight: 58, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
  moreLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  moreActions: { gap: 10 },
  secondaryAction: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rank: { width: 34, height: 34, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontSize: 13, fontWeight: '700' },
});
