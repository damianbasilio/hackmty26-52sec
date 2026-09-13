import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useAuth } from '@/components/AuthProvider';
import { Card } from '@/components/Card';
import { FormScroll } from '@/components/FormScroll';
import { HeroCard } from '@/components/HeroCard';
import { MotionPressable, Reveal } from '@/components/Motion';
import { PremiumSurface } from '@/components/PremiumSurface';
import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';
import { dataSource, dataSourceMode, sharesFor, type Split, type SplitParticipant } from '@/src/data';
import { formatCents } from '@/src/format';
import { moneyInputToCents, normalizeMoneyInput, withCents } from '@/src/moneyInput';
import { nearbySplit, type NearbyStatus } from '@/modules/expo-nearby-split';

type Step = 'amount' | 'join' | 'room';

const AVATAR_TONES = ['#E3F0FA', '#FCE7E5', '#E7F4EB', '#F7ECD7', '#E9EAE2'];

/** El modo demo guarda en memoria: al cerrar la app no queda nada. */
const IS_DEMO = dataSourceMode !== 'api';

function initialsFor(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'I'
  );
}

function minutesLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60000));
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function DividirGastoScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { verifyTransactionPin, demoPin } = useAuth();

  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState('');
  const [split, setSplit] = useState<Split | null>(null);
  const [myParticipantId, setMyParticipantId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState('');
  const [guestName, setGuestName] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nearbyStatus, setNearbyStatus] = useState<NearbyStatus>('stopped');
  const [now, setNow] = useState(() => Date.now());

  const splitId = split?.request.id ?? null;
  const totalCents = moneyInputToCents(amount);
  const preview = useMemo(() => sharesFor(totalCents, 2), [totalCents]);

  // Realtime: mientras la división esté abierta en pantalla, cualquier cambio de
  // participantes llega solo. La baja es obligatoria — un canal filtrado en una
  // demo de 36 horas se nota.
  useEffect(() => {
    if (!splitId || step !== 'room') return;
    const unsubscribe = dataSource.subscribeToSplit(splitId, setSplit);
    return unsubscribe;
  }, [splitId, step]);

  // El código expira; sin este tic la pantalla anunciaría un código muerto.
  useEffect(() => {
    if (step !== 'room') return;
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [step]);

  useEffect(() => {
    const subscription = nearbySplit.addStatusListener((event) => {
      setNearbyStatus(event.status);
    });
    return () => subscription?.remove();
  }, []);

  useEffect(() => () => {
    nearbySplit.stop();
  }, []);

  const stopNearby = useCallback(() => {
    nearbySplit.stop();
    setNearbyStatus('stopped');
  }, []);

  async function createSplit() {
    if (totalCents <= 0) {
      setMessage('Ingresa la cantidad total que quieren dividir.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const accounts = await dataSource.getAccounts();
      const checking = accounts.find((account) => account.type === 'checking') ?? accounts[0];
      if (!checking) throw new Error('No hay ninguna cuenta para cargar tu parte.');
      const created = await dataSource.createSplit({ accountId: checking.id, totalCents });
      setSplit(created);
      setMyParticipantId(created.participants.find((person) => person.is_creator)?.id ?? null);
      setStep('room');
      // En iOS la cercanía solo anuncia presencia: el código y las partes ya
      // viven en la base, y de ahí los lee cualquier teléfono.
      if (nearbySplit.isAvailable) {
        const owner = created.participants.find((person) => person.is_creator);
        nearbySplit
          .startHost(owner?.display_name ?? 'Anfitrión', created.request.code, '{}')
          .catch(() => setNearbyStatus('error'));
      }
    } catch (error) {
      setMessage(errorText(error, 'No pudimos crear la división.'));
    } finally {
      setBusy(false);
    }
  }

  async function joinByCode() {
    if (!joinName.trim() || joinCode.length !== 4) {
      setMessage('Escribe tu nombre y el código de 4 dígitos del anfitrión.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const joined = await dataSource.joinSplitByCode(joinCode, joinName.trim());
      setSplit(joined);
      setMyParticipantId(
        joined.participants.find((person) => person.display_name === joinName.trim())?.id ?? null,
      );
      setStep('room');
    } catch (error) {
      setMessage(errorText(error, 'No pudimos unirte a esa división.'));
    } finally {
      setBusy(false);
    }
  }

  async function addGuest() {
    if (!split || !guestName.trim()) {
      setMessage('Escribe el nombre de quien quieres agregar.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      setSplit(await dataSource.addSplitGuest(split.request.id, guestName.trim()));
      setGuestName('');
    } catch (error) {
      setMessage(errorText(error, 'No pudimos agregar a esa persona.'));
    } finally {
      setBusy(false);
    }
  }

  async function payMyShare() {
    if (!split || !myParticipantId) return;
    if (pin.length !== 6) {
      setMessage('Ingresa tu PIN de 6 dígitos para autorizar el pago.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (!(await verifyTransactionPin(pin))) {
        setMessage('El PIN no coincide. Revisa e inténtalo nuevamente.');
        return;
      }
      setSplit(await dataSource.paySplitShare(split.request.id, myParticipantId));
      setPin('');
    } catch (error) {
      setMessage(errorText(error, 'No pudimos registrar tu pago.'));
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    if (step === 'room') {
      stopNearby();
      setSplit(null);
      setMyParticipantId(null);
      setStep('amount');
    } else if (step === 'join') {
      setStep('amount');
    } else {
      router.back();
    }
    setMessage(null);
  }

  return (
    <PremiumSurface>
      <FormScroll contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <MotionPressable accessibilityLabel="Regresar" hitSlop={10} onPress={goBack} style={styles.backButton}>
              <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} tintColor={palette.ink} size={20} />
            </MotionPressable>
            <Text style={styles.title}>Dividir gasto</Text>
            <View style={styles.headerSpacer} />
          </View>

          {IS_DEMO ? <DemoBanner /> : null}

          {step === 'amount' ? (
            <AmountStep
              amount={amount}
              busy={busy}
              preview={preview}
              onAmountBlur={() => setAmount((current) => withCents(current))}
              onAmountChange={(value) => setAmount(normalizeMoneyInput(value))}
              onContinue={createSplit}
              onJoin={() => {
                setMessage(null);
                setStep('join');
              }}
            />
          ) : step === 'join' ? (
            <JoinStep
              busy={busy}
              code={joinCode}
              name={joinName}
              onCodeChange={(value) => setJoinCode(value.replace(/\D/g, '').slice(0, 4))}
              onJoin={joinByCode}
              onNameChange={setJoinName}
            />
          ) : split ? (
            <RoomStep
              busy={busy}
              demoPin={demoPin}
              guestName={guestName}
              minutesLeft={minutesLeft(split.request.code_expires_at, now)}
              myParticipantId={myParticipantId}
              nearbyStatus={nearbyStatus}
              onAddGuest={addGuest}
              onGuestNameChange={setGuestName}
              onPay={payMyShare}
              onPinChange={(value) => setPin(value.replace(/\D/g, ''))}
              onUseDemoPin={() => setPin(demoPin)}
              pin={pin}
              split={split}
            />
          ) : null}

          {message ? <Message text={message} /> : null}
      </FormScroll>
    </PremiumSurface>
  );
}

function DemoBanner() {
  const palette = usePalette();
  return (
    <View style={[styles.demoBanner, { backgroundColor: palette.warningSoft, borderColor: palette.warning }]}>
      <SymbolView
        name={{ ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }}
        tintColor={palette.warning}
        size={18}
      />
      <View style={styles.demoBannerCopy}>
        <Text style={[styles.demoBannerTitle, { color: palette.warning }]}>MODO DEMOSTRACIÓN</Text>
        <Text style={[styles.demoBannerBody, { color: palette.warning }]}>
          La división vive solo en este teléfono y se borra al cerrar la app. Nadie más puede unirse
          de verdad con el código.
        </Text>
      </View>
    </View>
  );
}

function AmountStep({
  amount,
  busy,
  preview,
  onAmountBlur,
  onAmountChange,
  onContinue,
  onJoin,
}: {
  amount: string;
  busy: boolean;
  preview: number[];
  onAmountBlur: () => void;
  onAmountChange: (value: string) => void;
  onContinue: () => void;
  onJoin: () => void;
}) {
  const palette = usePalette();
  const total = moneyInputToCents(amount);
  return (
    <>
      <Reveal>
        <HeroCard style={styles.amountHero}>
          <View style={styles.groupIcon}>
            <SymbolView name={{ ios: 'person.3.fill', android: 'groups', web: 'groups' }} tintColor="#FFFFFF" size={27} />
          </View>
          <View style={styles.amountHeroCopy}>
            <Text style={styles.amountHeroTitle}>Juntos, sin hacer cuentas.</Text>
            <Text style={styles.amountHeroBody}>
              Comparte el código y la parte de cada persona se actualiza sola en todos los teléfonos.
            </Text>
          </View>
        </HeroCard>
      </Reveal>

      <Reveal delay={60}>
        <Card style={styles.amountCard}>
          <Text style={[styles.amountLabel, { color: palette.muted }]}>Total del gasto</Text>
          <View style={styles.amountField}>
            <Text style={styles.currency}>$</Text>
            <TextInput
              accessibilityLabel="Total del gasto"
              keyboardType="decimal-pad"
              onBlur={onAmountBlur}
              onChangeText={onAmountChange}
              placeholder="0.00"
              placeholderTextColor={palette.muted}
              style={[styles.amountInput, { color: palette.ink }]}
              value={amount}
            />
          </View>
          {total > 0 ? (
            <Text style={[styles.amountHint, { color: palette.muted }]}>
              Entre dos serían {formatCents(preview[0])} y {formatCents(preview[1])}.
            </Text>
          ) : null}
        </Card>
      </Reveal>

      <Reveal delay={110}>
        <Card tone="sage" style={styles.howCard}>
          <StepRow number="1" label="Escribe el total" />
          <StepRow number="2" label="Comparte el código" />
          <StepRow number="3" label="Cada quien paga su parte" />
        </Card>
      </Reveal>

      <MotionPressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onContinue}
        style={[styles.primaryButton, { backgroundColor: palette.primary, opacity: busy ? 0.55 : 1 }]}>
        <Text style={styles.primaryLabel}>{busy ? 'Creando…' : 'Crear división'}</Text>
      </MotionPressable>

      <MotionPressable
        accessibilityRole="button"
        onPress={onJoin}
        style={[styles.secondaryButton, { borderColor: palette.border }]}>
        <SymbolView
          name={{ ios: 'number', android: 'tag', web: 'tag' }}
          tintColor={palette.accentDeep}
          size={20}
        />
        <Text style={[styles.secondaryLabel, { color: palette.accentDeep }]}>Unirme con un código</Text>
      </MotionPressable>
    </>
  );
}

function JoinStep({
  busy,
  code,
  name,
  onCodeChange,
  onJoin,
  onNameChange,
}: {
  busy: boolean;
  code: string;
  name: string;
  onCodeChange: (value: string) => void;
  onJoin: () => void;
  onNameChange: (value: string) => void;
}) {
  const palette = usePalette();
  return (
    <Animated.View entering={FadeInDown.duration(240).reduceMotion(ReduceMotion.System)} style={styles.nearbyStack}>
      <HeroCard style={styles.joinHero}>
        <View style={styles.groupIcon}>
          <SymbolView name={{ ios: 'number', android: 'tag', web: 'tag' }} tintColor="#FFFFFF" size={26} />
        </View>
        <View style={styles.amountHeroCopy}>
          <Text style={styles.amountHeroTitle}>Pide el código.</Text>
          <Text style={styles.amountHeroBody}>
            Funciona en cualquier teléfono, aunque no estén en el mismo lugar. El código caduca a los
            15 minutos.
          </Text>
        </View>
      </HeroCard>

      <Card style={styles.joinFormCard}>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Tu nombre</Text>
          <TextInput
            accessibilityLabel="Tu nombre"
            autoCapitalize="words"
            editable={!busy}
            onChangeText={onNameChange}
            placeholder="Mariana Ríos"
            placeholderTextColor={palette.muted}
            style={[styles.joinInput, { backgroundColor: palette.surfaceAlt, borderColor: palette.border, color: palette.ink }]}
            value={name}
          />
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Código del anfitrión</Text>
          <TextInput
            accessibilityLabel="Código del anfitrión"
            editable={!busy}
            keyboardType="number-pad"
            maxLength={4}
            onChangeText={onCodeChange}
            placeholder="0000"
            placeholderTextColor={palette.muted}
            style={[styles.codeInput, { backgroundColor: palette.surfaceAlt, borderColor: palette.border, color: palette.ink }]}
            value={code}
          />
        </View>
      </Card>

      <MotionPressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onJoin}
        style={[styles.primaryButton, { backgroundColor: palette.primary, opacity: busy ? 0.55 : 1 }]}>
        <Text style={styles.primaryLabel}>{busy ? 'Uniéndote…' : 'Unirme a la división'}</Text>
      </MotionPressable>
    </Animated.View>
  );
}

function RoomStep({
  busy,
  demoPin,
  guestName,
  minutesLeft: remaining,
  myParticipantId,
  nearbyStatus,
  onAddGuest,
  onGuestNameChange,
  onPay,
  onPinChange,
  onUseDemoPin,
  pin,
  split,
}: {
  busy: boolean;
  demoPin: string;
  guestName: string;
  minutesLeft: number;
  myParticipantId: string | null;
  nearbyStatus: NearbyStatus;
  onAddGuest: () => void;
  onGuestNameChange: (value: string) => void;
  onPay: () => void;
  onPinChange: (value: string) => void;
  onUseDemoPin: () => void;
  pin: string;
  split: Split;
}) {
  const palette = usePalette();
  const me = split.participants.find((person) => person.id === myParticipantId) ?? null;
  const isCreator = me?.is_creator ?? false;
  const pending = split.participants.filter((person) => !person.paid).length;
  const settled = split.request.status === 'settled';
  const expired = remaining === 0;

  return (
    <Animated.View layout={LinearTransition.duration(240).reduceMotion(ReduceMotion.System)} style={styles.nearbyStack}>
      <Card style={styles.liveCard}>
        <View style={styles.liveHeading}>
          <View style={[styles.liveDot, { backgroundColor: settled ? palette.positive : palette.accent }]} />
          <Text style={[styles.liveLabel, { color: settled ? palette.positive : palette.accent }]}>
            {settled ? 'DIVISIÓN LIQUIDADA' : 'DIVISIÓN EN VIVO'}
          </Text>
        </View>
        <Text style={styles.liveAmount}>{formatCents(split.request.total_cents)}</Text>
        <Text style={[styles.liveMeta, { color: palette.muted }]}>
          {split.participants.length}{' '}
          {split.participants.length === 1 ? 'persona' : 'personas'} ·{' '}
          {settled ? 'todos pagaron' : `faltan ${pending} por pagar`}
        </Text>
        <View style={[styles.roomCodePill, { backgroundColor: palette.accentSoft }]}>
          <Text style={[styles.roomCodeLabel, { color: palette.muted }]}>Código</Text>
          <Text style={[styles.roomCodeValue, { color: palette.accentDeep }]}>{split.request.code}</Text>
        </View>
        <Text style={[styles.codeExpiry, { color: expired ? palette.danger : palette.muted }]}>
          {expired ? 'El código ya caducó: nadie más puede unirse.' : `Caduca en ${remaining} min`}
        </Text>
      </Card>

      <View style={styles.participantSection}>
        <Text style={styles.sectionTitle}>Cada persona paga</Text>
        <Card tone="sage" style={styles.participantList}>
          {split.participants.map((person, index) => (
            <ParticipantRow
              key={person.id}
              isLast={index === split.participants.length - 1}
              isMe={person.id === myParticipantId}
              participant={person}
              tone={AVATAR_TONES[index % AVATAR_TONES.length]}
            />
          ))}
        </Card>
        <Text style={[styles.shareNote, { color: palette.muted }]}>
          El total se reparte en partes iguales y el sobrante de centavos se le da a quien entró
          primero, así la suma siempre cuadra con {formatCents(split.request.total_cents)}.
        </Text>
      </View>

      {me && !me.paid ? (
        <Card style={styles.pinCard}>
          <View style={styles.pinHeading}>
            <SymbolView
              name={{ ios: 'lock.shield.fill', android: 'verified_user', web: 'shield' }}
              tintColor={palette.accent}
              size={22}
            />
            <View style={styles.pinCopy}>
              <Text style={styles.pinTitle}>Paga tu parte</Text>
              <Text style={[styles.pinSubtitle, { color: palette.muted }]}>
                Se manda como transferencia desde tu cuenta. Autoriza con tu PIN.
              </Text>
            </View>
          </View>
          <TextInput
            accessibilityLabel="PIN para autorizar el pago"
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={onPinChange}
            placeholder="••••••"
            placeholderTextColor={palette.muted}
            secureTextEntry
            style={[styles.pinInput, { backgroundColor: palette.surfaceAlt, borderColor: palette.border, color: palette.ink }]}
            value={pin}
          />
          <MotionPressable onPress={onUseDemoPin} style={styles.demoPinButton}>
            <Text style={[styles.demoPinLabel, { color: palette.accent }]}>Usar PIN de demostración</Text>
          </MotionPressable>
          <MotionPressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onPay}
            style={[styles.primaryButton, { backgroundColor: palette.primary, opacity: busy ? 0.55 : 1 }]}>
            <Text style={styles.primaryLabel}>
              {busy ? 'Enviando…' : `Pagar ${formatCents(me.share_cents)}`}
            </Text>
          </MotionPressable>
        </Card>
      ) : null}

      {isCreator && !settled ? (
        <Card style={styles.joinFormCard}>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Agregar a alguien que no tiene la app</Text>
            <TextInput
              accessibilityLabel="Nombre de la persona a agregar"
              autoCapitalize="words"
              editable={!busy}
              onChangeText={onGuestNameChange}
              placeholder="Nombre"
              placeholderTextColor={palette.muted}
              style={[styles.joinInput, { backgroundColor: palette.surfaceAlt, borderColor: palette.border, color: palette.ink }]}
              value={guestName}
            />
          </View>
          <MotionPressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onAddGuest}
            style={[styles.secondaryButton, { borderColor: palette.border }]}>
            <Text style={[styles.secondaryLabel, { color: palette.accentDeep }]}>Agregar y repartir de nuevo</Text>
          </MotionPressable>
        </Card>
      ) : null}

      {nearbySplit.isAvailable && nearbyStatus !== 'stopped' ? (
        <Card tone="mint" style={styles.connectingCard}>
          <NearbyPulse active={nearbyStatus !== 'error' && nearbyStatus !== 'denied'} />
          <View style={styles.nearbyCopy}>
            <Text style={[styles.nearbyTitle, { color: palette.positive }]}>Cercanía activa</Text>
            <Text style={[styles.nearbyHint, { color: palette.muted }]}>
              Atajo de iPhone para verse entre teléfonos. El código funciona igual sin esto.
            </Text>
          </View>
        </Card>
      ) : null}
    </Animated.View>
  );
}

