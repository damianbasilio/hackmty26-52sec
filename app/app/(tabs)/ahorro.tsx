import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import type { Account, SavingsRule, SavingsRuleKind } from '@contracts/types';

import { useBanking } from '@/components/BankingProvider';
import { Card } from '@/components/Card';
import { HeroCard } from '@/components/HeroCard';
import { MotionPressable, Reveal } from '@/components/Motion';
import { PremiumSurface } from '@/components/PremiumSurface';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { Text } from '@/components/Themed';
import { SAVINGS_KIND_LABELS } from '@/components/display';
import { usePalette } from '@/components/palette';
import { markSubscription } from '@/components/subscriptionMarks';
import { Chevron, Chip, Collapsible, EmptyState, SectionTitle, Toast } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { dataSource } from '@/src/data';
import { formatCents } from '@/src/format';

type Notice = { tone: 'danger' | 'positive'; text: string };

/** Qué pasa al tocar el botón. Sin esto "Activar regla" no decía nada. */
const HOW_IT_WORKS: Record<SavingsRuleKind, string> = {
  round_up: 'Cada compra se redondea y la diferencia se aparta sola en tu cuenta de ahorro.',
  fixed_recurring: 'Movemos el monto indicado a tu cuenta de ahorro con esa frecuencia.',
  percent_of_income: 'Cada vez que recibas un ingreso apartamos ese porcentaje en tu ahorro.',
  cancel_subscription: 'No podemos cancelar por ti. Te dejamos un recordatorio con los pasos para cancelarla antes del próximo cobro.',
  spend_cap: 'Te avisamos cuando tu gasto del mes en esa categoría pase del tope. No bloquea tus compras.',
};

const ACTIVATE_LABELS: Record<SavingsRuleKind, string> = {
  round_up: 'Activar redondeo',
  fixed_recurring: 'Activar apartado',
  percent_of_income: 'Activar regla',
  cancel_subscription: 'Recordarme cancelar',
  spend_cap: 'Activar tope',
};

const ACTIVE_LABELS: Record<SavingsRuleKind, string> = {
  round_up: 'Activa',
  fixed_recurring: 'Activa',
  percent_of_income: 'Activa',
  cancel_subscription: 'Recordatorio',
  spend_cap: 'Tope activo',
};

/** Tiempo para ver el botón en verde antes de que la regla pase a "activas". */
const DONE_MS = 1200;

