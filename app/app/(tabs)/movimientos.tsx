import { useMemo, useState } from 'react';
import { FlatList, View as Box, Modal, Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import type {
  Account,
  AnomalyAlert,
  EnrichedTransaction,
  MerchantCategory,
  Subscription,
  TransactionStatus,
} from '@contracts/types';

import { Text, View } from '@/components/Themed';
import {
  CATEGORY_LABELS,
  formatDayHeading,
  formatSignedCents,
  localDayKey,
  localTime,
} from '@/components/display';
import { Card } from '@/components/Card';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { Chip, EmptyState, SectionTitle, spacing } from '@/components/ui';
import { usePalette } from '@/components/palette';
import { useAsync } from '@/components/useAsync';
import { dataSource } from '@/src/data';
import { formatCents, formatLongDay } from '@/src/format';

type Row =
  | { kind: 'day'; key: string; heading: string; total: number }
  | { kind: 'txn'; key: string; txn: EnrichedTransaction };

type Filter = MerchantCategory | 'all';

const STATUS_LABELS: Record<TransactionStatus, string> = {
  pending: 'Pendiente',
  completed: 'Aplicado',
  cancelled: 'Cancelado',
};

export default function MovimientosScreen() {
  const palette = usePalette();
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, error, loading, reload } = useAsync(async () => {
    const accounts = await dataSource.getAccounts();
    const account = accounts.find((a) => a.type === 'checking') ?? accounts[0];
    if (!account) throw new Error('No hay cuentas disponibles.');
    // resolved alerts included: el detalle sigue explicando un cargo ya revisado
    const [transactions, alerts, subscriptions] = await Promise.all([
      dataSource.getTransactions({ accountId: account.id }),
      dataSource.getAlerts(account.id, true),
      dataSource.getSubscriptions(account.id),
    ]);
    return { account, transactions, alerts, subscriptions };
  });

  const transactions = data?.transactions ?? [];
  const selected = transactions.find((t) => t.id === selectedId) ?? null;

  const categories = useMemo(() => {
    const counts = new Map<MerchantCategory, number>();
    for (const t of transactions) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([category]) => category);
  }, [transactions]);

  const rows = useMemo(() => {
    const visible = filter === 'all' ? transactions : transactions.filter((t) => t.category === filter);
    const out: Row[] = [];
    let currentDay = '';
    for (const txn of visible) {
      const day = localDayKey(txn.occurred_at);
      if (day !== currentDay) {
        currentDay = day;
        // rescan per day: lista de un periodo corto, no vale un índice aparte
        const total = visible
          .filter((t) => localDayKey(t.occurred_at) === day)
          .reduce((sum, t) => sum + t.amount_cents, 0);
        out.push({ kind: 'day', key: `day_${day}`, heading: formatDayHeading(day), total });
      }
      out.push({ kind: 'txn', key: txn.id, txn });
    }
    return out;
  }, [transactions, filter]);

  if (loading && !data) return <LoadingState label="Cargando movimientos…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}
        style={{ flexGrow: 0 }}>
        <Chip label="Todos" selected={filter === 'all'} onPress={() => setFilter('all')} />
        {categories.map((category) => (
          <Chip
            key={category}
            label={CATEGORY_LABELS[category]}
            selected={filter === category}
            onPress={() => setFilter(category)}
          />
        ))}
      </ScrollView>

      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        contentContainerStyle={rows.length ? styles.list : styles.listEmpty}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} tintColor={palette.muted} />
        }
        ListEmptyComponent={
          <EmptyState
            title="Sin movimientos aquí"
            hint={
              filter === 'all'
                ? 'Cuando llegue el primer movimiento lo verás en esta lista.'
                : 'No hay movimientos de esta categoría en el periodo.'
            }
          />
        }
        renderItem={({ item }) =>
          item.kind === 'day' ? (
            <Box style={styles.dayRow}>
              <Text style={[styles.dayHeading, { color: palette.muted }]}>{item.heading}</Text>
              <Text style={[styles.dayTotal, { color: palette.muted }]}>{formatSignedCents(item.total)}</Text>
            </Box>
          ) : (
            <TransactionRow txn={item.txn} onPress={() => setSelectedId(item.txn.id)} />
          )
        }
      />

      <Modal
        visible={selected !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedId(null)}>
        {selected && data ? (
          <TransactionDetail
            txn={selected}
            account={data.account}
            alert={data.alerts.find((a) => a.id === selected.anomaly_alert_id) ?? null}
            subscription={
              data.subscriptions.find((s) => s.id === selected.subscription_id) ?? null
            }
            onClose={() => setSelectedId(null)}
          />
        ) : null}
      </Modal>
    </View>
  );
}

function TransactionRow({ txn, onPress }: { txn: EnrichedTransaction; onPress: () => void }) {
  const palette = usePalette();
  const incoming = txn.amount_cents > 0;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.txnRow,
        { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.7 : 1 },
      ]}>
      <Box style={styles.txnMain}>
        <Text numberOfLines={1} style={styles.txnName}>
          {txn.merchant_display_name ?? txn.raw_description}
        </Text>
        <Box style={styles.txnMeta}>
          <Text style={[styles.txnCategory, { color: palette.muted }]}>{CATEGORY_LABELS[txn.category]}</Text>
          {txn.is_recurring ? (
            <Text style={[styles.txnTag, { color: palette.muted, borderColor: palette.border }]}>Recurrente</Text>
          ) : null}
          {txn.status === 'pending' ? (
            <Text style={[styles.txnTag, { color: palette.warning, borderColor: palette.border }]}>Pendiente</Text>
          ) : null}
        </Box>
      </Box>
      <Text style={[styles.txnAmount, incoming ? { color: palette.positive } : null]}>
        {formatSignedCents(txn.amount_cents)}
      </Text>
    </Pressable>
  );
}

