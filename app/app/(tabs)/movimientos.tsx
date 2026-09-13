import { SymbolView } from 'expo-symbols';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, RefreshControl, ScrollView, Share, StyleSheet, TextInput, View as Box } from 'react-native';
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
  localMonthKey,
  localTime,
  todayKey,
} from '@/components/display';
import { usePalette } from '@/components/palette';
import { TRANSACTION_TYPE_LABELS, transactionReceipt } from '@/components/receipt';
import { Chevron, Chip, Collapsible, EmptyState } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { dataSource } from '@/src/data';
import { formatCents, formatLongDay, formatMonthName } from '@/src/format';

type Filter = 'all' | 'expenses' | 'income';
/** `all`, `7d`, `30d` o un mes `YYYY-MM`. */
type Period = string;
type Resolution = NonNullable<AnomalyAlert['resolution']>;

const STATUS_LABELS: Record<TransactionStatus, string> = {
  pending: 'Pendiente',
  completed: 'Aplicado',
  cancelled: 'Cancelado',
};

const FILTERS: [Filter, string][] = [
  ['all', 'Todos'],
  ['expenses', 'Gastos'],
  ['income', 'Ingresos'],
];

// Sin String.normalize: Hermes no siempre trae ICU. Basta con las vocales del español.
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[áàä]/g, 'a')
    .replace(/[éèë]/g, 'e')
    .replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o')
    .replace(/[úùü]/g, 'u');
}

function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function inPeriod(transaction: EnrichedTransaction, period: Period, today: string): boolean {
  if (period === 'all') return true;
  const day = localDayKey(transaction.occurred_at);
  if (period === '7d') return day >= shiftDay(today, -6);
  if (period === '30d') return day >= shiftDay(today, -29);
  return day.startsWith(period);
}

function matchesQuery(transaction: EnrichedTransaction, query: string): boolean {
  if (!query) return true;
  const needle = fold(query.trim());
  return [
    transaction.merchant_display_name ?? '',
    transaction.raw_description,
    CATEGORY_LABELS[transaction.category],
    formatCents(Math.abs(transaction.amount_cents)),
  ].some((field) => fold(field).includes(needle));
}