export default function AhorroScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { reload: reloadBanking } = useBanking();
  const [activating, setActivating] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [showActiveDetail, setShowActiveDetail] = useState(false);
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newAccountOpen, setNewAccountOpen] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const { data, error, loading, reload } = useAsync(async () => {
    const accounts = await dataSource.getAccounts();
    const checking = accounts.find((account) => account.type === 'checking') ?? accounts[0];
    if (!checking) throw new Error('No hay cuentas disponibles.');
    const savings = accounts.filter((account) => account.type === 'savings');
    const rules = await dataSource.getSavingsRules(checking.id);
    return { checking, savings, rules };
  });

  const dismissNotice = useCallback(() => setNotice(null), []);

  if (loading && !data) return <LoadingState label="Cargando tus reglas…" />;
  if (error || !data) return <ErrorState message={error ?? 'Sin datos.'} onRetry={reload} />;

  const { checking, savings } = data;
  const active = data.rules.filter((rule) => rule.status !== 'suggested');
  const suggested = data.rules.filter((rule) => rule.status === 'suggested');
  const featured = suggested[0] ?? null;
  const moreSuggestions = suggested.slice(1);
  const primaryActive = active[0] ?? null;
  const additionalActive = active.slice(1);
  const savedToDate = active.reduce((sum, rule) => sum + rule.saved_to_date_cents, 0);
  const projected = suggested.reduce((sum, rule) => sum + rule.projected_annual_savings_cents, 0);
  const savingsTotal = savings.reduce((sum, account) => sum + account.balance_cents, 0);
  const chosenDestination = savings.find((account) => account.id === destinationId) ?? null;

  function accountName(accountId: string | null): string | null {
    return savings.find((account) => account.id === accountId)?.nickname ?? null;
  }

  function openSubscription(rule: SavingsRule) {
    router.push({
      pathname: '/suscripciones',
      params: rule.subscription_id ? { expand: rule.subscription_id, at: String(Date.now()) } : {},
    } as never);
  }

  function finish(ruleId: string, then?: () => void) {
    setDoneId(ruleId);
    setTimeout(() => {
      setDoneId(null);
      reload();
      then?.();
    }, DONE_MS);
  }

  async function remindCancel(rule: SavingsRule) {
    setNotice(null);
    setActivating(rule.id);
    if (rule.subscription_id) markSubscription(rule.subscription_id, { cancelPending: true, usage: 'not_using' });
    try {
      await dataSource.activateSavingsRule(rule.id, rule.destination_account_id ?? savings[0]?.id ?? checking.id);
    } catch {
      // El recordatorio ya quedó en el teléfono; la regla solo lo refleja en el engine.
    }
    setActivating(null);
    finish(rule.id, () => openSubscription(rule));
  }

  async function activate(rule: SavingsRule) {
    if (rule.kind === 'cancel_subscription') {
      await remindCancel(rule);
      return;
    }
    const destination = chosenDestination?.id ?? rule.destination_account_id ?? savings[0]?.id;
    if (!destination) {
      setNotice({ tone: 'danger', text: 'Primero abre una cuenta de ahorro: ahí caerá lo que aparte esta regla.' });
      setNewAccountOpen(true);
      return;
    }
    setNotice(null);
    setActivating(rule.id);
    try {
      await dataSource.activateSavingsRule(rule.id, destination);
      setNotice({
        tone: 'positive',
        text: rule.kind === 'spend_cap'
          ? rule.amount_cents !== null
            ? `Tope activado. Te avisaremos cuando pases de ${formatCents(rule.amount_cents)} en el mes.`
            : 'Tope activado. Te avisaremos cuando lo pases.'
          : `Activamos «${rule.title}». Lo que aparte irá a ${accountName(destination) ?? 'tu ahorro'}.`,
      });
      finish(rule.id);
    } catch (caught: unknown) {
      setNotice({ tone: 'danger', text: caught instanceof Error ? caught.message : 'No pudimos activar la regla.' });
    } finally {
      setActivating(null);
    }
  }

  async function createAccount() {
    const name = newAccountName.trim();
    if (!name) {
      setNotice({ tone: 'danger', text: 'Ponle un nombre a tu cuenta, por ejemplo «Fondo de emergencia».' });
      return;
    }
    setCreating(true);
    setNotice(null);
    try {
      const account = await dataSource.createSavingsAccount(name);
      setNewAccountName('');
      setNewAccountOpen(false);
      setDestinationId(account.id);
      setNotice({ tone: 'positive', text: `Abrimos «${account.nickname}». Ya puedes transferirle o usarla en tus reglas.` });
      reload();
      // Las cuentas propias también son destinatarios de transferencia.
      reloadBanking();
    } catch (caught: unknown) {
      setNotice({ tone: 'danger', text: caught instanceof Error ? caught.message : 'No pudimos abrir la cuenta.' });
    } finally {
      setCreating(false);
    }
  }

  return (
    <PremiumSurface>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={palette.accent} />}>
        <Reveal>
          <Text style={styles.title}>Ahorro</Text>
        </Reveal>

        <Reveal delay={55}>
          <View style={styles.heroGroup}>
            <HeroCard style={[styles.hero, primaryActive ? styles.heroWithRule : null]}>
              <View>
                <Text adjustsFontSizeToFit numberOfLines={1} style={styles.heroAmount}>{formatCents(savedToDate)}</Text>
                <Text style={styles.heroUnit}>ahorrados con tus reglas</Text>
              </View>
              <Text style={styles.heroCaption}>Hasta {formatCents(projected)} más al año</Text>
            </HeroCard>

            {primaryActive ? (
              <MotionPressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showActiveDetail }}
                onPress={() => setShowActiveDetail((current) => !current)}
                style={[styles.activeOverlay, { backgroundColor: palette.surfaceMint }]}>
                <View style={[styles.activeIcon, { backgroundColor: palette.positiveSoft }]}>
                  <SymbolView name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }} tintColor={palette.positive} size={20} />
                </View>
                <Text numberOfLines={1} style={styles.activeTitle}>{primaryActive.title}</Text>
                <Chip label={ACTIVE_LABELS[primaryActive.kind]} tone={{ background: palette.positiveSoft, color: palette.positive }} />
                <Chevron direction={showActiveDetail ? 'down' : 'right'} />
              </MotionPressable>
            ) : null}
          </View>
        </Reveal>

        {primaryActive ? (
          <Collapsible open={showActiveDetail}>
            <Card tone="mint">
              <Text style={styles.detailTitle}>{primaryActive.title}</Text>
              <Text style={[styles.detailCopy, { color: palette.muted }]}>{primaryActive.description}</Text>
              {accountName(primaryActive.destination_account_id) ? (
                <Text style={[styles.detailCopy, { color: palette.muted }]}>
                  Destino: {accountName(primaryActive.destination_account_id)}
                </Text>
              ) : null}
              <Text style={[styles.detailMetric, { color: palette.positive }]}>
                {formatCents(primaryActive.saved_to_date_cents)} ahorrados hasta hoy
              </Text>
            </Card>
          </Collapsible>
        ) : null}

        <Reveal delay={90} style={styles.section}>
          <SectionTitle
            action={<Text style={[styles.sectionMeta, { color: palette.muted }]}>{formatCents(savingsTotal)}</Text>}>
            Tus cuentas de ahorro
          </SectionTitle>
          <Card tone="sage" style={styles.accountList}>
            {savings.length === 0 ? (
              <Text style={[styles.detailCopy, { color: palette.muted }]}>
                Todavía no tienes cuentas de ahorro. Abre una para cada meta.
              </Text>
            ) : (
              savings.map((account, index) => (
                <SavingsAccountRow
                  key={account.id}
                  account={account}
                  isLast={index === savings.length - 1}
                  selected={savings.length > 1 && chosenDestination?.id === account.id}
                  onPress={savings.length > 1
                    ? () => setDestinationId((current) => (current === account.id ? null : account.id))
                    : undefined}
                />
              ))
            )}
          </Card>
          {savings.length > 1 ? (
            <Text style={[styles.hint, { color: palette.muted }]}>
              {chosenDestination
                ? `Las reglas que actives ahora ahorrarán en «${chosenDestination.nickname}».`
                : 'Toca una cuenta para elegir a dónde van las reglas que actives.'}
            </Text>
          ) : null}

          <MotionPressable
            accessibilityRole="button"
            accessibilityState={{ expanded: newAccountOpen }}
            onPress={() => setNewAccountOpen((current) => !current)}
            style={[styles.moreButton, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={[styles.plusIcon, { backgroundColor: palette.accentSoft }]}>
              <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} tintColor={palette.accent} size={16} />
            </View>
            <Text style={styles.moreLabel}>Abrir otra cuenta de ahorro</Text>
            <Chevron direction={newAccountOpen ? 'up' : 'down'} />
          </MotionPressable>

          <Collapsible open={newAccountOpen}>
            <Card style={styles.newAccountCard}>
              <Text style={styles.fieldLabel}>¿Para qué vas a ahorrar?</Text>
              <TextInput
                accessibilityLabel="Nombre de la cuenta de ahorro"
                maxLength={40}
                onChangeText={setNewAccountName}
                onSubmitEditing={createAccount}
                placeholder="Fondo de emergencia, viaje, auto…"
                placeholderTextColor={palette.muted}
                returnKeyType="done"
                style={[styles.input, { backgroundColor: palette.surfaceAlt, borderColor: palette.border, color: palette.ink }]}
                value={newAccountName}
              />
              <MotionPressable
                accessibilityRole="button"
                disabled={creating}
                onPress={createAccount}
                style={[styles.activateButton, { backgroundColor: palette.primary, opacity: creating ? 0.6 : 1 }]}>
                <Text style={[styles.activateLabel, { color: palette.onPrimary }]}>{creating ? 'Abriendo…' : 'Abrir cuenta'}</Text>
              </MotionPressable>
            </Card>
          </Collapsible>
        </Reveal>

        {featured ? (
          <Reveal delay={130} style={styles.section}>
            <SectionTitle>Sugerencia destacada</SectionTitle>
            <FeaturedRule
              rule={featured}
              busy={activating === featured.id}
              done={doneId === featured.id}
              onActivate={() => activate(featured)}
            />

            {moreSuggestions.length > 0 ? (
              <MotionPressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showMore }}
                onPress={() => setShowMore((current) => !current)}
                style={[styles.moreButton, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <Text style={styles.moreLabel}>
                  {showMore ? 'Ocultar sugerencias' : `Ver ${moreSuggestions.length} sugerencias más`}
                </Text>
                <Chevron direction={showMore ? 'up' : 'down'} />
              </MotionPressable>
            ) : null}

            <Collapsible open={showMore}>
              <View style={styles.stack}>
                {moreSuggestions.map((rule) => (
                  <CompactRule
                    key={rule.id}
                    rule={rule}
                    busy={activating === rule.id}
                    done={doneId === rule.id}
                    onActivate={() => activate(rule)}
                  />
                ))}
              </View>
            </Collapsible>
          </Reveal>
        ) : (
          <EmptyState
            title="Nada pendiente por ahora"
            hint="Cuando detectemos otra forma de ahorrar te la propondremos aquí."
          />
        )}

        {additionalActive.length > 0 ? (
          <Reveal delay={170} style={styles.section}>
            <SectionTitle>Otras reglas activas</SectionTitle>
            <View style={styles.stack}>
              {additionalActive.map((rule) => (
                <CompactRule
                  key={rule.id}
                  rule={rule}
                  destination={rule.kind === 'cancel_subscription' ? null : accountName(rule.destination_account_id)}
                  onOpen={rule.kind === 'cancel_subscription' ? () => openSubscription(rule) : undefined}
                />
              ))}
            </View>
          </Reveal>
        ) : null}
      </ScrollView>

      {notice ? (
        <Toast
          key={notice.text}
          text={notice.text}
          tone={notice.tone}
          autoHideMs={notice.tone === 'positive' ? 4500 : 7000}
          onDismiss={dismissNotice}
        />
      ) : null}
    </PremiumSurface>
  );
}

