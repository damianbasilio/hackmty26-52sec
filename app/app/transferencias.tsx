import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

import type { Account } from '@contracts/types';

import { useAuth } from '@/components/AuthProvider';
import { useBanking } from '@/components/BankingProvider';
import { Card } from '@/components/Card';
import { FormScroll } from '@/components/FormScroll';
import { MotionPressable, Reveal } from '@/components/Motion';
import { OptionSheet } from '@/components/OptionSheet';
import { PinEntry } from '@/components/PinEntry';
import { PremiumSurface } from '@/components/PremiumSurface';
import { ErrorState, LoadingState } from '@/components/ScreenState';
import { Text } from '@/components/Themed';
import { avatarTintFor, initialsFor } from '@/components/display';
import { usePalette } from '@/components/palette';
import { TRANSFER_STATUS_LABELS as STATUS_LABELS, shareReceipt, transferReceipt } from '@/components/receipt';
import { Chevron } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { bankForClabe, clabeLastFour, formatClabe, isValidClabe } from '@/src/clabe';
import { dataSource } from '@/src/data';
import { newTransferId, type Transfer, type TransferRecipient } from '@/src/data/DataSource';
import { formatCents } from '@/src/format';
import { moneyInputToCents, moneyMaxLength, normalizeMoneyInput, withCents } from '@/src/moneyInput';

type Step = 'form' | 'confirm' | 'success';

const NEW_PAYEE_ID = '__nuevo__';

const ACCOUNT_TYPE_LABELS: Record<Account['type'], string> = {
  checking: 'Cheques',
  savings: 'Ahorro',
  credit_card: 'Tarjeta',
};

/** Encoge el monto conforme crece para que los centavos nunca se corten. */
function amountFontSize(text: string): number {
  if (text.length > 10) return 30;
  if (text.length > 7) return 36;
  return 44;
}

