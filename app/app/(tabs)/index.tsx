import { SymbolView } from 'expo-symbols';
import { Link, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View as Box } from 'react-native';
import Animated, { LinearTransition, ReduceMotion } from 'react-native-reanimated';

import type { AnomalyAlert, AnomalySeverity, EnrichedTransaction } from '@contracts/types';

import { useAuth } from '@/components/AuthProvider';
import { useBanking } from '@/components/BankingProvider';
import { Card } from '@/components/Card';
import { HeroCard } from '@/components/HeroCard';
import { MotionPressable, Reveal } from '@/components/Motion';
import { PremiumSurface } from '@/components/PremiumSurface';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { Text } from '@/components/Themed';
import { localMonthKey } from '@/components/display';
import { usePalette, type Palette } from '@/components/palette';
import { SectionTitle } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { dataSource } from '@/src/data';
import { formatCents, formatMonthName } from '@/src/format';

const SEVERITY_LABELS: Record<AnomalySeverity, string> = {
  info: 'Aviso',
  warning: 'Atención',
  critical: 'Urgente',
};

type Resolution = NonNullable<AnomalyAlert['resolution']>;

const RESOLUTIONS: { value: Resolution; label: string }[] = [
  { value: 'confirmed_legit', label: 'Sí fui yo' },
  { value: 'confirmed_fraud', label: 'No fui yo' },
  { value: 'dismissed', label: 'Ignorar' },
];

function severityTone(palette: Palette, severity: AnomalySeverity) {
  if (severity === 'critical') return { background: palette.dangerSoft, color: palette.danger };
  if (severity === 'warning') return { background: palette.warningSoft, color: palette.warning };
  return { background: palette.accentSoft, color: palette.accent };
}