function SavingsAccountRow({
  account,
  isLast,
  selected,
  onPress,
}: {
  account: Account;
  isLast: boolean;
  selected: boolean;
  onPress?: () => void;
}) {
  const palette = usePalette();
  const content = (
    <>
      <View style={[styles.accountIcon, { backgroundColor: selected ? palette.primary : palette.surface }]}>
        <SymbolView
          name={selected
            ? { ios: 'checkmark', android: 'check', web: 'check' }
            : { ios: 'banknote.fill', android: 'savings', web: 'savings' }}
          tintColor={selected ? palette.onPrimary : palette.positive}
          size={17}
        />
      </View>
      <View style={styles.accountCopy}>
        <Text numberOfLines={1} style={styles.accountName}>{account.nickname}</Text>
        <Text style={[styles.accountMeta, { color: palette.muted }]}>·· {account.last_four}</Text>
      </View>
      <Text style={styles.accountBalance}>{formatCents(account.balance_cents)}</Text>
    </>
  );
  const rowStyle = [styles.accountRow, !isLast ? { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth } : null];
  if (!onPress) return <View style={rowStyle}>{content}</View>;
  return (
    <MotionPressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} pressedScale={0.985} style={rowStyle}>
      {content}
    </MotionPressable>
  );
}

function ActivateButton({
  rule,
  busy,
  done,
  compact = false,
  onPress,
}: {
  rule: SavingsRule;
  busy: boolean;
  done: boolean;
  compact?: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  const label = done
    ? rule.kind === 'cancel_subscription' ? 'Recordatorio creado' : 'Activada'
    : busy
      ? 'Activando…'
      : ACTIVATE_LABELS[rule.kind];
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy || done }}
      disabled={busy || done}
      onPress={onPress}
      pressedScale={0.975}
      style={[
        compact ? styles.smallButton : styles.activateButton,
        { backgroundColor: done ? palette.positiveSoft : palette.primary, opacity: busy ? 0.65 : 1 },
      ]}>
      {done ? (
        <SymbolView name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }} tintColor={palette.positive} size={compact ? 15 : 18} />
      ) : null}
      <Text style={[compact ? styles.smallButtonLabel : styles.activateLabel, { color: done ? palette.positive : palette.onPrimary }]}>
        {label}
      </Text>
    </MotionPressable>
  );
}

