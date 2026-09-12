import { useMemo, useState } from 'react';
import { FlatList, Modal, RefreshControl, ScrollView, StyleSheet, View as Box } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

import type {
  Account,
  AnomalyAlert,
  EnrichedTransaction,
  MerchantCategory,
  Subscription,
  TransactionStatus,
} from '@contracts/types';

import { Card } from '@/components/Card';
import { MotionPressable, Reveal } from '@/components/Motion';
import { PremiumSurface } from '@/components/PremiumSurface';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { Text } from '@/components/Themed';
import {
  CATEGORY_LABELS,
  formatSignedCents,
  localDayKey,
  localTime,
} from '@/components/display';
import { usePalette } from '@/components/palette';
import { Chip, EmptyState, SectionTitle } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { dataSource } from '@/src/data';
import { formatCents, formatLongDay } from '@/src/format';

type DayGroup = {
  key: string;
  heading: string;
  total: number;
  transactions: EnrichedTransaction[];
};

type Filter = MerchantCategory | 'all' | 'expenses' | 'income';
type Resolution = NonNullable<AnomalyAlert['resolution']>;

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
    const account = accounts.find((candidate) => candidate.type === 'checking') ?? accounts[0];
    if (!account) throw new Error('No hay cuentas disponibles.');
    const [transactions, alerts, subscriptions] = await Promise.all([
      dataSource.getTransactions({ accountId: account.id }),
      dataSource.getAlerts(account.id, true),
      dataSource.getSubscriptions(account.id),
    ]);
    return { account, transactions, alerts, subscriptions };
  });

  const transactions = data?.transactions ?? [];
  const selected = transactions.find((transaction) => transaction.id === selectedId) ?? null;

  const categories = useMemo(() => {
    const counts = new Map<MerchantCategory, number>();
    for (const transaction of transactions) {
      counts.set(transaction.category, (counts.get(transaction.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([category]) => category);
  }, [transactions]);

  const groups = useMemo(() => {
    const visible = transactions.filter((transaction) => {
      if (filter === 'all') return true;
      if (filter === 'expenses') return transaction.amount_cents < 0;
      if (filter === 'income') return transaction.amount_cents > 0;
      return transaction.category === filter;
    });

    const byDay = new Map<string, EnrichedTransaction[]>();
    for (const transaction of visible) {
      const day = localDayKey(transaction.occurred_at);
      byDay.set(day, [...(byDay.get(day) ?? []), transaction]);
    }

    return [...byDay.entries()].map(([day, dayTransactions]) => ({
      key: day,
      heading: formatLongDay(day, true),
      total: dayTransactions.reduce((sum, transaction) => sum + transaction.amount_cents, 0),
      transactions: dayTransactions,
    }));
  }, [filter, transactions]);

  if (loading && !data) return <LoadingState label="Cargando movimientos…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <PremiumSurface>
      <FlatList
        data={groups}
        keyExtractor={(group) => group.key}
        contentContainerStyle={groups.length ? styles.list : styles.listEmpty}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={palette.accent} />}
        ListHeaderComponent={
          <Box style={styles.header}>
            <Reveal delay={20}>
              <Text style={styles.title}>Movimientos</Text>
            </Reveal>
            <Reveal delay={70}>
              <Box style={[styles.segmented, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                {([
                  ['all', 'Todos'],
                  ['expenses', 'Gastos'],
                  ['income', 'Ingresos'],
                ] as const).map(([value, label]) => {
                  const selectedFilter = filter === value;
                  return (
                    <MotionPressable
                      key={value}
                      accessibilityRole="button"
                      onPress={() => setFilter(value)}
                      style={[
                        styles.segment,
                        selectedFilter ? { backgroundColor: palette.accentDeep } : null,
                      ]}>
                      <Text style={[styles.segmentLabel, { color: selectedFilter ? '#FFFFFF' : palette.ink }]}>
                        {label}
                      </Text>
                    </MotionPressable>
                  );
                })}
              </Box>
            </Reveal>
          </Box>
        }
        ListEmptyComponent={
          <EmptyState
            title="Sin movimientos aquí"
            hint={filter === 'all' ? 'Cuando llegue el primer movimiento lo verás aquí.' : 'No hay movimientos para este filtro.'}
          />
        }
        renderItem={({ item, index }) => (
          <Reveal delay={Math.min(90 + index * 35, 260)} style={styles.groupWrap}>
            <Card tone="sage" style={styles.dayCard}>
              <Box style={[styles.dayHead, { borderBottomColor: palette.border }]}>
                <Text style={[styles.dayHeading, { color: palette.muted }]}>{item.heading}</Text>
                <Text style={[styles.dayTotal, { color: palette.muted }]}>{formatSignedCents(item.total)}</Text>
              </Box>
              {item.transactions.map((transaction, transactionIndex) => (
                <TransactionRow
                  key={transaction.id}
                  txn={transaction}
                  first={transactionIndex === 0}
                  onPress={() => setSelectedId(transaction.id)}
                />
              ))}
            </Card>
          </Reveal>
        )}
        ListFooterComponent={
          categories.length > 0 ? (
            <Box style={styles.categorySection}>
              <SectionTitle>Filtrar por categoría</SectionTitle>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filters}>
                {categories.map((category) => (
                  <Chip
                    key={category}
                    label={CATEGORY_LABELS[category]}
                    selected={filter === category}
                    onPress={() => setFilter(category)}
                  />
                ))}
              </ScrollView>
            </Box>
          ) : null
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
            alert={data.alerts.find((alert) => alert.id === selected.anomaly_alert_id) ?? null}
            subscription={data.subscriptions.find((subscription) => subscription.id === selected.subscription_id) ?? null}
            onClose={() => setSelectedId(null)}
            onAlertResolved={reload}
          />
        ) : null}
      </Modal>
    </PremiumSurface>
  );
}

