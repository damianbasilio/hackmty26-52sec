import * as SecureStore from 'expo-secure-store';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useAuth } from '@/components/AuthProvider';
import { Card } from '@/components/Card';
import { HeroCard } from '@/components/HeroCard';
import { MotionPressable, Reveal } from '@/components/Motion';
import { PremiumSurface } from '@/components/PremiumSurface';
import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';
import { bytesToHex, hexToBytes, secondsLeft, totp } from '@/src/totp';

const STEP_SECONDS = 60;
const SECRET_PREFIX = 'capital-one.dynamic-key.v1.';

function randomSecret(): Uint8Array {
  const bytes = new Uint8Array(20);
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    // ponytail: Hermes no trae crypto.getRandomValues. Mientras la clave solo se
    // muestre y nadie la valide, Math.random alcanza; con validación en servidor
    // hay que usar expo-crypto.
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

export default function ClaveDinamicaScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { userId } = useAuth();
  const [secret, setSecret] = useState<Uint8Array | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [visible, setVisible] = useState(false);
  const remaining = useSharedValue(1);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    const key = `${SECRET_PREFIX}${userId}`;
    (async () => {
      const stored = await SecureStore.getItemAsync(key);
      if (stored) return hexToBytes(stored);
      const created = randomSecret();
      await SecureStore.setItemAsync(key, bytesToHex(created), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      return created;
    })()
      .then((value) => {
        if (active) setSecret(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const code = secret ? totp(secret, now, STEP_SECONDS) : null;
  const left = secondsLeft(now, STEP_SECONDS);

  // Una sola animación por ventana: la barra baja continua, no a saltos.
  useEffect(() => {
    if (!code) return;
    const seconds = secondsLeft(Date.now(), STEP_SECONDS);
    remaining.value = seconds / STEP_SECONDS;
    remaining.value = withTiming(0, {
      duration: seconds * 1000,
      easing: Easing.linear,
      reduceMotion: ReduceMotion.System,
    });
  }, [code, remaining]);

  const barStyle = useAnimatedStyle(() => ({ width: `${remaining.value * 100}%` }));
  const shownCode = code ? (visible ? `${code.slice(0, 3)} ${code.slice(3)}` : '••• •••') : '––– –––';

  return (
    <PremiumSurface>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <MotionPressable accessibilityLabel="Regresar" hitSlop={10} onPress={() => router.back()} style={styles.backButton}>
            <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} tintColor={palette.ink} size={20} />
          </MotionPressable>
          <Text style={styles.title}>Clave dinámica</Text>
          <View style={styles.headerSpacer} />
        </View>

        <Reveal>
          <HeroCard style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={styles.heroIcon}>
                <SymbolView name={{ ios: 'key.fill', android: 'key', web: 'key' }} tintColor="#FFFFFF" size={22} />
              </View>
              <Text style={styles.heroLabel}>Tu clave de seguridad</Text>
            </View>

            <Animated.Text
              key={`${code}-${visible}`}
              accessibilityLabel={visible && code ? `Clave ${code.split('').join(' ')}` : 'Clave oculta'}
              entering={FadeIn.duration(260).reduceMotion(ReduceMotion.System)}
              style={styles.code}>
              {failed ? 'No disponible' : shownCode}
            </Animated.Text>

            <View style={styles.timerBlock}>
              <View style={styles.track}>
                <Animated.View style={[styles.bar, { backgroundColor: left <= 5 ? '#FFB4AE' : '#7FE5B0' }, barStyle]} />
              </View>
              <Text style={styles.timerText}>Se renueva en {left} s</Text>
            </View>
          </HeroCard>
        </Reveal>

        <Reveal delay={60}>
          <MotionPressable
            accessibilityRole="button"
            disabled={!code}
            onPress={() => setVisible((current) => !current)}
            style={[styles.primaryButton, { backgroundColor: palette.primary, opacity: code ? 1 : 0.55 }]}>
            <SymbolView
              name={visible
                ? { ios: 'eye.slash.fill', android: 'visibility_off', web: 'visibility_off' }
                : { ios: 'eye.fill', android: 'visibility', web: 'visibility' }}
              tintColor={palette.onPrimary}
              size={19}
            />
            <Text style={[styles.primaryLabel, { color: palette.onPrimary }]}>{visible ? 'Ocultar clave' : 'Mostrar clave'}</Text>
          </MotionPressable>
        </Reveal>

        <Reveal delay={110}>
          <Card tone="sage" style={styles.infoCard}>
            <InfoRow
              icon={{ ios: 'arrow.triangle.2.circlepath', android: 'autorenew', web: 'autorenew' }}
              text="Cambia cada minuto y solo se genera en este teléfono, aunque no tengas internet."
            />
            <InfoRow
              icon={{ ios: 'hand.raised.fill', android: 'back_hand', web: 'back_hand' }}
              text="Nunca la compartas por mensaje ni se la dictes a alguien que te llamó. Capital One no te la va a pedir."
            />
          </Card>
        </Reveal>
      </ScrollView>
    </PremiumSurface>
  );
}

function InfoRow({ icon, text }: { icon: { ios: string; android: string; web: string }; text: string }) {
  const palette = usePalette();
  return (
    <View style={styles.infoRow}>
      <View style={[styles.infoIcon, { backgroundColor: palette.surface }]}>
        <SymbolView name={icon as never} tintColor={palette.accent} size={17} />
      </View>
      <Text style={[styles.infoText, { color: palette.muted }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 52, gap: 18 },
  header: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: 42 },
  title: { fontSize: 18, fontWeight: '700' },
  hero: { minHeight: 240, justifyContent: 'space-between', gap: 18 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  heroIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  heroLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: '600' },
  code: { color: '#FFFFFF', fontSize: 50, lineHeight: 58, fontWeight: '700', letterSpacing: 2, textAlign: 'center', fontVariant: ['tabular-nums'] },
  timerBlock: { gap: 8 },
  track: { height: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  bar: { height: 6, borderRadius: 999 },
  timerText: { color: 'rgba(255,255,255,0.8)', fontSize: 13, textAlign: 'center', fontVariant: ['tabular-nums'] },
  primaryButton: { minHeight: 56, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  primaryLabel: { fontSize: 16, fontWeight: '700' },
  infoCard: { gap: 14 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  infoIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  infoText: { flex: 1, fontSize: 13, lineHeight: 19 },
});