function TransactionDetail({
  txn,
  account,
  alert,
  subscription,
  onClose,
}: {
  txn: EnrichedTransaction;
  account: Account;
  alert: AnomalyAlert | null;
  subscription: Subscription | null;
  onClose: () => void;
}) {
  const palette = usePalette();
  const alertColor =
    alert?.severity === 'critical'
      ? palette.danger
      : alert?.severity === 'warning'
        ? palette.warning
        : palette.accent;

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <Box style={[styles.sheetHead, { borderColor: palette.border }]}>
        <Text numberOfLines={1} style={styles.sheetTitle}>
          {txn.merchant_display_name ?? txn.raw_description}
        </Text>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={onClose}>
          <Text style={[styles.sheetClose, { color: palette.accent }]}>Cerrar</Text>
        </Pressable>
      </Box>

      <ScrollView contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
        <Card>
          <Text
            style={[
              styles.detailAmount,
              txn.amount_cents > 0 ? { color: palette.positive } : null,
            ]}>
            {formatSignedCents(txn.amount_cents)}
          </Text>
          <Text style={[styles.detailCaption, { color: palette.muted }]}>
            {formatLongDay(localDayKey(txn.occurred_at), true)} · {localTime(txn.occurred_at)}
          </Text>
        </Card>

        <Card>
          <DetailRow label="Comercio" value={txn.merchant_display_name ?? 'Sin identificar'} />
          <DetailRow label="Categoría" value={CATEGORY_LABELS[txn.category]} />
          <DetailRow label="Cuenta" value={`${account.nickname} ·· ${account.last_four}`} />
          <DetailRow label="Estado" value={STATUS_LABELS[txn.status]} />
          <DetailRow label="Como lo reporta tu banco" value={txn.raw_description} />
        </Card>

        {alert || subscription || txn.is_recurring ? (
          <Box>
            <SectionTitle>Qué detectamos</SectionTitle>
            <Box style={styles.sheetStack}>
              {alert ? (
                <Card accent={alertColor}>
                  <Text style={styles.detailSignalTitle}>{alert.title}</Text>
                  <Text style={[styles.detailBody, { color: palette.muted }]}>
                    {alert.explanation}
                  </Text>
                  <Box style={styles.signalChips}>
                    {alert.signals.map((signal, i) => (
                      <Chip key={`${signal.kind}_${i}`} label={signal.label} />
                    ))}
                  </Box>
                  {alert.suggested_action ? (
                    <Text style={[styles.detailSignalAction, { color: alertColor }]}>
                      {alert.suggested_action}
                    </Text>
                  ) : null}
                  {alert.resolved_at ? (
                    <Text style={[styles.detailBody, { color: palette.muted }]}>
                      Ya respondiste esta alerta.
                    </Text>
                  ) : null}
                </Card>
              ) : null}

              {subscription ? (
                <Card>
                  <Text style={styles.detailSignalTitle}>Es parte de una suscripción</Text>
                  <Text style={[styles.detailBody, { color: palette.muted }]}>
                    {subscription.explanation}
                  </Text>
                  <Text style={[styles.detailBody, { color: palette.muted }]}>
                    Siguiente cargo el {formatLongDay(subscription.next_charge_on)} por{' '}
                    {formatCents(subscription.amount_cents)}.
                  </Text>
                </Card>
              ) : null}

              {!alert && !subscription && txn.is_recurring ? (
                <Card>
                  <Text style={[styles.detailBody, { color: palette.muted }]}>
                    Este cargo se repite cada cierto tiempo, pero todavía no lo agrupamos como
                    suscripción.
                  </Text>
                </Card>
              ) : null}
            </Box>
          </Box>
        ) : null}
      </ScrollView>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const palette = usePalette();
  return (
    <Box style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: palette.muted }]}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </Box>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  filters: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  listEmpty: { flexGrow: 1 },
  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  dayHeading: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  dayTotal: { fontSize: 13, fontWeight: '600' },
  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
  },
  txnMain: { flex: 1, gap: spacing.xs },
  txnName: { fontSize: 15, fontWeight: '600' },
  txnMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  txnCategory: { fontSize: 13 },
  txnTag: {
    fontSize: 11,
    fontWeight: '600',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  txnAmount: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sheet: { flex: 1 },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { flex: 1, fontSize: 17, fontWeight: '700' },
  sheetClose: { fontSize: 15, fontWeight: '600' },
  sheetBody: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl * 2 },
  sheetStack: { gap: spacing.md },
  detailAmount: { fontSize: 30, fontWeight: '700', letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  detailCaption: { fontSize: 14 },
  detailRow: { gap: 2, paddingVertical: spacing.xs },
  detailLabel: { fontSize: 12 },
  detailValue: { fontSize: 15, fontWeight: '600' },
  detailSignalTitle: { fontSize: 16, fontWeight: '700' },
  detailBody: { fontSize: 14, lineHeight: 20 },
  detailSignalAction: { fontSize: 14, fontWeight: '600' },
  signalChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
