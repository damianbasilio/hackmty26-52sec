import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/Card';
import { BrandHeader } from '@/components/BrandLogo';
import { MotionPressable, Reveal } from '@/components/Motion';
import { PremiumSurface } from '@/components/PremiumSurface';
import { ScoreBreakdown } from '@/components/ScoreBreakdown';
import { ScoreGauge } from '@/components/ScoreGauge';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';
import { Chevron, Collapsible, SectionTitle } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { dataSource } from '@/src/data';
import { formatLongDay } from '@/src/format';

type ActionTarget = {
  pathname: '/suscripciones' | '/ahorro' | '/movimientos';
  params?: Record<string, string>;
  label: string;
  symbol: { ios: string; android: string; web: string };
};

function splitAction(action: string): { title: string; detail: string } {
  const [title, ...rest] = action.split(':');
  return { title, detail: rest.join(':').trim() };
}

/** Lleva cada acción a la pantalla donde se resuelve. El texto viene del engine, así que se lee por palabras clave. */
function actionTarget(action: string): ActionTarget {
  const text = action.toLowerCase();
  if (/suscrip|cancelar|netflix|spotify|plan |gimnasio|smart fit|streaming/.test(text)) {
    return {
      pathname: '/suscripciones',
      label: 'Revisar suscripciones',
      symbol: { ios: 'arrow.triangle.2.circlepath', android: 'autorenew', web: 'autorenew' },
    };
  }
  if (/ahorr|apart|automatiz|colch|tope|l[ií]mite|presupuesto/.test(text)) {
    return {
      pathname: '/ahorro',
      label: 'Ir a ahorro',
      symbol: { ios: 'banknote.fill', android: 'savings', web: 'savings' },
    };
  }
  return {
    pathname: '/movimientos',
    params: { filter: 'expenses' },
    label: 'Ver mis gastos',
    symbol: { ios: 'list.bullet', android: 'list', web: 'list' },
  };
}

export default function SaludScreen() {
  const palette = usePalette();
  const router = useRouter();
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
  const [firstAction, ...remainingActions] = score.top_actions;

  function openAction(action: string) {
    const target = actionTarget(action);
    router.push({
      pathname: target.pathname,
      params: { ...target.params, at: String(Date.now()) },
    } as never);
  }

  return (
    <PremiumSurface>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={palette.accent} />}>
        <Reveal>
          <BrandHeader />
        </Reveal>

        <Reveal delay={35}>
          <Text style={styles.title}>Salud financiera</Text>
          <Text style={[styles.subtitle, { color: palette.muted }]}>Una mejor versión de tu futuro, hoy.</Text>
        </Reveal>

        <Reveal delay={60}>
          <Card style={styles.scoreCard}>
            <ScoreGauge score={score} />
            <Text style={[styles.scoreSummary, { color: palette.ink }]}>
              Tu ingreso es estable; tu colchón todavía puede crecer.
            </Text>
          </Card>
        </Reveal>

        <Reveal delay={120}>
          <Card style={styles.disclosureCard}>
            <MotionPressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showBreakdown }}
              onPress={() => setShowBreakdown((current) => !current)}
              style={styles.disclosure}>
              <View style={[styles.disclosureIcon, { backgroundColor: palette.surfaceSage }]}>
                <SymbolView name={{ ios: 'chart.bar.fill', android: 'bar_chart', web: 'bar_chart' }} tintColor={palette.muted} size={18} />
              </View>
              <Text style={styles.disclosureTitle}>{showBreakdown ? 'Ocultar el cálculo' : 'Ver cómo se calcula'}</Text>
              <Chevron direction={showBreakdown ? 'up' : 'down'} />
            </MotionPressable>

            <Collapsible open={showBreakdown}>
              <View style={[styles.breakdown, { borderColor: palette.border }]}>
                <Text style={[styles.fullExplanation, { color: palette.muted }]}>{score.explanation}</Text>
                <ScoreBreakdown components={score.components} />
                <Text style={[styles.period, { color: palette.muted }]}>
                  Calculado del {formatLongDay(score.period_start)} al {formatLongDay(score.period_end, true)}.
                </Text>
              </View>
            </Collapsible>
          </Card>
        </Reveal>

        {firstAction ? (
          <Reveal delay={180} style={styles.section}>
            <SectionTitle>Siguiente mejor acción</SectionTitle>
            <ActionCard action={firstAction} featured onPress={() => openAction(firstAction)} />

            {remainingActions.length > 0 ? (
              <MotionPressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showMoreActions }}
                onPress={() => setShowMoreActions((current) => !current)}
                style={[styles.moreButton, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <Text style={styles.moreLabel}>{showMoreActions ? 'Ocultar acciones' : 'Ver otras acciones'}</Text>
                <Chevron direction={showMoreActions ? 'up' : 'down'} />
              </MotionPressable>
            ) : null}

            <Collapsible open={showMoreActions}>
              <View style={styles.moreActions}>
                {remainingActions.map((action, index) => (
                  <Reveal key={action} delay={index * 60}>
                    <ActionCard action={action} onPress={() => openAction(action)} />
                  </Reveal>
                ))}
              </View>
            </Collapsible>
          </Reveal>
        ) : null}
      </ScrollView>
    </PremiumSurface>
  );
}

