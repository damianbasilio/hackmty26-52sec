import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View as Box } from 'react-native';
import Animated, { LinearTransition, ReduceMotion } from 'react-native-reanimated';

import type { AnomalyAlert, AnomalySeverity, EnrichedTransaction } from '@contracts/types';

import { useAuth } from '@/components/AuthProvider';
import { BrandLogo } from '@/components/BrandLogo';
import { Card } from '@/components/Card';
import { HeroCard } from '@/components/HeroCard';
import { MotionPressable, Reveal } from '@/components/Motion';
import { OptionSheet } from '@/components/OptionSheet';
import { PremiumSurface } from '@/components/PremiumSurface';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { Text } from '@/components/Themed';
import { localMonthKey } from '@/components/display';
import { usePalette, type Palette } from '@/components/palette';
import { Chevron, SectionTitle } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { dataSource } from '@/src/data';
import { formatCents, formatMonthName, formatShortDate } from '@/src/format';

const SEVERITY_LABELS: Record<AnomalySeverity, string> = {
  info: 'Aviso',
  warning: 'Atención',
  critical: 'Urgente',
};

type Resolution = NonNullable<AnomalyAlert['resolution']>;

const MORE_OPTIONS = [
  { key: '/clave-dinamica', label: 'Clave dinámica', detail: 'Tu código para operar' },
  { key: '/mi-dinero', label: 'Mi dinero', detail: 'Cuánto puedes gastar y tu saldo en 30 días' },
  { key: '/escudo', label: 'Escudo', detail: 'Protección contra fraudes en tu cuenta' },
];

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
  const { lock, firstName } = useAuth();
  const [resolvedIds, setResolvedIds] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);

  const { data, error, loading, reload } = useAsync(async () => {
    const accounts = await dataSource.getAccounts();
    const checking = accounts.find((account) => account.type === 'checking') ?? accounts[0];
    if (!checking) throw new Error('No hay cuentas disponibles.');
    const savings = accounts.filter((account) => account.type === 'savings');
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

  const { checking, customer, transactions, alerts } = data;
  const openAlerts = alerts.filter((alert) => !resolvedIds.includes(alert.id));
  const featuredAlert = openAlerts[0] ?? null;
  const remainingAlerts = openAlerts.slice(1);
  // El DataSource ya descuenta las transferencias; restarlas aquí las cobraba dos veces.
  const availableBalanceCents = checking.balance_cents;
  const recentTransactions = transactions.slice(0, 3);

  // `at` cambia en cada toque: la pestaña sigue montada y sin él no vería los mismos filtros dos veces.
  function openMovements(params: Record<string, string>) {
    router.push({ pathname: '/movimientos', params: { ...params, at: String(Date.now()) } } as never);
  }

  return (
    <PremiumSurface>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} tintColor={palette.accent} />
        }>
        <Reveal delay={20} style={styles.brandRow}>
          <BrandLogo />
          <MotionPressable accessibilityLabel="Bloquear sesión" onPress={lock} style={styles.avatar}>
            <Text style={[styles.avatarText, { color: palette.muted }]}>DP</Text>
          </MotionPressable>
        </Reveal>

        <Reveal delay={60}>
          <Text style={[styles.hello, { color: palette.muted }]}>Hola,</Text>
          <Text style={styles.name}>{firstName ?? customer.first_name}</Text>
          <Text style={[styles.welcome, { color: palette.muted }]}>Qué bueno tenerte de vuelta.</Text>
        </Reveal>

        <Reveal delay={95}>
          <HeroCard style={styles.balanceCard}>
            <Box style={styles.heroTop}>
              <Text style={[styles.heroLabel, { color: palette.muted }]}>Saldo disponible</Text>
              <Text numberOfLines={1} style={styles.heroAmount}>
                {formatCents(availableBalanceCents)}
              </Text>
            </Box>
            <Box style={styles.balanceFooter}>
              <Text numberOfLines={1} style={[styles.accountLabel, { color: palette.muted }]}>
                Cuenta ·· {checking.last_four}
              </Text>
              <MotionPressable
                accessibilityHint="Muestra tu CLABE y datos para recibir transferencias"
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/datos-cuenta', params: { accountId: checking.id } } as never)}
                style={[styles.eyeButton, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
                <SymbolView name={{ ios: 'eye.fill', android: 'visibility', web: 'visibility' }} tintColor={palette.muted} size={21} />
              </MotionPressable>
            </Box>
          </HeroCard>
        </Reveal>

        <Reveal delay={130} style={styles.moneyActions}>
          <MoneyAction
            label="Transferir"
            symbol={{ ios: 'arrow.up.right', android: 'north_east', web: 'north_east' }}
            tint={palette.accent}
            tone={palette.dangerSoft}
            onPress={() => router.push('/transferencias' as never)}
          />
          <MoneyAction
            label="Dividir"
            symbol={{ ios: 'person.2.fill', android: 'groups', web: 'groups' }}
            tint="#6F91FF"
            tone="rgba(82,113,218,0.16)"
            onPress={() => router.push('/dividir-gasto' as never)}
          />
          <MoneyAction
            label="Recibir"
            symbol={{ ios: 'arrow.down', android: 'south', web: 'south' }}
            tint={palette.positive}
            tone={palette.positiveSoft}
            onPress={() => router.push({ pathname: '/datos-cuenta', params: { accountId: checking.id } } as never)}
          />
          <MoneyAction
            label="Más"
            symbol={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }}
            tint={palette.muted}
            tone={palette.surfaceAlt}
            onPress={() => setMoreOpen(true)}
          />
        </Reveal>

        <Reveal delay={165} style={styles.section}>
          <SectionTitle
            action={
              <MotionPressable accessibilityRole="link" hitSlop={8} onPress={() => openMovements({})}>
                <Box style={styles.sectionAction}>
                  <Text style={[styles.link, { color: palette.muted }]}>Ver todas</Text>
                  <Chevron size={11} />
                </Box>
              </MotionPressable>
            }>
            Transacciones recientes
          </SectionTitle>
          <Card style={styles.transactionsCard}>
            {recentTransactions.map((transaction, index) => {
              const name = transaction.merchant_display_name ?? transaction.raw_description;
              const isTransfer = /transfer/i.test(name);
              return (
                <MotionPressable
                  key={transaction.id}
                  accessibilityHint={`Ver los movimientos de ${name}`}
                  accessibilityRole="button"
                  onPress={() => openMovements({ q: name })}
                  pressedScale={0.985}
                  style={[
                    styles.transactionRow,
                    index < recentTransactions.length - 1
                      ? { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth }
                      : null,
                  ]}>
                  <Box style={[styles.transactionIcon, { backgroundColor: isTransfer ? palette.surfaceAlt : palette.surfaceBlush }]}>
                    {isTransfer ? (
                      <SymbolView name={{ ios: 'paperplane.fill', android: 'send', web: 'send' }} tintColor="#D7E0EC" size={19} />
                    ) : (
                      <Text style={[styles.transactionInitial, { color: name === 'Netflix' ? palette.accent : palette.warning }]}>
                        {name.slice(0, 1).toUpperCase()}
                      </Text>
                    )}
                  </Box>
                  <Box style={styles.transactionCopy}>
                    <Text numberOfLines={1} style={styles.transactionName}>{name}</Text>
                    <Text style={[styles.transactionDate, { color: palette.muted }]}>{formatShortDate(transaction.occurred_at)}</Text>
                  </Box>
                  <Text style={styles.transactionAmount}>{formatCents(transaction.amount_cents)}</Text>
                </MotionPressable>
              );
            })}
          </Card>
        </Reveal>

        {alerts.length > 0 ? (
          <Reveal delay={165} style={styles.section}>
            <Card style={styles.alertShell}>
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
          <MotionPressable
            accessibilityHint="Abre tus gastos del mes en movimientos"
            accessibilityRole="button"
            onPress={() => openMovements({ filter: 'expenses', month: month.key })}>
            <Card style={styles.monthCard}>
              <Box style={[styles.monthIcon, { backgroundColor: palette.surfaceSage }]}>
                <SymbolView name={{ ios: 'creditcard.fill', android: 'credit_card', web: 'credit_card' }} tintColor={palette.muted} size={18} />
              </Box>
              <Box style={styles.monthCopy}>
                <Text style={styles.monthLabel}>Gastos de {formatMonthName(month.key)}</Text>
                <Text style={[styles.monthMeta, { color: palette.muted }]}>
                  {month.count} {month.count === 1 ? 'movimiento' : 'movimientos'}
                </Text>
              </Box>
              <Text style={styles.monthAmount}>{formatCents(month.spent)}</Text>
              <Chevron />
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
              <MotionPressable
                accessibilityRole="link"
                hitSlop={8}
                onPress={() => openMovements({ filter: 'expenses', month: month.key })}>
                <Text style={[styles.link, { color: palette.accent }]}>Ver todos</Text>
              </MotionPressable>
            }>
            Donde más gastas
          </SectionTitle>
          <Card style={styles.merchantCard}>
            {month.topMerchants.length === 0 ? (
              <Text style={[styles.alertBody, { color: palette.muted }]}>Todavía no hay compras este mes.</Text>
            ) : (
              month.topMerchants.map((merchant) => (
                <MotionPressable
                  key={merchant.name}
                  accessibilityHint={`Ver los movimientos de ${merchant.name}`}
                  accessibilityRole="button"
                  onPress={() => openMovements({ q: merchant.name, month: month.key })}
                  pressedScale={0.985}
                  style={styles.merchantRow}>
                  <Box style={styles.merchantHead}>
                    <Text numberOfLines={1} style={styles.merchantName}>{merchant.name}</Text>
                    <Text style={styles.merchantAmount}>{formatCents(merchant.spent)}</Text>
                    <Chevron size={12} />
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
                </MotionPressable>
              ))
            )}
          </Card>
        </Reveal>
      </ScrollView>

      <OptionSheet
        visible={moreOpen}
        title="Más"
        options={MORE_OPTIONS}
        selectedKey={null}
        onSelect={(key) => {
          setMoreOpen(false);
          router.push(key as never);
        }}
        onClose={() => setMoreOpen(false)}
      />
    </PremiumSurface>
  );
}

function MoneyAction({
  label,
  onPress,
  symbol,
  tint,
  tone,
}: {
  label: string;
  onPress: () => void;
  symbol: React.ComponentProps<typeof SymbolView>['name'];
  tint: string;
  tone: string;
}) {
  const palette = usePalette();
  return (
    <MotionPressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.moneyAction, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Box style={[styles.moneyActionIcon, { backgroundColor: tone }]}>
        <SymbolView name={symbol} tintColor={tint} size={24} />
      </Box>
      <Text numberOfLines={1} style={styles.moneyActionTitle}>{label}</Text>
    </MotionPressable>
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
  content: { paddingHorizontal: 20, paddingTop: 18, gap: 24, paddingBottom: 150 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#12171D', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.13)' },
  avatarText: { fontSize: 16, fontWeight: '600' },
  hello: { fontSize: 17, lineHeight: 22 },
  name: { fontSize: 38, lineHeight: 42, fontWeight: '700', letterSpacing: -1.2 },
  welcome: { marginTop: 4, fontSize: 16, lineHeight: 22 },
  balanceCard: { minHeight: 220 },
  heroTop: { backgroundColor: 'transparent', gap: 6 },
  heroLabel: { fontSize: 16, fontWeight: '500' },
  heroAmount: { color: '#FFFFFF', fontSize: 46, lineHeight: 54, fontWeight: '700', letterSpacing: -1.7, fontVariant: ['tabular-nums'] },
  balanceFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'transparent' },
  accountLabel: { fontSize: 15, fontWeight: '500' },
  eyeButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  moneyActions: { flexDirection: 'row', gap: 8 },
  moneyAction: { flex: 1, minHeight: 108, borderRadius: 24, paddingVertical: 14, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', gap: 11, borderWidth: StyleSheet.hairlineWidth },
  moneyActionIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  moneyActionTitle: { fontSize: 13, fontWeight: '600' },
  section: { gap: 0 },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'transparent' },
  transactionsCard: { paddingVertical: 6, paddingHorizontal: 16, gap: 0 },
  transactionRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'transparent' },
  transactionIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  transactionInitial: { fontSize: 24, fontWeight: '800' },
  transactionCopy: { flex: 1, gap: 4, backgroundColor: 'transparent' },
  transactionName: { fontSize: 16, fontWeight: '600' },
  transactionDate: { fontSize: 13 },
  transactionAmount: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
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
  monthCopy: { flex: 1, gap: 3, backgroundColor: 'transparent' },
  monthLabel: { fontSize: 14, fontWeight: '600' },
  monthAmount: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2, fontVariant: ['tabular-nums'] },
  monthMeta: { fontSize: 11 },
  merchantCard: { gap: 5 },
  merchantRow: { gap: 7, paddingVertical: 8, backgroundColor: 'transparent' },
  merchantHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: 'transparent' },
  merchantName: { flex: 1, fontSize: 15, fontWeight: '600' },
  merchantAmount: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  barTrack: { height: 5, borderRadius: 999, overflow: 'hidden' },
  barFill: { height: 5, borderRadius: 999 },
});
