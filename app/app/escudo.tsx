import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';

import type {
  AnomalySeverity,
  ProtectionCase,
  ShieldAlert,
  ShieldEvent,
  ShieldStatus,
} from '@contracts/types';

import { Card } from '@/components/Card';
import { HeroCard } from '@/components/HeroCard';
import { MotionPressable, Reveal } from '@/components/Motion';
import { PremiumSurface } from '@/components/PremiumSurface';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { Text } from '@/components/Themed';
import { VerifySheet, type VerifyRequest } from '@/components/VerifySheet';
import { usePalette, type Palette } from '@/components/palette';
import { SectionTitle, Toast } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { dataSource } from '@/src/data';
import { formatCents, formatShortDate } from '@/src/format';

const STATUS_COPY: Record<ShieldStatus, { title: string; text: string }> = {
  normal: { title: 'Tu cuenta está protegida', text: 'Revisamos cada movimiento y te avisamos si algo no se parece a ti.' },
  attention: { title: 'Hay algo que revisar', text: 'Confírmanos si reconoces lo que marcamos.' },
  protecting: { title: 'Protección activa', text: 'Tu tarjeta está bloqueada mientras confirmas qué pasó.' },
};

const SEVERITY_LABELS: Record<AnomalySeverity, string> = {
  info: 'Aviso',
  warning: 'Atención',
  critical: 'Urgente',
};

const GOOD_EVENTS = new Set<ShieldEvent['kind']>(['verified', 'card_unlocked']);

function statusTone(palette: Palette, status: ShieldStatus) {
  if (status === 'protecting') return { background: palette.dangerSoft, color: palette.danger };
  if (status === 'attention') return { background: palette.warningSoft, color: palette.warning };
  return { background: palette.positiveSoft, color: palette.positive };
}

function severityTone(palette: Palette, severity: AnomalySeverity) {
  if (severity === 'critical') return { background: palette.dangerSoft, color: palette.danger };
  if (severity === 'warning') return { background: palette.warningSoft, color: palette.warning };
  return { background: palette.accentSoft, color: palette.accent };
}

