import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import type {
  CashflowForecast,
  ForecastDay,
  ForecastRecommendation,
  ForecastStatus,
} from '@contracts/types';

import { Card } from '@/components/Card';
import { HeroCard } from '@/components/HeroCard';
import { MotionPressable, Reveal } from '@/components/Motion';
import { PremiumSurface } from '@/components/PremiumSurface';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { Text } from '@/components/Themed';
import { usePalette, type Palette } from '@/components/palette';
import { SectionTitle } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { dataSource } from '@/src/data';
import { formatCents, formatLongDay } from '@/src/format';

const STATUS_COPY: Record<ForecastStatus, string> = {
  healthy: 'Vas bien',
  watch: 'Ojo con tu saldo',
  critical: 'Te podría faltar',
};

const PRIORITY_COPY: Record<ForecastRecommendation['priority'], string> = {
  high: 'Urgente',
  medium: 'Pronto',
  low: 'Cuando puedas',
};

const CHART_HEIGHT = 150;

function statusTone(palette: Palette, status: ForecastStatus) {
  if (status === 'critical') return { background: palette.dangerSoft, color: palette.danger };
  if (status === 'watch') return { background: palette.warningSoft, color: palette.warning };
  return { background: palette.positiveSoft, color: palette.positive };
}

export default function MiDineroScreen() {
  const palette = usePalette();
  const router = useRouter();

  const { data, error, loading, reload } = useAsync(async () => {
    const accounts = await dataSource.getAccounts();
    const checking = accounts.find((account) => account.type === 'checking') ?? accounts[0];
    if (!checking) throw new Error('No hay cuentas disponibles.');
    return { checking, forecast: await dataSource.getForecast(checking.id) };
  });

  if (loading && !data) return <LoadingState label="Calculando tus próximos 30 días…" />;
  if (error || !data) return <ErrorState message={error ?? 'Sin datos.'} onRetry={reload} />;

  const { checking, forecast } = data;
  const { summary } = forecast;
  const tone = statusTone(palette, forecast.status);

  function openAction(recommendation: ForecastRecommendation) {
    if (recommendation.action?.type === 'move_money') router.push('/transferencias' as never);
    else if (recommendation.action?.type === 'open_subscriptions') router.push('/suscripciones' as never);
  }

  return (
    <PremiumSurface>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={palette.accent} />}>
        <View style={styles.header}>
          <MotionPressable accessibilityLabel="Regresar" hitSlop={10} onPress={() => router.back()} style={styles.backButton}>
            <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} tintColor={palette.ink} size={20} />
          </MotionPressable>
          <Text style={styles.title}>Mi dinero</Text>
          <View style={styles.headerSpacer} />
        </View>

        <Reveal>
          <HeroCard style={styles.hero}>
            <View style={styles.heroTop}>
              <Text style={[styles.heroLabel, { color: palette.muted }]}>Para gastar al día</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={styles.heroAmount}>
                {formatCents(summary.safe_to_spend_daily_cents)}
              </Text>
              <Text style={[styles.heroMeta, { color: palette.muted }]}>
                {summary.safe_to_spend_until
                  ? `Hasta el ${formatLongDay(summary.safe_to_spend_until)} · ${summary.safe_to_spend_days} días`
                  : `Durante los próximos ${summary.safe_to_spend_days} días`}
              </Text>
            </View>
            <View style={styles.statusRow}>
              <View style={[styles.statusPill, { backgroundColor: tone.background }]}>
                <Text style={[styles.statusLabel, { color: tone.color }]}>{STATUS_COPY[forecast.status]}</Text>
              </View>
              <Text numberOfLines={1} style={[styles.accountLabel, { color: palette.muted }]}>
                Cuenta ·· {checking.last_four}
              </Text>
            </View>
          </HeroCard>
        </Reveal>

        <Reveal delay={40}>
          <Text style={[styles.explanation, { color: palette.muted }]}>{forecast.status_explanation}</Text>
        </Reveal>

        <Reveal delay={70} style={styles.stats}>
          <Stat
            label="Próximo ingreso"
            value={summary.next_income_cents !== null ? formatCents(summary.next_income_cents) : 'Sin fecha fija'}
            detail={summary.next_income_on ? formatLongDay(summary.next_income_on) : 'Tus ingresos no son regulares'}
          />
          <Stat
            label="Saldo más bajo"
            value={formatCents(summary.min_low_balance_cents)}
            detail={formatLongDay(summary.min_low_on)}
          />
          <Stat
            label="En 30 días"
            value={formatCents(summary.end_expected_balance_cents)}
            detail="Si gastas como siempre"
          />
        </Reveal>

        <Reveal delay={100} style={styles.section}>
          <SectionTitle>Tu saldo, día por día</SectionTitle>
          <Card style={styles.chartCard}>
            <BalanceChart daily={forecast.daily} bufferCents={forecast.buffer_cents} />
            <View style={styles.legend}>
              <LegendKey color={palette.accent} label="Lo esperado" />
              <LegendKey color={palette.track} label="Rango probable" />
              <LegendKey color={palette.warning} label={`Tu colchón ${formatCents(forecast.buffer_cents)}`} />
            </View>
          </Card>
        </Reveal>

        {forecast.recommendations.length > 0 ? (
          <Reveal delay={130} style={styles.section}>
            <SectionTitle>Qué te recomendamos</SectionTitle>
            <View style={styles.stack}>
              {forecast.recommendations.map((recommendation) => (
                <RecommendationCard key={recommendation.id} recommendation={recommendation} onPress={() => openAction(recommendation)} />
              ))}
            </View>
          </Reveal>
        ) : null}

        {forecast.spending.categories.length > 0 ? (
          <Reveal delay={160} style={styles.section}>
            <SectionTitle>En qué se va tu dinero</SectionTitle>
            <Card style={styles.listCard}>
              <Text style={[styles.cardHint, { color: palette.muted }]}>Últimos 30 días contra los 30 anteriores</Text>
              {forecast.spending.categories.slice(0, 6).map((category) => (
                <SpendingRow
                  key={category.category}
                  label={category.label}
                  cents={category.last_30d_cents}
                  changePct={category.change_pct}
                  widthPct={Math.round((category.last_30d_cents / forecast.spending.categories[0].last_30d_cents) * 100)}
                />
              ))}
            </Card>
          </Reveal>
        ) : null}

        {forecast.streams.length > 0 ? (
          <Reveal delay={190} style={styles.section}>
            <SectionTitle>Pagos que se repiten</SectionTitle>
            <Card style={styles.listCard}>
              {forecast.streams.map((stream, index) => (
                <View
                  key={`${stream.label}-${stream.cadence}`}
                  style={[
                    styles.streamRow,
                    index < forecast.streams.length - 1
                      ? { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth }
                      : null,
                  ]}>
                  <View style={styles.streamCopy}>
                    <Text numberOfLines={1} style={styles.streamName}>{stream.label}</Text>
                    <Text style={[styles.streamMeta, { color: palette.muted }]}>
                      {stream.category_label} · {stream.cadence_label}
                    </Text>
                  </View>
                  <Text style={[styles.streamAmount, stream.amount_cents > 0 ? { color: palette.positive } : null]}>
                    {formatCents(stream.amount_cents)}
                  </Text>
                </View>
              ))}
            </Card>
          </Reveal>
        ) : null}
      </ScrollView>
    </PremiumSurface>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  const palette = usePalette();
  return (
    <View style={[styles.stat, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text style={[styles.statLabel, { color: palette.muted }]}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={styles.statValue}>{value}</Text>
      <Text numberOfLines={2} style={[styles.statDetail, { color: palette.muted }]}>{detail}</Text>
    </View>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  const palette = usePalette();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={[styles.legendLabel, { color: palette.muted }]}>{label}</Text>
    </View>
  );
}

/** Barras de Views: una por día con el rango probable detrás y lo esperado encima. Sin librería de gráficas. */
function BalanceChart({ daily, bufferCents }: { daily: ForecastDay[]; bufferCents: number }) {
  const palette = usePalette();
  const floor = Math.min(0, bufferCents, ...daily.map((day) => day.low_balance_cents));
  const ceiling = Math.max(bufferCents, ...daily.map((day) => day.high_balance_cents));
  const span = ceiling - floor || 1;
  const y = (cents: number) => ((cents - floor) / span) * CHART_HEIGHT;
  const first = daily[0];
  const last = daily[daily.length - 1];

  return (
    <View
      accessibilityLabel={`Tu saldo esperado va de ${formatCents(first.expected_balance_cents)} a ${formatCents(last.expected_balance_cents)} en 30 días`}
      accessible>
      <View style={[styles.chart, { height: CHART_HEIGHT }]}>
        <View style={[styles.bufferLine, { bottom: y(bufferCents), borderColor: palette.warning }]} />
        {floor < 0 ? <View style={[styles.zeroLine, { bottom: y(0), backgroundColor: palette.danger }]} /> : null}
        {daily.map((day) => (
          <View key={day.date} style={styles.column}>
            <View
              style={[
                styles.band,
                { backgroundColor: palette.track, bottom: y(day.low_balance_cents), height: Math.max(2, y(day.high_balance_cents) - y(day.low_balance_cents)) },
              ]}
            />
            <View
              style={[
                styles.expected,
                {
                  backgroundColor: day.expected_balance_cents < bufferCents ? palette.warning : palette.accent,
                  bottom: y(day.expected_balance_cents) - 1.5,
                },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.axis}>
        <Text style={[styles.axisLabel, { color: palette.muted }]}>{formatLongDay(first.date)}</Text>
        <Text style={[styles.axisLabel, { color: palette.muted }]}>{formatLongDay(last.date)}</Text>
      </View>
    </View>
  );
}

function RecommendationCard({ recommendation, onPress }: { recommendation: ForecastRecommendation; onPress: () => void }) {
  const palette = usePalette();
  const tone = recommendation.priority === 'high'
    ? { background: palette.dangerSoft, color: palette.danger }
    : recommendation.priority === 'medium'
      ? { background: palette.warningSoft, color: palette.warning }
      : { background: palette.positiveSoft, color: palette.positive };
  const { action } = recommendation;

  return (
    <Card tone={recommendation.priority === 'high' ? 'blush' : 'default'} style={styles.recommendation}>
      <View style={styles.recommendationHead}>
        <Text style={[styles.priority, { color: tone.color }]}>{PRIORITY_COPY[recommendation.priority]}</Text>
        {recommendation.due_on ? (
          <Text style={[styles.priority, { color: palette.muted }]}>Antes del {formatLongDay(recommendation.due_on)}</Text>
        ) : null}
      </View>
      <Text style={styles.recommendationTitle}>{recommendation.title}</Text>
      <Text style={[styles.recommendationBody, { color: palette.muted }]}>{recommendation.explanation}</Text>
      {action ? (
        <MotionPressable
          accessibilityHint={action.type === 'move_money' ? 'Abre Transferir para mover el dinero entre tus cuentas' : 'Abre tus suscripciones'}
          accessibilityRole="button"
          onPress={onPress}
          style={[styles.actionButton, { backgroundColor: tone.background }]}>
          <Text style={[styles.actionLabel, { color: tone.color }]}>{action.label}</Text>
        </MotionPressable>
      ) : null}
    </Card>
  );
}

function SpendingRow({ label, cents, changePct, widthPct }: { label: string; cents: number; changePct: number | null; widthPct: number }) {
  const palette = usePalette();
  const change = changePct === null ? null : Math.round(changePct * 100);
  return (
    <View style={styles.spendingRow}>
      <View style={styles.spendingHead}>
        <Text numberOfLines={1} style={styles.spendingName}>{label}</Text>
        {change !== null ? (
          <Text style={[styles.change, { color: change > 0 ? palette.warning : palette.positive }]}>
            {change > 0 ? `+${change}%` : `${change}%`}
          </Text>
        ) : null}
        <Text style={styles.spendingAmount}>{formatCents(cents)}</Text>
      </View>
      <View style={[styles.barTrack, { backgroundColor: palette.track }]}>
        <View style={[styles.barFill, { backgroundColor: palette.accent, width: `${widthPct}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 52, gap: 18 },
  header: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: 42 },
  title: { fontSize: 18, fontWeight: '700' },
  hero: { minHeight: 200 },
  heroTop: { gap: 6, backgroundColor: 'transparent' },
  heroLabel: { fontSize: 16, fontWeight: '500' },
  heroAmount: { color: '#FFFFFF', fontSize: 46, lineHeight: 54, fontWeight: '700', letterSpacing: -1.7, fontVariant: ['tabular-nums'] },
  heroMeta: { fontSize: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  statusPill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  statusLabel: { fontSize: 13, fontWeight: '700' },
  accountLabel: { fontSize: 14, fontWeight: '500' },
  explanation: { fontSize: 15, lineHeight: 21 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 4 },
  statLabel: { fontSize: 12, fontWeight: '600' },
  statValue: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statDetail: { fontSize: 11, lineHeight: 15 },
  section: { gap: 0 },
  stack: { gap: 12 },
  chartCard: { gap: 12 },
  chart: { flexDirection: 'row', alignItems: 'stretch', gap: 2 },
  column: { flex: 1 },
  band: { position: 'absolute', left: 0, right: 0, borderRadius: 3 },
  expected: { position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2 },
  bufferLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1, borderStyle: 'dashed' },
  zeroLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  axisLabel: { fontSize: 11 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 12, height: 4, borderRadius: 2 },
  legendLabel: { fontSize: 12 },
  recommendation: { gap: 8 },
  recommendationHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  priority: { fontSize: 12, fontWeight: '700' },
  recommendationTitle: { fontSize: 17, lineHeight: 22, fontWeight: '700', letterSpacing: -0.25 },
  recommendationBody: { fontSize: 14, lineHeight: 20 },
  actionButton: { minHeight: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 4 },
  actionLabel: { fontSize: 15, fontWeight: '700' },
  listCard: { gap: 6, paddingVertical: 14 },
  cardHint: { fontSize: 12, marginBottom: 4 },
  spendingRow: { gap: 7, paddingVertical: 6 },
  spendingHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  spendingName: { flex: 1, fontSize: 15, fontWeight: '600' },
  change: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  spendingAmount: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  barTrack: { height: 5, borderRadius: 999, overflow: 'hidden' },
  barFill: { height: 5, borderRadius: 999 },
  streamRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12 },
  streamCopy: { flex: 1, gap: 3 },
  streamName: { fontSize: 15, fontWeight: '600' },
  streamMeta: { fontSize: 12 },
  streamAmount: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