export default function MovimientosScreen() {
  const palette = usePalette();
  const params = useLocalSearchParams<{ filter?: string; month?: string; q?: string; category?: string; at?: string }>();
  const [filter, setFilter] = useState<Filter>('all');
  const [period, setPeriod] = useState<Period>('all');
  const [category, setCategory] = useState<MerchantCategory | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Inicio y Salud abren esta pestaña ya filtrada; `at` cambia en cada toque.
  useEffect(() => {
    if (!params.at) return;
    setFilter(params.filter === 'expenses' || params.filter === 'income' ? params.filter : 'all');
    setPeriod(params.month || 'all');
    setQuery(params.q ?? '');
    setCategory(params.category && params.category in CATEGORY_LABELS ? (params.category as MerchantCategory) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.at]);

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

  const transactions = useMemo(() => data?.transactions ?? [], [data?.transactions]);
  const selected = transactions.find((transaction) => transaction.id === selectedId) ?? null;

  const categories = useMemo(() => {
    const counts = new Map<MerchantCategory, number>();
    for (const transaction of transactions) {
      counts.set(transaction.category, (counts.get(transaction.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
  }, [transactions]);

  const months = useMemo(
    () => [...new Set(transactions.map((transaction) => localMonthKey(transaction.occurred_at)))].sort().reverse(),
    [transactions],
  );

  const visible = useMemo(() => {
    const today = todayKey();
    return transactions.filter((transaction) => {
      if (filter === 'expenses' && transaction.amount_cents >= 0) return false;
      if (filter === 'income' && transaction.amount_cents <= 0) return false;
      if (category && transaction.category !== category) return false;
      return inPeriod(transaction, period, today) && matchesQuery(transaction, query);
    });
  }, [category, filter, period, query, transactions]);

  const groups = useMemo(() => {
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
  }, [visible]);

  if (loading && !data) return <LoadingState label="Cargando movimientos…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const hasFilters = filter !== 'all' || period !== 'all' || category !== null || query.trim().length > 0;
  const visibleTotal = visible.reduce((sum, transaction) => sum + transaction.amount_cents, 0);

  function clearFilters() {
    setFilter('all');
    setPeriod('all');
    setCategory(null);
    setQuery('');
  }

  const periods: [Period, string][] = [
    ['all', 'Todo'],
    ['7d', 'Últimos 7 días'],
    ['30d', 'Últimos 30 días'],
    ...months.map((month): [Period, string] => [month, capitalize(formatMonthName(month))]),
  ];

  return (
    <PremiumSurface>
      <FlatList
        data={groups}
        keyExtractor={(group) => group.key}
        contentContainerStyle={groups.length ? styles.list : styles.listEmpty}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={palette.accent} />}
        ListHeaderComponent={
          <Box style={styles.header}>
            <Reveal delay={20}>
              <Text style={styles.title}>Movimientos</Text>
            </Reveal>

            <Reveal delay={50}>
              <Box style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} tintColor={palette.muted} size={18} />
                <TextInput
                  accessibilityLabel="Buscar movimientos"
                  autoCorrect={false}
                  onChangeText={setQuery}
                  placeholder="Buscar comercio, categoría o monto"
                  placeholderTextColor={palette.muted}
                  returnKeyType="search"
                  style={[styles.searchInput, { color: palette.ink }]}
                  value={query}
                />
                {query ? (
                  <MotionPressable accessibilityLabel="Borrar búsqueda" hitSlop={8} onPress={() => setQuery('')} style={styles.searchClear}>
                    <SymbolView name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }} tintColor={palette.muted} size={18} />
                  </MotionPressable>
                ) : null}
              </Box>
            </Reveal>

            <Reveal delay={80}>
              <Box style={[styles.segmented, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                {FILTERS.map(([value, label]) => {
                  const active = filter === value;
                  return (
                    <MotionPressable
                      key={value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => setFilter(value)}
                      style={[styles.segment, active ? { backgroundColor: palette.primary } : null]}>
                      <Text style={[styles.segmentLabel, { color: active ? palette.onPrimary : palette.ink }]}>{label}</Text>
                    </MotionPressable>
                  );
                })}
              </Box>
            </Reveal>

            <Reveal delay={110} style={styles.filterGroup}>
              <Text style={[styles.filterLabel, { color: palette.muted }]}>Fecha</Text>
              <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
                {periods.map(([value, label]) => (
                  <Chip key={value} label={label} selected={period === value} onPress={() => setPeriod(value)} />
                ))}
              </ScrollView>
            </Reveal>

            {categories.length > 0 ? (
              <Reveal delay={140} style={styles.filterGroup}>
                <Text style={[styles.filterLabel, { color: palette.muted }]}>Categoría</Text>
                <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
                  <Chip label="Todas" selected={category === null} onPress={() => setCategory(null)} />
                  {categories.map((key) => (
                    <Chip
                      key={key}
                      label={CATEGORY_LABELS[key]}
                      selected={category === key}
                      onPress={() => setCategory((current) => (current === key ? null : key))}
                    />
                  ))}
                </ScrollView>
              </Reveal>
            ) : null}

            <Box style={styles.summaryRow}>
              <Text style={[styles.summaryText, { color: palette.muted }]}>
                {visible.length} {visible.length === 1 ? 'movimiento' : 'movimientos'} · {formatSignedCents(visibleTotal)}
              </Text>
              {hasFilters ? (
                <MotionPressable accessibilityRole="button" hitSlop={8} onPress={clearFilters}>
                  <Text style={[styles.clearLabel, { color: palette.accent }]}>Limpiar filtros</Text>
                </MotionPressable>
              ) : null}
            </Box>
          </Box>
        }
        ListEmptyComponent={
          <EmptyState
            title="Sin movimientos aquí"
            hint={hasFilters ? 'Prueba con otra fecha, categoría o búsqueda.' : 'Cuando llegue el primer movimiento lo verás aquí.'}
          />
        }
        renderItem={({ item, index }) => (
          <Reveal delay={Math.min(60 + index * 35, 220)} style={styles.groupWrap}>
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
      accessibilityHint="Abre el detalle del movimiento"
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.txnRow,
        !first ? { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth } : null,
      ]}>
      <Box style={[styles.avatar, { backgroundColor: incoming ? palette.positiveSoft : palette.surface }]}>
        <Text style={[styles.avatarText, { color: incoming ? palette.positive : palette.accent }]}>{name.charAt(0).toUpperCase()}</Text>
      </Box>
      <Box style={styles.txnMain}>
        <Text numberOfLines={1} style={styles.txnName}>{name}</Text>
        <Box style={styles.txnMeta}>
          <Text style={[styles.txnCategory, { color: palette.muted }]}>{CATEGORY_LABELS[txn.category]}</Text>
          {txn.is_recurring ? <Text style={[styles.dot, { color: palette.muted }]}> · recurrente</Text> : null}
          {txn.status === 'pending' ? <Text style={[styles.dot, { color: palette.warning }]}> · pendiente</Text> : null}
        </Box>
      </Box>
      <Box style={styles.amountWrap}>
        <Text style={[styles.txnAmount, incoming ? { color: palette.positive } : null]}>{formatSignedCents(txn.amount_cents)}</Text>
        {txn.anomaly_alert_id ? <Text style={[styles.reviewTag, { color: palette.danger }]}>Revisar</Text> : null}
      </Box>
      <Chevron />
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
  const [bankOpen, setBankOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [resolving, setResolving] = useState<Resolution | null>(null);
  const [resolved, setResolved] = useState<Resolution | null>(alert?.resolution ?? null);
  const [resolutionError, setResolutionError] = useState(false);
  const statusTone = txn.status === 'completed'
    ? { background: palette.positiveSoft, color: palette.positive }
    : txn.status === 'pending'
      ? { background: palette.warningSoft, color: palette.warning }
      : { background: palette.dangerSoft, color: palette.danger };
  const when = `${formatLongDay(localDayKey(txn.occurred_at), true)} · ${localTime(txn.occurred_at)} h`;

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

  function shareReceipt() {
    Share.share({ title: 'Comprobante', message: transactionReceipt(txn, account) }).catch(() => undefined);
  }

  return (
    <PremiumSurface>
      <Box style={styles.sheetHead}>
        <MotionPressable accessibilityLabel="Cerrar detalle" accessibilityRole="button" hitSlop={10} onPress={onClose} pressedScale={0.94} style={styles.closeButton}>
          <SymbolView name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} tintColor={palette.ink} size={20} />
        </MotionPressable>
        <Box style={[styles.sheetHandle, { backgroundColor: palette.border }]} />
        <MotionPressable accessibilityLabel="Compartir comprobante" accessibilityRole="button" hitSlop={10} onPress={shareReceipt} pressedScale={0.94} style={styles.closeButton}>
          <SymbolView name={{ ios: 'square.and.arrow.up', android: 'share', web: 'share' }} tintColor={palette.ink} size={19} />
        </MotionPressable>
      </Box>

      <ScrollView contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
        <Reveal delay={20} style={styles.detailHero}>
          <Box style={[styles.detailAvatar, { backgroundColor: alert ? palette.dangerSoft : palette.accentSoft }]}>
            <Text style={[styles.detailAvatarText, { color: alert ? palette.danger : palette.accent }]}>{name.charAt(0).toUpperCase()}</Text>
          </Box>
          <Text numberOfLines={2} style={styles.detailName}>{name}</Text>
          <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.detailAmount, txn.amount_cents > 0 ? { color: palette.positive } : null]}>{formatSignedCents(txn.amount_cents)}</Text>
          <Box style={[styles.statusBadge, { backgroundColor: statusTone.background }]}>
            <Text style={[styles.statusText, { color: statusTone.color }]}>{STATUS_LABELS[txn.status]}</Text>
          </Box>
          <Text style={[styles.detailCaption, { color: palette.muted }]}>{when}</Text>
        </Reveal>

        <Reveal delay={80}>
          <Card tone="sage" style={styles.detailCard}>
            <DetailRow
              icon={{ ios: 'tag.fill', android: 'sell', web: 'sell' }}
              label="Categoría"
              value={CATEGORY_LABELS[txn.category]}
            />
            <DetailRow
              icon={{ ios: 'creditcard.fill', android: 'credit_card', web: 'credit_card' }}
              label="Cuenta"
              value={`·· ${account.last_four}`}
            />
            <MotionPressable
              accessibilityRole="button"
              accessibilityState={{ expanded: bankOpen }}
              onPress={() => setBankOpen((current) => !current)}
              pressedScale={0.985}
              style={[styles.detailRow, bankOpen ? { borderBottomColor: palette.border } : styles.detailRowLast]}>
              <SymbolView name={{ ios: 'building.columns.fill', android: 'account_balance', web: 'account_balance' }} tintColor={palette.accent} size={18} />
              <Text style={styles.detailLabel}>Detalles bancarios</Text>
              <Chevron direction={bankOpen ? 'down' : 'right'} />
            </MotionPressable>
            <Collapsible open={bankOpen}>
              <Box style={styles.bankDetails}>
                <BankRow label="Tipo" value={TRANSACTION_TYPE_LABELS[txn.type]} />
                <BankRow label="Estado" value={STATUS_LABELS[txn.status]} />
                <BankRow label="Fecha y hora" value={when} />
                <BankRow label="Descripción del banco" value={txn.raw_description} />
                <BankRow label="Cuenta" value={`${account.nickname} ·· ${account.last_four}`} />
                <BankRow label="Moneda" value="MXN · peso mexicano" />
                <BankRow label="Referencia bancaria" value={txn.nessie_transaction_id ?? 'Sin referencia'} />
                <BankRow label="Folio" value={txn.id} />
              </Box>
            </Collapsible>
          </Card>
        </Reveal>

        <Reveal delay={110}>
          <MotionPressable
            accessibilityRole="button"
            onPress={shareReceipt}
            style={[styles.shareButton, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <SymbolView name={{ ios: 'square.and.arrow.up', android: 'share', web: 'share' }} tintColor={palette.accent} size={18} />
            <Text style={[styles.shareLabel, { color: palette.accent }]}>Compartir comprobante</Text>
          </MotionPressable>
        </Reveal>

        {alert && !resolved ? (
          <Reveal delay={140} style={styles.alertReviewStack}>
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
                    {reviewOpen ? alert.explanation : compactAlertCopy(alert)}
                  </Text>
                </Box>
              </Box>
            </Card>

            <MotionPressable
              accessibilityRole="button"
              accessibilityState={{ expanded: reviewOpen }}
              onPress={() => setReviewOpen((current) => !current)}
              pressedScale={0.975}
              style={[styles.reviewChargeButton, { backgroundColor: palette.primary }]}>
              <Text style={[styles.reviewChargeLabel, { color: palette.onPrimary }]}>
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
          <Reveal delay={140}>
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

function DetailRow({ icon, label, value }: { icon: { ios: string; android: string; web: string }; label: string; value: string }) {
  const palette = usePalette();
  return (
    <Box style={[styles.detailRow, { borderBottomColor: palette.border }]}>
      <SymbolView name={icon as never} tintColor={palette.accent} size={18} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.detailValue}>{value}</Text>
    </Box>
  );
}

function BankRow({ label, value }: { label: string; value: string }) {
  const palette = usePalette();
  return (
    <Box style={styles.bankRow}>
      <Text style={[styles.bankLabel, { color: palette.muted }]}>{label}</Text>
      <Text selectable style={styles.bankValue}>{value}</Text>
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
  header: { gap: 14, marginBottom: 22, backgroundColor: 'transparent' },
  title: { fontSize: 36, lineHeight: 41, fontWeight: '700', letterSpacing: -1.1 },
  search: { minHeight: 50, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, paddingLeft: 14, flexDirection: 'row', alignItems: 'center', gap: 9 },
  searchInput: { flex: 1, minHeight: 48, fontSize: 15 },
  searchClear: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  segmented: { height: 54, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 5, flexDirection: 'row', gap: 3 },
  segment: { flex: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  segmentLabel: { fontSize: 15, fontWeight: '600' },
  filterGroup: { gap: 7 },
  filterLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  filters: { gap: 8, paddingRight: 20 },
  summaryRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  summaryText: { flex: 1, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  clearLabel: { fontSize: 13, fontWeight: '700' },
  groupWrap: { marginBottom: 22 },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: 'transparent' },
  dayHeading: { fontSize: 15, fontWeight: '600' },
  dayTotal: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  dayCard: { paddingVertical: 0, paddingHorizontal: 0, gap: 0, overflow: 'hidden' },
  txnRow: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 16, paddingRight: 12 },
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
  sheetHead: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, backgroundColor: 'transparent' },
  sheetHandle: { width: 36, height: 5, borderRadius: 999, alignSelf: 'flex-start', marginTop: 7 },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sheetBody: { paddingHorizontal: 20, paddingBottom: 60, gap: 18 },
  detailHero: { alignItems: 'center', paddingVertical: 16, gap: 7 },
  detailAvatar: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  detailAvatarText: { fontSize: 29, fontWeight: '700' },
  detailName: { fontSize: 21, fontWeight: '700', textAlign: 'center' },
  detailAmount: { fontSize: 42, lineHeight: 48, fontWeight: '700', letterSpacing: -1.4, fontVariant: ['tabular-nums'] },
  statusBadge: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5 },
  statusText: { fontSize: 13, fontWeight: '600' },
  detailCaption: { fontSize: 13 },
  detailCard: { paddingVertical: 2, gap: 0 },
  detailRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: 'transparent' },
  detailRowLast: { borderBottomWidth: 0 },
  detailLabel: { flex: 1, fontSize: 14, fontWeight: '500' },
  detailValue: { maxWidth: '50%', fontSize: 14, fontWeight: '600', textAlign: 'right' },
  bankDetails: { paddingTop: 6, paddingBottom: 12, gap: 12 },
  bankRow: { gap: 3 },
  bankLabel: { fontSize: 12, fontWeight: '600' },
  bankValue: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
  shareButton: { minHeight: 52, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  shareLabel: { fontSize: 15, fontWeight: '700' },
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
  reviewChargeLabel: { fontSize: 16, fontWeight: '600' },
  resolutionActions: { flexDirection: 'row', gap: 10 },
  resolutionButton: { flex: 1, minHeight: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  resolutionLabel: { fontSize: 14, fontWeight: '700' },
  legitButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  legitLabel: { fontSize: 15, fontWeight: '600' },
  resolutionError: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
