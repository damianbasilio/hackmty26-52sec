import type { Subscription, SubscriptionCadence, SubscriptionStatus } from '@contracts/types';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition, ReduceMotion } from 'react-native-reanimated';

import { MotionPressable } from '@/components/Motion';
import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';
import { daysFromToday, formatCents, formatLongDay } from '@/src/format';

const CADENCE_ES: Record<SubscriptionCadence, string> = {
  weekly: 'semanal',
  biweekly: 'quincenal',
  monthly: 'mensual',
  bimonthly: 'cada 2 meses',
  quarterly: 'trimestral',
  annual: 'anual',
};

const STATUS_ES: Record<SubscriptionStatus, string | null> = {
  active: null,
  price_increased: null,
  paused: 'En pausa',
  likely_cancelled: 'Parece cancelada',
  unused: 'Sin uso',
};

function nextChargeText(day: string): string {
  const days = daysFromToday(day);
  const when = formatLongDay(day);
  if (days === 0) return `Próximo cobro: hoy · ${when}`;
  if (days === 1) return `Próximo cobro: mañana · ${when}`;
  if (days > 1) return `Próximo cobro: ${when}`;
  return `Cobro esperado: ${when}`;
}

export function SubscriptionCard({
  subscription,
  expanded,
  isLast = false,
  onToggle,
}: {
  subscription: Subscription;
  expanded: boolean;
  isLast?: boolean;
  onToggle: () => void;
}) {
  const palette = usePalette();
  const statusLabel = STATUS_ES[subscription.status];
  const attention = subscription.price_increase_detected || subscription.status === 'unused';
  const initial = subscription.merchant_display_name.trim().charAt(0).toUpperCase();
  const subtitle = subscription.price_increase_detected && subscription.previous_amount_cents !== null
    ? `Antes ${formatCents(subscription.previous_amount_cents)}`
    : statusLabel ?? CADENCE_ES[subscription.cadence];

  return (
    <Animated.View
      layout={LinearTransition.duration(220).reduceMotion(ReduceMotion.System)}
      style={!isLast ? [styles.item, { borderBottomColor: palette.border }] : styles.item}>
      <MotionPressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        pressedScale={0.985}
        style={styles.row}>
        <View
          style={[
            styles.avatar,
            {
              backgroundColor: attention
                ? subscription.status === 'unused'
                  ? palette.warningSoft
                  : palette.dangerSoft
                : palette.accentSoft,
            },
          ]}>
          <Text
            style={[
              styles.avatarText,
              {
                color: attention
                  ? subscription.status === 'unused'
                    ? palette.warning
                    : palette.danger
                  : palette.accent,
              },
            ]}>
            {initial}
          </Text>
        </View>

        <View style={styles.identity}>
          <Text style={styles.merchant}>{subscription.merchant_display_name}</Text>
          <Text
            style={[
              styles.subtitle,
              {
                color: attention ? (subscription.status === 'unused' ? palette.warning : palette.muted) : palette.muted,
                textDecorationLine: subscription.price_increase_detected ? 'line-through' : 'none',
              },
            ]}>
            {subtitle}
          </Text>
        </View>

        <View style={styles.amountGroup}>
          <Text style={[styles.amount, subscription.price_increase_detected ? { color: palette.danger } : null]}>
            {formatCents(subscription.amount_cents)}
          </Text>
          <Text style={[styles.cadence, { color: palette.muted }]}>{CADENCE_ES[subscription.cadence]}</Text>
        </View>
        <Text style={[styles.chevron, { color: palette.muted }]}>{expanded ? '⌄' : '›'}</Text>
      </MotionPressable>

      {expanded && (
        <Animated.View
          entering={FadeInDown.duration(200).reduceMotion(ReduceMotion.System)}
          style={[styles.details, { backgroundColor: palette.surface }]}>
          <View style={styles.detailTop}>
            <Text style={[styles.nextCharge, { color: palette.ink }]}>{nextChargeText(subscription.next_charge_on)}</Text>
            <Text style={styles.annual}>{formatCents(subscription.annual_cost_cents)} al año</Text>
          </View>
          <Text style={[styles.explanation, { color: palette.muted }]}>{subscription.explanation}</Text>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  item: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: { minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 23, fontWeight: '600' },
  identity: { flex: 1, gap: 4 },
  merchant: { fontSize: 17, fontWeight: '700', letterSpacing: -0.28 },
  subtitle: { fontSize: 13 },
  amountGroup: { alignItems: 'flex-end', gap: 4 },
  amount: { fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cadence: { fontSize: 12 },
  chevron: { width: 12, fontSize: 25, fontWeight: '300', marginLeft: 1 },
  details: { marginHorizontal: 12, marginBottom: 12, borderRadius: 18, padding: 14, gap: 7 },
  detailTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  nextCharge: { flex: 1, fontSize: 12, fontWeight: '600' },
  annual: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  explanation: { fontSize: 12, lineHeight: 17 },
});
