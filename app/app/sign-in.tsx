import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { useAuth } from '@/components/AuthProvider';
import { Card } from '@/components/Card';
import { FormScroll } from '@/components/FormScroll';
import { HeroCard } from '@/components/HeroCard';
import { MotionPressable, Reveal } from '@/components/Motion';
import { PinEntry } from '@/components/PinEntry';
import { PremiumSurface } from '@/components/PremiumSurface';
import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';
import { Banner } from '@/components/ui';

type Mode = 'signin' | 'signup';
type PinStage = 'create' | 'confirm';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

export default function SignInScreen() {
  const palette = usePalette();
  const {
    signedIn,
    sessionLocked,
    needsPinSetup,
    lockUntil,
    biometricsAvailable,
    biometricSignInEnabled,
    biometricLabel,
    email: signedEmail,
    recentEmails,
    demoEmail,
    demoPassword,
    demoPin,
    signIn,
    signUp,
    forgetAccount,
    setDevicePin,
    unlock,
    authenticateWithBiometrics,
    signOut,
  } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pin, setPin] = useState('');
  const [pinDraft, setPinDraft] = useState('');
  const [pinStage, setPinStage] = useState<PinStage>('create');
  const [pinErrors, setPinErrors] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const lastNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!lockUntil || lockUntil <= Date.now()) return;
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [lockUntil]);

  const lockedSeconds = useMemo(
    () => lockUntil ? Math.max(0, Math.ceil((lockUntil - clock) / 1000)) : 0,
    [clock, lockUntil],
  );
  const isPinSetup = signedIn && needsPinSetup;
  const isSessionUnlock = signedIn && sessionLocked && !needsPinSetup;
  const isCredentials = !isPinSetup && !isSessionUnlock;
  const isSignUp = isCredentials && mode === 'signup';
  const blocked = lockedSeconds > 0;
  const hasDemoCredentials = demoEmail.length > 0 && demoPassword.length > 0;

  function failPin(text: string) {
    setMessage(text);
    setPin('');
    setPinErrors((count) => count + 1);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setMessage(null);
    setNotice(null);
    setPassword('');
    setPasswordConfirm('');
  }

  async function submitCredentials() {
    if (!email.trim() || !password) {
      setMessage('Escribe tu correo y contraseña.');
      return;
    }
    setSubmitting(true);
    setMessage(null);
    const result = await signIn(email, password);
    if (!result.ok) setMessage(result.message);
    else setPassword('');
    setSubmitting(false);
  }

  async function submitSignUp() {
    if (!firstName.trim()) return setMessage('Escribe tu nombre.');
    if (!lastName.trim()) return setMessage('Escribe tu apellido.');
    if (!EMAIL_PATTERN.test(email.trim())) return setMessage('Revisa el formato de tu correo.');
    if (password.length < MIN_PASSWORD) {
      return setMessage(`Tu contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
    }
    if (password !== passwordConfirm) return setMessage('Las contraseñas no coinciden.');
    setSubmitting(true);
    setMessage(null);
    const result = await signUp({ firstName, lastName, email, password });
    setSubmitting(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setPassword('');
    setPasswordConfirm('');
    setMode('signin');
    setNotice(
      result.needsConfirmation
        ? 'Te enviamos un correo para confirmar tu cuenta. Confírmalo y luego inicia sesión.'
        : 'Tu cuenta está lista. Ahora crea tu PIN.',
    );
  }

  async function savePin(value: string) {
    setSubmitting(true);
    setMessage(null);
    const result = await setDevicePin(value);
    setSubmitting(false);
    if (!result.ok) {
      setPinStage('create');
      setPinDraft('');
      failPin(result.message);
      return;
    }
    setPin('');
    setPinDraft('');
    setPinStage('create');
  }

  function completePinSetup(value: string) {
    if (pinStage === 'create') {
      setPinDraft(value);
      setPin('');
      setMessage(null);
      setPinStage('confirm');
      return;
    }
    if (value !== pinDraft) {
      setPinDraft('');
      setPinStage('create');
      failPin('Los dos PIN no coinciden. Vuelve a crearlo.');
      return;
    }
    savePin(value);
  }

  async function submitPin(value = pin) {
    if (value.length !== 6) {
      setMessage('Tu PIN debe tener 6 dígitos.');
      return;
    }
    setSubmitting(true);
    setMessage(null);
    const result = await unlock(value);
    setSubmitting(false);
    if (!result.ok) failPin(result.message);
    else setPin('');
  }

  async function submitBiometrics() {
    setSubmitting(true);
    setMessage(null);
    const result = await authenticateWithBiometrics();
    if (!result.ok) setMessage(result.message);
    setSubmitting(false);
  }

  function useOtherAccount() {
    setPin('');
    setPinDraft('');
    setPinStage('create');
    setPassword('');
    setMessage(null);
    signOut();
  }

  const inputStyle = [
    styles.input,
    { backgroundColor: palette.surfaceAlt, borderColor: palette.border, color: palette.ink },
  ];

  const heroTitle = isPinSetup
    ? 'Crea tu PIN.'
    : isSessionUnlock
      ? 'Tu sesión está protegida.'
      : isSignUp
        ? 'Abre tu cuenta.'
        : 'Tu dinero, bajo control.';
  const heroBody = isPinSetup
    ? 'Seis dígitos que se quedan en este teléfono. Los usarás para desbloquear la app y autorizar transferencias.'
    : isSessionUnlock
      ? 'Confirma tu identidad para continuar donde te quedaste.'
      : isSignUp
        ? 'Tus datos, una contraseña y un PIN para este teléfono. Listo en un minuto.'
        : 'Alertas claras, transferencias seguras y decisiones financieras simples.';
  const formTitle = isPinSetup
    ? pinStage === 'create' ? 'Tu PIN de seguridad' : 'Confirma tu PIN'
    : isSessionUnlock
      ? 'Hola de nuevo'
      : isSignUp
        ? 'Crear cuenta'
        : 'Iniciar sesión';
  const formSubtitle = isPinSetup
    ? pinStage === 'create' ? 'Elige seis dígitos que recuerdes.' : 'Escríbelo otra vez para confirmarlo.'
    : isSessionUnlock
      ? 'Ingresa tu PIN para entrar.'
      : isSignUp
        ? 'Usa un correo al que tengas acceso.'
        : 'Accede con tus datos de banca.';

  return (
    <PremiumSurface>
      <FormScroll contentContainerStyle={styles.content}>
        <Reveal style={styles.brandRow}>
          <View style={styles.brandMark}>
            <View style={[styles.brandSweep, { backgroundColor: palette.danger }]} />
            <Text style={styles.brandLetter}>C1</Text>
          </View>
          <View style={styles.brandCopy}>
            <Text style={styles.brandName}>Capital One</Text>
            <Text style={[styles.brandLabel, { color: palette.muted }]}>52pay · Banca inteligente</Text>
          </View>
        </Reveal>

        <Reveal delay={50}>
          <HeroCard style={styles.hero}>
            <View style={styles.heroLock}>
              <SymbolView
                name={isSignUp
                  ? { ios: 'person.crop.circle.badge.plus', android: 'person_add', web: 'person_add' }
                  : { ios: 'lock.shield.fill', android: 'verified_user', web: 'shield' }}
                tintColor="#FFFFFF"
                size={24}
              />
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>{heroTitle}</Text>
              <Text style={styles.heroBody}>{heroBody}</Text>
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
              <Text style={styles.formTitle}>{formTitle}</Text>
              <Text style={[styles.formSubtitle, { color: palette.muted }]}>{formSubtitle}</Text>
              {isSessionUnlock && signedEmail ? (
                <Text numberOfLines={1} style={[styles.formSubtitle, { color: palette.accent }]}>{signedEmail}</Text>
              ) : null}
            </View>

            {isPinSetup || isSessionUnlock ? (
              <PinEntry
                key={isPinSetup ? `setup-${pinStage}` : 'unlock'}
                accessibilityLabel={isPinSetup ? formTitle : 'PIN de seguridad'}
                autoFocus
                disabled={submitting || blocked}
                errorKey={pinErrors}
                onChange={(value) => {
                  setPin(value);
                  if (value.length > 0) setMessage(null);
                }}
                onComplete={isPinSetup ? completePinSetup : submitPin}
                value={pin}
              />
            ) : (
              <>
                {isSignUp ? (
                  <View style={styles.nameRow}>
                    <View style={[styles.fieldGroup, styles.nameField]}>
                      <Text style={styles.fieldLabel}>Nombre</Text>
                      <TextInput
                        accessibilityLabel="Nombre"
                        autoCapitalize="words"
                        autoComplete="given-name"
                        maxLength={40}
                        onChangeText={setFirstName}
                        onSubmitEditing={() => lastNameRef.current?.focus()}
                        placeholder="Ana"
                        placeholderTextColor={palette.muted}
                        returnKeyType="next"
                        style={inputStyle}
                        submitBehavior="submit"
                        textContentType="givenName"
                        value={firstName}
                      />
                    </View>
                    <View style={[styles.fieldGroup, styles.nameField]}>
                      <Text style={styles.fieldLabel}>Apellido</Text>
                      <TextInput
                        ref={lastNameRef}
                        accessibilityLabel="Apellido"
                        autoCapitalize="words"
                        autoComplete="family-name"
                        maxLength={40}
                        onChangeText={setLastName}
                        onSubmitEditing={() => emailRef.current?.focus()}
                        placeholder="Treviño"
                        placeholderTextColor={palette.muted}
                        returnKeyType="next"
                        style={inputStyle}
                        submitBehavior="submit"
                        textContentType="familyName"
                        value={lastName}
                      />
                    </View>
                  </View>
                ) : recentEmails.length > 0 ? (
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Cuentas en este teléfono</Text>
                    {recentEmails.map((recent) => {
                      const selected = email.trim().toLowerCase() === recent;
                      return (
                        <MotionPressable
                          key={recent}
                          accessibilityHint="Llena el correo con esta cuenta"
                          accessibilityRole="button"
                          onPress={() => {
                            setEmail(recent);
                            setMessage(null);
                            passwordRef.current?.focus();
                          }}
                          style={[
                            styles.recentRow,
                            {
                              backgroundColor: selected ? palette.accentSoft : palette.surfaceAlt,
                              borderColor: selected ? palette.primary : palette.border,
                            },
                          ]}>
                          <View style={[styles.recentAvatar, { backgroundColor: palette.surface }]}>
                            <Text style={[styles.recentInitial, { color: palette.accent }]}>{recent.charAt(0).toUpperCase()}</Text>
                          </View>
                          <Text numberOfLines={1} style={styles.recentEmail}>{recent}</Text>
                          <MotionPressable
                            accessibilityLabel={`Quitar ${recent} de este teléfono`}
                            accessibilityRole="button"
                            hitSlop={8}
                            onPress={() => {
                              forgetAccount(recent);
                              if (selected) setEmail('');
                            }}
                            style={styles.recentRemove}>
                            <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} tintColor={palette.muted} size={12} />
                          </MotionPressable>
                        </MotionPressable>
                      );
                    })}
                  </View>
                ) : null}

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Correo</Text>
                  <TextInput
                    ref={emailRef}
                    accessibilityLabel="Correo"
                    autoCapitalize="none"
                    autoComplete="email"
                    keyboardType="email-address"
                    onChangeText={setEmail}
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    placeholder="correo@ejemplo.mx"
                    placeholderTextColor={palette.muted}
                    returnKeyType="next"
                    style={inputStyle}
                    submitBehavior="submit"
                    textContentType="emailAddress"
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
                      ref={passwordRef}
                      accessibilityLabel="Contraseña"
                      autoCapitalize="none"
                      autoComplete={isSignUp ? 'new-password' : 'current-password'}
                      onChangeText={setPassword}
                      onSubmitEditing={isSignUp ? () => confirmRef.current?.focus() : submitCredentials}
                      placeholder={isSignUp ? `Mínimo ${MIN_PASSWORD} caracteres` : 'Tu contraseña'}
                      placeholderTextColor={palette.muted}
                      returnKeyType={isSignUp ? 'next' : 'go'}
                      secureTextEntry={!showPassword}
                      style={[styles.passwordInput, { color: palette.ink }]}
                      submitBehavior={isSignUp ? 'submit' : 'blurAndSubmit'}
                      textContentType={isSignUp ? 'newPassword' : 'password'}
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

                {isSignUp ? (
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Confirma tu contraseña</Text>
                    <TextInput
                      ref={confirmRef}
                      accessibilityLabel="Confirma tu contraseña"
                      autoCapitalize="none"
                      autoComplete="new-password"
                      onChangeText={setPasswordConfirm}
                      onSubmitEditing={submitSignUp}
                      placeholder="Escríbela otra vez"
                      placeholderTextColor={palette.muted}
                      returnKeyType="go"
                      secureTextEntry={!showPassword}
                      style={inputStyle}
                      textContentType="newPassword"
                      value={passwordConfirm}
                    />
                  </View>
                ) : null}
              </>
            )}

            {blocked ? (
              <View style={[styles.lockMessage, { backgroundColor: palette.dangerSoft }]}>
                <Text style={[styles.lockMessageText, { color: palette.danger }]}>
                  Acceso temporalmente bloqueado · {lockedSeconds}s
                </Text>
              </View>
            ) : message ? (
              <Banner text={message} onDismiss={() => setMessage(null)} />
            ) : null}
            {notice && !message && !blocked ? (
              <Banner text={notice} tone="positive" autoHideMs={9000} onDismiss={() => setNotice(null)} />
            ) : null}

            <MotionPressable
              accessibilityRole="button"
              disabled={submitting || blocked}
              onPress={
                isPinSetup
                  ? () => (pin.length === 6 ? completePinSetup(pin) : setMessage('Tu PIN debe tener 6 dígitos.'))
                  : isSessionUnlock
                    ? () => submitPin()
                    : isSignUp
                      ? submitSignUp
                      : submitCredentials
              }
              style={[
                styles.primaryButton,
                { backgroundColor: palette.primary, opacity: submitting || blocked ? 0.55 : 1 },
              ]}>
              <Text style={[styles.primaryLabel, { color: palette.onPrimary }]}>
                {submitting
                  ? 'Verificando…'
                  : isPinSetup
                    ? pinStage === 'create' ? 'Siguiente' : 'Guardar mi PIN'
                    : isSessionUnlock
                      ? 'Desbloquear'
                      : isSignUp
                        ? 'Crear mi cuenta'
                        : 'Continuar'}
              </Text>
            </MotionPressable>

            {biometricsAvailable && isSessionUnlock && biometricSignInEnabled ? (
              <MotionPressable
                accessibilityLabel={`Entrar con ${biometricLabel}`}
                accessibilityRole="button"
                disabled={submitting || blocked}
                onPress={submitBiometrics}
                style={[styles.secondaryButton, { borderColor: palette.border }]}>
                <SymbolView
                  name={{ ios: 'faceid', android: 'fingerprint', web: 'fingerprint' }}
                  tintColor={palette.accent}
                  size={21}
                />
                <Text style={[styles.secondaryLabel, { color: palette.accent }]}>Entrar con {biometricLabel}</Text>
              </MotionPressable>
            ) : null}

            {isCredentials ? (
              <MotionPressable
                accessibilityRole="button"
                onPress={() => switchMode(isSignUp ? 'signin' : 'signup')}
                style={[styles.secondaryButton, { borderColor: palette.border }]}>
                <SymbolView
                  name={isSignUp
                    ? { ios: 'person.fill', android: 'person', web: 'person' }
                    : { ios: 'person.badge.plus', android: 'person_add', web: 'person_add' }}
                  tintColor={palette.accent}
                  size={19}
                />
                <Text style={[styles.secondaryLabel, { color: palette.accent }]}>
                  {isSignUp ? 'Ya tengo cuenta, iniciar sesión' : '¿Eres nuevo? Crea tu cuenta'}
                </Text>
              </MotionPressable>
            ) : null}

            {isCredentials && !isSignUp && hasDemoCredentials ? (
              <MotionPressable
                accessibilityRole="button"
                onPress={() => {
                  setEmail(demoEmail);
                  setPassword(demoPassword);
                  setMessage(null);
                }}
                style={[styles.demoButton, { backgroundColor: palette.accentSoft }]}>
                <Text style={[styles.demoLabel, { color: palette.accent }]}>Usar acceso de demostración</Text>
              </MotionPressable>
            ) : null}

            {isPinSetup && demoPin.length === 6 ? (
              <MotionPressable
                accessibilityRole="button"
                disabled={submitting}
                onPress={() => savePin(demoPin)}
                style={[styles.demoButton, { backgroundColor: palette.accentSoft }]}>
                <Text style={[styles.demoLabel, { color: palette.accent }]}>Usar PIN de demostración</Text>
              </MotionPressable>
            ) : null}

            {isSessionUnlock || isPinSetup ? (
              <MotionPressable accessibilityRole="button" onPress={useOtherAccount} style={styles.signOutButton}>
                <Text style={[styles.signOutLabel, { color: palette.muted }]}>Entrar con otra cuenta</Text>
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
      </FormScroll>
    </PremiumSurface>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 44, gap: 20 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandMark: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#004977' },
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
  nameRow: { flexDirection: 'row', gap: 10 },
  nameField: { flex: 1 },
  fieldGroup: { gap: 7, backgroundColor: 'transparent' },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  input: { minHeight: 54, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, fontSize: 16, letterSpacing: 0 },
  passwordField: { minHeight: 54, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center' },
  passwordInput: { minHeight: 52, flex: 1, paddingLeft: 16, fontSize: 16, letterSpacing: 0 },
  eyeButton: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  recentRow: { minHeight: 52, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingLeft: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  recentAvatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  recentInitial: { fontSize: 15, fontWeight: '700' },
  recentEmail: { flex: 1, fontSize: 14, fontWeight: '600' },
  recentRemove: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  lockMessage: { borderRadius: 14, paddingHorizontal: 13, paddingVertical: 10 },
  lockMessageText: { fontSize: 13, lineHeight: 18, textAlign: 'center', fontWeight: '600' },
  primaryButton: { minHeight: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { fontSize: 16, fontWeight: '700' },
  secondaryButton: { minHeight: 50, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 12 },
  secondaryLabel: { fontSize: 15, fontWeight: '700' },
  demoButton: { minHeight: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  demoLabel: { fontSize: 14, fontWeight: '700' },
  signOutButton: { minHeight: 38, alignItems: 'center', justifyContent: 'center' },
  signOutLabel: { fontSize: 14, fontWeight: '600' },
  trustRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  trustText: { fontSize: 12 },
});