export default function EscudoScreen() {
  const palette = usePalette();
  const router = useRouter();
  const [verify, setVerify] = useState<VerifyRequest | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'danger' | 'positive' } | null>(null);
  const [busy, setBusy] = useState(false);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const closeVerify = useCallback(() => setVerify(null), []);

  const { data, error, loading, reload } = useAsync(async () => {
    // El Escudo sincroniza los movimientos antes de responder: las alertas salen de esa misma pasada.
    const shield = await dataSource.getShield();
    const alerts = await dataSource.getShieldAlerts();
    return { shield, alerts };
  });

  if (loading && !data) return <LoadingState label="Revisando tu cuenta…" />;
  if (error || !data) return <ErrorState message={error ?? 'Sin datos.'} onRetry={reload} />;

  const { shield, alerts } = data;
  const tone = statusTone(palette, shield.status);

  async function act(work: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await work();
      setNotice({ text: success, tone: 'positive' });
      reload();
    } catch (cause) {
      setNotice({ text: cause instanceof Error ? cause.message : 'No pudimos completar la acción.', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  function confirmLegit(alert: ShieldAlert) {
    setVerify({
      title: 'Confirma que fuiste tú',
      reason: `Marcaremos «${alert.title}» como legítimo y desbloquearemos lo que detuvimos.`,
      purpose: 'confirm_legit',
      target: alert.id,
      run: async (verification) => {
        await dataSource.resolveShieldAlert(alert.id, 'confirmed_legit', verification);
        setNotice({ text: 'Listo: marcamos la alerta como tuya.', tone: 'positive' });
        reload();
      },
    });
  }

  function reportFraud(alert: ShieldAlert) {
    act(() => dataSource.resolveShieldAlert(alert.id, 'confirmed_fraud'), 'Bloqueamos tu tarjeta y abrimos una aclaración.');
  }

  function unlockCard() {
    setVerify({
      title: 'Desbloquear tu tarjeta',
      reason: 'Hacer tu cuenta menos segura siempre pide tu PIN.',
      purpose: 'release_protection',
      target: 'shield',
      run: async (verification) => {
        await dataSource.releaseShield(verification);
        setNotice({ text: 'Tu tarjeta vuelve a funcionar.', tone: 'positive' });
        reload();
      },
    });
  }

  function toggleAutoProtect(enabled: boolean) {
    if (enabled) {
      act(() => dataSource.setAutoProtect(true), 'Protección automática activada.');
      return;
    }
    setVerify({
      title: 'Apagar la protección automática',
      reason: 'Si la apagas, no bloquearemos tu tarjeta aunque veamos riesgo alto.',
      purpose: 'change_settings',
      target: 'settings',
      run: async (verification) => {
        await dataSource.setAutoProtect(false, verification);
        setNotice({ text: 'Protección automática apagada.', tone: 'positive' });
        reload();
      },
    });
  }

  return (
    <PremiumSurface>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={palette.accent} />}>
        <View style={styles.header}>
          <MotionPressable accessibilityLabel="Regresar" hitSlop={10} onPress={() => router.back()} style={styles.backButton}>
            <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} tintColor={palette.ink} size={20} />
          </MotionPressable>
          <Text style={styles.title}>Escudo</Text>
          <View style={styles.headerSpacer} />
        </View>

        <Reveal>
          <HeroCard style={styles.hero}>
            <View style={[styles.heroIcon, { backgroundColor: tone.background }]}>
              <SymbolView
                name={shield.status === 'normal'
                  ? { ios: 'checkmark.shield.fill', android: 'verified_user', web: 'verified_user' }
                  : { ios: 'exclamationmark.shield.fill', android: 'gpp_maybe', web: 'gpp_maybe' }}
                tintColor={tone.color}
                size={28}
              />
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>{STATUS_COPY[shield.status].title}</Text>
              <Text style={[styles.heroText, { color: palette.muted }]}>{STATUS_COPY[shield.status].text}</Text>
              {shield.open_alerts > 0 ? (
                <Text style={[styles.heroText, { color: tone.color }]}>
                  {shield.open_alerts === 1 ? '1 alerta abierta' : `${shield.open_alerts} alertas abiertas`}
                </Text>
              ) : null}
            </View>
          </HeroCard>
        </Reveal>

        {alerts.length > 0 ? (
          <Reveal delay={40} style={styles.section}>
            <SectionTitle>Para revisar</SectionTitle>
            <View style={styles.stack}>
              {alerts.map((alert) => (
                <ShieldAlertCard
                  key={alert.id}
                  alert={alert}
                  busy={busy}
                  onLegit={() => confirmLegit(alert)}
                  onFraud={() => reportFraud(alert)}
                  onDismiss={() => act(() => dataSource.resolveShieldAlert(alert.id, 'dismissed'), 'Ignoraste la alerta.')}
                />
              ))}
            </View>
          </Reveal>
        ) : null}

        <Reveal delay={70}>
          <Card style={styles.controlCard}>
            <View style={styles.controlRow}>
              <View style={styles.controlCopy}>
                <Text style={styles.controlTitle}>Tarjeta</Text>
                <Text style={[styles.controlText, { color: palette.muted }]}>
                  {shield.card_locked ? 'Bloqueada temporalmente. Solo tú la desbloqueas.' : 'Activa para compras y retiros.'}
                </Text>
              </View>
              <MotionPressable
                accessibilityRole="button"
                disabled={busy}
                onPress={shield.card_locked ? unlockCard : () => act(() => dataSource.lockCard(), 'Bloqueaste tu tarjeta.')}
                style={[
                  styles.controlButton,
                  { backgroundColor: shield.card_locked ? palette.surfaceAlt : palette.primary, opacity: busy ? 0.55 : 1 },
                ]}>
                <Text style={[styles.controlButtonLabel, { color: shield.card_locked ? palette.ink : palette.onPrimary }]}>
                  {shield.card_locked ? 'Desbloquear' : 'Bloquear'}
                </Text>
              </MotionPressable>
            </View>
            <View style={[styles.divider, { backgroundColor: palette.border }]} />
            <View style={styles.controlRow}>
              <View style={styles.controlCopy}>
                <Text style={styles.controlTitle}>Protección automática</Text>
                <Text style={[styles.controlText, { color: palette.muted }]}>
                  Si vemos riesgo alto, bloqueamos tu tarjeta al instante. Tú la liberas con tu PIN.
                </Text>
              </View>
              <Switch
                accessibilityLabel="Protección automática"
                disabled={busy}
                onValueChange={toggleAutoProtect}
                thumbColor="#FFFFFF"
                trackColor={{ false: palette.track, true: palette.positive }}
                value={shield.settings.auto_protect}
              />
            </View>
          </Card>
        </Reveal>

        {shield.cases.length > 0 ? (
          <Reveal delay={100} style={styles.section}>
            <SectionTitle>Tus aclaraciones</SectionTitle>
            <View style={styles.stack}>
              {shield.cases.map((item) => <CaseCard key={item.id} protectionCase={item} />)}
            </View>
          </Reveal>
        ) : null}

        {shield.blocked_clabes.length > 0 ? (
          <Reveal delay={120}>
            <Text style={[styles.footnote, { color: palette.muted }]}>
              CLABEs marcadas por fraude: {shield.blocked_clabes.map((c) => `···${c.last_four} (${c.bank})`).join(', ')}.
            </Text>
          </Reveal>
        ) : null}

        <Reveal delay={140} style={styles.section}>
          <SectionTitle>Lo que hicimos por ti</SectionTitle>
          <Card style={styles.timelineCard}>
            {shield.timeline.length === 0 ? (
              <Text style={[styles.controlText, { color: palette.muted }]}>
                Todavía nada: no hemos visto movimientos que no se parezcan a ti.
              </Text>
            ) : (
              shield.timeline.map((event, index) => (
                <View key={`${event.at}-${index}`} style={styles.timelineRow}>
                  <View
                    style={[
                      styles.timelineDot,
                      { backgroundColor: GOOD_EVENTS.has(event.kind) ? palette.positive : event.kind === 'alert' ? palette.warning : palette.accent },
                    ]}
                  />
                  <View style={styles.timelineCopy}>
                    <Text style={styles.timelineTitle}>{event.title}</Text>
                    <Text style={[styles.timelineDetail, { color: palette.muted }]}>{event.detail}</Text>
                    <Text style={[styles.timelineDate, { color: palette.muted }]}>{formatShortDate(event.at)}</Text>
                  </View>
                </View>
              ))
            )}
          </Card>
        </Reveal>

        <Reveal delay={170}>
          <Card tone="sage" style={styles.tips}>
            <Text style={styles.controlTitle}>Para no caer en fraudes</Text>
            <Text style={[styles.controlText, { color: palette.muted }]}>
              • Nadie de 52Pay te va a pedir que muevas tu dinero a una «cuenta segura». Si te lo piden, cuelga.
            </Text>
            <Text style={[styles.controlText, { color: palette.muted }]}>
              • Tu PIN es solo para ti: no lo dictes por teléfono ni lo mandes por mensaje.
            </Text>
            <Text style={[styles.controlText, { color: palette.muted }]}>
              • Si algo no te suena, toca «No fui yo». Bloquea tu tarjeta al momento y se revierte con tu PIN.
            </Text>
          </Card>
        </Reveal>
      </ScrollView>

      {notice ? <Toast text={notice.text} tone={notice.tone} onDismiss={dismissNotice} /> : null}
      <VerifySheet request={verify} onClose={closeVerify} />
    </PremiumSurface>
  );
}

