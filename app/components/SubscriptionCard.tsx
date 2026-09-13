import type { Subscription, SubscriptionCadence, SubscriptionStatus } from '@contracts/types';
import { StyleSheet, View } from 'react-native';

import { MotionPressable } from '@/components/Motion';
import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';
import type { SubscriptionMark, SubscriptionUsage } from '@/components/subscriptionMarks';
import { Chevron, Collapsible } from '@/components/ui';
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
  mark = {},
  isLast = false,
  onToggle,
  onMarkUsage,
  onToggleCancel,
}: {
  subscription: Subscription;
  expanded: boolean;
  mark?: SubscriptionMark;
  isLast?: boolean;
  onToggle: () => void;
  onMarkUsage: (usage: SubscriptionUsage) => void;
  onToggleCancel: () => void;
}) {
  const palette = usePalette();
  const statusLabel = STATUS_ES[subscription.status];
  const notUsing = mark.usage === 'not_using';
  const attention = mark.cancelPending || notUsing || subscription.price_increase_detected || subscription.status === 'unused';
  const warningTone = !mark.cancelPending && (notUsing || subscription.status === 'unused');
  const initial = subscription.merchant_display_name.trim().charAt(0).toUpperCase();
  const subtitle = mark.cancelPending
    ? 'Por cancelar'
    : mark.usage === 'not_using'
      ? 'No la usas'
      : mark.usage === 'using'
        ? 'La usas'
        : subscription.price_increase_detected && subscription.previous_amount_cents !== null
          ? `Antes ${formatCents(subscription.previous_amount_cents)}`
          : statusLabel ?? CADENCE_ES[subscription.cadence];
  const strike = !mark.cancelPending && !mark.usage && subscription.price_increase_detected;

  return (
    <View style={!isLast ? [styles.item, { borderBottomColor: palette.border }] : null}>
      <MotionPressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        pressedScale={0.985}
        style={styles.row}>
        <View
          style={[
            styles.avatar,
            { backgroundColor: attention ? (warningTone ? palette.warningSoft : palette.dangerSoft) : palette.accentSoft },
          ]}>
          <Text
            style={[
              styles.avatarText,
              { color: attention ? (warningTone ? palette.warning : palette.danger) : palette.accent },
            ]}>
            {initial}
          </Text>
        </View>

        <View style={styles.identity}>
          <Text numberOfLines={1} style={styles.merchant}>{subscription.merchant_display_name}</Text>
          <Text
            numberOfLines={1}
            style={[
              styles.subtitle,
              {
                color: mark.cancelPending
                  ? palette.danger
                  : warningTone
                    ? palette.warning
                    : mark.usage === 'using'
                      ? palette.positive
                      : palette.muted,
                textDecorationLine: strike ? 'line-through' : 'none',
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
        <Chevron direction={expanded ? 'down' : 'right'} />
      </MotionPressable>

      <Collapsible open={expanded}>
        <View style={[styles.details, { backgroundColor: palette.surface }]}>
          <View style={styles.detailTop}>
            <Text style={[styles.nextCharge, { color: palette.ink }]}>{nextChargeText(subscription.next_charge_on)}</Text>
            <Text style={styles.annual}>{formatCents(subscription.annual_cost_cents)} al año</Text>
          </View>
          <Text style={[styles.explanation, { color: palette.muted }]}>{subscription.explanation}</Text>

          <View style={[styles.divider, { backgroundColor: palette.border }]} />
          <Text style={styles.question}>¿Todavía la usas?</Text>
          <View style={styles.usageRow}>
            <UsageButton
              label="La uso"
              selected={mark.usage === 'using'}
              color={palette.positive}
              background={palette.positiveSoft}
              onPress={() => onMarkUsage('using')}
            />
            <UsageButton
              label="Ya no la uso"
              selected={notUsing}
              color={palette.warning}
              background={palette.warningSoft}
              onPress={() => onMarkUsage('not_using')}
            />
          </View>

          {mark.cancelPending ? (
            <View style={[styles.cancelBox, { backgroundColor: palette.dangerSoft }]}>
              <Text style={[styles.cancelTitle, { color: palette.danger }]}>Pendiente de cancelar</Text>
              <Step number="1" text={`Entra a la app o al sitio de ${subscription.merchant_display_name} y cancela tu plan.`} />
              <Step number="2" text={`Hazlo antes del ${formatLongDay(subscription.next_charge_on)} para que no te cobren otra vez.`} />
              <Step number="3" text="Si el cobro deja de aparecer, la verás aquí como «Parece cancelada»." />
              <MotionPressable accessibilityRole="button" onPress={onToggleCancel} style={styles.linkButton}>
                <Text style={[styles.linkLabel, { color: palette.danger }]}>Ya no quiero cancelarla</Text>
              </MotionPressable>
            </View>
          ) : notUsing ? (
            <View style={[styles.cancelBox, { backgroundColor: palette.warningSoft }]}>
              <Text style={[styles.cancelCopy, { color: palette.ink }]}>
                Cancelarla te ahorraría {formatCents(subscription.annual_cost_cents)} al año.
              </Text>
              <MotionPressable
                accessibilityRole="button"
                onPress={onToggleCancel}
                style={[styles.cancelButton, { backgroundColor: palette.primary }]}>
                <Text style={[styles.cancelButtonLabel, { color: palette.onPrimary }]}>Recordarme cancelar</Text>
              </MotionPressable>
            </View>
          ) : null}
        </View>
      </Collapsible>
    </View>
  );
}

function UsageButton({
  label,
  selected,
  color,
  background,
  onPress,
}: {
  label: string;
  selected: boolean;
  color: string;
  background: string;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      pressedScale={0.96}
      style={[
        styles.usageButton,
        { backgroundColor: selected ? background : palette.surfaceAlt, borderColor: selected ? color : palette.border },
      ]}>
      <Text style={[styles.usageLabel, { color: selected ? color : palette.ink }]}>{label}</Text>
    </MotionPressable>
  );
}

function Step({ number, text }: { number: string; text: string }) {
  const palette = usePalette();
  return (
    <View style={styles.step}>
      <View style={[styles.stepNumber, { backgroundColor: palette.surface }]}>
        <Text style={[styles.stepNumberText, { color: palette.danger }]}>{number}</Text>
      </View>
      <Text style={[styles.stepText, { color: palette.ink }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  item: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: { minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 23, fontWeight: '600' },
  identity: { flex: 1, gap: 4 },
  merchant: { fontSize: 17, fontWeight: '700', letterSpacing: -0.28 },
  subtitle: { fontSize: 13, fontWeight: '600' },
  amountGroup: { alignItems: 'flex-end', gap: 4 },
  amount: { fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cadence: { fontSize: 12 },
  details: { marginHorizontal: 12, marginBottom: 12, borderRadius: 18, padding: 14, gap: 9 },
  detailTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  nextCharge: { flex: 1, fontSize: 12, fontWeight: '600' },
  annual: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  explanation: { fontSize: 12, lineHeight: 17 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  question: { fontSize: 14, fontWeight: '700' },
  usageRow: { flexDirection: 'row', gap: 8 },
  usageButton: { flex: 1, minHeight: 42, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  usageLabel: { fontSize: 14, fontWeight: '700' },
  cancelBox: { borderRadius: 14, padding: 12, gap: 9 },
  cancelTitle: { fontSize: 14, fontWeight: '800' },
  cancelCopy: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  cancelButton: { minHeight: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  cancelButtonLabel: { fontSize: 14, fontWeight: '700' },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  stepNumber: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { fontSize: 12, fontWeight: '800' },
  stepText: { flex: 1, fontSize: 12, lineHeight: 17 },
  linkButton: { minHeight: 34, alignItems: 'center', justifyContent: 'center' },
  linkLabel: { fontSize: 13, fontWeight: '700' },
});
