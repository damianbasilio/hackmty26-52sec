import { useMemo, useState } from 'react';
import { FlatList, View as Box, RefreshControl, ScrollView, StyleSheet } from 'react-native';

import type { EnrichedTransaction, MerchantCategory } from '@contracts/types';

import { Text, View } from '@/components/Themed';
import {
  CATEGORY_LABELS,
  formatDayHeading,
  formatSignedCents,
  localDayKey,
} from '@/components/display';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { Chip, EmptyState, spacing } from '@/components/ui';
import { usePalette } from '@/components/palette';
import { useAsync } from '@/components/useAsync';
import { dataSource } from '@/src/data';

type Row =
  | { kind: 'day'; key: string; heading: string; total: number }
  | { kind: 'txn'; key: string; txn: EnrichedTransaction };

type Filter = MerchantCategory | 'all';

export default function MovimientosScreen() {
  const palette = usePalette();
  const [filter, setFilter] = useState<Filter>('all');

  const { data, error, loading, reload } = useAsync(async () => {
    const accounts = await dataSource.getAccounts();
    const account = accounts.find((a) => a.type === 'checking') ?? accounts[0];
    if (!account) throw new Error('No hay cuentas disponibles.');
    const transactions = await dataSource.getTransactions({ accountId: account.id });
    return { account, transactions };
  });

  const transactions = data?.transactions ?? [];

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
            <TransactionRow txn={item.txn} />
          )
        }
      />
    </View>
  );
}

function TransactionRow({ txn }: { txn: EnrichedTransaction }) {
  const palette = usePalette();
  const incoming = txn.amount_cents > 0;

  return (
    <Box style={[styles.txnRow, { backgroundColor: palette.surface, borderColor: palette.border }]}>
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
});