function ShieldAlertCard({
  alert,
  busy,
  onLegit,
  onFraud,
  onDismiss,
}: {
  alert: ShieldAlert;
  busy: boolean;
  onLegit: () => void;
  onFraud: () => void;
  onDismiss: () => void;
}) {
  const palette = usePalette();
  const tone = severityTone(palette, alert.severity);
  const actions = [
    { key: 'legit', label: 'Sí fui yo', onPress: onLegit },
    { key: 'fraud', label: 'No fui yo', onPress: onFraud },
    { key: 'dismiss', label: 'Ignorar', onPress: onDismiss },
  ];

  return (
    <Card tone={alert.severity === 'critical' ? 'blush' : 'sage'} style={styles.alertCard}>
      <View style={styles.alertHead}>
        <View style={[styles.alertIcon, { backgroundColor: tone.background }]}>
          <Text style={[styles.alertIconText, { color: tone.color }]}>!</Text>
        </View>
        <View style={styles.alertCopy}>
          <View style={styles.alertTitleRow}>
            <Text style={styles.alertTitle}>{alert.title}</Text>
            <Text style={[styles.severity, { color: tone.color }]}>{SEVERITY_LABELS[alert.severity]}</Text>
          </View>
          <Text style={[styles.alertBody, { color: palette.muted }]}>{alert.explanation}</Text>
        </View>
      </View>
      <View style={styles.chips}>
        {alert.signals.map((signal) => (
          <View key={signal.kind} style={[styles.chip, { backgroundColor: palette.surfaceAlt }]}>
            <Text style={[styles.chipLabel, { color: palette.muted }]}>{signal.label}</Text>
          </View>
        ))}
      </View>
      {alert.suggested_action ? (
        <Text style={[styles.suggested, { color: tone.color }]}>{alert.suggested_action}</Text>
      ) : null}
      <View style={styles.alertActions}>
        {actions.map((action) => (
          <MotionPressable
            key={action.key}
            accessibilityRole="button"
            disabled={busy}
            onPress={action.onPress}
            pressedScale={0.96}
            style={[
              styles.actionPill,
              { backgroundColor: action.key === 'fraud' ? palette.primary : palette.surface, opacity: busy ? 0.55 : 1 },
            ]}>
            <Text style={[styles.actionPillLabel, { color: action.key === 'fraud' ? palette.onPrimary : palette.ink }]}>
              {action.label}
            </Text>
          </MotionPressable>
        ))}
      </View>
    </Card>
  );
}