function HowItWorks({ kind }: { kind: SavingsRuleKind }) {
  const palette = usePalette();
  return (
    <View style={[styles.howBox, { backgroundColor: palette.surfaceAlt }]}>
      <SymbolView name={{ ios: 'info.circle.fill', android: 'info', web: 'info' }} tintColor={palette.accent} size={15} />
      <Text style={[styles.howText, { color: palette.muted }]}>{HOW_IT_WORKS[kind]}</Text>
    </View>
  );
}

function FeaturedRule({
  rule,
  busy,
  done,
  onActivate,
}: {
  rule: SavingsRule;
  busy: boolean;
  done: boolean;
  onActivate: () => void;
}) {
  const palette = usePalette();
  return (
    <Card tone="sage" style={styles.featuredShell}>
      <View style={[styles.featuredInner, { backgroundColor: palette.surface }]}>
        <View style={styles.featuredHead}>
          <View style={[styles.featuredIcon, { backgroundColor: palette.accentSoft }]}>
            <SymbolView name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} tintColor={palette.accent} size={24} />
          </View>
          <View style={styles.featuredCopy}>
            <Text style={styles.featuredTitle}>{rule.title}</Text>
            <Text style={[styles.featuredImpact, { color: palette.muted }]}>
              Impacto: {formatCents(rule.projected_annual_savings_cents)} al año
            </Text>
          </View>
        </View>
        <Text style={[styles.detailCopy, { color: palette.muted }]}>{rule.description}</Text>
        <HowItWorks kind={rule.kind} />
        <ActivateButton rule={rule} busy={busy} done={done} onPress={onActivate} />
      </View>
    </Card>
  );
}