function TransactionRow({
  txn,
  first,
  onPress,
}: {
  txn: EnrichedTransaction;
  first: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  const incoming = txn.amount_cents > 0;
  const name = txn.merchant_display_name ?? txn.raw_description;

  return (
    <MotionPressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.txnRow,
        !first ? { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth } : null,
      ]}>
      <Box style={[styles.avatar, { backgroundColor: incoming ? palette.positiveSoft : palette.surface }]}>
        <Text style={[styles.avatarText, { color: incoming ? palette.positive : palette.accentDeep }]}>{name.charAt(0).toUpperCase()}</Text>
      </Box>
      <Box style={styles.txnMain}>
        <Text numberOfLines={1} style={styles.txnName}>{name}</Text>
        <Box style={styles.txnMeta}>
          <Text style={[styles.txnCategory, { color: palette.muted }]}>{CATEGORY_LABELS[txn.category]}</Text>
          {txn.is_recurring ? <Text style={[styles.dot, { color: palette.muted }]}>· recurrente</Text> : null}
          {txn.status === 'pending' ? <Text style={[styles.dot, { color: palette.warning }]}>· pendiente</Text> : null}
        </Box>
      </Box>
      <Box style={styles.amountWrap}>
        <Text style={[styles.txnAmount, incoming ? { color: palette.positive } : null]}>{formatSignedCents(txn.amount_cents)}</Text>
        {txn.anomaly_alert_id ? <Text style={[styles.reviewTag, { color: palette.danger }]}>Revisar</Text> : null}
      </Box>
      <Text style={[styles.chevron, { color: palette.muted }]}>›</Text>
    </MotionPressable>
  );
}

