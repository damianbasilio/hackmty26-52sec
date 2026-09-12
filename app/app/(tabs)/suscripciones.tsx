import type { Subscription } from '@contracts/types';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View as RawView } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Card } from '@/components/Card';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { SubscriptionCard } from '@/components/SubscriptionCard';
import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';
import { EmptyState } from '@/components/ui';
import { dataSource } from '@/src/data';
import { formatCents } from '@/src/format';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; subscriptions: Subscription[] };

const LOAD_ERROR =
  'Necesitamos tus movimientos para encontrar cargos recurrentes y ahora no pudimos leerlos. Revisa tu conexión e inténtalo de nuevo.';

export default function SuscripcionesScreen() {
  const palette = usePalette();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const accounts = await dataSource.getAccounts();
      const account = accounts.find((a) => a.type === 'checking') ?? accounts[0];
      setState({ kind: 'ready', subscriptions: await dataSource.getSubscriptions(account.id) });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (state.kind === 'loading') return <LoadingState label="Buscando tus cargos recurrentes…" />;
  if (state.kind === 'error') return <ErrorState message={LOAD_ERROR} onRetry={retry} />;

  const { subscriptions } = state;

  if (subscriptions.length === 0) {
    return (
      <ScrollView
        style={{ backgroundColor: palette.background }}
        contentContainerStyle={styles.emptyContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.accent} />}>
        <EmptyState
          title="Todavía no vemos suscripciones"
          hint="Marcamos un cargo como suscripción cuando el mismo comercio te cobra varias veces con la misma cadencia. Tus movimientos aún no repiten ese patrón, así que preferimos no adivinar. En cuanto se repita, aparece aquí."
        />
      </ScrollView>
    );
  }

  const annualTotal = subscriptions.reduce((sum, s) => sum + s.annual_cost_cents, 0);
  const increased = subscriptions.filter((s) => s.price_increase_detected);
  const increaseTotal = increased.reduce((sum, s) => sum + (s.price_delta_cents ?? 0), 0);
  const unused = subscriptions.filter((s) => s.status === 'unused');
  const unusedAnnual = unused.reduce((sum, s) => sum + s.annual_cost_cents, 0);

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.accent} />}>
      <Card>
        <Text style={[styles.eyebrow, { color: palette.muted }]}>Gasto fijo detectado</Text>
        <Text style={styles.total}>{formatCents(annualTotal)}</Text>
        <Text style={[styles.totalHint, { color: palette.muted }]}>
          al año en {subscriptions.length} {subscriptions.length === 1 ? 'suscripción' : 'suscripciones'}
        </Text>

        {(increased.length > 0 || unused.length > 0) && (
          <RawView style={[styles.divider, { backgroundColor: palette.border }]} />
        )}

        {increased.length > 0 && (
          <Text style={[styles.flag, { color: palette.danger }]}>
            {increased.map((s) => s.merchant_display_name).join(', ')}{' '}
            {increased.length === 1 ? 'subió' : 'subieron'} de precio: {formatCents(increaseTotal)} más
            por cobro.
          </Text>
        )}

        {unused.length > 0 && (
          <Text style={[styles.flag, { color: palette.warning }]}>
            No usas {unused.length === 1 ? '1 suscripción' : `${unused.length} suscripciones`}:{' '}
            {formatCents(unusedAnnual)} al año que puedes recuperar.
          </Text>
        )}
      </Card>

      <Text style={[styles.sectionTitle, { color: palette.muted }]}>Tus suscripciones</Text>

      {subscriptions.map((subscription, i) => (
        <Animated.View key={subscription.id} entering={FadeInDown.delay(60 * i).duration(320)}>
          <SubscriptionCard subscription={subscription} />
        </Animated.View>
      ))}

      <Text style={[styles.footerText, { color: palette.muted }]}>
        Detectamos estos cargos por su cadencia, no por una lista de comercios. Cada monto viene de tus
        movimientos.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  emptyContent: { flexGrow: 1, padding: 16 },
  eyebrow: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  total: { fontSize: 36, fontWeight: '800', fontVariant: ['tabular-nums'] },
  totalHint: { fontSize: 14, marginTop: -6 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  flag: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 8 },
  footerText: { fontSize: 12, lineHeight: 17, marginTop: 4 },
});