export default function InicioScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { lock } = useAuth();
  const { outgoingCents } = useBanking();
  const [resolvedIds, setResolvedIds] = useState<string[]>([]);

  const { data, error, loading, reload } = useAsync(async () => {
    const accounts = await dataSource.getAccounts();
    const checking = accounts.find((account) => account.type === 'checking') ?? accounts[0];
    if (!checking) throw new Error('No hay cuentas disponibles.');
    const savings = accounts.find((account) => account.type === 'savings') ?? null;
    const [customer, transactions, alerts] = await Promise.all([
      dataSource.getCustomer(),
      dataSource.getTransactions({ accountId: checking.id }),
      dataSource.getAlerts(checking.id),
    ]);
    return { checking, savings, customer, transactions, alerts };
  });

  const month = useMemo(() => monthSummary(data?.transactions ?? []), [data?.transactions]);

  if (loading && !data) return <LoadingState label="Preparando tu resumen…" />;
  if (error || !data) return <ErrorState message={error ?? 'Sin datos.'} onRetry={reload} />;

  const { checking, savings, customer, alerts } = data;
  const openAlerts = alerts.filter((alert) => !resolvedIds.includes(alert.id));
  const featuredAlert = openAlerts[0] ?? null;
  const remainingAlerts = openAlerts.slice(1);
  const availableBalanceCents = Math.max(0, checking.balance_cents - outgoingCents);

  return (
    <PremiumSurface>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} tintColor={palette.accent} />
        }>
        <Reveal delay={20}>
          <Text style={[styles.hello, { color: palette.muted }]}>Hola,</Text>
          <Text style={styles.name}>{customer.first_name}</Text>
        </Reveal>

        <Reveal delay={80}>
          <HeroCard>
            <Box style={styles.heroTop}>
              <Text style={styles.heroLabel}>
                {checking.nickname} ·· {checking.last_four}
              </Text>
              <Text style={styles.heroAmount}>{formatCents(availableBalanceCents)}</Text>
            </Box>
            {savings ? (
              <Box style={styles.savingsStrip}>
                <Box style={styles.savingsIcon}>
                  <Text style={styles.savingsIconText}>↗</Text>
                </Box>
                <Text numberOfLines={1} style={styles.savingsName}>{savings.nickname}</Text>
                <Text style={styles.savingsAmount}>{formatCents(savings.balance_cents)}</Text>
              </Box>
            ) : null}
          </HeroCard>
        </Reveal>

        <Reveal delay={115}>
          <Card style={styles.moneyActionsCard}>
            <Box style={styles.moneyActions}>
              <MotionPressable
                accessibilityRole="button"
                onPress={() => router.push('/transferencias' as never)}
                style={[styles.moneyAction, { backgroundColor: palette.accentSoft }]}>
                <Box style={[styles.moneyActionIcon, { backgroundColor: palette.surface }]}>
                  <SymbolView
                    name={{ ios: 'arrow.up.right', android: 'north_east', web: 'north_east' }}
                    tintColor={palette.accent}
                    size={20}
                  />
                </Box>
                <Box style={styles.moneyActionCopy}>
                  <Text style={styles.moneyActionTitle}>Transferir</Text>
                  <Text style={[styles.moneyActionHint, { color: palette.muted }]}>Enviar dinero</Text>
                </Box>
              </MotionPressable>
              <MotionPressable
                accessibilityRole="button"
                onPress={() => router.push('/dividir-gasto' as never)}
                style={[styles.moneyAction, { backgroundColor: palette.surfaceMint }]}>
                <Box style={[styles.moneyActionIcon, { backgroundColor: palette.surface }]}>
                  <SymbolView
                    name={{ ios: 'person.3.fill', android: 'groups', web: 'groups' }}
                    tintColor={palette.positive}
                    size={20}
                  />
                </Box>
                <Box style={styles.moneyActionCopy}>
                  <Text style={styles.moneyActionTitle}>Dividir</Text>
                  <Text style={[styles.moneyActionHint, { color: palette.muted }]}>Por cercanía</Text>
                </Box>
              </MotionPressable>
            </Box>
            <Box style={[styles.securityStatus, { borderTopColor: palette.border }]}>
              <Box style={styles.securityCopy}>
                <SymbolView
                  name={{ ios: 'lock.shield.fill', android: 'verified_user', web: 'shield' }}
                  tintColor={palette.positive}
                  size={16}
                />
                <Text style={[styles.securityLabel, { color: palette.muted }]}>Sesión protegida</Text>
              </Box>
              <MotionPressable accessibilityRole="button" onPress={lock} style={styles.lockButton}>
                <Text style={[styles.lockLabel, { color: palette.accent }]}>Bloquear</Text>
              </MotionPressable>
            </Box>
          </Card>
        </Reveal>

        {alerts.length > 0 ? (
          <Reveal delay={165} style={styles.section}>
            <Card tone="sage" style={styles.alertShell}>
              <Box style={styles.alertShellTitle}>
                <SectionTitle>Para ti</SectionTitle>
              </Box>
              {openAlerts.length === 0 ? (
                <Text style={[styles.alertBody, { color: palette.muted }]}>Todo está en orden.</Text>
              ) : (
                featuredAlert ? (
                  <AlertCard
                    alert={featuredAlert}
                    onResolved={() => setResolvedIds((previous) => [...previous, featuredAlert.id])}
                  />
                ) : null
              )}
            </Card>
          </Reveal>
        ) : null}

        <Reveal delay={190}>
            <MotionPressable accessibilityRole="button" onPress={() => router.push('/movimientos')}>
              <Card style={styles.monthCard}>
                <Box style={[styles.monthIcon, { backgroundColor: palette.surfaceSage }]}>
                  <Text style={[styles.monthIconText, { color: palette.muted }]}>▤</Text>
                </Box>
                <Box style={styles.monthCopy}>
                  <Text style={styles.monthLabel}>Gasto de {formatMonthName(month.key)}</Text>
                  <Text style={[styles.monthMeta, { color: palette.muted }]}>
                    {month.count} {month.count === 1 ? 'movimiento' : 'movimientos'}
                  </Text>
                </Box>
                <Text style={styles.monthAmount}>{formatCents(month.spent)}</Text>
                <Text style={[styles.monthChevron, { color: palette.muted }]}>›</Text>
              </Card>
            </MotionPressable>
        </Reveal>

        {remainingAlerts.length > 0 ? (
          <Reveal delay={220} style={styles.section}>
            <SectionTitle>Más alertas</SectionTitle>
            <Box style={styles.stack}>
              {remainingAlerts.map((alert) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  onResolved={() => setResolvedIds((previous) => [...previous, alert.id])}
                />
              ))}
            </Box>
          </Reveal>
        ) : null}

        <Reveal delay={250} style={styles.section}>
          <SectionTitle
            action={
              <Link href="/movimientos" style={[styles.link, { color: palette.accent }]}>Ver todos</Link>
            }>
            Donde más gastas
          </SectionTitle>
          <Card tone="sage" style={styles.merchantCard}>
            {month.topMerchants.length === 0 ? (
              <Text style={[styles.alertBody, { color: palette.muted }]}>Todavía no hay compras este mes.</Text>
            ) : (
              month.topMerchants.map((merchant) => (
                <Box key={merchant.name} style={styles.merchantRow}>
                  <Box style={styles.merchantHead}>
                    <Text numberOfLines={1} style={styles.merchantName}>{merchant.name}</Text>
                    <Text style={styles.merchantAmount}>{formatCents(merchant.spent)}</Text>
                  </Box>
                  <Box style={[styles.barTrack, { backgroundColor: palette.track }]}>
                    <Box
                      style={[
                        styles.barFill,
                        {
                          backgroundColor: palette.accent,
                          width: `${Math.round((merchant.spent / month.topMerchants[0].spent) * 100)}%`,
                        },
                      ]}
                    />
                  </Box>
                </Box>
              ))
            )}
          </Card>
        </Reveal>
      </ScrollView>
    </PremiumSurface>
  );
}

