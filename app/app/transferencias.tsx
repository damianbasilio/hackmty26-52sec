import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown, LinearTransition, ReduceMotion } from 'react-native-reanimated';

import { useAuth } from '@/components/AuthProvider';
import {
  TRANSFER_RECIPIENTS,
  useBanking,
  type TransferReceipt,
  type TransferRecipient,
} from '@/components/BankingProvider';
import { Card } from '@/components/Card';
import { MotionPressable, Reveal } from '@/components/Motion';
import { PremiumSurface } from '@/components/PremiumSurface';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';
import { useAsync } from '@/components/useAsync';
import { dataSource } from '@/src/data';
import { formatCents } from '@/src/format';
import { moneyInputToCents, normalizeMoneyInput } from '@/src/moneyInput';

type Step = 'form' | 'confirm' | 'success';

export default function TransferenciasScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { verifyTransactionPin, demoPin } = useAuth();
  const { outgoingCents, sendTransfer } = useBanking();
  const [step, setStep] = useState<Step>('form');
  const [recipient, setRecipient] = useState<TransferRecipient>(TRANSFER_RECIPIENTS[0]);
  const [amount, setAmount] = useState('');
  const [concept, setConcept] = useState('');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<TransferReceipt | null>(null);
  const { data, error, loading, reload } = useAsync(async () => {
    const accounts = await dataSource.getAccounts();
    return accounts.find((account) => account.type === 'checking') ?? accounts[0] ?? null;
  });

  if (loading && !data) return <LoadingState label="Preparando transferencia…" />;
  if (error || !data) return <ErrorState message={error ?? 'No encontramos tu cuenta.'} onRetry={reload} />;

  const amountCents = moneyInputToCents(amount);
  const availableCents = Math.max(0, data.balance_cents - outgoingCents);

  function continueToConfirmation() {
    if (amountCents <= 0) {
      setMessage('Ingresa una cantidad mayor a cero.');
      return;
    }
    if (amountCents > availableCents) {
      setMessage('La cantidad supera tu saldo disponible.');
      return;
    }
    setMessage(null);
    setStep('confirm');
  }

  async function confirmTransfer() {
    if (pin.length !== 6) {
      setMessage('Ingresa tu PIN de 6 dígitos.');
      return;
    }
    setSubmitting(true);
    setMessage(null);
    const verified = await verifyTransactionPin(pin);
    if (!verified) {
      setMessage('El PIN no coincide. Revisa e inténtalo nuevamente.');
      setSubmitting(false);
      return;
    }
    const result = await sendTransfer({
      recipient,
      amountCents,
      concept: concept.trim() || 'Transferencia',
    });
    setReceipt(result);
    setSubmitting(false);
    setStep('success');
  }

  if (step === 'success' && receipt) {
    return (
      <PremiumSurface>
        <View style={styles.successScreen}>
          <Reveal style={[styles.successIcon, { backgroundColor: palette.positiveSoft }]}>
            <SymbolView
              name={{ ios: 'checkmark', android: 'check', web: 'check' }}
              tintColor={palette.positive}
              size={36}
            />
          </Reveal>
          <Reveal delay={60} style={styles.successCopy}>
            <Text style={styles.successTitle}>Transferencia enviada</Text>
            <Text style={styles.successAmount}>{formatCents(receipt.amountCents)}</Text>
            <Text style={[styles.successBody, { color: palette.muted }]}>a {receipt.recipient.name}</Text>
          </Reveal>
          <Reveal delay={120} style={styles.successReceipt}>
            <Card tone="mint">
              <SummaryRow label="Estado" value="Aplicada" valueColor={palette.positive} />
              <SummaryRow label="Concepto" value={receipt.concept} />
              <SummaryRow label="Folio" value={receipt.id.replace('transfer_', '')} />
            </Card>
          </Reveal>
          <MotionPressable
            accessibilityRole="button"
            onPress={() => router.replace('/' as never)}
            style={[styles.primaryButton, { backgroundColor: palette.accentDeep }]}>
            <Text style={styles.primaryLabel}>Volver al inicio</Text>
          </MotionPressable>
        </View>
      </PremiumSurface>
    );
  }

  return (
    <PremiumSurface>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <MotionPressable accessibilityLabel="Regresar" hitSlop={10} onPress={() => step === 'confirm' ? setStep('form') : router.back()} style={styles.backButton}>
              <Text style={[styles.backGlyph, { color: palette.accentDeep }]}>‹</Text>
            </MotionPressable>
            <Text style={styles.title}>{step === 'confirm' ? 'Confirmar' : 'Transferir'}</Text>
            <View style={styles.headerSpacer} />
          </View>

          {step === 'form' ? (
            <>
              <Reveal>
                <Card tone="sage" style={styles.sourceCard}>
                  <View style={[styles.sourceIcon, { backgroundColor: palette.surface }]}>
                    <SymbolView
                      name={{ ios: 'creditcard.fill', android: 'account_balance_wallet', web: 'credit_card' }}
                      tintColor={palette.accent}
                      size={22}
                    />
                  </View>
                  <View style={styles.sourceCopy}>
                    <Text style={styles.sourceLabel}>{data.nickname} ·· {data.last_four}</Text>
                    <Text style={[styles.sourceMeta, { color: palette.muted }]}>Saldo disponible</Text>
                  </View>
                  <Text style={styles.sourceAmount}>{formatCents(availableCents)}</Text>
                </Card>
              </Reveal>

              <Reveal delay={50} style={styles.section}>
                <Text style={styles.sectionTitle}>¿A quién?</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recipientList}>
                  {TRANSFER_RECIPIENTS.map((item) => {
                    const selected = recipient.id === item.id;
                    return (
                      <MotionPressable
                        key={item.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setRecipient(item)}
                        style={[
                          styles.recipient,
                          {
                            backgroundColor: selected ? palette.accentDeep : palette.surface,
                            borderColor: selected ? palette.accentDeep : palette.border,
                          },
                        ]}>
                        <View style={[styles.recipientAvatar, { backgroundColor: item.color }]}>
                          <Text style={[styles.recipientInitials, { color: palette.accentDeep }]}>{item.initials}</Text>
                        </View>
                        <Text numberOfLines={1} style={[styles.recipientName, selected ? styles.selectedText : null]}>{item.name.split(' ')[0]}</Text>
                        <Text style={[styles.recipientBank, { color: selected ? 'rgba(255,255,255,0.68)' : palette.muted }]}>{item.bank}</Text>
                      </MotionPressable>
                    );
                  })}
                </ScrollView>
              </Reveal>

              <Reveal delay={100}>
                <Card style={styles.amountCard}>
                  <Text style={[styles.amountLabel, { color: palette.muted }]}>Cantidad</Text>
                  <View style={styles.amountField}>
                    <Text style={styles.currency}>$</Text>
                    <TextInput
                      accessibilityLabel="Cantidad a transferir"
                      autoFocus={false}
                      keyboardType="decimal-pad"
                      onChangeText={(value) => setAmount(normalizeMoneyInput(value))}
                      placeholder="0.00"
                      placeholderTextColor={palette.muted}
                      style={[styles.amountInput, { color: palette.ink }]}
                      value={amount}
                    />
                  </View>
                  <View style={[styles.divider, { backgroundColor: palette.border }]} />
                  <TextInput
                    accessibilityLabel="Concepto"
                    maxLength={40}
                    onChangeText={setConcept}
                    placeholder="Concepto opcional"
                    placeholderTextColor={palette.muted}
                    style={[styles.conceptInput, { color: palette.ink }]}
                    value={concept}
                  />
                </Card>
              </Reveal>

              {message ? <Message text={message} /> : null}
              <MotionPressable
                accessibilityRole="button"
                onPress={continueToConfirmation}
                style={[styles.primaryButton, { backgroundColor: palette.accentDeep }]}>
                <Text style={styles.primaryLabel}>Continuar</Text>
              </MotionPressable>
            </>
          ) : (
            <Animated.View
              entering={FadeInDown.duration(240).reduceMotion(ReduceMotion.System)}
              layout={LinearTransition.duration(220).reduceMotion(ReduceMotion.System)}
              style={styles.confirmStack}>
              <Card style={styles.confirmHero}>
                <View style={[styles.confirmAvatar, { backgroundColor: recipient.color }]}>
                  <Text style={[styles.confirmInitials, { color: palette.accentDeep }]}>{recipient.initials}</Text>
                </View>
                <Text style={styles.confirmName}>{recipient.name}</Text>
                <Text style={[styles.confirmBank, { color: palette.muted }]}>{recipient.bank} ·· {recipient.accountLastFour}</Text>
                <Text style={styles.confirmAmount}>{formatCents(amountCents)}</Text>
              </Card>

              <Card tone="sage">
                <SummaryRow label="Cuenta origen" value={`${data.nickname} ·· ${data.last_four}`} />
                <SummaryRow label="Concepto" value={concept.trim() || 'Transferencia'} />
              </Card>

              <Card style={styles.pinCard}>
                <View style={styles.pinHeading}>
                  <SymbolView
                    name={{ ios: 'lock.shield.fill', android: 'verified_user', web: 'shield' }}
                    tintColor={palette.accent}
                    size={22}
                  />
                  <View style={styles.pinCopy}>
                    <Text style={styles.pinTitle}>Autoriza con tu PIN</Text>
                    <Text style={[styles.pinSubtitle, { color: palette.muted }]}>Esta confirmación protege cada movimiento.</Text>
                  </View>
                </View>
                <TextInput
                  accessibilityLabel="PIN para autorizar transferencia"
                  keyboardType="number-pad"
                  maxLength={6}
                  onChangeText={(value) => setPin(value.replace(/\D/g, ''))}
                  placeholder="••••••"
                  placeholderTextColor={palette.muted}
                  secureTextEntry
                  style={[styles.pinInput, { backgroundColor: palette.surfaceAlt, borderColor: palette.border, color: palette.ink }]}
                  value={pin}
                />
                <MotionPressable onPress={() => setPin(demoPin)} style={styles.demoPinButton}>
                  <Text style={[styles.demoPinLabel, { color: palette.accent }]}>Usar PIN de demostración</Text>
                </MotionPressable>
              </Card>

              {message ? <Message text={message} /> : null}
              <MotionPressable
                accessibilityRole="button"
                disabled={submitting}
                onPress={confirmTransfer}
                style={[styles.primaryButton, { backgroundColor: palette.accentDeep, opacity: submitting ? 0.55 : 1 }]}>
                <Text style={styles.primaryLabel}>{submitting ? 'Enviando…' : `Enviar ${formatCents(amountCents)}`}</Text>
              </MotionPressable>
            </Animated.View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </PremiumSurface>
  );
}

function SummaryRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  const palette = usePalette();
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, { color: palette.muted }]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.summaryValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

function Message({ text }: { text: string }) {
  const palette = usePalette();
  return (
    <View style={[styles.message, { backgroundColor: palette.dangerSoft }]}>
      <Text style={[styles.messageText, { color: palette.danger }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 52, gap: 18 },
  header: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  backGlyph: { fontSize: 38, lineHeight: 40, fontWeight: '300' },
  headerSpacer: { width: 42 },
  title: { fontSize: 18, fontWeight: '700' },
  sourceCard: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15 },
  sourceIcon: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  sourceCopy: { flex: 1, gap: 4, backgroundColor: 'transparent' },
  sourceLabel: { fontSize: 15, fontWeight: '700' },
  sourceMeta: { fontSize: 12 },
  sourceAmount: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  section: { gap: 11 },
  sectionTitle: { fontSize: 21, fontWeight: '700', letterSpacing: -0.4 },
  recipientList: { gap: 10, paddingRight: 20 },
  recipient: { width: 112, minHeight: 126, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 13, justifyContent: 'space-between' },
  recipientAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  recipientInitials: { fontSize: 16, fontWeight: '700' },
  recipientName: { fontSize: 15, fontWeight: '700' },
  recipientBank: { fontSize: 11 },
  selectedText: { color: '#FFFFFF' },
  amountCard: { gap: 8 },
  amountLabel: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  amountField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  currency: { fontSize: 34, lineHeight: 44, fontWeight: '600' },
  amountInput: { minWidth: 90, maxWidth: 230, fontSize: 44, lineHeight: 52, fontWeight: '700', letterSpacing: -1.5, fontVariant: ['tabular-nums'], textAlign: 'center' },
  divider: { height: StyleSheet.hairlineWidth },
  conceptInput: { minHeight: 42, fontSize: 15, textAlign: 'center' },
  message: { borderRadius: 15, paddingHorizontal: 14, paddingVertical: 11 },
  messageText: { fontSize: 13, lineHeight: 18, fontWeight: '600', textAlign: 'center' },
  primaryButton: { minHeight: 58, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  confirmStack: { gap: 16 },
  confirmHero: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  confirmAvatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  confirmInitials: { fontSize: 23, fontWeight: '700' },
  confirmName: { fontSize: 19, fontWeight: '700' },
  confirmBank: { fontSize: 13 },
  confirmAmount: { fontSize: 38, lineHeight: 44, fontWeight: '700', letterSpacing: -1.1, marginTop: 10, fontVariant: ['tabular-nums'] },
  summaryRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, backgroundColor: 'transparent' },
  summaryLabel: { fontSize: 13 },
  summaryValue: { maxWidth: '62%', fontSize: 14, fontWeight: '600', textAlign: 'right' },
  pinCard: { gap: 14 },
  pinHeading: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: 'transparent' },
  pinCopy: { flex: 1, gap: 3, backgroundColor: 'transparent' },
  pinTitle: { fontSize: 16, fontWeight: '700' },
  pinSubtitle: { fontSize: 12, lineHeight: 17 },
  pinInput: { minHeight: 58, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, fontSize: 24, fontWeight: '700', letterSpacing: 10, textAlign: 'center' },
  demoPinButton: { minHeight: 34, alignItems: 'center', justifyContent: 'center' },
  demoPinLabel: { fontSize: 13, fontWeight: '600' },
  successScreen: { flex: 1, paddingHorizontal: 20, paddingTop: 86, paddingBottom: 42, alignItems: 'center', gap: 22 },
  successIcon: { width: 82, height: 82, borderRadius: 41, alignItems: 'center', justifyContent: 'center' },
  successCopy: { alignItems: 'center', gap: 7 },
  successTitle: { fontSize: 25, fontWeight: '700', letterSpacing: -0.65 },
  successAmount: { fontSize: 43, lineHeight: 49, fontWeight: '700', letterSpacing: -1.4, fontVariant: ['tabular-nums'] },
  successBody: { fontSize: 15 },
  successReceipt: { alignSelf: 'stretch' },
});