function ActionCard({ action, featured = false, onPress }: { action: string; featured?: boolean; onPress: () => void }) {
  const palette = usePalette();
  const { title, detail } = splitAction(action);
  const target = actionTarget(action);
  return (
    <MotionPressable accessibilityHint={target.label} accessibilityRole="button" onPress={onPress} pressedScale={0.985}>
      <Card style={styles.actionCard}>
        <View style={styles.actionHead}>
          <View
            style={[
              featured ? styles.actionIcon : styles.actionIconSmall,
              { backgroundColor: featured ? palette.dangerSoft : palette.accentSoft },
            ]}>
            <SymbolView
              name={target.symbol as never}
              tintColor={featured ? palette.danger : palette.accent}
              size={featured ? 24 : 18}
            />
          </View>
          <View style={styles.actionCopy}>
            <Text style={featured ? styles.actionTitle : styles.actionTitleSmall}>{title}</Text>
            {detail ? <Text style={[styles.actionDetail, { color: palette.muted }]}>{detail}</Text> : null}
          </View>
        </View>
        <View style={[styles.resolvePill, { backgroundColor: palette.primary }]}>
          <Text style={[styles.resolveLabel, { color: palette.onPrimary }]}>{target.label}</Text>
        </View>
      </Card>
    </MotionPressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 20, paddingBottom: 146 },
  title: { marginTop: 8, fontSize: 38, lineHeight: 44, fontWeight: '700', letterSpacing: -1.35 },
  subtitle: { marginTop: 4, fontSize: 17, lineHeight: 23 },
  scoreCard: { alignItems: 'center', paddingTop: 26, paddingBottom: 24 },
  scoreSummary: { maxWidth: 278, marginTop: 12, fontSize: 16, lineHeight: 22, textAlign: 'center' },
  disclosureCard: { padding: 10, gap: 0 },
  disclosure: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  disclosureIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  disclosureTitle: { flex: 1, fontSize: 15, fontWeight: '600' },
  breakdown: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingTop: 18, paddingBottom: 8, marginTop: 8, gap: 20 },
  fullExplanation: { fontSize: 13, lineHeight: 19 },
  period: { fontSize: 11, lineHeight: 16 },
  section: { gap: 12 },
  actionCard: { gap: 14 },
  actionHead: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  actionIcon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  actionIconSmall: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  actionCopy: { flex: 1, gap: 5 },
  actionTitle: { fontSize: 17, lineHeight: 22, fontWeight: '700', letterSpacing: -0.25 },
  actionTitleSmall: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  actionDetail: { fontSize: 13, lineHeight: 18 },
  resolvePill: { minHeight: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  resolveLabel: { fontSize: 16, fontWeight: '700' },
  moreButton: { minHeight: 58, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
  moreLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  moreActions: { gap: 10, paddingBottom: 2 },
});