function AlertCard({ alert, onResolved }: { alert: AnomalyAlert; onResolved: () => void }) {
  const palette = usePalette();
  const tone = severityTone(palette, alert.severity);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState<Resolution | null>(null);
  const [failed, setFailed] = useState(false);

  async function resolve(resolution: Resolution) {
    setFailed(false);
    setSaving(resolution);
    try {
      await dataSource.resolveAlert(alert.id, resolution);
      onResolved();
    } catch {
      setFailed(true);
      setSaving(null);
    }
  }

  return (
    <Animated.View layout={LinearTransition.duration(240).reduceMotion(ReduceMotion.System)}>
      <Card tone={alert.severity === 'critical' ? 'blush' : 'sage'} style={styles.alertCard}>
        <Box style={styles.alertHead}>
          <Box style={[styles.alertIcon, { backgroundColor: tone.background }]}>
            <Text style={[styles.alertIconText, { color: tone.color }]}>!</Text>
          </Box>
          <Box style={styles.alertCopy}>
            <Box style={styles.alertTitleRow}>
              <Text style={styles.alertTitle}>{alert.title}</Text>
              <Text style={[styles.severity, { color: tone.color }]}>{SEVERITY_LABELS[alert.severity]}</Text>
            </Box>
            <Text numberOfLines={expanded ? undefined : 2} style={[styles.alertBody, { color: palette.muted }]}>
              {expanded ? alert.explanation : compactAlertCopy(alert)}
            </Text>
          </Box>
        </Box>

        {!expanded ? (
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel={`Revisar ${alert.title}`}
            onPress={() => setExpanded(true)}
            style={[styles.reviewButton, { backgroundColor: tone.background }]}>
            <Text style={[styles.reviewLabel, { color: tone.color }]}>Revisar</Text>
          </MotionPressable>
        ) : (
          <Reveal style={styles.expandedActions}>
            {alert.suggested_action ? (
              <Text style={[styles.suggestedAction, { color: tone.color }]}>{alert.suggested_action}</Text>
            ) : null}
            <Box style={styles.alertActions}>
              {RESOLUTIONS.map(({ value, label }) => (
                <MotionPressable
                  key={value}
                  accessibilityRole="button"
                  disabled={saving !== null}
                  onPress={() => resolve(value)}
                  pressedScale={0.96}
                  style={[
                    styles.actionPill,
                    { backgroundColor: palette.surface, opacity: saving !== null && saving !== value ? 0.42 : 1 },
                  ]}>
                  <Text style={[styles.actionPillLabel, { color: palette.ink }]}>{saving === value ? 'Guardando…' : label}</Text>
                </MotionPressable>
              ))}
            </Box>
            {failed ? (
              <Text style={[styles.alertBody, { color: palette.danger }]}>No pudimos guardar tu respuesta. Inténtalo otra vez.</Text>
            ) : null}
          </Reveal>
        )}
      </Card>
    </Animated.View>
  );
}

function compactAlertCopy(alert: AnomalyAlert): string {
  const primary = alert.signals[0];
  if (primary?.kind === 'duplicate_charge') {
    const amount = primary.evidence.amount_cents;
    if (typeof amount === 'number') return `Detectamos 2 cargos por ${formatCents(Math.abs(amount))}.`;
  }
  if (primary?.kind === 'amount_outlier') return 'Este cargo está fuera de tu patrón habitual.';
  if (primary?.kind === 'subscription_price_hike') return primary.label;
  return primary?.label ?? alert.suggested_action ?? alert.explanation;
}

type MonthSummary = {
  key: string;
  spent: number;
  income: number;
  count: number;
  topMerchants: { name: string; spent: number }[];
};

