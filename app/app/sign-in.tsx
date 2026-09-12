import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/components/AuthProvider';
import { Card } from '@/components/Card';
import { HeroCard } from '@/components/HeroCard';
import { MotionPressable, Reveal } from '@/components/Motion';
import { PremiumSurface } from '@/components/PremiumSurface';
import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';

export default function SignInScreen() {
  const palette = usePalette();
  const {
    signedIn,
    sessionLocked,
    lockUntil,
    biometricsAvailable,
    biometricSignInEnabled,
    biometricLabel,
    demoEmail,
    demoPassword,
    demoPin,
    signIn,
    unlock,
    authenticateWithBiometrics,
    signOut,
  } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    if (!lockUntil || lockUntil <= Date.now()) return;
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [lockUntil]);

  const lockedSeconds = useMemo(
    () => lockUntil ? Math.max(0, Math.ceil((lockUntil - clock) / 1000)) : 0,
    [clock, lockUntil],
  );
  const isSessionUnlock = signedIn && sessionLocked;
  const blocked = lockedSeconds > 0;

  async function submitCredentials() {
    if (!email.trim() || !password) {
      setMessage('Escribe tu correo y contraseña.');
      return;
    }
    setSubmitting(true);
    setMessage(null);
    const result = await signIn(email, password);
    if (!result.ok) setMessage(result.message);
    setSubmitting(false);
  }

  async function submitPin() {
    if (pin.length !== 6) {
      setMessage('Tu PIN debe tener 6 dígitos.');
      return;
    }
    setSubmitting(true);
    setMessage(null);
    const result = await unlock(pin);
    if (!result.ok) setMessage(result.message);
    setSubmitting(false);
  }

  async function submitBiometrics() {
    setSubmitting(true);
    setMessage(null);
    const result = await authenticateWithBiometrics();
    if (!result.ok) setMessage(result.message);
    setSubmitting(false);
  }

  return (
    <PremiumSurface>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}>
          <Reveal style={styles.brandRow}>
            <View style={[styles.brandMark, { backgroundColor: palette.accentDeep }]}>
              <View style={[styles.brandSweep, { backgroundColor: palette.danger }]} />
              <Text style={styles.brandLetter}>C1</Text>
            </View>
            <View style={styles.brandCopy}>
              <Text style={styles.brandName}>Capital One</Text>
              <Text style={[styles.brandLabel, { color: palette.muted }]}>Banca inteligente</Text>
            </View>
          </Reveal>

          <Reveal delay={50}>
            <HeroCard style={styles.hero}>
              <View style={styles.heroLock}>
                <SymbolView
                  name={{ ios: 'lock.shield.fill', android: 'verified_user', web: 'shield' }}
                  tintColor="#FFFFFF"
                  size={24}
                />
              </View>
              <View style={styles.heroCopy}>
                <Text style={styles.heroTitle}>
                  {isSessionUnlock ? 'Tu sesión está protegida.' : 'Tu dinero, bajo control.'}
                </Text>
                <Text style={styles.heroBody}>
                  {isSessionUnlock
                    ? 'Confirma tu identidad para continuar donde te quedaste.'
                    : 'Alertas claras, transferencias seguras y decisiones financieras simples.'}
                </Text>
              </View>
              <View style={styles.securityLine}>
                <Text style={styles.securityDot}>●</Text>
                <Text style={styles.securityText}>Bloqueo automático y confirmación de operaciones</Text>
              </View>
            </HeroCard>
          </Reveal>

          <Reveal delay={110}>
            <Card style={styles.formCard}>
              <View style={styles.formHeading}>
                <Text style={styles.formTitle}>
                  {isSessionUnlock ? 'Bienvenida de nuevo' : 'Iniciar sesión'}
                </Text>
                <Text style={[styles.formSubtitle, { color: palette.muted }]}>
                  {isSessionUnlock ? 'Ingresa tu PIN para desbloquear.' : 'Accede con tus datos de banca.'}
                </Text>
              </View>

              {isSessionUnlock ? (
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>PIN de seguridad</Text>
                  <TextInput
                    key="unlock-pin"
                    accessibilityLabel="PIN de seguridad"
                    autoFocus
                    keyboardType="number-pad"
                    maxLength={6}
                    onChangeText={(value) => setPin(value.replace(/\D/g, ''))}
                    onSubmitEditing={submitPin}
                    placeholder="••••••"
                    placeholderTextColor={palette.muted}
                    secureTextEntry
                    style={[
                      styles.pinInput,
                      { backgroundColor: palette.surfaceAlt, borderColor: palette.border, color: palette.ink },
                    ]}
                    value={pin}
                  />
                </View>
              ) : (
                <>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Correo</Text>
                    <TextInput
                      key="email"
                      accessibilityLabel="Correo"
                      autoCapitalize="none"
                      autoComplete="email"
                      keyboardType="email-address"
                      onChangeText={setEmail}
                      placeholder="correo@ejemplo.mx"
                      placeholderTextColor={palette.muted}
                      style={[
                        styles.input,
                        { backgroundColor: palette.surfaceAlt, borderColor: palette.border, color: palette.ink },
                      ]}
                      value={email}
                    />
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Contraseña</Text>
                    <View style={[
                      styles.passwordField,
                      { backgroundColor: palette.surfaceAlt, borderColor: palette.border },
                    ]}>
                      <TextInput
                        key="password"
                        accessibilityLabel="Contraseña"
                        autoCapitalize="none"
                        autoComplete="current-password"
                        onChangeText={setPassword}
                        onSubmitEditing={submitCredentials}
                        placeholder="Tu contraseña"
                        placeholderTextColor={palette.muted}
                        secureTextEntry={!showPassword}
                        style={[styles.passwordInput, { color: palette.ink }]}
                        value={password}
                      />
                      <MotionPressable
                        accessibilityLabel={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        onPress={() => setShowPassword((current) => !current)}
                        style={styles.eyeButton}>
                        <SymbolView
                          name={{ ios: showPassword ? 'eye.slash' : 'eye', android: 'visibility', web: 'visibility' }}
                          tintColor={palette.muted}
                          size={20}
                        />
                      </MotionPressable>
                    </View>
                  </View>
                </>
              )}

              {message || blocked ? (
                <View style={[styles.message, { backgroundColor: palette.dangerSoft }]}>
                  <Text style={[styles.messageText, { color: palette.danger }]}>
                    {blocked ? `Acceso temporalmente bloqueado · ${lockedSeconds}s` : message}
                  </Text>
                </View>
              ) : null}

              <MotionPressable
                accessibilityRole="button"
                disabled={submitting || blocked}
                onPress={isSessionUnlock ? submitPin : submitCredentials}
                style={[
                  styles.primaryButton,
                  { backgroundColor: palette.accentDeep, opacity: submitting || blocked ? 0.55 : 1 },
                ]}>
                <Text style={styles.primaryLabel}>{submitting ? 'Verificando…' : 'Continuar'}</Text>
              </MotionPressable>

              {biometricsAvailable && (isSessionUnlock || biometricSignInEnabled) ? (
                <MotionPressable
                  accessibilityLabel={`Entrar con ${biometricLabel}`}
                  accessibilityRole="button"
                  disabled={submitting || blocked}
                  onPress={submitBiometrics}
                  style={[styles.biometricButton, { borderColor: palette.border }]}>
                  <SymbolView
                    name={{ ios: 'faceid', android: 'fingerprint', web: 'fingerprint' }}
                    tintColor={palette.accentDeep}
                    size={21}
                  />
                  <Text style={[styles.biometricLabel, { color: palette.accentDeep }]}>Entrar con {biometricLabel}</Text>
                </MotionPressable>
              ) : null}

              <MotionPressable
                accessibilityRole="button"
                onPress={() => {
                  if (isSessionUnlock) {
                    setPin(demoPin);
                  } else {
                    setEmail(demoEmail);
                    setPassword(demoPassword);
                  }
                  setMessage(null);
                }}
                style={[styles.demoButton, { backgroundColor: palette.accentSoft }]}>
                <Text style={[styles.demoLabel, { color: palette.accent }]}>Usar acceso de demostración</Text>
              </MotionPressable>

              {isSessionUnlock ? (
                <MotionPressable
                  accessibilityRole="button"
                  onPress={() => {
                    setPin('');
                    setPassword('');
                    signOut();
                  }}
                  style={styles.signOutButton}>
                  <Text style={[styles.signOutLabel, { color: palette.muted }]}>Cerrar sesión</Text>
                </MotionPressable>
              ) : null}
            </Card>
          </Reveal>

          <View style={styles.trustRow}>
            <SymbolView
              name={{ ios: 'checkmark.shield.fill', android: 'verified_user', web: 'shield' }}
              tintColor={palette.positive}
              size={17}
            />
            <Text style={[styles.trustText, { color: palette.muted }]}>Nunca compartas tu contraseña ni tu PIN.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </PremiumSurface>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 44, gap: 20 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandMark: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  brandSweep: { position: 'absolute', width: 58, height: 7, borderRadius: 999, top: 7, right: -17, transform: [{ rotate: '-18deg' }] },
  brandLetter: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: -0.6 },
  brandCopy: { gap: 2 },
  brandName: { fontSize: 19, fontWeight: '700', letterSpacing: -0.35 },
  brandLabel: { fontSize: 12 },
  hero: { minHeight: 218, justifyContent: 'space-between' },
  heroLock: { width: 46, height: 46, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  heroCopy: { gap: 9, backgroundColor: 'transparent' },
  heroTitle: { color: '#FFFFFF', fontSize: 31, lineHeight: 35, fontWeight: '700', letterSpacing: -1.1, maxWidth: 290 },
  heroBody: { color: 'rgba(255,255,255,0.78)', fontSize: 15, lineHeight: 21, maxWidth: 300 },
  securityLine: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'transparent' },
  securityDot: { color: '#7FE5B0', fontSize: 10 },
  securityText: { flex: 1, color: 'rgba(255,255,255,0.8)', fontSize: 12, lineHeight: 17 },
  formCard: { gap: 16 },
  formHeading: { gap: 5, backgroundColor: 'transparent' },
  formTitle: { fontSize: 24, lineHeight: 29, fontWeight: '700', letterSpacing: -0.65 },
  formSubtitle: { fontSize: 14, lineHeight: 19 },
  fieldGroup: { gap: 7, backgroundColor: 'transparent' },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  input: { minHeight: 54, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, fontSize: 16, letterSpacing: 0 },
  passwordField: { minHeight: 54, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center' },
  passwordInput: { minHeight: 52, flex: 1, paddingLeft: 16, fontSize: 16, letterSpacing: 0 },
  eyeButton: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  pinInput: { minHeight: 64, borderRadius: 19, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, fontSize: 28, fontWeight: '700', letterSpacing: 12, textAlign: 'center' },
  message: { borderRadius: 14, paddingHorizontal: 13, paddingVertical: 10 },
  messageText: { fontSize: 13, lineHeight: 18, textAlign: 'center', fontWeight: '600' },
  primaryButton: { minHeight: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  biometricButton: { minHeight: 50, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  biometricLabel: { fontSize: 15, fontWeight: '700' },
  demoButton: { minHeight: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  demoLabel: { fontSize: 14, fontWeight: '700' },
  signOutButton: { minHeight: 38, alignItems: 'center', justifyContent: 'center' },
  signOutLabel: { fontSize: 14, fontWeight: '600' },
  trustRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  trustText: { fontSize: 12 },
});