export default function TransferenciasScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { verifyTransactionPin } = useAuth();
  const {
    recipients,
    sendTransfer,
    loading: loadingRecipients,
    error: recipientsError,
    reload: reloadRecipients,
  } = useBanking();
  const [step, setStep] = useState<Step>('form');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [payeeName, setPayeeName] = useState('');
  const [payeeClabe, setPayeeClabe] = useState('');
  const [amount, setAmount] = useState('');
  const [concept, setConcept] = useState('');
  const [pin, setPin] = useState('');
  const [pinErrors, setPinErrors] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Transfer | null>(null);
  // Clave de idempotencia: se fija al entrar a confirmar y sobrevive los
  // reintentos, así un segundo toque no manda el dinero dos veces.
  const [transferId, setTransferId] = useState<string | null>(null);
  const { data: accounts, error, loading, reload } = useAsync(() => dataSource.getAccounts());

  if ((loading && !accounts) || (loadingRecipients && recipients.length === 0)) {
    return <LoadingState label="Preparando transferencia…" />;
  }
  if (error || !accounts) return <ErrorState message={error ?? 'No encontramos tus cuentas.'} onRetry={reload} />;
  if (recipientsError) return <ErrorState message={recipientsError} onRetry={reloadRecipients} />;

  const source = accounts.find((account) => account.id === sourceId)
    ?? accounts.find((account) => account.type === 'checking')
    ?? accounts[0];
  if (!source) return <ErrorState message="No encontramos tu cuenta." onRetry={reload} />;

  // Tus otras cuentas salen de la lista de cuentas: cambian con el origen elegido.
  const ownIds = new Set(accounts.map((account) => account.id));
  const ownClabes = new Set(accounts.map((account) => account.clabe).filter(Boolean));
  const payees: TransferRecipient[] = [
    ...accounts
      .filter((account) => account.id !== source.id)
      .map((account) => ({
        id: `own_${account.id}`,
        name: account.nickname,
        bank: 'Capital One',
        last_four: account.last_four,
        clabe: account.clabe,
        account_id: account.id,
      })),
    ...recipients.filter((item) =>
      !(item.account_id && ownIds.has(item.account_id)) && !(item.clabe && ownClabes.has(item.clabe))),
  ];

  const clabeComplete = payeeClabe.length === 18;
  const clabeValid = clabeComplete && isValidClabe(payeeClabe);
  const addingPayee = selectedId === NEW_PAYEE_ID || payees.length === 0;
  const recipient: TransferRecipient | null = addingPayee
    ? payeeName.trim().length > 0
      ? {
          id: NEW_PAYEE_ID,
          name: payeeName.trim(),
          bank: clabeValid ? bankForClabe(payeeClabe) : null,
          last_four: clabeValid ? clabeLastFour(payeeClabe) : null,
          clabe: clabeValid ? payeeClabe : null,
          account_id: null,
        }
      : null
    : payees.find((item) => item.id === selectedId) ?? payees[0];

  const amountCents = moneyInputToCents(amount);
  const availableCents = Math.max(0, source.balance_cents);

  function continueToConfirmation() {
    if (!recipient) {
      setMessage('Escribe a quién le vas a transferir.');
      return;
    }
    if (addingPayee && !clabeComplete) {
      setMessage('Escribe los 18 dígitos de la CLABE de quien recibe.');
      return;
    }
    if (addingPayee && !clabeValid) {
      setMessage('Esa CLABE no es válida. Revisa los dígitos con quien te la dio.');
      return;
    }
    if (recipient.clabe && recipient.clabe === source.clabe) {
      setMessage('No puedes transferir a la misma cuenta de origen.');
      return;
    }
    if (amountCents <= 0) {
      setMessage('Ingresa una cantidad mayor a cero.');
      return;
    }
    if (amountCents > availableCents) {
      setMessage(`No tienes saldo suficiente en ${source.nickname}. Disponible: ${formatCents(availableCents)}.`);
      return;
    }
    setMessage(null);
    setAmount(withCents(amount));
    setTransferId((current) => current ?? newTransferId());
    setStep('confirm');
  }

  function backToForm() {
    // Editar el borrador es otra transferencia: la llave de idempotencia se renueva.
    setStep('form');
    setTransferId(null);
    setPin('');
    setMessage(null);
  }

  async function confirmTransfer(value = pin) {
    if (!recipient || !transferId || submitting) return;
    if (value.length !== 6) {
      setMessage('Ingresa tu PIN de 6 dígitos.');
      return;
    }
    setSubmitting(true);
    setMessage(null);
    const verified = await verifyTransactionPin(value);
    if (!verified) {
      setMessage('El PIN no coincide. Revisa e inténtalo nuevamente.');
      setPin('');
      setPinErrors((count) => count + 1);
      setSubmitting(false);
      return;
    }
    try {
      const result = await sendTransfer({
        id: transferId,
        accountId: source.id,
        recipient,
        amountCents,
        concept: concept.trim() || 'Transferencia',
      });
      setReceipt(result);
      setStep('success');
    } catch (cause) {
      // El id no se regenera: si la fila sí entró, reintentar devuelve la misma.
      setMessage(cause instanceof Error ? cause.message : 'No pudimos enviar tu transferencia.');
    } finally {
      setSubmitting(false);
    }
  }

  async function share(transfer: Transfer) {
    setSharing(true);
    await shareReceipt(transferReceipt(transfer, source));
    setSharing(false);
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
            <Text adjustsFontSizeToFit numberOfLines={1} style={styles.successAmount}>{formatCents(receipt.amount_cents)}</Text>
            <Text numberOfLines={2} style={[styles.successBody, { color: palette.muted }]}>a {receipt.payee_name}</Text>
          </Reveal>
          <Reveal delay={120} style={styles.successReceipt}>
            <Card tone="mint">
              <SummaryRow
                label="Estado"
                value={STATUS_LABELS[receipt.status]}
                valueColor={receipt.status === 'completed' ? palette.positive : palette.muted}
              />
              <SummaryRow label="Desde" value={`${source.nickname} ·· ${source.last_four}`} />
              <SummaryRow label="Concepto" value={receipt.concept} />
              <SummaryRow label="Folio" value={receipt.id.replace('txf_', '')} />
            </Card>
            {receipt.status === 'pending' ? (
              <Text style={[styles.successNote, { color: palette.muted }]}>
                El banco la está aplicando. Te avisamos en cuanto se acredite.
              </Text>
            ) : null}
            {receipt.failure_reason ? (
              <Text style={[styles.successNote, { color: palette.danger }]}>{receipt.failure_reason}</Text>
            ) : null}
          </Reveal>
          <View style={styles.successActions}>
            <MotionPressable
              accessibilityRole="button"
              disabled={sharing}
              onPress={() => share(receipt)}
              style={[styles.secondaryButton, { borderColor: palette.border, backgroundColor: palette.surface, opacity: sharing ? 0.6 : 1 }]}>
              <SymbolView name={{ ios: 'doc.richtext', android: 'picture_as_pdf', web: 'picture_as_pdf' }} tintColor={palette.accent} size={18} />
              <Text style={[styles.secondaryLabel, { color: palette.accent }]}>
                {sharing ? 'Preparando PDF…' : 'Compartir comprobante (PDF)'}
              </Text>
            </MotionPressable>
            <MotionPressable
              accessibilityRole="button"
              onPress={() => router.replace('/' as never)}
              style={[styles.primaryButton, { backgroundColor: palette.primary }]}>
              <Text style={[styles.primaryLabel, { color: palette.onPrimary }]}>Volver al inicio</Text>
            </MotionPressable>
          </View>
        </View>
      </PremiumSurface>
    );
  }

  return (
    <PremiumSurface>
      <FormScroll contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <MotionPressable accessibilityLabel="Regresar" hitSlop={10} onPress={() => (step === 'confirm' ? backToForm() : router.back())} style={styles.backButton}>
            <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} tintColor={palette.ink} size={20} />
          </MotionPressable>
          <Text style={styles.title}>{step === 'confirm' ? 'Confirmar' : 'Transferir'}</Text>
          <View style={styles.headerSpacer} />
        </View>

        {step === 'form' ? (
          <>
            <Reveal>
              <MotionPressable
                accessibilityHint={accounts.length > 1 ? 'Elige desde qué cuenta envías' : undefined}
                accessibilityRole={accounts.length > 1 ? 'button' : undefined}
                disabled={accounts.length < 2}
                onPress={() => setSourcePickerOpen(true)}
                pressedScale={0.985}>
                <Card style={styles.sourceCard}>
                  <View style={[styles.sourceIcon, { backgroundColor: palette.surface }]}>
                    <SymbolView
                      name={{ ios: 'creditcard.fill', android: 'account_balance_wallet', web: 'credit_card' }}
                      tintColor={palette.accent}
                      size={22}
                    />
                  </View>
                  <View style={styles.sourceCopy}>
                    <Text numberOfLines={1} style={styles.sourceLabel}>{source.nickname} ·· {source.last_four}</Text>
                    <View style={styles.sourceMetaRow}>
                      <Text style={[styles.sourceMeta, { color: palette.muted }]}>Saldo disponible</Text>
                      <Text numberOfLines={1} style={styles.sourceBalance}>{formatCents(availableCents)}</Text>
                    </View>
                  </View>
                  <View style={styles.sourceSlash} />
                </Card>
              </MotionPressable>
            </Reveal>

            <Reveal delay={50} style={styles.section}>
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionTitle}>¿A quién?</Text>
                <Text style={[styles.sectionLink, { color: palette.muted }]}>Ver todos  ›</Text>
              </View>
              {payees.length === 0 ? (
                <Text style={[styles.emptyHint, { color: palette.muted }]}>
                  Todavía no le has transferido a nadie. Escribe el nombre y la CLABE de quien
                  recibe y quedará guardado para la próxima.
                </Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recipientList}>
                  {payees.map((item) => {
                    const selected = !addingPayee && recipient?.id === item.id;
                    return (
                      <MotionPressable
                        key={item.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setSelectedId(item.id)}
                        style={[
                          styles.recipient,
                          {
                            backgroundColor: selected ? palette.dangerSoft : palette.surface,
                            borderColor: selected ? palette.primary : palette.border,
                          },
                        ]}>
                        <View style={[styles.recipientAvatar, { backgroundColor: avatarTintFor(item.name) }]}>
                          <Text style={[styles.recipientInitials, { color: palette.ink }]}>{initialsFor(item.name)}</Text>
                        </View>
                        <Text numberOfLines={1} style={[styles.recipientName, selected ? styles.selectedText : null]}>
                          {item.account_id ? item.name : item.name.split(' ')[0]}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={[styles.recipientBank, { color: selected ? 'rgba(255,255,255,0.78)' : palette.muted }]}>
                          {item.account_id ? `Tuya ·· ${item.last_four}` : item.bank ?? 'Otro banco'}
                        </Text>
                      </MotionPressable>
                    );
                  })}
                  <MotionPressable
                    accessibilityRole="button"
                    accessibilityLabel="Nuevo destinatario"
                    accessibilityState={{ selected: addingPayee }}
                    onPress={() => setSelectedId(NEW_PAYEE_ID)}
                    style={[
                      styles.recipient,
                      {
                        backgroundColor: addingPayee ? palette.dangerSoft : palette.surface,
                        borderColor: addingPayee ? palette.primary : palette.border,
                      },
                    ]}>
                    <View style={[styles.recipientAvatar, { backgroundColor: palette.accentSoft }]}>
                      <Text style={[styles.recipientInitials, { color: palette.accent }]}>+</Text>
                    </View>
                    <Text numberOfLines={1} style={[styles.recipientName, addingPayee ? styles.selectedText : null]}>
                      Nuevo
                    </Text>
                    <Text numberOfLines={1} style={[styles.recipientBank, { color: addingPayee ? 'rgba(255,255,255,0.78)' : palette.muted }]}>
                      Otra cuenta
                    </Text>
                  </MotionPressable>
                </ScrollView>
              )}

              {addingPayee ? (
                <Card style={styles.payeeCard}>
                  <TextInput
                    accessibilityLabel="Nombre del beneficiario"
                    maxLength={60}
                    onChangeText={setPayeeName}
                    placeholder="Nombre del beneficiario"
                    placeholderTextColor={palette.muted}
                    style={[styles.payeeInput, { color: palette.ink, borderBottomColor: palette.border }]}
                    value={payeeName}
                  />
                  <TextInput
                    accessibilityLabel="CLABE de 18 dígitos"
                    keyboardType="number-pad"
                    maxLength={18}
                    onChangeText={(value) => setPayeeClabe(value.replace(/\D/g, ''))}
                    placeholder="CLABE (18 dígitos)"
                    placeholderTextColor={palette.muted}
                    style={[styles.payeeInput, styles.payeeInputLast, { color: palette.ink, fontVariant: ['tabular-nums'] }]}
                    value={payeeClabe}
                  />
                  {clabeComplete ? (
                    <Text style={[styles.clabeHint, { color: clabeValid ? palette.muted : palette.danger }]}>
                      {clabeValid ? `${bankForClabe(payeeClabe)} · cuenta ·· ${clabeLastFour(payeeClabe)}` : 'El dígito verificador no coincide.'}
                    </Text>
                  ) : null}
                </Card>
              ) : null}
            </Reveal>

            <Reveal delay={100}>
              <Card style={styles.amountCard}>
                <Text style={[styles.amountLabel, { color: palette.muted }]}>Cantidad</Text>
                <View style={styles.amountField}>
                  <Text style={[styles.currency, { fontSize: amountFontSize(amount) * 0.75 }]}>$</Text>
                  <TextInput
                    accessibilityLabel="Cantidad a transferir"
                    keyboardType="decimal-pad"
                    maxLength={moneyMaxLength(amount)}
                    onBlur={() => setAmount((current) => withCents(current))}
                    onChangeText={(value) => setAmount(normalizeMoneyInput(value))}
                    placeholder="0.00"
                    placeholderTextColor={palette.muted}
                    style={[
                      styles.amountInput,
                      { color: palette.ink, fontSize: amountFontSize(amount), lineHeight: amountFontSize(amount) + 8 },
                    ]}
                    value={amount}
                  />
                </View>
                {amountCents > 0 ? (
                  <Text style={[styles.amountPreview, { color: palette.muted }]}>{formatCents(amountCents)} MXN</Text>
                ) : null}
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
              style={[styles.primaryButton, { backgroundColor: palette.primary }]}>
              <Text style={[styles.primaryLabel, { color: palette.onPrimary }]}>Continuar</Text>
              <SymbolView name={{ ios: 'arrow.right', android: 'east', web: 'east' }} tintColor={palette.onPrimary} size={21} />
            </MotionPressable>
          </>
        ) : (
          <Animated.View
            entering={FadeInDown.duration(240).reduceMotion(ReduceMotion.System)}
            style={styles.confirmStack}>
            <Card style={styles.confirmHero}>
              <View style={[styles.confirmAvatar, { backgroundColor: avatarTintFor(recipient?.name ?? '') }]}>
                <Text style={[styles.confirmInitials, { color: palette.ink }]}>
                  {initialsFor(recipient?.name ?? '')}
                </Text>
              </View>
              <Text numberOfLines={2} style={styles.confirmName}>{recipient?.name}</Text>
              <Text numberOfLines={1} style={[styles.confirmBank, { color: palette.muted }]}>
                {[recipient?.account_id ? 'Cuenta propia' : recipient?.bank, recipient?.last_four ? `·· ${recipient.last_four}` : null]
                  .filter(Boolean)
                  .join(' ') || 'Sin datos de banco'}
              </Text>
              <Text adjustsFontSizeToFit numberOfLines={1} style={styles.confirmAmount}>{formatCents(amountCents)}</Text>
            </Card>

            <Card>
              {recipient?.clabe ? <SummaryRow label="CLABE destino" value={formatClabe(recipient.clabe)} /> : null}
              <SummaryRow label="Cuenta origen" value={`${source.nickname} ·· ${source.last_four}`} />
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
              <PinEntry
                accessibilityLabel="PIN para autorizar transferencia"
                autoFocus
                disabled={submitting}
                errorKey={pinErrors}
                onChange={setPin}
                onComplete={confirmTransfer}
                value={pin}
              />
            </Card>

            {message ? <Message text={message} /> : null}
            <MotionPressable
              accessibilityRole="button"
              disabled={submitting}
              onPress={() => confirmTransfer()}
              style={[styles.primaryButton, { backgroundColor: palette.primary, opacity: submitting ? 0.55 : 1 }]}>
              <Text numberOfLines={1} style={[styles.primaryLabel, { color: palette.onPrimary }]}>
                {submitting ? 'Enviando…' : `Enviar ${formatCents(amountCents)}`}
              </Text>
            </MotionPressable>
          </Animated.View>
        )}
      </FormScroll>

      <OptionSheet
        visible={sourcePickerOpen}
        title="¿Desde qué cuenta envías?"
        options={accounts.map((account) => ({
          key: account.id,
          label: `${account.nickname} ·· ${account.last_four}`,
          detail: `${ACCOUNT_TYPE_LABELS[account.type]} · ${formatCents(account.balance_cents)}`,
        }))}
        selectedKey={source.id}
        onSelect={(key) => {
          setSourceId(key);
          if (selectedId === `own_${key}`) setSelectedId(null);
          setSourcePickerOpen(false);
        }}
        onClose={() => setSourcePickerOpen(false)}
      />
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
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 52, gap: 22 },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: 42 },
  title: { fontSize: 19, fontWeight: '700' },
  sourceCard: { minHeight: 100, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  sourceIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  sourceCopy: { flex: 1, minWidth: 0, gap: 6, backgroundColor: 'transparent' },
  sourceLabel: { fontSize: 15, fontWeight: '700' },
  sourceMeta: { fontSize: 13, fontVariant: ['tabular-nums'] },
  sourceMetaRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, backgroundColor: 'transparent' },
  sourceSlash: { position: 'absolute', width: 10, height: 24, borderRadius: 2, top: 17, right: 18, backgroundColor: '#FF3B57', transform: [{ skewX: '-24deg' }] },
  sourceBalance: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  section: { gap: 11 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 25, fontWeight: '700', letterSpacing: -0.65 },
  sectionLink: { fontSize: 14, fontWeight: '500' },
  recipientList: { gap: 10, paddingRight: 20 },
  recipient: { width: 112, minHeight: 116, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 13, alignItems: 'center', justifyContent: 'space-between' },
  recipientAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  recipientInitials: { fontSize: 16, fontWeight: '700' },
  recipientName: { fontSize: 15, fontWeight: '700' },
  recipientBank: { fontSize: 11 },
  selectedText: { color: '#FFFFFF' },
  emptyHint: { fontSize: 13, lineHeight: 18 },
  payeeCard: { gap: 0, paddingVertical: 4 },
  payeeInput: { minHeight: 50, fontSize: 15, borderBottomWidth: StyleSheet.hairlineWidth },
  payeeInputLast: { borderBottomWidth: 0 },
  clabeHint: { fontSize: 12, paddingBottom: 10 },
  amountCard: { minHeight: 214, gap: 9 },
  amountLabel: { fontSize: 15, fontWeight: '500' },
  amountField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 2, backgroundColor: 'transparent' },
  currency: { fontWeight: '600' },
  amountInput: { minWidth: 130, flexShrink: 1, fontWeight: '700', letterSpacing: -1, fontVariant: ['tabular-nums'], paddingVertical: 0 },
  amountPreview: { fontSize: 12, fontVariant: ['tabular-nums'] },
  divider: { height: StyleSheet.hairlineWidth },
  conceptInput: { minHeight: 50, fontSize: 15 },
  message: { borderRadius: 15, paddingHorizontal: 14, paddingVertical: 11 },
  messageText: { fontSize: 13, lineHeight: 18, fontWeight: '600', textAlign: 'center' },
  primaryButton: { minHeight: 60, borderRadius: 30, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  primaryLabel: { fontSize: 17, fontWeight: '700' },
  secondaryButton: { minHeight: 52, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  secondaryLabel: { fontSize: 15, fontWeight: '700' },
  successActions: { alignSelf: 'stretch', gap: 10 },
  confirmStack: { gap: 16 },
  confirmHero: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  confirmAvatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  confirmInitials: { fontSize: 23, fontWeight: '700' },
  confirmName: { fontSize: 19, fontWeight: '700', textAlign: 'center' },
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
  successScreen: { flex: 1, paddingHorizontal: 20, paddingTop: 86, paddingBottom: 42, alignItems: 'center', gap: 22 },
  successIcon: { width: 82, height: 82, borderRadius: 41, alignItems: 'center', justifyContent: 'center' },
  successCopy: { alignItems: 'center', gap: 7 },
  successTitle: { fontSize: 25, fontWeight: '700', letterSpacing: -0.65 },
  successAmount: { fontSize: 43, lineHeight: 49, fontWeight: '700', letterSpacing: -1.4, fontVariant: ['tabular-nums'] },
  successBody: { fontSize: 15 },
  successReceipt: { alignSelf: 'stretch', gap: 10 },
  successNote: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
