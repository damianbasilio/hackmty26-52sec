import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import type { Account, SavingsRule } from '@contracts/types';

import { useBanking } from '@/components/BankingProvider';
import { Card } from '@/components/Card';
import { HeroCard } from '@/components/HeroCard';
import { MotionPressable, Reveal } from '@/components/Motion';
import { PremiumSurface } from '@/components/PremiumSurface';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { Text } from '@/components/Themed';
import { SAVINGS_KIND_LABELS } from '@/components/display';
import { usePalette } from '@/components/palette';
import { Banner, Chevron, Chip, Collapsible, EmptyState, SectionTitle } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { dataSource } from '@/src/data';
import { formatCents } from '@/src/format';

type Notice = { tone: 'danger' | 'positive'; text: string };

export default function AhorroScreen() {
  const palette = usePalette();
  const { reload: reloadBanking } = useBanking();
  const [activating, setActivating] = useState<string | null>(null);
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
    return { savings, rules };
  });

  const dismissNotice = useCallback(() => setNotice(null), []);

  if (loading && !data) return <LoadingState label="Cargando tus reglas…" />;
  if (error || !data) return <ErrorState message={error ?? 'Sin datos.'} onRetry={reload} />;

  const { savings } = data;
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

  async function activate(rule: SavingsRule) {
    const destination = chosenDestination?.id ?? rule.destination_account_id ?? savings[0]?.id;
    if (!destination) {
      setNotice({ tone: 'danger', text: 'Abre una cuenta de ahorro para activar esta regla.' });
      setNewAccountOpen(true);
      return;
    }
    setNotice(null);
    setActivating(rule.id);
    try {
      await dataSource.activateSavingsRule(rule.id, destination);
      setNotice({
        tone: 'positive',
        text: `Activamos «${rule.title}». El dinero irá a ${accountName(destination) ?? 'tu ahorro'}.`,
      });
      reload();
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
                <Chip label="Activa" tone={{ background: palette.positiveSoft, color: palette.positive }} />
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

        {notice ? (
          <Banner
            key={notice.text}
            text={notice.text}
            tone={notice.tone}
            autoHideMs={notice.tone === 'positive' ? 5000 : 7000}
            onDismiss={dismissNotice}
          />
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
                <CompactRule key={rule.id} rule={rule} destination={accountName(rule.destination_account_id)} />
              ))}
            </View>
          </Reveal>
        ) : null}
      </ScrollView>
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

function FeaturedRule({
  rule,
  busy,
  onActivate,
}: {
  rule: SavingsRule;
  busy: boolean;
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
        <MotionPressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onActivate}
          pressedScale={0.975}
          style={[styles.activateButton, { backgroundColor: palette.primary, opacity: busy ? 0.65 : 1 }]}>
          <Text style={[styles.activateLabel, { color: palette.onPrimary }]}>{busy ? 'Activando…' : 'Activar regla'}</Text>
        </MotionPressable>
      </View>
    </Card>
  );
}

function CompactRule({
  rule,
  busy = false,
  destination = null,
  onActivate,
}: {
  rule: SavingsRule;
  busy?: boolean;
  destination?: string | null;
  onActivate?: () => void;
}) {
  const palette = usePalette();
  return (
    <Card tone={onActivate ? 'sage' : 'mint'} style={styles.compactRule}>
      <View style={styles.compactHead}>
        <Text style={styles.compactTitle}>{rule.title}</Text>
        <Chip label={SAVINGS_KIND_LABELS[rule.kind]} />
      </View>
      <Text style={[styles.detailCopy, { color: palette.muted }]}>{rule.description}</Text>
      {destination ? <Text style={[styles.detailCopy, { color: palette.muted }]}>Destino: {destination}</Text> : null}
      <View style={styles.compactFooter}>
        <Text style={[styles.detailMetric, { color: onActivate ? palette.ink : palette.positive }]}>
          {formatCents(onActivate ? rule.projected_annual_savings_cents : rule.saved_to_date_cents)}
          {onActivate ? ' al año' : ' ahorrados'}
        </Text>
        {onActivate ? (
          <MotionPressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onActivate}
            style={[styles.smallButton, { backgroundColor: palette.primary, opacity: busy ? 0.65 : 1 }]}>
            <Text style={[styles.smallButtonLabel, { color: palette.onPrimary }]}>{busy ? 'Activando…' : 'Activar'}</Text>
          </MotionPressable>
        ) : (
          <Chip label="Activa" tone={{ background: palette.positiveSoft, color: palette.positive }} />
        )}
      </View>
    </Card>
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
  activateButton: { minHeight: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  activateLabel: { fontSize: 16, fontWeight: '600' },
  moreButton: { minHeight: 58, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  moreLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  stack: { gap: 10 },
  detailTitle: { fontSize: 16, fontWeight: '700' },
  detailCopy: { fontSize: 13, lineHeight: 19 },
  detailMetric: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  compactRule: { gap: 13 },
  compactHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  compactTitle: { flex: 1, fontSize: 16, lineHeight: 21, fontWeight: '700' },
  compactFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  smallButton: { minHeight: 38, borderRadius: 13, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center' },
  smallButtonLabel: { fontSize: 13, fontWeight: '600' },
});
