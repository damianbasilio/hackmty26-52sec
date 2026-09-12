import { useMemo, useState } from 'react';
import { View as Box, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Link } from 'expo-router';

import type { AnomalyAlert, AnomalySeverity, EnrichedTransaction } from '@contracts/types';

import { Text } from '@/components/Themed';
import { localMonthKey } from '@/components/display';
import { Card } from '@/components/Card';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { Chip, SectionTitle, spacing } from '@/components/ui';
import { usePalette, type Palette } from '@/components/palette';
import { useAsync } from '@/components/useAsync';
import { dataSource } from '@/src/data';
import { formatCents, formatMonthName } from '@/src/format';

const SEVERITY_LABELS: Record<AnomalySeverity, string> = {
  info: 'Aviso',
  warning: 'Revisar',
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
  const [resolvedIds, setResolvedIds] = useState<string[]>([]);

  const { data, error, loading, reload } = useAsync(async () => {
    const accounts = await dataSource.getAccounts();
    const checking = accounts.find((a) => a.type === 'checking') ?? accounts[0];
    if (!checking) throw new Error('No hay cuentas disponibles.');
    const savings = accounts.find((a) => a.type === 'savings') ?? null;
    const [customer, transactions, alerts] = await Promise.all([
      dataSource.getCustomer(),
      dataSource.getTransactions({ accountId: checking.id }),
      dataSource.getAlerts(checking.id),
    ]);
    return { checking, savings, customer, transactions, alerts };
  });

  const month = useMemo(() => monthSummary(data?.transactions ?? []), [data?.transactions]);

  if (loading) return <LoadingState label="Preparando tu resumen…" />;
  if (error || !data) return <ErrorState message={error ?? 'Sin datos.'} onRetry={reload} />;

  const { checking, savings, customer, alerts } = data;
  const openAlerts = alerts.filter((a) => !resolvedIds.includes(a.id));

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <Text style={[styles.greeting, { color: palette.muted }]}>Hola, {customer.first_name}</Text>

      <Card>
        <Text style={[styles.balanceLabel, { color: palette.muted }]}>
          {checking.nickname} ·· {checking.last_four}
        </Text>
        <Text style={styles.balance}>{formatCents(checking.balance_cents)}</Text>
        {savings ? (
          <Box style={[styles.divider, { borderColor: palette.border }]}>
            <Text style={[styles.balanceSub, { color: palette.muted }]}>{savings.nickname}</Text>
            <Text style={styles.balanceSubAmount}>
              {formatCents(savings.balance_cents)}
            </Text>
          </Box>
        ) : null}
      </Card>

      {alerts.length > 0 ? (
        <Box style={styles.section}>
          <SectionTitle>Necesita tu atención</SectionTitle>
          {openAlerts.length === 0 ? (
            <Card>
              <Text style={[styles.alertBody, { color: palette.muted }]}>
                Listo, no queda nada por revisar.
              </Text>
            </Card>
          ) : (
            <Box style={styles.stack}>
              {openAlerts.map((alert) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  onResolved={() => setResolvedIds((prev) => [...prev, alert.id])}
                />
              ))}
            </Box>
          )}
        </Box>
      ) : null}

      <Box style={styles.section}>
        <SectionTitle>Gasto de {formatMonthName(month.key)}</SectionTitle>
        <Card>
          <Text style={styles.balance}>{formatCents(month.spent)}</Text>
          <Text style={[styles.balanceLabel, { color: palette.muted }]}>
            {month.count} {month.count === 1 ? 'movimiento' : 'movimientos'} · entradas{' '}
            {formatCents(month.income)}
          </Text>
        </Card>
      </Box>

      <Box style={styles.section}>
        <SectionTitle
          action={
            <Link href="/movimientos" style={[styles.link, { color: palette.accent }]}>
              Ver todos
            </Link>
          }>
          Donde más gastas
        </SectionTitle>
        <Card>
          {month.topMerchants.length === 0 ? (
            <Text style={[styles.balanceLabel, { color: palette.muted }]}>
              Todavía no hay compras este mes.
            </Text>
          ) : (
            month.topMerchants.map((merchant) => (
              <Box key={merchant.name} style={styles.merchantRow}>
                <Box style={styles.merchantHead}>
                  <Text numberOfLines={1} style={styles.merchantName}>
                    {merchant.name}
                  </Text>
                  <Text style={styles.merchantAmount}>
                    {formatCents(merchant.spent)}
                  </Text>
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
      </Box>
    </ScrollView>
  );
}

function AlertCard({ alert, onResolved }: { alert: AnomalyAlert; onResolved: () => void }) {
  const palette = usePalette();
  const tone = severityTone(palette, alert.severity);
  const [saving, setSaving] = useState<Resolution | null>(null);
  const [failed, setFailed] = useState(false);

  // no setSaving(null) on success: onResolved unmounts this card
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
    <Card accent={tone.color}>
      <Box style={styles.alertHead}>
        <Text style={styles.alertTitle}>{alert.title}</Text>
        <Chip label={SEVERITY_LABELS[alert.severity]} tone={tone} />
      </Box>
      <Text style={[styles.alertBody, { color: palette.muted }]}>{alert.explanation}</Text>
      {alert.suggested_action ? (
        <Text style={[styles.alertAction, { color: tone.color }]}>{alert.suggested_action}</Text>
      ) : null}

      <Box style={[styles.alertActions, { borderColor: palette.border }]}>
        {RESOLUTIONS.map(({ value, label }) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            disabled={saving !== null}
            onPress={() => resolve(value)}
            style={({ pressed }) => [
              styles.actionPill,
              {
                backgroundColor: palette.surfaceAlt,
                borderColor: palette.border,
                opacity: saving !== null && saving !== value ? 0.4 : pressed ? 0.7 : 1,
              },
            ]}>
            <Text style={[styles.actionPillLabel, { color: palette.muted }]}>
              {saving === value ? 'Guardando…' : label}
            </Text>
          </Pressable>
        ))}
      </Box>

      {failed ? (
        <Text style={[styles.alertBody, { color: palette.danger }]}>
          No pudimos guardar tu respuesta. Revisa tu conexión e inténtalo otra vez.
        </Text>
      ) : null}
    </Card>
  );
}

