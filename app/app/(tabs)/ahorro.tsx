import { useState } from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, LinearTransition, ReduceMotion } from 'react-native-reanimated';

import type { SavingsRule } from '@contracts/types';

import { Card } from '@/components/Card';
import { HeroCard } from '@/components/HeroCard';
import { MotionPressable, Reveal } from '@/components/Motion';
import { PremiumSurface } from '@/components/PremiumSurface';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { Text } from '@/components/Themed';
import { SAVINGS_KIND_LABELS } from '@/components/display';
import { usePalette } from '@/components/palette';
import { Chip, EmptyState, SectionTitle } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { dataSource } from '@/src/data';
import { formatCents } from '@/src/format';

export default function AhorroScreen() {
  const palette = usePalette();
  const [activating, setActivating] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [showActiveDetail, setShowActiveDetail] = useState(false);
  const { data, error, loading, reload } = useAsync(async () => {
    const accounts = await dataSource.getAccounts();
    const checking = accounts.find((account) => account.type === 'checking') ?? accounts[0];
    if (!checking) throw new Error('No hay cuentas disponibles.');
    const savings = accounts.find((account) => account.type === 'savings') ?? null;
    const rules = await dataSource.getSavingsRules(checking.id);
    return { savings, rules };
  });

  if (loading && !data) return <LoadingState label="Cargando tus reglas…" />;
  if (error || !data) return <ErrorState message={error ?? 'Sin datos.'} onRetry={reload} />;

  const active = data.rules.filter((rule) => rule.status !== 'suggested');
  const suggested = data.rules.filter((rule) => rule.status === 'suggested');
  const featured = suggested[0] ?? null;
  const moreSuggestions = suggested.slice(1);
  const primaryActive = active[0] ?? null;
  const additionalActive = active.slice(1);
  const savedToDate = active.reduce((sum, rule) => sum + rule.saved_to_date_cents, 0);
  const projected = suggested.reduce((sum, rule) => sum + rule.projected_annual_savings_cents, 0);

  async function activate(rule: SavingsRule) {
    const destination = rule.destination_account_id ?? data?.savings?.id;
    if (!destination) {
      setActionError('Necesitas una cuenta de ahorro para activar esta regla.');
      return;
    }
    setActionError(null);
    setActivating(rule.id);
    try {
      await dataSource.activateSavingsRule(rule.id, destination);
      reload();
    } catch (caught: unknown) {
      setActionError(caught instanceof Error ? caught.message : 'No pudimos activar la regla.');
    } finally {
      setActivating(null);
    }
  }

  return (
    <PremiumSurface>
      <ScrollView
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
                <Text style={styles.heroAmount}>{formatCents(savedToDate)}</Text>
                <Text style={styles.heroUnit}>ahorrados</Text>
              </View>
              <Text style={styles.heroCaption}>Hasta {formatCents(projected)} más al año</Text>
            </HeroCard>

            {primaryActive && (
              <MotionPressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showActiveDetail }}
                onPress={() => setShowActiveDetail((current) => !current)}
                style={[styles.activeOverlay, { backgroundColor: palette.surfaceMint }]}>
                <View style={[styles.activeIcon, { backgroundColor: palette.positiveSoft }]}>
                  <Text style={[styles.activeIconText, { color: palette.positive }]}>◎</Text>
                </View>
                <Text numberOfLines={1} style={styles.activeTitle}>{primaryActive.title}</Text>
                <Chip label="Activa" tone={{ background: palette.positiveSoft, color: palette.positive }} />
                <Text style={[styles.chevron, { color: palette.muted }]}>›</Text>
              </MotionPressable>
            )}
          </View>
        </Reveal>

        {primaryActive && showActiveDetail && (
          <Animated.View entering={FadeIn.duration(190).reduceMotion(ReduceMotion.System)}>
            <Card tone="mint">
              <Text style={styles.detailTitle}>{primaryActive.title}</Text>
              <Text style={[styles.detailCopy, { color: palette.muted }]}>{primaryActive.description}</Text>
              <Text style={[styles.detailMetric, { color: palette.positive }]}>
                {formatCents(primaryActive.saved_to_date_cents)} ahorrados hasta hoy
              </Text>
            </Card>
          </Animated.View>
        )}

        {actionError ? (
          <Card tone="blush">
            <Text style={[styles.message, { color: palette.danger }]}>{actionError}</Text>
          </Card>
        ) : null}

        {featured ? (
          <View style={styles.section}>
            <SectionTitle>Sugerencia destacada</SectionTitle>
            <FeaturedRule
              rule={featured}
              busy={activating === featured.id}
              onActivate={() => activate(featured)}
            />

            {moreSuggestions.length > 0 && (
              <MotionPressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showMore }}
                onPress={() => setShowMore((current) => !current)}
                style={[styles.moreButton, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <Text style={styles.moreLabel}>
                  {showMore ? 'Ocultar sugerencias' : `Ver ${moreSuggestions.length} sugerencias más`}
                </Text>
                <Text style={[styles.chevron, { color: palette.muted }]}>{showMore ? '⌃' : '›'}</Text>
              </MotionPressable>
            )}

            {showMore && (
              <Animated.View
                layout={LinearTransition.duration(220).reduceMotion(ReduceMotion.System)}
                entering={FadeIn.duration(190).reduceMotion(ReduceMotion.System)}
                style={styles.stack}>
                {moreSuggestions.map((rule) => (
                  <CompactRule
                    key={rule.id}
                    rule={rule}
                    busy={activating === rule.id}
                    onActivate={() => activate(rule)}
                  />
                ))}
              </Animated.View>
            )}
          </View>
        ) : (
          <EmptyState
            title="Nada pendiente por ahora"
            hint="Cuando detectemos otra forma de ahorrar te la propondremos aquí."
          />
        )}

        {additionalActive.length > 0 && (
          <View style={styles.section}>
            <SectionTitle>Otras reglas activas</SectionTitle>
            <View style={styles.stack}>
              {additionalActive.map((rule) => (
                <CompactRule key={rule.id} rule={rule} />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </PremiumSurface>
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
            <Text style={[styles.featuredIconText, { color: palette.accentDeep }]}>▣</Text>
          </View>
          <View style={styles.featuredCopy}>
            <Text style={styles.featuredTitle}>{rule.title}</Text>
            <Text style={[styles.featuredImpact, { color: palette.muted }]}>
              Impacto: {formatCents(rule.projected_annual_savings_cents)} al año
            </Text>
          </View>
        </View>
        <MotionPressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onActivate}
          pressedScale={0.975}
          style={[styles.activateButton, { backgroundColor: palette.accentDeep, opacity: busy ? 0.65 : 1 }]}>
          <Text style={styles.activateLabel}>{busy ? 'Activando…' : 'Activar regla'}</Text>
        </MotionPressable>
      </View>
    </Card>
  );
}

function CompactRule({
  rule,
  busy = false,
  onActivate,
}: {
  rule: SavingsRule;
  busy?: boolean;
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
      <View style={styles.compactFooter}>
        <Text style={[styles.detailMetric, { color: onActivate ? palette.ink : palette.positive }]}>
          {formatCents(onActivate ? rule.projected_annual_savings_cents : rule.saved_to_date_cents)}
        </Text>
        {onActivate ? (
          <MotionPressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onActivate}
            style={[styles.smallButton, { backgroundColor: palette.accentDeep, opacity: busy ? 0.65 : 1 }]}>
            <Text style={styles.smallButtonLabel}>{busy ? 'Activando…' : 'Activar'}</Text>
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
  heroUnit: { color: '#FFFFFF', fontSize: 20, lineHeight: 25 },
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
  activeIconText: { fontSize: 23, fontWeight: '700' },
  activeTitle: { flex: 1, fontSize: 13, fontWeight: '600' },
  chevron: { width: 15, fontSize: 25, fontWeight: '300', textAlign: 'center' },
  section: { gap: 12 },
  featuredShell: { padding: 8 },
  featuredInner: { borderRadius: 20, padding: 15, gap: 16 },
  featuredHead: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  featuredIcon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  featuredIconText: { fontSize: 25, fontWeight: '600' },
  featuredCopy: { flex: 1, gap: 5 },
  featuredTitle: { fontSize: 17, lineHeight: 22, fontWeight: '700', letterSpacing: -0.28 },
  featuredImpact: { fontSize: 13, lineHeight: 18 },
  activateButton: { minHeight: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  activateLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  moreButton: { minHeight: 58, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
  moreLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  stack: { gap: 10 },
  message: { fontSize: 14, lineHeight: 20 },
  detailTitle: { fontSize: 16, fontWeight: '700' },
  detailCopy: { fontSize: 13, lineHeight: 19 },
  detailMetric: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  compactRule: { gap: 13 },
  compactHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  compactTitle: { flex: 1, fontSize: 16, lineHeight: 21, fontWeight: '700' },
  compactFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  smallButton: { minHeight: 38, borderRadius: 13, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center' },
  smallButtonLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
});