function ParticipantRow({
  isLast,
  isMe,
  participant,
  tone,
}: {
  isLast: boolean;
  isMe: boolean;
  participant: SplitParticipant;
  tone: string;
}) {
  const palette = usePalette();
  return (
    <Animated.View
      entering={FadeInDown.duration(220).reduceMotion(ReduceMotion.System)}
      layout={LinearTransition.duration(220).reduceMotion(ReduceMotion.System)}
      style={[
        styles.participantRow,
        isLast ? null : { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}>
      <View style={[styles.participantAvatar, { backgroundColor: tone }]}>
        <Text style={[styles.participantInitials, { color: palette.accentDeep }]}>
          {initialsFor(participant.display_name)}
        </Text>
      </View>
      <View style={styles.participantCopy}>
        <Text style={styles.participantName}>{isMe ? 'Tú' : participant.display_name}</Text>
        <Text style={[styles.participantStatus, { color: participant.paid ? palette.positive : palette.muted }]}>
          {participant.paid ? 'Ya pagó' : participant.is_creator ? 'Anfitrión · falta pagar' : 'Falta pagar'}
        </Text>
      </View>
      <Text style={styles.participantShare}>{formatCents(participant.share_cents)}</Text>
    </Animated.View>
  );
}

function NearbyPulse({ active }: { active: boolean }) {
  const palette = usePalette();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = active
      ? withRepeat(withTiming(1, { duration: 760, easing: Easing.inOut(Easing.cubic), reduceMotion: ReduceMotion.System }), -1, true)
      : withTiming(0, { duration: 150, reduceMotion: ReduceMotion.System });
  }, [active, progress]);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.28 + progress.value * 0.34,
    transform: [{ scale: 0.94 + progress.value * 0.09 }],
  }));
  return (
    <View style={styles.pulseWrap}>
      <Animated.View style={[styles.pulseRing, { borderColor: palette.accent }, animatedStyle]} />
      <SymbolView name={{ ios: 'wave.3.right', android: 'sensors', web: 'sensors' }} tintColor={palette.accent} size={22} />
    </View>
  );
}

