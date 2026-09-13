import * as Clipboard from 'expo-clipboard';
import { SymbolView } from 'expo-symbols';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';

import type { AccountType } from '@contracts/types';

import { Card } from '@/components/Card';
import { HeroCard } from '@/components/HeroCard';
import { MotionPressable, Reveal } from '@/components/Motion';
import { OptionSheet } from '@/components/OptionSheet';
import { PremiumSurface } from '@/components/PremiumSurface';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';
import { Chevron, Toast } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { demoClabe, formatClabe } from '@/src/clabe';
import { dataSource } from '@/src/data';
import { formatCents } from '@/src/format';

const TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Cuenta de cheques',
  savings: 'Cuenta de ahorro',
  credit_card: 'Tarjeta de crédito',
};

export default function DatosCuentaScreen() {
  const palette = usePalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ accountId?: string }>();
  const [selectedId, setSelectedId] = useState<string | null>(params.accountId ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const { data, error, loading, reload } = useAsync(async () => {
    const [customer, accounts] = await Promise.all([dataSource.getCustomer(), dataSource.getAccounts()]);
    return { customer, accounts };
  });

  if (loading && !data) return <LoadingState label="Cargando tus datos…" />;
  if (error || !data) return <ErrorState message={error ?? 'Sin datos.'} onRetry={reload} />;

  const { customer, accounts } = data;
  const account = accounts.find((candidate) => candidate.id === selectedId)
    ?? accounts.find((candidate) => candidate.type === 'checking')
    ?? accounts[0];
  if (!account) return <ErrorState message="No hay cuentas disponibles." onRetry={reload} />;

  const holder = `${customer.first_name} ${customer.last_name}`.trim();
  const clabe = demoClabe(account.id, account.last_four);

  async function copy(value: string, label: string) {
    try {
      await Clipboard.setStringAsync(value);
      setNotice(`${label} copiada.`);
    } catch {
      setNotice('No pudimos copiar. Mantén presionado el texto para seleccionarlo.');
    }
  }

  function share() {
    Share.share({
      title: 'Mis datos bancarios',
      message: [
        'Mis datos para transferirme',
        '',
        `Titular: ${holder}`,
        'Banco: Capital One',
        `CLABE: ${clabe}`,
        `Cuenta: ${account.nickname} terminación ${account.last_four}`,
      ].join('\n'),
    }).catch(() => undefined);
  }

  return (
    <PremiumSurface>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <MotionPressable accessibilityLabel="Regresar" hitSlop={10} onPress={() => router.back()} style={styles.backButton}>
            <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} tintColor={palette.ink} size={20} />
          </MotionPressable>
          <Text style={styles.title}>Datos de tu cuenta</Text>
          <View style={styles.headerSpacer} />
        </View>

        {accounts.length > 1 ? (
          <Reveal>
            <MotionPressable
              accessibilityHint="Elige qué cuenta mostrar"
              accessibilityRole="button"
              onPress={() => setPickerOpen(true)}
              style={[styles.accountPicker, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <SymbolView name={{ ios: 'creditcard.fill', android: 'credit_card', web: 'credit_card' }} tintColor={palette.accent} size={17} />
              <Text numberOfLines={1} style={styles.accountPickerLabel}>{account.nickname} ·· {account.last_four}</Text>
              <Chevron direction="down" />
            </MotionPressable>
          </Reveal>
        ) : null}

        <Reveal delay={50}>
          <HeroCard style={styles.hero}>
            <View style={styles.heroTop}>
              <Text style={styles.heroLabel}>CLABE interbancaria</Text>
              <Text numberOfLines={1} style={styles.holder}>{holder}</Text>
            </View>
            <Text adjustsFontSizeToFit numberOfLines={1} selectable style={styles.clabe}>{formatClabe(clabe)}</Text>
            <MotionPressable
              accessibilityRole="button"
              onPress={() => copy(clabe, 'CLABE')}
              style={[styles.copyHero, { backgroundColor: palette.accentSoft, borderColor: palette.border }]}>
              <SymbolView name={{ ios: 'doc.on.doc.fill', android: 'content_copy', web: 'content_copy' }} tintColor={palette.accent} size={16} />
              <Text style={[styles.copyHeroLabel, { color: palette.accent }]}>Copiar CLABE</Text>
            </MotionPressable>
          </HeroCard>
        </Reveal>

        <Reveal delay={100}>
          <Card style={styles.details}>
            <DetailRow label="Titular" value={holder} onCopy={() => copy(holder, 'Nombre del titular')} />
            <DetailRow label="Banco" value="Capital One" />
            <DetailRow label="Tipo de cuenta" value={TYPE_LABELS[account.type]} />
            <DetailRow label="Número de cuenta" value={`Terminación ·· ${account.last_four}`} />
            <DetailRow label="Saldo disponible" value={formatCents(account.balance_cents)} last />
          </Card>
        </Reveal>

        <Reveal delay={140}>
          <MotionPressable
            accessibilityRole="button"
            onPress={share}
            style={[styles.primaryButton, { backgroundColor: palette.primary }]}>
            <SymbolView name={{ ios: 'square.and.arrow.up', android: 'share', web: 'share' }} tintColor={palette.onPrimary} size={18} />
            <Text style={[styles.primaryLabel, { color: palette.onPrimary }]}>Compartir mis datos</Text>
          </MotionPressable>
        </Reveal>

        <Reveal delay={170}>
          <View style={[styles.note, { backgroundColor: palette.warningSoft }]}>
            <SymbolView name={{ ios: 'info.circle.fill', android: 'info', web: 'info' }} tintColor={palette.warning} size={17} />
            <Text style={[styles.noteText, { color: palette.warning }]}>
              CLABE de demostración: tiene un formato válido para practicar, pero no recibe transferencias reales.
              Al compartir no se incluye tu saldo.
            </Text>
          </View>
        </Reveal>
      </ScrollView>

      <OptionSheet
        visible={pickerOpen}
        title="¿Qué cuenta quieres mostrar?"
        options={accounts.map((candidate) => ({
          key: candidate.id,
          label: `${candidate.nickname} ·· ${candidate.last_four}`,
          detail: `${TYPE_LABELS[candidate.type]} · ${formatCents(candidate.balance_cents)}`,
        }))}
        selectedKey={account.id}
        onSelect={(key) => {
          setSelectedId(key);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />

      {notice ? <Toast key={notice} text={notice} tone="positive" autoHideMs={2500} onDismiss={dismissNotice} /> : null}
    </PremiumSurface>
  );
}

function DetailRow({ label, value, onCopy, last = false }: { label: string; value: string; onCopy?: () => void; last?: boolean }) {
  const palette = usePalette();
  return (
    <View style={[styles.row, !last ? { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth } : null]}>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowLabel, { color: palette.muted }]}>{label}</Text>
        <Text selectable style={styles.rowValue}>{value}</Text>
      </View>
      {onCopy ? (
        <MotionPressable accessibilityLabel={`Copiar ${label.toLowerCase()}`} accessibilityRole="button" hitSlop={8} onPress={onCopy} style={styles.copyButton}>
          <SymbolView name={{ ios: 'doc.on.doc', android: 'content_copy', web: 'content_copy' }} tintColor={palette.accent} size={17} />
        </MotionPressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 52, gap: 18 },
  header: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: 42 },
  title: { fontSize: 18, fontWeight: '700' },
  accountPicker: { minHeight: 52, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 10 },
  accountPickerLabel: { flex: 1, fontSize: 15, fontWeight: '600' },
  hero: { minHeight: 210, justifyContent: 'space-between', gap: 16 },
  heroTop: { gap: 4 },
  heroLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  holder: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  clabe: { color: '#FFFFFF', fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: 0.5, fontVariant: ['tabular-nums'], textAlign: 'center' },
  copyHero: { alignSelf: 'center', minHeight: 40, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
  copyHeroLabel: { fontSize: 14, fontWeight: '700' },
  details: { paddingVertical: 4, gap: 0 },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowCopy: { flex: 1, gap: 3 },
  rowLabel: { fontSize: 12, fontWeight: '600' },
  rowValue: { fontSize: 15, fontWeight: '600' },
  copyButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  primaryButton: { minHeight: 58, borderRadius: 29, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  primaryLabel: { fontSize: 16, fontWeight: '700' },
  note: { borderRadius: 15, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  noteText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '600' },
});