function CaseCard({ protectionCase }: { protectionCase: ProtectionCase }) {
  const palette = usePalette();
  return (
    <Card accent={palette.accent} style={styles.caseCard}>
      <View style={styles.caseHead}>
        <Text style={styles.controlTitle}>Aclaración {protectionCase.id}</Text>
        {protectionCase.disputed_cents > 0 ? (
          <Text style={styles.caseAmount}>{formatCents(protectionCase.disputed_cents)}</Text>
        ) : null}
      </View>
      <Text style={[styles.timelineDate, { color: palette.muted }]}>Abierta el {formatShortDate(protectionCase.opened_at)}</Text>
      {protectionCase.next_steps.map((step, index) => (
        <View key={step} style={styles.stepRow}>
          <Text style={[styles.stepNumber, { color: palette.accent }]}>{index + 1}</Text>
          <Text style={[styles.controlText, styles.stepText, { color: palette.muted }]}>{step}</Text>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 52, gap: 18 },
  header: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: 42 },
  title: { fontSize: 18, fontWeight: '700' },
  hero: { minHeight: 180, justifyContent: 'flex-start', gap: 18 },
  heroIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  heroCopy: { gap: 6 },
  heroTitle: { color: '#FFFFFF', fontSize: 26, lineHeight: 31, fontWeight: '700', letterSpacing: -0.8 },
  heroText: { fontSize: 15, lineHeight: 21 },
  section: { gap: 0 },
  stack: { gap: 12 },
  alertCard: { gap: 12 },
  alertHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  alertIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  alertIconText: { fontSize: 22, fontWeight: '700' },
  alertCopy: { flex: 1, gap: 5 },
  alertTitleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  alertTitle: { flex: 1, fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  severity: { fontSize: 12, fontWeight: '600' },
  alertBody: { fontSize: 14, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  chipLabel: { fontSize: 12, fontWeight: '600' },
  suggested: { fontSize: 14, fontWeight: '600' },
  alertActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionPill: { minHeight: 42, flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 13 },
  actionPillLabel: { fontSize: 13, fontWeight: '600' },
  controlCard: { gap: 14 },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  controlCopy: { flex: 1, gap: 4 },
  controlTitle: { fontSize: 16, fontWeight: '700' },
  controlText: { fontSize: 13, lineHeight: 19 },
  controlButton: { minHeight: 42, borderRadius: 21, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  controlButtonLabel: { fontSize: 14, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth },
  footnote: { fontSize: 12, lineHeight: 17 },
  timelineCard: { gap: 16 },
  timelineRow: { flexDirection: 'row', gap: 12 },
  timelineDot: { width: 9, height: 9, borderRadius: 5, marginTop: 6 },
  timelineCopy: { flex: 1, gap: 3 },
  timelineTitle: { fontSize: 14, fontWeight: '700' },
  timelineDetail: { fontSize: 13, lineHeight: 18 },
  timelineDate: { fontSize: 11 },
  tips: { gap: 8 },
  caseCard: { gap: 8 },
  caseHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  caseAmount: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  stepRow: { flexDirection: 'row', gap: 10 },
  stepNumber: { width: 16, fontSize: 13, fontWeight: '700' },
  stepText: { flex: 1 },
});
