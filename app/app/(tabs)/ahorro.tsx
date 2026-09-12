import { useState } from 'react';
import { View as Box, ScrollView, StyleSheet } from 'react-native';

import type { SavingsRule } from '@contracts/types';

import { Text } from '@/components/Themed';
import { SAVINGS_KIND_LABELS } from '@/components/display';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  LoadingState,
  SectionTitle,
  spacing,
  usePalette,
} from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { dataSource } from '@/src/data';
import { formatCents } from '@/src/format';

export default function AhorroScreen() {
  const p = usePalette();
  const [activating, setActivating] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, error, loading, reload } = useAsync(async () => {
    const accounts = await dataSource.getAccounts();
    const checking = accounts.find((a) => a.type === 'checking') ?? accounts[0];
    if (!checking) throw new Error('No hay cuentas disponibles.');
    const savings = accounts.find((a) => a.type === 'savings') ?? null;
    const rules = await dataSource.getSavingsRules(checking.id);
    return { savings, rules };
  });

  if (loading) return <LoadingState label="Cargando tus reglas…" />;
  if (error || !data) return <ErrorState message={error ?? 'Sin datos.'} onRetry={reload} />;

  const active = data.rules.filter((r) => r.status !== 'suggested');
  const suggested = data.rules.filter((r) => r.status === 'suggested');
  const savedToDate = active.reduce((sum, r) => sum + r.saved_to_date_cents, 0);
  const projected = suggested.reduce((sum, r) => sum + r.projected_annual_savings_cents, 0);

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
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'No pudimos activar la regla.');
    } finally {
      setActivating(null);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: p.background }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <Card>
        <Text style={[styles.summaryLabel, { color: p.muted }]}>Llevas ahorrado</Text>
        <Text style={[styles.summaryAmount, { color: p.text }]}>{formatCents(savedToDate)}</Text>
        {projected > 0 ? (
          <Text style={[styles.summaryHint, { color: p.muted }]}>
            Si activas lo sugerido, podrías juntar {formatCents(projected)} más al año.
          </Text>
        ) : null}
      </Card>

      {actionError ? (
        <Card style={{ borderColor: p.critical }}>
          <Text style={[styles.summaryHint, { color: p.critical }]}>{actionError}</Text>
        </Card>
      ) : null}

      <Box style={styles.section}>
        <SectionTitle>Reglas activas</SectionTitle>
        {active.length === 0 ? (
          <Card>
            <Text style={[styles.summaryHint, { color: p.muted }]}>
              Todavía no tienes reglas activas. Activa una sugerencia para empezar.
            </Text>
          </Card>
        ) : (
          <Box style={styles.stack}>
            {active.map((rule) => (
              <RuleCard key={rule.id} rule={rule} />
            ))}
          </Box>
        )}
      </Box>

      <Box style={styles.section}>
        <SectionTitle>Sugerencias para ti</SectionTitle>
        {suggested.length === 0 ? (
          <EmptyState
            title="Nada pendiente por ahora"
            hint="Cuando detectemos otra forma de ahorrar te la proponemos aquí."
          />
        ) : (
          <Box style={styles.stack}>
            {suggested.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                onActivate={() => activate(rule)}
                busy={activating === rule.id}
              />
            ))}
          </Box>
        )}
      </Box>
    </ScrollView>
  );
}

function RuleCard({
  rule,
  onActivate,
  busy,
}: {
  rule: SavingsRule;
  onActivate?: () => void;
  busy?: boolean;
}) {
  const p = usePalette();
  const suggested = rule.status === 'suggested';

  return (
    <Card>
      <Box style={styles.ruleHead}>
        <Text style={[styles.ruleTitle, { color: p.text }]}>{rule.title}</Text>
        <Chip label={SAVINGS_KIND_LABELS[rule.kind]} />
      </Box>
      <Text style={[styles.ruleBody, { color: p.muted }]}>{rule.description}</Text>

      <Box style={[styles.ruleFooter, { borderColor: p.border }]}>
        <Box>
          <Text style={[styles.ruleMetricLabel, { color: p.muted }]}>
            {suggested ? 'Ahorro estimado al año' : 'Ahorrado hasta hoy'}
          </Text>
          <Text style={[styles.ruleMetric, { color: suggested ? p.text : p.positive }]}>
            {formatCents(
              suggested ? rule.projected_annual_savings_cents : rule.saved_to_date_cents
            )}
          </Text>
        </Box>
        {onActivate ? (
          <Button label={busy ? 'Activando…' : 'Activar'} onPress={onActivate} disabled={busy} />
        ) : (
          <Chip label="Activa" tone={{ background: p.infoBg, color: p.info }} />
        )}
      </Box>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl * 2 },
  section: { gap: 0 },
  stack: { gap: spacing.md },
  summaryLabel: { fontSize: 13 },
  summaryAmount: { fontSize: 34, fontWeight: '700', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  summaryHint: { fontSize: 14, lineHeight: 20 },
  ruleHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  ruleTitle: { flex: 1, fontSize: 16, fontWeight: '700' },
  ruleBody: { fontSize: 14, lineHeight: 20 },
  ruleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
    marginTop: spacing.xs,
  },
  ruleMetricLabel: { fontSize: 12 },
  ruleMetric: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
