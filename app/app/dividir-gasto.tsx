import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
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
import {
  NEARBY_PARTICIPANTS,
  useBanking,
  type SplitParticipant,
} from '@/components/BankingProvider';
import { Card } from '@/components/Card';
import { HeroCard } from '@/components/HeroCard';
import { MotionPressable, Reveal } from '@/components/Motion';
import { PremiumSurface } from '@/components/PremiumSurface';
import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';
import { formatCents } from '@/src/format';
import { moneyInputToCents, normalizeMoneyInput } from '@/src/moneyInput';
import { nearbySplit, type NearbyStatus } from '@/modules/expo-nearby-split';

type Step = 'amount' | 'nearby' | 'join' | 'confirm' | 'success';

type SplitUpdate = {
  type: 'split_update';
  totalCents: number;
  participantCount: number;
  shares: { name: string; amountCents: number }[];
};

const OWNER: SplitParticipant = {
  id: 'owner',
  name: 'Ana Sofía',
  initials: 'AS',
  color: '#E3F0FA',
};

function sharesFor(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function initialsFor(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'I';
}

export default function DividirGastoScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { verifyTransactionPin, demoPin } = useAuth();
  const { createSplitRequest } = useBanking();
  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState('');
  const [participants, setParticipants] = useState<SplitParticipant[]>([OWNER]);
  const [scanning, setScanning] = useState(false);
  const [nearbyStatus, setNearbyStatus] = useState<NearbyStatus>('stopped');
  const [roomCode] = useState(() => String(1000 + (Date.now() % 9000)));
  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState('');
  const [joinPin, setJoinPin] = useState('');
  const [incomingSplit, setIncomingSplit] = useState<SplitUpdate | null>(null);
  const [joinedConfirmed, setJoinedConfirmed] = useState(false);
  const [confirmedPeers, setConfirmedPeers] = useState<string[]>([]);
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const totalCents = moneyInputToCents(amount);
  const shares = useMemo(() => sharesFor(totalCents, participants.length), [participants.length, totalCents]);
  const nextNearby = NEARBY_PARTICIPANTS.find((candidate) =>
    !participants.some((participant) => participant.id === candidate.id));

  useEffect(() => {
    const statusSubscription = nearbySplit.addStatusListener((event) => {
      setNearbyStatus(event.status);
      if (event.status === 'error' || event.status === 'denied') {
        setMessage(event.message ?? 'No pudimos conectar el teléfono cercano.');
      }
    });
    const joinedSubscription = nearbySplit.addPeerJoinedListener((event) => {
      if (step !== 'nearby') return;
      setParticipants((current) => {
        const id = `nearby_${event.peerId}`;
        if (current.some((participant) => participant.id === id)) return current;
        return [...current, {
          id,
          name: event.displayName,
          initials: initialsFor(event.displayName),
          color: ['#E3F0FA', '#FCE7E5', '#E7F4EB'][current.length % 3],
        }];
      });
    });
    const leftSubscription = nearbySplit.addPeerLeftListener((event) => {
      if (step !== 'nearby') return;
      setParticipants((current) => current.filter((participant) => participant.id !== `nearby_${event.peerId}`));
      setConfirmedPeers((current) => current.filter((peerId) => peerId !== event.peerId));
    });
    const payloadSubscription = nearbySplit.addPayloadListener((event) => {
      try {
        const payload = JSON.parse(event.json) as SplitUpdate | { type: 'confirmation' };
        if (payload.type === 'split_update' && step === 'join') {
          setIncomingSplit(payload);
        } else if (payload.type === 'confirmation' && step === 'nearby') {
          setConfirmedPeers((current) => current.includes(event.peerId) ? current : [...current, event.peerId]);
        }
      } catch {
        setMessage('Recibimos una actualización que no pudimos validar.');
      }
    });
    return () => {
      statusSubscription?.remove();
      joinedSubscription?.remove();
      leftSubscription?.remove();
      payloadSubscription?.remove();
    };
  }, [step]);

  useEffect(() => {
    if (step !== 'nearby' || !nearbySplit.isAvailable) return;
    const payload: SplitUpdate = {
      type: 'split_update',
      totalCents,
      participantCount: participants.length,
      shares: participants.map((participant, index) => ({
        name: participant.name,
        amountCents: shares[index],
      })),
    };
    nearbySplit.broadcast(JSON.stringify(payload)).catch(() => {
      setMessage('No pudimos actualizar todos los teléfonos.');
    });
  }, [participants, shares, step, totalCents]);

  useEffect(() => () => {
    nearbySplit.stop();
  }, []);

  async function createRoom() {
    if (totalCents <= 0) {
      setMessage('Ingresa la cantidad total que quieren dividir.');
      return;
    }
    setMessage(null);
    setStep('nearby');
    if (nearbySplit.isAvailable) {
      const payload: SplitUpdate = {
        type: 'split_update',
        totalCents,
        participantCount: 1,
        shares: [{ name: OWNER.name, amountCents: totalCents }],
      };
      try {
        await nearbySplit.startHost(OWNER.name, roomCode, JSON.stringify(payload));
      } catch {
        setMessage('No pudimos activar la conexión cercana. Puedes usar el modo demo.');
      }
    }
  }

  async function joinNearbyRoom() {
    if (!joinName.trim() || joinCode.length !== 4) {
      setMessage('Escribe tu nombre y el código de 4 dígitos del anfitrión.');
      return;
    }
    setMessage(null);
    setIncomingSplit(null);
    setJoinedConfirmed(false);
    setNearbyStatus('browsing');
    await nearbySplit.joinNearby(joinName.trim(), joinCode);
  }

  async function confirmJoinedShare() {
    if (joinPin.length !== 6) {
      setMessage('Ingresa tu PIN de 6 dígitos para autorizar el pago.');
      return;
    }
    const verified = await verifyTransactionPin(joinPin);
    if (!verified) {
      setMessage('El PIN no coincide. Revisa e inténtalo nuevamente.');
      return;
    }
    setMessage(null);
    await nearbySplit.broadcast(JSON.stringify({ type: 'confirmation' }));
    setJoinedConfirmed(true);
  }

  function addNearbyParticipant() {
    if (!nextNearby || scanning) return;
    setScanning(true);
    setTimeout(() => {
      setParticipants((current) => [...current, nextNearby]);
      setScanning(false);
    }, 680);
  }

  async function sendRequests() {
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
    await createSplitRequest(totalCents, participants);
    setSubmitting(false);
    setStep('success');
  }

  if (step === 'success') {
    return (
      <PremiumSurface>
        <View style={styles.successScreen}>
          <Reveal style={[styles.successIcon, { backgroundColor: palette.positiveSoft }]}>
            <SymbolView
              name={{ ios: 'person.3.fill', android: 'groups', web: 'groups' }}
              tintColor={palette.positive}
              size={38}
            />
          </Reveal>
          <Reveal delay={55} style={styles.successCopy}>
            <Text style={styles.successTitle}>División creada</Text>
            <Text style={styles.successAmount}>{formatCents(totalCents)}</Text>
            <Text style={[styles.successBody, { color: palette.muted }]}>
              Enviamos {participants.length - 1} {participants.length - 1 === 1 ? 'solicitud' : 'solicitudes'} de pago.
            </Text>
          </Reveal>
          <Reveal delay={110} style={styles.successCard}>
            <Card tone="mint">
              {participants.slice(1).map((participant, index) => (
                <View key={participant.id} style={styles.successRow}>
                  <Text style={styles.successName}>{participant.name}</Text>
                  <Text style={[styles.successShare, { color: palette.positive }]}>{formatCents(shares[index + 1])}</Text>
                </View>
              ))}
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
            <MotionPressable
              accessibilityLabel="Regresar"
              hitSlop={10}
              onPress={() => {
                if (step === 'confirm') setStep('nearby');
                else if (step === 'nearby' || step === 'join') {
                  nearbySplit.stop();
                  setStep('amount');
                }
                else router.back();
              }}
              style={styles.backButton}>
              <Text style={[styles.backGlyph, { color: palette.accentDeep }]}>‹</Text>
            </MotionPressable>
            <Text style={styles.title}>Dividir gasto</Text>
            <View style={styles.headerSpacer} />
          </View>

          {step === 'amount' ? (
            <AmountStep
              amount={amount}
              message={message}
              onAmountChange={(value) => setAmount(normalizeMoneyInput(value))}
              onContinue={createRoom}
              onJoin={() => {
                setMessage(null);
                setStep('join');
              }}
            />
          ) : step === 'join' ? (
            <JoinStep
              code={joinCode}
              confirmed={joinedConfirmed}
              incomingSplit={incomingSplit}
              message={message}
              name={joinName}
              nearbyStatus={nearbyStatus}
              onCodeChange={(value) => setJoinCode(value.replace(/\D/g, '').slice(0, 4))}
              onConfirm={confirmJoinedShare}
              onJoin={joinNearbyRoom}
              onNameChange={setJoinName}
              onPinChange={(value) => setJoinPin(value.replace(/\D/g, ''))}
              onUseDemoPin={() => setJoinPin(demoPin)}
              pin={joinPin}
            />
          ) : step === 'nearby' ? (
            <NearbyStep
              confirmedPeers={confirmedPeers}
              isNativeAvailable={nearbySplit.isAvailable}
              nextNearby={nextNearby}
              nearbyStatus={nearbyStatus}
              onAdd={addNearbyParticipant}
              onContinue={() => setStep('confirm')}
              participants={participants}
              roomCode={roomCode}
              scanning={scanning}
              shares={shares}
              totalCents={totalCents}
            />
          ) : (
            <Animated.View
              entering={FadeInDown.duration(240).reduceMotion(ReduceMotion.System)}
              style={styles.confirmStack}>
              <HeroCard style={styles.confirmHero}>
                <Text style={styles.confirmEyebrow}>SOLICITUD GRUPAL</Text>
                <Text style={styles.confirmAmount}>{formatCents(totalCents)}</Text>
                <Text style={styles.confirmCaption}>{participants.length} personas · actualización en tiempo real</Text>
              </HeroCard>

              <Card tone="sage" style={styles.confirmList}>
                {participants.slice(1).map((participant, index) => (
                  <View key={participant.id} style={styles.confirmRow}>
                    <View style={[styles.smallAvatar, { backgroundColor: participant.color }]}>
                      <Text style={[styles.smallInitials, { color: palette.accentDeep }]}>{participant.initials}</Text>
                    </View>
                    <Text style={styles.confirmName}>{participant.name}</Text>
                    <Text style={styles.confirmShare}>{formatCents(shares[index + 1])}</Text>
                  </View>
                ))}
              </Card>

              <Card style={styles.pinCard}>
                <View style={styles.pinHeading}>
                  <SymbolView
                    name={{ ios: 'lock.shield.fill', android: 'verified_user', web: 'shield' }}
                    tintColor={palette.accent}
                    size={22}
                  />
                  <View style={styles.pinCopy}>
                    <Text style={styles.pinTitle}>Confirma las solicitudes</Text>
                    <Text style={[styles.pinSubtitle, { color: palette.muted }]}>Autoriza con tu PIN antes de enviarlas.</Text>
                  </View>
                </View>
                <TextInput
                  accessibilityLabel="PIN para enviar solicitudes"
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
                onPress={sendRequests}
                style={[styles.primaryButton, { backgroundColor: palette.accentDeep, opacity: submitting ? 0.55 : 1 }]}>
                <Text style={styles.primaryLabel}>{submitting ? 'Enviando…' : 'Enviar solicitudes'}</Text>
              </MotionPressable>
            </Animated.View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </PremiumSurface>
  );
}

function AmountStep({
  amount,
  message,
  onAmountChange,
  onContinue,
  onJoin,
}: {
  amount: string;
  message: string | null;
  onAmountChange: (value: string) => void;
  onContinue: () => void;
  onJoin: () => void;
}) {
  const palette = usePalette();
  return (
    <>
      <Reveal>
        <HeroCard style={styles.amountHero}>
          <View style={styles.groupIcon}>
            <SymbolView
              name={{ ios: 'person.3.fill', android: 'groups', web: 'groups' }}
              tintColor="#FFFFFF"
              size={27}
            />
          </View>
          <View style={styles.amountHeroCopy}>
            <Text style={styles.amountHeroTitle}>Juntos, sin hacer cuentas.</Text>
            <Text style={styles.amountHeroBody}>Acerca otro teléfono y la parte de cada persona cambia al instante.</Text>
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
              onChangeText={onAmountChange}
              placeholder="0.00"
              placeholderTextColor={palette.muted}
              style={[styles.amountInput, { color: palette.ink }]}
              value={amount}
            />
          </View>
        </Card>
      </Reveal>

      <Reveal delay={110}>
        <Card tone="sage" style={styles.howCard}>
          <StepRow number="1" label="Escribe el total" />
          <StepRow number="2" label="Acerca los teléfonos" />
          <StepRow number="3" label="Confirma y solicita" />
        </Card>
      </Reveal>

      {message ? <Message text={message} /> : null}
      <MotionPressable
        accessibilityRole="button"
        onPress={onContinue}
        style={[styles.primaryButton, { backgroundColor: palette.accentDeep }]}>
        <Text style={styles.primaryLabel}>Crear división</Text>
      </MotionPressable>
      {nearbySplit.isAvailable ? (
        <MotionPressable
          accessibilityRole="button"
          onPress={onJoin}
          style={[styles.secondaryButton, { borderColor: palette.border }]}>
          <SymbolView
            name={{ ios: 'iphone.radiowaves.left.and.right', android: 'sensors', web: 'sensors' }}
            tintColor={palette.accentDeep}
            size={20}
          />
          <Text style={[styles.secondaryLabel, { color: palette.accentDeep }]}>Unirme a una división cercana</Text>
        </MotionPressable>
      ) : null}
    </>
  );
}

function JoinStep({
  code,
  confirmed,
  incomingSplit,
  message,
  name,
  nearbyStatus,
  onCodeChange,
  onConfirm,
  onJoin,
  onNameChange,
  onPinChange,
  onUseDemoPin,
  pin,
}: {
  code: string;
  confirmed: boolean;
  incomingSplit: SplitUpdate | null;
  message: string | null;
  name: string;
  nearbyStatus: NearbyStatus;
  onCodeChange: (value: string) => void;
  onConfirm: () => void;
  onJoin: () => void;
  onNameChange: (value: string) => void;
  onPinChange: (value: string) => void;
  onUseDemoPin: () => void;
  pin: string;
}) {
  const palette = usePalette();
  const myShare = incomingSplit?.shares.find((share) => share.name === name.trim());
  const connecting = nearbyStatus === 'browsing' || nearbyStatus === 'connecting';

  if (incomingSplit && myShare) {
    return (
      <Animated.View entering={FadeInDown.duration(240).reduceMotion(ReduceMotion.System)} style={styles.nearbyStack}>
        <HeroCard style={styles.joinHero}>
          <Text style={styles.confirmEyebrow}>TU PARTE</Text>
          <Text style={styles.confirmAmount}>{formatCents(myShare.amountCents)}</Text>
          <Text style={styles.confirmCaption}>
            de {formatCents(incomingSplit.totalCents)} · {incomingSplit.participantCount} personas
          </Text>
        </HeroCard>

        <Card tone="sage" style={styles.joinSummaryCard}>
          <View style={styles.pinHeading}>
            <View style={[styles.joinLiveIcon, { backgroundColor: palette.positiveSoft }]}>
              <SymbolView
                name={{ ios: 'checkmark.shield.fill', android: 'verified_user', web: 'shield' }}
                tintColor={palette.positive}
                size={22}
              />
            </View>
            <View style={styles.pinCopy}>
              <Text style={styles.pinTitle}>Importe sincronizado</Text>
              <Text style={[styles.pinSubtitle, { color: palette.muted }]}>Si alguien más se conecta, esta cantidad cambiará al instante.</Text>
            </View>
          </View>
        </Card>

        {!confirmed ? (
          <Card style={styles.pinCard}>
            <Text style={styles.pinTitle}>Autoriza tu pago</Text>
            <TextInput
              accessibilityLabel="PIN para confirmar mi parte"
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
          </Card>
        ) : null}

        {message ? <Message text={message} /> : null}
        <MotionPressable
          accessibilityRole="button"
          disabled={confirmed}
          onPress={onConfirm}
          style={[styles.primaryButton, { backgroundColor: confirmed ? palette.positive : palette.accentDeep }]}>
          <Text style={styles.primaryLabel}>{confirmed ? 'Pago confirmado' : `Confirmar ${formatCents(myShare.amountCents)}`}</Text>
        </MotionPressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeInDown.duration(240).reduceMotion(ReduceMotion.System)} style={styles.nearbyStack}>
      <HeroCard style={styles.joinHero}>
        <View style={styles.groupIcon}>
          <SymbolView
            name={{ ios: 'iphone.radiowaves.left.and.right', android: 'sensors', web: 'sensors' }}
            tintColor="#FFFFFF"
            size={26}
          />
        </View>
        <View style={styles.amountHeroCopy}>
          <Text style={styles.amountHeroTitle}>Acércate al anfitrión.</Text>
          <Text style={styles.amountHeroBody}>La conexión es local y cifrada. El código evita que otro grupo se una por accidente.</Text>
        </View>
      </HeroCard>

      <Card style={styles.joinFormCard}>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Tu nombre</Text>
          <TextInput
            accessibilityLabel="Tu nombre"
            autoCapitalize="words"
            editable={!connecting}
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
            editable={!connecting}
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

      {connecting ? (
        <Card tone="mint" style={styles.connectingCard}>
          <NearbyPulse active />
          <View style={styles.nearbyCopy}>
            <Text style={[styles.nearbyTitle, { color: palette.positive }]}>Buscando la división…</Text>
            <Text style={[styles.nearbyHint, { color: palette.muted }]}>Mantén ambos teléfonos cerca y la app abierta.</Text>
          </View>
        </Card>
      ) : null}
      {message ? <Message text={message} /> : null}
      <MotionPressable
        accessibilityRole="button"
        disabled={connecting}
        onPress={onJoin}
        style={[styles.primaryButton, { backgroundColor: palette.accentDeep, opacity: connecting ? 0.55 : 1 }]}>
        <Text style={styles.primaryLabel}>{connecting ? 'Conectando…' : 'Buscar división cercana'}</Text>
      </MotionPressable>
    </Animated.View>
  );
}

function NearbyStep({
  confirmedPeers,
  isNativeAvailable,
  nextNearby,
  nearbyStatus,
  onAdd,
  onContinue,
  participants,
  roomCode,
  scanning,
  shares,
  totalCents,
}: {
  confirmedPeers: string[];
  isNativeAvailable: boolean;
  nextNearby?: SplitParticipant;
  nearbyStatus: NearbyStatus;
  onAdd: () => void;
  onContinue: () => void;
  participants: SplitParticipant[];
  roomCode: string;
  scanning: boolean;
  shares: number[];
  totalCents: number;
}) {
  const palette = usePalette();
  return (
    <Animated.View layout={LinearTransition.duration(240).reduceMotion(ReduceMotion.System)} style={styles.nearbyStack}>
      <Card style={styles.liveCard}>
        <View style={styles.liveHeading}>
          <View style={[styles.liveDot, { backgroundColor: palette.positive }]} />
          <Text style={[styles.liveLabel, { color: palette.positive }]}>DIVISIÓN EN VIVO</Text>
        </View>
        <Text style={styles.liveAmount}>{formatCents(totalCents)}</Text>
        <Text style={[styles.liveMeta, { color: palette.muted }]}>
          {participants.length} {participants.length === 1 ? 'persona conectada' : 'personas conectadas'}
        </Text>
        {isNativeAvailable ? (
          <View style={[styles.roomCodePill, { backgroundColor: palette.accentSoft }]}>
            <Text style={[styles.roomCodeLabel, { color: palette.muted }]}>Código</Text>
            <Text style={[styles.roomCodeValue, { color: palette.accentDeep }]}>{roomCode}</Text>
          </View>
        ) : null}
      </Card>

      <View style={styles.participantSection}>
        <Text style={styles.sectionTitle}>Cada persona paga</Text>
        <Card tone="sage" style={styles.participantList}>
          {participants.map((participant, index) => (
            <Animated.View
              key={`${participant.id}-${shares[index]}`}
              entering={FadeInDown.duration(220).reduceMotion(ReduceMotion.System)}
              layout={LinearTransition.duration(220).reduceMotion(ReduceMotion.System)}
              style={[styles.participantRow, index < participants.length - 1 ? { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth } : null]}>
              <View style={[styles.participantAvatar, { backgroundColor: participant.color }]}>
                <Text style={[styles.participantInitials, { color: palette.accentDeep }]}>{participant.initials}</Text>
              </View>
              <View style={styles.participantCopy}>
                <Text style={styles.participantName}>{participant.id === OWNER.id ? 'Tú' : participant.name}</Text>
                <Text style={[styles.participantStatus, { color: confirmedPeers.includes(participant.id.replace('nearby_', '')) ? palette.positive : palette.muted }]}>
                  {participant.id === OWNER.id
                    ? 'Anfitriona'
                    : confirmedPeers.includes(participant.id.replace('nearby_', ''))
                      ? 'Pago confirmado'
                      : 'Listo para confirmar'}
                </Text>
              </View>
              <Text style={styles.participantShare}>{formatCents(shares[index])}</Text>
            </Animated.View>
          ))}
        </Card>
      </View>

      {isNativeAvailable ? (
        <View style={styles.nativeNearbyStack}>
          <Card tone="mint" style={styles.connectingCard}>
            <NearbyPulse active={nearbyStatus !== 'error' && nearbyStatus !== 'denied'} />
            <View style={styles.nearbyCopy}>
              <Text style={[styles.nearbyTitle, { color: palette.positive }]}>Conexión cercana activa</Text>
              <Text style={[styles.nearbyHint, { color: palette.muted }]}>Comparte el código y mantengan ambos teléfonos cerca.</Text>
            </View>
          </Card>
          {nextNearby ? (
            <MotionPressable accessibilityRole="button" disabled={scanning} onPress={onAdd} style={styles.demoLink}>
              <Text style={[styles.demoLinkText, { color: palette.accent }]}>Simular otro teléfono para la demo</Text>
            </MotionPressable>
          ) : null}
        </View>
      ) : nextNearby ? (
        <MotionPressable
          accessibilityRole="button"
          disabled={scanning}
          onPress={onAdd}
          style={[styles.nearbyButton, { backgroundColor: palette.accentSoft, borderColor: palette.border }]}>
          <NearbyPulse active={scanning} />
          <View style={styles.nearbyCopy}>
            <Text style={[styles.nearbyTitle, { color: palette.accentDeep }]}>{scanning ? 'Detectando teléfono…' : 'Acercar otro teléfono'}</Text>
            <Text style={[styles.nearbyHint, { color: palette.muted }]}>La cantidad se recalcula automáticamente.</Text>
          </View>
          <Text style={[styles.nearbyChevron, { color: palette.accent }]}>+</Text>
        </MotionPressable>
      ) : (
        <Card tone="mint">
          <Text style={[styles.allReady, { color: palette.positive }]}>Todos los teléfonos de la demostración están conectados.</Text>
        </Card>
      )}

      <MotionPressable
        accessibilityRole="button"
        disabled={participants.length < 2}
        onPress={onContinue}
        style={[styles.primaryButton, { backgroundColor: palette.accentDeep, opacity: participants.length < 2 ? 0.42 : 1 }]}>
        <Text style={styles.primaryLabel}>Continuar con {participants.length - 1} {participants.length - 1 === 1 ? 'solicitud' : 'solicitudes'}</Text>
      </MotionPressable>
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
      <SymbolView
        name={{ ios: 'wave.3.right', android: 'sensors', web: 'sensors' }}
        tintColor={palette.accent}
        size={22}
      />
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
    <Animated.View entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)} style={[styles.message, { backgroundColor: palette.dangerSoft }]}>
      <Text style={[styles.messageText, { color: palette.danger }]}>{text}</Text>
    </Animated.View>
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
  amountHero: { minHeight: 226, justifyContent: 'space-between' },
  groupIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  amountHeroCopy: { gap: 9, backgroundColor: 'transparent' },
  amountHeroTitle: { color: '#FFFFFF', fontSize: 31, lineHeight: 35, fontWeight: '700', letterSpacing: -1.1, maxWidth: 285 },
  amountHeroBody: { color: 'rgba(255,255,255,0.78)', fontSize: 15, lineHeight: 21, maxWidth: 300 },
  amountCard: { alignItems: 'center', gap: 10 },
  amountLabel: { fontSize: 13, fontWeight: '600' },
  amountField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
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
  joinSummaryCard: { gap: 12 },
  joinLiveIcon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  nearbyStack: { gap: 18 },
  liveCard: { alignItems: 'center', paddingVertical: 24, gap: 7 },
  liveHeading: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'transparent' },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  liveLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  liveAmount: { fontSize: 43, lineHeight: 49, fontWeight: '700', letterSpacing: -1.5, fontVariant: ['tabular-nums'] },
  liveMeta: { fontSize: 13 },
  roomCodePill: { marginTop: 5, minHeight: 38, borderRadius: 14, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 8 },
  roomCodeLabel: { fontSize: 12, fontWeight: '600' },
  roomCodeValue: { fontSize: 17, fontWeight: '800', letterSpacing: 2.5, fontVariant: ['tabular-nums'] },
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
  nearbyButton: { minHeight: 78, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  pulseWrap: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  pulseRing: { position: 'absolute', width: 42, height: 42, borderRadius: 21, borderWidth: 2 },
  nearbyCopy: { flex: 1, gap: 4, backgroundColor: 'transparent' },
  nearbyTitle: { fontSize: 15, fontWeight: '700' },
  nearbyHint: { fontSize: 11, lineHeight: 15 },
  nearbyChevron: { fontSize: 27, fontWeight: '400' },
  nativeNearbyStack: { gap: 8 },
  connectingCard: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 11 },
  demoLink: { minHeight: 38, alignItems: 'center', justifyContent: 'center' },
  demoLinkText: { fontSize: 12, fontWeight: '700' },
  allReady: { fontSize: 13, lineHeight: 18, fontWeight: '600', textAlign: 'center' },
  confirmStack: { gap: 16 },
  confirmHero: { minHeight: 178, justifyContent: 'center', alignItems: 'center', gap: 7 },
  confirmEyebrow: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  confirmAmount: { color: '#FFFFFF', fontSize: 42, lineHeight: 48, fontWeight: '700', letterSpacing: -1.4, fontVariant: ['tabular-nums'] },
  confirmCaption: { color: 'rgba(255,255,255,0.76)', fontSize: 13 },
  confirmList: { paddingVertical: 7 },
  confirmRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: 'transparent' },
  smallAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  smallInitials: { fontSize: 13, fontWeight: '700' },
  confirmName: { flex: 1, fontSize: 14, fontWeight: '600' },
  confirmShare: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
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
  successBody: { fontSize: 14, textAlign: 'center' },
  successCard: { alignSelf: 'stretch' },
  successRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: 'transparent' },
  successName: { flex: 1, fontSize: 14, fontWeight: '600' },
  successShare: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