function monthSummary(transactions: EnrichedTransaction[]): MonthSummary {
  const newest = transactions[0];
  const key = newest ? localMonthKey(newest.occurred_at) : '';
  const inMonth = transactions.filter((transaction) => localMonthKey(transaction.occurred_at) === key);
  const spentByMerchant = new Map<string, number>();
  let spent = 0;
  let income = 0;

  for (const transaction of inMonth) {
    if (transaction.amount_cents < 0) {
      spent -= transaction.amount_cents;
      const name = transaction.merchant_display_name ?? transaction.raw_description;
      spentByMerchant.set(name, (spentByMerchant.get(name) ?? 0) - transaction.amount_cents);
    } else {
      income += transaction.amount_cents;
    }
  }

  const topMerchants = [...spentByMerchant.entries()]
    .map(([name, total]) => ({ name, spent: total }))
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 5);

  return { key, spent, income, count: inMonth.length, topMerchants };
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 24, gap: 24, paddingBottom: 138 },
  hello: { fontSize: 17, lineHeight: 22 },
  name: { fontSize: 36, lineHeight: 40, fontWeight: '700', letterSpacing: -1.1 },
  heroTop: { backgroundColor: 'transparent', gap: 6 },
  heroLabel: { color: 'rgba(255,255,255,0.82)', fontSize: 15, fontWeight: '600' },
  heroAmount: { color: '#FFFFFF', fontSize: 42, lineHeight: 48, fontWeight: '700', letterSpacing: -1.5, fontVariant: ['tabular-nums'] },
  savingsStrip: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.28)' },
  savingsIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  savingsIconText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  savingsName: { flex: 1, color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  savingsAmount: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  moneyActionsCard: { padding: 7, gap: 6 },
  moneyActions: { flexDirection: 'row', gap: 7, backgroundColor: 'transparent' },
  moneyAction: { flex: 1, minHeight: 72, borderRadius: 18, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 9 },
  moneyActionIcon: { width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  moneyActionCopy: { flex: 1, gap: 3, backgroundColor: 'transparent' },
  moneyActionTitle: { fontSize: 14, fontWeight: '700' },
  moneyActionHint: { fontSize: 10.5 },
  securityStatus: { minHeight: 38, paddingHorizontal: 10, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'transparent' },
  securityCopy: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'transparent' },
  securityLabel: { fontSize: 11.5, fontWeight: '600' },
  lockButton: { minHeight: 34, paddingHorizontal: 8, justifyContent: 'center' },
  lockLabel: { fontSize: 12, fontWeight: '700' },
  section: { gap: 0 },
  stack: { gap: 12, backgroundColor: 'transparent' },
  link: { fontSize: 14, fontWeight: '600' },
  alertShell: { padding: 8 },
  alertShellTitle: { paddingHorizontal: 8, backgroundColor: 'transparent' },
  alertCard: { gap: 14 },
  alertHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: 'transparent' },
  alertIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  alertIconText: { fontSize: 22, fontWeight: '700' },
  alertCopy: { flex: 1, gap: 5, backgroundColor: 'transparent' },
  alertTitleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, backgroundColor: 'transparent' },
  alertTitle: { flex: 1, fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  severity: { fontSize: 12, fontWeight: '600' },
  alertBody: { fontSize: 14, lineHeight: 20 },
  reviewButton: { minHeight: 44, alignSelf: 'stretch', borderRadius: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  reviewLabel: { fontSize: 15, fontWeight: '700' },
  expandedActions: { gap: 12 },
  suggestedAction: { fontSize: 14, fontWeight: '600' },
  alertActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, backgroundColor: 'transparent' },
  actionPill: { minHeight: 42, flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 13 },
  actionPillLabel: { fontSize: 13, fontWeight: '600' },
  monthCard: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14 },
  monthIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  monthIconText: { fontSize: 20, fontWeight: '600' },
  monthCopy: { flex: 1, gap: 3, backgroundColor: 'transparent' },
  monthLabel: { fontSize: 14, fontWeight: '600' },
  monthAmount: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2, fontVariant: ['tabular-nums'] },
  monthMeta: { fontSize: 11 },
  monthChevron: { fontSize: 24, fontWeight: '300' },
  merchantCard: { gap: 5 },
  merchantRow: { gap: 7, paddingVertical: 8, backgroundColor: 'transparent' },
  merchantHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, backgroundColor: 'transparent' },
  merchantName: { flex: 1, fontSize: 15, fontWeight: '600' },
  merchantAmount: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  barTrack: { height: 5, borderRadius: 999, overflow: 'hidden' },
  barFill: { height: 5, borderRadius: 999 },
});
