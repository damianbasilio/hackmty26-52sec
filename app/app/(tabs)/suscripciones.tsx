import { useState } from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/Card';
import { HeroCard } from '@/components/HeroCard';
import { MotionPressable, Reveal } from '@/components/Motion';
import { PremiumSurface } from '@/components/PremiumSurface';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { SubscriptionCard } from '@/components/SubscriptionCard';
import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';
import { EmptyState, SectionTitle } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { dataSource } from '@/src/data';
import { formatCents } from '@/src/format';

const LOAD_ERROR =
  'Necesitamos tus movimientos para encontrar cargos recurrentes y ahora no pudimos leerlos. Revisa tu conexión e inténtalo de nuevo.';

export default function SuscripcionesScreen() {
  const palette = usePalette();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync(async () => {
    const accounts = await dataSource.getAccounts();
    const checking = accounts.find((account) => account.type === 'checking') ?? accounts[0];
    if (!checking) throw new Error('No hay cuentas disponibles.');
    return dataSource.getSubscriptions(checking.id);
  });

  if (loading && !data) return <LoadingState label="Buscando tus cargos recurrentes…" />;
  if (error || !data) return <ErrorState message={LOAD_ERROR} onRetry={reload} />;

  const subscriptions = data;
  const refresh = <RefreshControl refreshing={loading} onRefresh={reload} tintColor={palette.accent} />;

  if (subscriptions.length === 0) {
    return (
      <PremiumSurface>
        <ScrollView contentContainerStyle={styles.emptyContent} refreshControl={refresh}>
          <Text style={styles.title}>Suscripciones</Text>
          <EmptyState
            title="Aún no vemos suscripciones"
            hint="Cuando un comercio repita un cobro con la misma cadencia, aparecerá aquí con una explicación clara."
          />
        </ScrollView>
      </PremiumSurface>
    );
  }

  const annualTotal = subscriptions.reduce((sum, item) => sum + item.annual_cost_cents, 0);
  const increased = subscriptions.filter((item) => item.price_increase_detected);
  const spotlight = increased[0] ?? null;
  const increase = spotlight?.price_delta_cents ?? 0;
  const displaySubscriptions = [...subscriptions].sort((left, right) => {
    const priority = (status: typeof left) =>
      status.price_increase_detected ? 0 : status.status === 'unused' ? 1 : 2;
    return priority(left) - priority(right);
  });

  return (
    <PremiumSurface>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={refresh}>
        <Reveal>
          <Text style={styles.title}>Suscripciones</Text>
        </Reveal>

        <Reveal delay={55}>
          <View style={styles.heroGroup}>
            <HeroCard style={[styles.hero, spotlight ? styles.heroWithAlert : null]}>
              <View>
                <Text style={styles.heroAmount}>{formatCents(annualTotal)}</Text>
                <Text style={styles.heroUnit}>al año</Text>
              </View>
              <Text style={styles.heroCaption}>
                {subscriptions.length} {subscriptions.length === 1 ? 'cargo recurrente' : 'cargos recurrentes'}
              </Text>
            </HeroCard>

            {spotlight && (
              <MotionPressable
                accessibilityRole="button"
                accessibilityLabel={`Revisar aumento de ${spotlight.merchant_display_name}`}
                onPress={() => setExpandedId(spotlight.id)}
                style={[styles.alertOverlay, { backgroundColor: palette.surfaceBlush }]}>
                <View style={[styles.alertIcon, { backgroundColor: palette.dangerSoft }]}>
                  <Text style={[styles.alertIconText, { color: palette.danger }]}>↗</Text>
                </View>
                <Text numberOfLines={1} style={styles.alertText}>
                  {spotlight.merchant_display_name} subió{' '}
                  <Text style={{ color: palette.danger }}>{formatCents(Math.abs(increase))}</Text>
                </Text>
                <Text style={[styles.review, { color: palette.danger }]}>Revisar</Text>
                <Text style={[styles.chevron, { color: palette.muted }]}>›</Text>
              </MotionPressable>
            )}
          </View>
        </Reveal>

        <View style={styles.section}>
          <SectionTitle>Tus suscripciones</SectionTitle>
          <Card tone="sage" style={styles.subscriptionList}>
            {displaySubscriptions.map((subscription, index) => (
              <SubscriptionCard
                key={subscription.id}
                subscription={subscription}
                expanded={expandedId === subscription.id}
                isLast={index === displaySubscriptions.length - 1}
                onToggle={() =>
                  setExpandedId((current) => (current === subscription.id ? null : subscription.id))
                }
              />
            ))}
          </Card>
        </View>

        <Card>
          <Text style={styles.detailTitle}>Cómo las detectamos</Text>
          <Text style={[styles.detailCopy, { color: palette.muted }]}>
            Buscamos coincidencias de comercio, monto y cadencia. Si el patrón cambia o deja de aparecer,
            te lo explicamos sin adivinar.
          </Text>
        </Card>
      </ScrollView>
    </PremiumSurface>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 16, gap: 22, paddingBottom: 132 },
  emptyContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 16, gap: 24, justifyContent: 'center' },
  title: { fontSize: 36, lineHeight: 42, fontWeight: '700', letterSpacing: -1.25 },
  heroGroup: { paddingBottom: 34 },
  hero: { minHeight: 218, justifyContent: 'space-between' },
  heroWithAlert: { paddingBottom: 68 },
  heroAmount: { color: '#FFFFFF', fontSize: 43, lineHeight: 49, fontWeight: '700', letterSpacing: -1.7, fontVariant: ['tabular-nums'] },
  heroUnit: { color: '#FFFFFF', fontSize: 20, lineHeight: 25, marginTop: 1 },
  heroCaption: { color: 'rgba(255,255,255,0.76)', fontSize: 16 },
  alertOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 78,
    borderRadius: 23,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(196, 44, 44, 0.08)',
    ...Platform.select({
      ios: { shadowColor: '#5B2020', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.13, shadowRadius: 20 },
      android: { elevation: 7 },
      default: { boxShadow: '0 14px 28px rgba(91, 32, 32, 0.13)' },
    }),
  },
  alertIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  alertIconText: { fontSize: 24, fontWeight: '600' },
  alertText: { flex: 1, fontSize: 14, fontWeight: '600' },
  review: { fontSize: 13, fontWeight: '600' },
  chevron: { fontSize: 24, fontWeight: '300' },
  section: { gap: 12 },
  subscriptionList: { padding: 6, gap: 0 },
  detailTitle: { fontSize: 16, fontWeight: '700' },
  detailCopy: { fontSize: 13, lineHeight: 19 },
});