type MonthSummary = {
  key: string;
  /** Positive magnitude of money out. */
  spent: number;
  income: number;
  count: number;
  topMerchants: { name: string; spent: number }[];
};

/**
 * Window = month of the newest movement, not the wall clock: la demo corre con fixtures
 * fijos y un mes natural vacío dejaría la pantalla en ceros.
 */
function monthSummary(transactions: EnrichedTransaction[]): MonthSummary {
  const newest = transactions[0];
  const key = newest ? localMonthKey(newest.occurred_at) : '';
  const inMonth = transactions.filter((t) => localMonthKey(t.occurred_at) === key);

  const spentByMerchant = new Map<string, number>();
  let spent = 0;
  let income = 0;
  for (const t of inMonth) {
    if (t.amount_cents < 0) {
      spent -= t.amount_cents;
      const name = t.merchant_display_name ?? t.raw_description;
      spentByMerchant.set(name, (spentByMerchant.get(name) ?? 0) - t.amount_cents);
    } else {
      income += t.amount_cents;
    }
  }

  const topMerchants = [...spentByMerchant.entries()]
    .map(([name, total]) => ({ name, spent: total }))
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 5);

  return { key, spent, income, count: inMonth.length, topMerchants };
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl * 2 },
  greeting: { fontSize: 15, fontWeight: '600' },
  balanceLabel: { fontSize: 13 },
  balance: { fontSize: 34, fontWeight: '700', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  divider: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
    marginTop: spacing.xs,
  },
  balanceSub: { fontSize: 14 },
  balanceSubAmount: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  section: { gap: 0 },
  stack: { gap: spacing.md },
  link: { fontSize: 14, fontWeight: '600' },
  alertHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  alertTitle: { flex: 1, fontSize: 16, fontWeight: '700' },
  alertBody: { fontSize: 14, lineHeight: 20 },
  alertAction: { fontSize: 14, fontWeight: '600' },
  alertActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
    marginTop: spacing.xs,
  },
  actionPill: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionPillLabel: { fontSize: 13, fontWeight: '700' },
  merchantRow: { gap: spacing.xs, paddingVertical: spacing.xs },
  merchantHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  merchantName: { flex: 1, fontSize: 15 },
  merchantAmount: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  barTrack: { height: 6, borderRadius: 999, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 999 },
});