function StepRow({ number, label }: { number: string; label: string }) {
  const palette = usePalette();
  return (
    <View style={styles.stepRow}>
      <View style={[styles.stepNumber, { backgroundColor: palette.surface }]}>
        <Text style={[styles.stepNumberText, { color: palette.accent }]}>{number}</Text>
      </View>
      <Text style={styles.stepLabel}>{label}</Text>
    </View>
  );
}

function Message({ text }: { text: string }) {
  const palette = usePalette();
  return (
    <Animated.View
      entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)}
      style={[styles.message, { backgroundColor: palette.dangerSoft }]}>
      <Text style={[styles.messageText, { color: palette.danger }]}>{text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 52, gap: 18 },
  header: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: 42 },
  title: { fontSize: 18, fontWeight: '700' },
  demoBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 13, paddingVertical: 11 },
  demoBannerCopy: { flex: 1, gap: 3, backgroundColor: 'transparent' },
  demoBannerTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  demoBannerBody: { fontSize: 12, lineHeight: 17 },
  amountHero: { minHeight: 226, justifyContent: 'space-between' },
  groupIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  amountHeroCopy: { gap: 9, backgroundColor: 'transparent' },
  amountHeroTitle: { color: '#FFFFFF', fontSize: 31, lineHeight: 35, fontWeight: '700', letterSpacing: -1.1, maxWidth: 285 },
  amountHeroBody: { color: 'rgba(255,255,255,0.78)', fontSize: 15, lineHeight: 21, maxWidth: 300 },
  amountCard: { alignItems: 'center', gap: 10 },
  amountLabel: { fontSize: 13, fontWeight: '600' },
  amountField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  amountHint: { fontSize: 12, textAlign: 'center' },
  currency: { fontSize: 34, lineHeight: 44, fontWeight: '600' },
  amountInput: { minWidth: 100, maxWidth: 230, fontSize: 44, lineHeight: 52, fontWeight: '700', letterSpacing: -1.5, textAlign: 'center', fontVariant: ['tabular-nums'] },
  howCard: { gap: 12 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'transparent' },
  stepNumber: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { fontSize: 13, fontWeight: '700' },
  stepLabel: { fontSize: 14, fontWeight: '600' },
  message: { borderRadius: 15, paddingHorizontal: 14, paddingVertical: 11 },
  messageText: { fontSize: 13, lineHeight: 18, textAlign: 'center', fontWeight: '600' },
  primaryButton: { minHeight: 58, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  secondaryButton: { minHeight: 54, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  secondaryLabel: { fontSize: 14, fontWeight: '700' },
  joinHero: { minHeight: 205, justifyContent: 'space-between' },
  joinFormCard: { gap: 15 },
  fieldGroup: { gap: 7, backgroundColor: 'transparent' },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  joinInput: { minHeight: 54, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, fontSize: 16 },
  codeInput: { minHeight: 58, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, fontSize: 25, fontWeight: '700', letterSpacing: 9, textAlign: 'center', fontVariant: ['tabular-nums'] },
  nearbyStack: { gap: 18 },
  liveCard: { alignItems: 'center', paddingVertical: 24, gap: 7 },
  liveHeading: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'transparent' },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  liveLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  liveAmount: { fontSize: 43, lineHeight: 49, fontWeight: '700', letterSpacing: -1.5, fontVariant: ['tabular-nums'] },
  liveMeta: { fontSize: 13, textAlign: 'center' },
  roomCodePill: { marginTop: 5, minHeight: 38, borderRadius: 14, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 8 },
  roomCodeLabel: { fontSize: 12, fontWeight: '600' },
  roomCodeValue: { fontSize: 17, fontWeight: '800', letterSpacing: 2.5, fontVariant: ['tabular-nums'] },
  codeExpiry: { fontSize: 11 },
  participantSection: { gap: 11 },
  sectionTitle: { fontSize: 21, fontWeight: '700', letterSpacing: -0.4 },
  participantList: { padding: 5, gap: 0 },
  participantRow: { minHeight: 78, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: 'transparent' },
  participantAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  participantInitials: { fontSize: 15, fontWeight: '700' },
  participantCopy: { flex: 1, gap: 3, backgroundColor: 'transparent' },
  participantName: { fontSize: 15, fontWeight: '700' },
  participantStatus: { fontSize: 11 },
  participantShare: { fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  shareNote: { fontSize: 11, lineHeight: 16 },
  pulseWrap: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  pulseRing: { position: 'absolute', width: 42, height: 42, borderRadius: 21, borderWidth: 2 },
  nearbyCopy: { flex: 1, gap: 4, backgroundColor: 'transparent' },
  nearbyTitle: { fontSize: 15, fontWeight: '700' },
  nearbyHint: { fontSize: 11, lineHeight: 15 },
  connectingCard: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 11 },
  pinCard: { gap: 14 },
  pinHeading: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: 'transparent' },
  pinCopy: { flex: 1, gap: 3, backgroundColor: 'transparent' },
  pinTitle: { fontSize: 16, fontWeight: '700' },
  pinSubtitle: { fontSize: 12, lineHeight: 17 },
  pinInput: { minHeight: 58, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, fontSize: 24, fontWeight: '700', letterSpacing: 10, textAlign: 'center' },
  demoPinButton: { minHeight: 34, alignItems: 'center', justifyContent: 'center' },
  demoPinLabel: { fontSize: 13, fontWeight: '600' },
});
