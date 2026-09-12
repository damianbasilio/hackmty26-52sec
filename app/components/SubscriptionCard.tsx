import type { Subscription, SubscriptionCadence, SubscriptionStatus } from '@contracts/types';
import { StyleSheet, View as RawView } from 'react-native';

import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { Text } from '@/components/Themed';
import { usePalette, type Palette } from '@/components/palette';
import { daysFromToday, formatCents, formatLongDay } from '@/src/format';

const CADENCE_ES: Record<SubscriptionCadence, string> = {
  weekly: 'cada semana',
  biweekly: 'cada quincena',
  monthly: 'cada mes',
  bimonthly: 'cada dos meses',
  quarterly: 'cada tres meses',
  annual: 'cada año',
};

const STATUS_ES: Record<SubscriptionStatus, string | null> = {
  active: null,
  price_increased: null, // the price badge already says it, louder
  paused: 'En pausa',
  likely_cancelled: 'Parece cancelada',
  unused: 'No la usas',
};

function nextChargeText(day: string): string {
  const days = daysFromToday(day);
  const when = formatLongDay(day);
  if (days === 0) return `Se cobra hoy, ${when}`;
  if (days === 1) return `Se cobra mañana, ${when}`;
  if (days > 1) return `Se cobra el ${when}, en ${days} días`;
  if (days === -1) return `Se esperaba ayer, ${when}`;
  return `Se esperaba el ${when}, hace ${Math.abs(days)} días`;
}

function accentFor(sub: Subscription, palette: Palette): string | undefined {
  if (sub.price_increase_detected) return palette.danger;
  if (sub.status === 'unused') return palette.warning;
  return undefined;
}

export function SubscriptionCard({ subscription }: { subscription: Subscription }) {
  const palette = usePalette();
  const statusLabel = STATUS_ES[subscription.status];
  const delta = subscription.price_delta_cents;

  return (
    <Card accent={accentFor(subscription, palette)}>
      <RawView style={styles.header}>
        <Text style={styles.merchant}>{subscription.merchant_display_name}</Text>
        <Text style={styles.amount}>{formatCents(subscription.amount_cents)}</Text>
      </RawView>

      <Text style={[styles.cadence, { color: palette.muted }]}>
        {CADENCE_ES[subscription.cadence]} · {formatCents(subscription.annual_cost_cents)} al año
      </Text>

      {(subscription.price_increase_detected || statusLabel) && (
        <RawView style={styles.badges}>
          {subscription.price_increase_detected && delta !== null && (
            <Badge
              label={delta >= 0 ? `Subió ${formatCents(delta)}` : `Bajó ${formatCents(-delta)}`}
              color={delta >= 0 ? palette.danger : palette.positive}
              background={delta >= 0 ? palette.dangerSoft : palette.positiveSoft}
            />
          )}
          {statusLabel && (
            <Badge label={statusLabel} color={palette.warning} background={palette.warningSoft} />
          )}
        </RawView>
      )}

      {subscription.price_increase_detected && subscription.previous_amount_cents !== null && (
        <RawView style={[styles.priceRow, { backgroundColor: palette.surfaceAlt }]}>
          <Text style={[styles.oldPrice, { color: palette.muted }]}>
            {formatCents(subscription.previous_amount_cents)}
          </Text>
          <Text style={[styles.arrow, { color: palette.muted }]}>→</Text>
          <Text style={[styles.newPrice, { color: palette.danger }]}>
            {formatCents(subscription.amount_cents)}
          </Text>
        </RawView>
      )}

      <Text style={[styles.nextCharge, { color: palette.muted }]}>
        {nextChargeText(subscription.next_charge_on)}
      </Text>

      <Text style={styles.explanation}>{subscription.explanation}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  merchant: { fontSize: 18, fontWeight: '700', flexShrink: 1 },
  amount: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cadence: { fontSize: 13 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  oldPrice: { fontSize: 15, textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] },
  arrow: { fontSize: 15 },
  newPrice: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  nextCharge: { fontSize: 13 },
  explanation: { fontSize: 13, lineHeight: 19, opacity: 0.85 },
});
