import { useMemo } from 'react';
import { View as Box, ScrollView, StyleSheet } from 'react-native';
import { Link } from 'expo-router';

import type { AnomalyAlert, AnomalySeverity, EnrichedTransaction } from '@contracts/types';

import { Text } from '@/components/Themed';
import { formatMonthName, localMonthKey } from '@/components/display';
import {
  Card,
  Chip,
  ErrorState,
  LoadingState,
  SectionTitle,
  spacing,
  usePalette,
  type Palette,
} from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { dataSource } from '@/src/data';
import { formatCents } from '@/src/format';

const SEVERITY_LABELS: Record<AnomalySeverity, string> = {
  info: 'Aviso',
  warning: 'Revisar',
  critical: 'Urgente',
};

function severityTone(p: Palette, severity: AnomalySeverity) {
  if (severity === 'critical') return { background: p.criticalBg, color: p.critical };
  if (severity === 'warning') return { background: p.warningBg, color: p.warning };
  return { background: p.infoBg, color: p.info };
}

export default function InicioScreen() {
  const p = usePalette();

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

  return (
    <ScrollView
      style={{ backgroundColor: p.background }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <Text style={[styles.greeting, { color: p.muted }]}>Hola, {customer.first_name}</Text>

      <Card>
        <Text style={[styles.balanceLabel, { color: p.muted }]}>
          {checking.nickname} ·· {checking.last_four}
        </Text>
        <Text style={[styles.balance, { color: p.text }]}>{formatCents(checking.balance_cents)}</Text>
        {savings ? (
          <Box style={[styles.divider, { borderColor: p.border }]}>
            <Text style={[styles.balanceSub, { color: p.muted }]}>{savings.nickname}</Text>
            <Text style={[styles.balanceSubAmount, { color: p.text }]}>
              {formatCents(savings.balance_cents)}
            </Text>
          </Box>
        ) : null}
      </Card>

      {alerts.length > 0 ? (
        <Box style={styles.section}>
          <SectionTitle>Necesita tu atención</SectionTitle>
          <Box style={styles.stack}>
            {alerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </Box>
        </Box>
      ) : null}

      <Box style={styles.section}>
        <SectionTitle>Gasto de {formatMonthName(month.key)}</SectionTitle>
        <Card>
          <Text style={[styles.balance, { color: p.text }]}>{formatCents(month.spent)}</Text>
          <Text style={[styles.balanceLabel, { color: p.muted }]}>
            {month.count} {month.count === 1 ? 'movimiento' : 'movimientos'} · entradas{' '}
            {formatCents(month.income)}
          </Text>
        </Card>
      </Box>

      <Box style={styles.section}>
        <SectionTitle
          action={
            <Link href="/movimientos" style={[styles.link, { color: p.accent }]}>
              Ver todos
            </Link>
          }>
          Donde más gastas
        </SectionTitle>
        <Card>
          {month.topMerchants.length === 0 ? (
            <Text style={[styles.balanceLabel, { color: p.muted }]}>
              Todavía no hay compras este mes.
            </Text>
          ) : (
            month.topMerchants.map((merchant) => (
              <Box key={merchant.name} style={styles.merchantRow}>
                <Box style={styles.merchantHead}>
                  <Text numberOfLines={1} style={[styles.merchantName, { color: p.text }]}>
                    {merchant.name}
                  </Text>
                  <Text style={[styles.merchantAmount, { color: p.text }]}>
                    {formatCents(merchant.spent)}
                  </Text>
                </Box>
                <Box style={[styles.barTrack, { backgroundColor: p.chip }]}>
                  <Box
                    style={[
                      styles.barFill,
                      {
                        backgroundColor: p.accent,
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

function AlertCard({ alert }: { alert: AnomalyAlert }) {
  const p = usePalette();
  const tone = severityTone(p, alert.severity);

  return (
    <Card style={{ borderColor: tone.color }}>
      <Box style={styles.alertHead}>
        <Text style={[styles.alertTitle, { color: p.text }]}>{alert.title}</Text>
        <Chip label={SEVERITY_LABELS[alert.severity]} tone={tone} />
      </Box>
      <Text style={[styles.alertBody, { color: p.muted }]}>{alert.explanation}</Text>
      {alert.suggested_action ? (
        <Text style={[styles.alertAction, { color: tone.color }]}>{alert.suggested_action}</Text>
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
  merchantRow: { gap: spacing.xs, paddingVertical: spacing.xs },
  merchantHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  merchantName: { flex: 1, fontSize: 15 },
  merchantAmount: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  barTrack: { height: 6, borderRadius: 999, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 999 },
});