function CompactRule({
  rule,
  busy = false,
  done = false,
  destination = null,
  onActivate,
  onOpen,
}: {
  rule: SavingsRule;
  busy?: boolean;
  done?: boolean;
  destination?: string | null;
  onActivate?: () => void;
  onOpen?: () => void;
}) {
  const palette = usePalette();
  const card = (
    <Card tone={onActivate ? 'sage' : 'mint'} style={styles.compactRule}>
      <View style={styles.compactHead}>
        <Text style={styles.compactTitle}>{rule.title}</Text>
        <Chip label={SAVINGS_KIND_LABELS[rule.kind]} />
      </View>
      <Text style={[styles.detailCopy, { color: palette.muted }]}>{rule.description}</Text>
      {onActivate ? <HowItWorks kind={rule.kind} /> : null}
      {destination ? <Text style={[styles.detailCopy, { color: palette.muted }]}>Destino: {destination}</Text> : null}
      <View style={styles.compactFooter}>
        <Text style={[styles.detailMetric, { color: onActivate ? palette.ink : palette.positive }]}>
          {formatCents(onActivate ? rule.projected_annual_savings_cents : rule.saved_to_date_cents)}
          {onActivate ? ' al año' : ' ahorrados'}
        </Text>
        {onActivate ? (
          <ActivateButton compact rule={rule} busy={busy} done={done} onPress={onActivate} />
        ) : (
          <Chip label={ACTIVE_LABELS[rule.kind]} tone={{ background: palette.positiveSoft, color: palette.positive }} />
        )}
      </View>
      {onOpen ? <Text style={[styles.openLink, { color: palette.accent }]}>Ver pasos para cancelar</Text> : null}
    </Card>
  );
  if (!onOpen) return card;
  return (
    <MotionPressable accessibilityRole="button" onPress={onOpen} pressedScale={0.985}>
      {card}
    </MotionPressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 16, gap: 20, paddingBottom: 132 },
  title: { fontSize: 36, lineHeight: 42, fontWeight: '700', letterSpacing: -1.3 },
  heroGroup: { paddingBottom: 34 },
  hero: { minHeight: 218, justifyContent: 'space-between' },
  heroWithRule: { paddingBottom: 68 },
  heroAmount: { color: '#FFFFFF', fontSize: 44, lineHeight: 50, fontWeight: '700', letterSpacing: -1.75, fontVariant: ['tabular-nums'] },
  heroUnit: { color: '#FFFFFF', fontSize: 18, lineHeight: 24 },
  heroCaption: { color: 'rgba(255,255,255,0.78)', fontSize: 16 },
  activeOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 78,
    borderRadius: 23,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(19, 126, 79, 0.08)',
    ...Platform.select({
      ios: { shadowColor: '#174E38', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.12, shadowRadius: 20 },
      android: { elevation: 7 },
      default: { boxShadow: '0 14px 28px rgba(23, 78, 56, 0.12)' },
    }),
  },
  activeIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  activeTitle: { flex: 1, fontSize: 13, fontWeight: '600' },
  section: { gap: 12 },
  sectionMeta: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  accountList: { paddingVertical: 4, paddingHorizontal: 14, gap: 0 },
  accountRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 11 },
  accountIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  accountCopy: { flex: 1, gap: 2 },
  accountName: { fontSize: 15, fontWeight: '700' },
  accountMeta: { fontSize: 12 },
  accountBalance: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  hint: { fontSize: 12, lineHeight: 17 },
  plusIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  newAccountCard: { gap: 12 },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  input: { minHeight: 52, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 15, fontSize: 16 },
  featuredShell: { padding: 8 },
  featuredInner: { borderRadius: 20, padding: 15, gap: 14 },
  featuredHead: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  featuredIcon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  featuredCopy: { flex: 1, gap: 5 },
  featuredTitle: { fontSize: 17, lineHeight: 22, fontWeight: '700', letterSpacing: -0.28 },
  featuredImpact: { fontSize: 13, lineHeight: 18 },
  howBox: { borderRadius: 13, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  howText: { flex: 1, fontSize: 12, lineHeight: 17 },
  activateButton: { minHeight: 52, borderRadius: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  activateLabel: { fontSize: 16, fontWeight: '700' },
  moreButton: { minHeight: 58, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  moreLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  stack: { gap: 10 },
  detailTitle: { fontSize: 16, fontWeight: '700' },
  detailCopy: { fontSize: 13, lineHeight: 19 },
  detailMetric: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  compactRule: { gap: 12 },
  compactHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  compactTitle: { flex: 1, fontSize: 16, lineHeight: 21, fontWeight: '700' },
  compactFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  smallButton: { minHeight: 38, borderRadius: 13, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  smallButtonLabel: { fontSize: 13, fontWeight: '700' },
  openLink: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
});