function TransactionDetail({
  txn,
  account,
  alert,
  subscription,
  onClose,
  onAlertResolved,
}: {
  txn: EnrichedTransaction;
  account: Account;
  alert: AnomalyAlert | null;
  subscription: Subscription | null;
  onClose: () => void;
  onAlertResolved: () => void;
}) {
  const palette = usePalette();
  const name = txn.merchant_display_name ?? txn.raw_description;
  const [reviewOpen, setReviewOpen] = useState(false);
  const [resolving, setResolving] = useState<Resolution | null>(null);
  const [resolved, setResolved] = useState<Resolution | null>(alert?.resolution ?? null);
  const [resolutionError, setResolutionError] = useState(false);

  async function resolveAlert(resolution: Resolution) {
    if (!alert) return;
    setResolutionError(false);
    setResolving(resolution);
    try {
      await dataSource.resolveAlert(alert.id, resolution);
      setResolved(resolution);
      onAlertResolved();
    } catch {
      setResolutionError(true);
    } finally {
      setResolving(null);
    }
  }

  return (
    <PremiumSurface>
      <Box style={styles.sheetHead}>
        <MotionPressable accessibilityRole="button" hitSlop={10} onPress={onClose} pressedScale={0.94} style={styles.closeButton}>
          <Text style={[styles.closeIcon, { color: palette.accentDeep }]}>‹</Text>
        </MotionPressable>
        <Box style={[styles.sheetHandle, { backgroundColor: palette.border }]} />
        <Box style={styles.closeSpacer} />
      </Box>

      <ScrollView contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
        <Reveal delay={20} style={styles.detailHero}>
          <Box style={[styles.detailAvatar, { backgroundColor: alert ? palette.dangerSoft : palette.accentSoft }]}>
            <Text style={[styles.detailAvatarText, { color: alert ? palette.danger : palette.accentDeep }]}>{name.charAt(0).toUpperCase()}</Text>
          </Box>
          <Text style={styles.detailName}>{name}</Text>
          <Text style={[styles.detailAmount, txn.amount_cents > 0 ? { color: palette.positive } : null]}>{formatSignedCents(txn.amount_cents)}</Text>
          <Box style={[styles.statusBadge, { backgroundColor: palette.positiveSoft }]}>
            <Text style={[styles.statusText, { color: palette.positive }]}>{STATUS_LABELS[txn.status]}</Text>
          </Box>
          <Text style={[styles.detailCaption, { color: palette.muted }]}>{formatLongDay(localDayKey(txn.occurred_at), true)} · {localTime(txn.occurred_at)}</Text>
        </Reveal>

        <Reveal delay={80}>
          <Card tone="sage" style={styles.detailCard}>
            <DetailRow icon="◇" label="Categoría" value={CATEGORY_LABELS[txn.category]} />
            <DetailRow icon="▣" label="Cuenta" value={'·· ' + account.last_four} />
            <DetailRow icon="▤" label="Detalles bancarios" value="›" />
          </Card>
        </Reveal>

        {alert && !resolved ? (
          <Reveal delay={130} style={styles.alertReviewStack}>
            <Card tone="blush" style={styles.signalCard}>
              <Box style={styles.signalHead}>
                <Box style={[styles.signalIcon, { backgroundColor: palette.dangerSoft }]}>
                  <Text style={[styles.signalIconText, { color: palette.danger }]}>!</Text>
                </Box>
                <Box style={styles.signalCopy}>
                  <Text style={styles.signalTitle}>{alert.title}</Text>
                  <Text
                    numberOfLines={reviewOpen ? undefined : 2}
                    style={[styles.signalPreview, { color: palette.muted }]}>
                    {compactAlertCopy(alert)}
                  </Text>
                </Box>
                <Text style={[styles.chevron, { color: palette.muted }]}>›</Text>
              </Box>
            </Card>

            <MotionPressable
              accessibilityRole="button"
              accessibilityState={{ expanded: reviewOpen }}
              onPress={() => setReviewOpen((current) => !current)}
              pressedScale={0.975}
              style={[styles.reviewChargeButton, { backgroundColor: palette.accentDeep }]}>
              <Text style={styles.reviewChargeLabel}>
                {reviewOpen ? 'Ocultar opciones' : 'Revisar cargo'}
              </Text>
            </MotionPressable>

            {reviewOpen ? (
              <Animated.View
                entering={FadeInDown.duration(200).reduceMotion(ReduceMotion.System)}
                style={styles.resolutionActions}>
                <MotionPressable
                  accessibilityRole="button"
                  disabled={resolving !== null}
                  onPress={() => resolveAlert('confirmed_fraud')}
                  style={[styles.resolutionButton, { backgroundColor: palette.dangerSoft }]}>
                  <Text style={[styles.resolutionLabel, { color: palette.danger }]}>
                    {resolving === 'confirmed_fraud' ? 'Guardando…' : 'No fui yo'}
                  </Text>
                </MotionPressable>
                <MotionPressable
                  accessibilityRole="button"
                  disabled={resolving !== null}
                  onPress={() => resolveAlert('dismissed')}
                  style={[styles.resolutionButton, { backgroundColor: palette.surfaceSage }]}>
                  <Text style={[styles.resolutionLabel, { color: palette.muted }]}>
                    {resolving === 'dismissed' ? 'Guardando…' : 'Ignorar'}
                  </Text>
                </MotionPressable>
              </Animated.View>
            ) : null}

            <MotionPressable
              accessibilityRole="button"
              disabled={resolving !== null}
              onPress={() => resolveAlert('confirmed_legit')}
              style={styles.legitButton}>
              <Text style={[styles.legitLabel, { color: palette.accent }]}>
                {resolving === 'confirmed_legit' ? 'Guardando…' : 'Sí fui yo'}
              </Text>
            </MotionPressable>

            {resolutionError ? (
              <Text style={[styles.resolutionError, { color: palette.danger }]}>
                No pudimos guardar tu respuesta. Inténtalo otra vez.
              </Text>
            ) : null}
          </Reveal>
        ) : alert && resolved ? (
          <Reveal delay={130}>
            <Card tone="mint">
              <Text style={[styles.signalAction, { color: palette.positive }]}>Respuesta guardada</Text>
              <Text style={[styles.detailBody, { color: palette.muted }]}>
                {resolved === 'confirmed_legit'
                  ? 'Marcaste este cargo como reconocido.'
                  : resolved === 'confirmed_fraud'
                    ? 'Marcaste este cargo como no reconocido.'
                    : 'La alerta quedó ignorada.'}
              </Text>
            </Card>
          </Reveal>
        ) : null}

        {subscription ? (
          <Reveal delay={170}>
            <Card tone="sage">
              <Text style={styles.signalTitle}>Es parte de una suscripción</Text>
              <Text style={[styles.detailBody, { color: palette.muted }]}>{subscription.explanation}</Text>
              <Text style={[styles.detailBody, { color: palette.muted }]}>Siguiente cargo el {formatLongDay(subscription.next_charge_on)} por {formatCents(subscription.amount_cents)}.</Text>
            </Card>
          </Reveal>
        ) : txn.is_recurring ? (
          <Reveal delay={170}>
            <Card tone="sage">
              <Text style={[styles.detailBody, { color: palette.muted }]}>Este cargo se repite, pero todavía no lo agrupamos como suscripción.</Text>
            </Card>
          </Reveal>
        ) : null}
      </ScrollView>
    </PremiumSurface>
  );
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  const palette = usePalette();
  return (
    <Box style={[styles.detailRow, { borderBottomColor: palette.border }]}>
      <Text style={[styles.detailRowIcon, { color: palette.accentDeep }]}>{icon}</Text>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </Box>
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

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 138 },
  listEmpty: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 120 },
  header: { gap: 18, marginBottom: 22, backgroundColor: 'transparent' },
  title: { fontSize: 36, lineHeight: 41, fontWeight: '700', letterSpacing: -1.1 },
  segmented: { height: 58, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 5, flexDirection: 'row', gap: 3 },
  segment: { flex: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  segmentLabel: { fontSize: 15, fontWeight: '600' },
  filters: { gap: 8, paddingRight: 20 },
  groupWrap: { marginBottom: 22 },
  categorySection: { gap: 12, marginTop: 2, marginBottom: 8, backgroundColor: 'transparent' },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: 'transparent' },
  dayHeading: { fontSize: 15, fontWeight: '600' },
  dayTotal: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  dayCard: { paddingVertical: 0, paddingHorizontal: 0, gap: 0, overflow: 'hidden' },
  txnRow: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700' },
  txnMain: { flex: 1, gap: 4, backgroundColor: 'transparent' },
  txnName: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  txnMeta: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: 'transparent' },
  txnCategory: { fontSize: 13 },
  dot: { fontSize: 13 },
  amountWrap: { alignItems: 'flex-end', gap: 3, backgroundColor: 'transparent' },
  txnAmount: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  reviewTag: { fontSize: 12, fontWeight: '600' },
  chevron: { fontSize: 26, fontWeight: '300', marginLeft: -4 },
  sheetHead: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, backgroundColor: 'transparent' },
  sheetHandle: { width: 36, height: 5, borderRadius: 999, alignSelf: 'flex-start', marginTop: 7 },
  closeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  closeIcon: { fontSize: 38, lineHeight: 40, fontWeight: '300' },
  closeSpacer: { width: 40, height: 40, backgroundColor: 'transparent' },
  sheetBody: { paddingHorizontal: 20, paddingBottom: 60, gap: 18 },
  detailHero: { alignItems: 'center', paddingVertical: 16, gap: 7 },
  detailAvatar: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  detailAvatarText: { fontSize: 29, fontWeight: '700' },
  detailName: { fontSize: 21, fontWeight: '700' },
  detailAmount: { fontSize: 42, lineHeight: 48, fontWeight: '700', letterSpacing: -1.4, fontVariant: ['tabular-nums'] },
  statusBadge: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5 },
  statusText: { fontSize: 13, fontWeight: '600' },
  detailCaption: { fontSize: 13 },
  detailCard: { paddingVertical: 2 },
  detailRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: 'transparent' },
  detailRowIcon: { width: 24, fontSize: 21, fontWeight: '600', textAlign: 'center' },
  detailLabel: { flex: 1, fontSize: 14, fontWeight: '500' },
  detailValue: { maxWidth: '45%', fontSize: 14, fontWeight: '600', textAlign: 'right' },
  alertReviewStack: { gap: 14 },
  signalCard: { padding: 14 },
  signalHead: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: 'transparent' },
  signalIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  signalIconText: { fontSize: 22, fontWeight: '800' },
  signalCopy: { flex: 1, gap: 4, backgroundColor: 'transparent' },
  signalTitle: { fontSize: 16, fontWeight: '700' },
  signalPreview: { fontSize: 12, lineHeight: 17 },
  detailBody: { fontSize: 14, lineHeight: 21 },
  signalAction: { fontSize: 14, fontWeight: '700' },
  reviewChargeButton: { minHeight: 58, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  reviewChargeLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  resolutionActions: { flexDirection: 'row', gap: 10 },
  resolutionButton: { flex: 1, minHeight: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  resolutionLabel: { fontSize: 14, fontWeight: '700' },
  legitButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  legitLabel: { fontSize: 15, fontWeight: '600' },
  resolutionError: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
