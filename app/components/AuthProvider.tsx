import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';

import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';
import { describeSupabaseError, supabase } from '@/src/supabase';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;
const BACKGROUND_LOCK_MS = 15_000;
const PIN_LENGTH = 6;
const TRUSTED_DEVICE_KEY = 'capital-one.trusted-device.v1';
const DEVICE_PIN_PREFIX = 'capital-one.device-pin.v1.';
const RECENT_ACCOUNTS_KEY = 'capital-one.recent-accounts.v1';
const MAX_RECENT_ACCOUNTS = 5;

// Precargan los campos en la demo. Vienen del .env, que no se commitea: sin
// ellas los botones de demostración no se muestran.
const DEMO_EMAIL = process.env.EXPO_PUBLIC_DEMO_EMAIL ?? '';
const DEMO_PASSWORD = process.env.EXPO_PUBLIC_DEMO_PASSWORD ?? '';
const DEMO_PIN = process.env.EXPO_PUBLIC_DEMO_PIN ?? '';

type AuthResult = { ok: true } | { ok: false; message: string };
type SignUpResult = { ok: true; needsConfirmation: boolean } | { ok: false; message: string };

export type SignUpInput = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
};

type AuthContextValue = {
  signedIn: boolean;
  userId: string | null;
  /** Del registro; null para usuarios creados a mano en Supabase. */
  firstName: string | null;
  /** Correos que ya entraron en este teléfono, el más reciente primero. */
  recentEmails: string[];
  sessionLocked: boolean;
  /** La sesión es válida pero el dispositivo todavía no tiene PIN. */
  needsPinSetup: boolean;
  ready: boolean;
  attemptsRemaining: number;
  lockUntil: number | null;
  biometricsAvailable: boolean;
  biometricSignInEnabled: boolean;
  biometricLabel: string;
  email: string | null;
  demoEmail: string;
  demoPassword: string;
  demoPin: string;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (input: SignUpInput) => Promise<SignUpResult>;
  forgetAccount: (email: string) => void;
  setDevicePin: (pin: string) => Promise<AuthResult>;
  unlock: (pin: string) => Promise<AuthResult>;
  authenticateWithBiometrics: () => Promise<AuthResult>;
  verifyTransactionPin: (pin: string) => Promise<boolean>;
  lock: () => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function pinKey(userId: string) {
  return `${DEVICE_PIN_PREFIX}${userId}`;
}

async function readStoredPin(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  try {
    return await SecureStore.getItemAsync(pinKey(userId));
  } catch {
    return null;
  }
}

async function readRecentEmails(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(RECENT_ACCOUNTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function metadataFirstName(metadata: Record<string, unknown> | undefined): string | null {
  const value = metadata?.first_name;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const palette = usePalette();
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [recentEmails, setRecentEmails] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [sessionLocked, setSessionLocked] = useState(false);
  const [needsPinSetup, setNeedsPinSetup] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [appState, setAppState] = useState(AppState.currentState);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [biometricSignInEnabled, setBiometricSignInEnabled] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('biometría');
  const backgroundedAt = useRef<number | null>(null);
  const signedIn = userId !== null;

  useEffect(() => {
    let active = true;
    async function prepareDeviceSecurity() {
      try {
        const [hasHardware, isEnrolled, supportedTypes, trustedDevice] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
          LocalAuthentication.supportedAuthenticationTypesAsync(),
          SecureStore.getItemAsync(TRUSTED_DEVICE_KEY),
        ]);
        if (!active) return;
        const available = hasHardware && isEnrolled;
        setBiometricsAvailable(available);
        setBiometricSignInEnabled(available && trustedDevice === 'enabled');
        if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
          setBiometricLabel('Face ID');
        } else if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
          setBiometricLabel('huella');
        }
      } catch {
        if (active) {
          setBiometricsAvailable(false);
          setBiometricSignInEnabled(false);
        }
      }
    }
    prepareDeviceSecurity();
    readRecentEmails().then((emails) => {
      if (active) setRecentEmails(emails);
    });
    return () => {
      active = false;
    };
  }, []);

  const saveRecentEmails = useCallback((update: (current: string[]) => string[]) => {
    setRecentEmails((current) => {
      const next = update(current);
      SecureStore.setItemAsync(RECENT_ACCOUNTS_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const rememberAccount = useCallback((accountEmail: string | null | undefined) => {
    if (!accountEmail) return;
    const normalized = accountEmail.toLowerCase();
    saveRecentEmails((current) =>
      [normalized, ...current.filter((item) => item !== normalized)].slice(0, MAX_RECENT_ACCOUNTS),
    );
  }, [saveRecentEmails]);

  const forgetAccount = useCallback((accountEmail: string) => {
    const normalized = accountEmail.toLowerCase();
    saveRecentEmails((current) => current.filter((item) => item !== normalized));
  }, [saveRecentEmails]);

  // Sesión guardada en el llavero. Un arranque en frío la recupera pero entra
  // bloqueada: tener el teléfono no debe bastar para ver el saldo.
  useEffect(() => {
    let active = true;
    async function restoreSession() {
      if (!supabase) {
        if (active) setReady(true);
        return;
      }
      try {
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        const user = data.session?.user ?? null;
        if (user) {
          setUserId(user.id);
          setEmail(user.email ?? null);
          setFirstName(metadataFirstName(user.user_metadata));
          setNeedsPinSetup((await readStoredPin(user.id)) === null);
          setSessionLocked(true);
        }
      } catch {
        // Sin sesión recuperable se entra con correo y contraseña.
      } finally {
        if (active) setReady(true);
      }
    }
    restoreSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppState(nextState);
      // Supabase solo debe renovar el token con la app al frente.
      if (nextState === 'active') supabase?.auth.startAutoRefresh();
      else supabase?.auth.stopAutoRefresh();

      if (nextState !== 'active') {
        backgroundedAt.current = Date.now();
        return;
      }
      if (
        signedIn &&
        backgroundedAt.current !== null &&
        Date.now() - backgroundedAt.current >= BACKGROUND_LOCK_MS
      ) {
        setSessionLocked(true);
      }
      backgroundedAt.current = null;
    });
    return () => subscription.remove();
  }, [signedIn]);

  const checkLockout = useCallback((): AuthResult | null => {
    if (lockUntil === null || Date.now() >= lockUntil) {
      if (lockUntil !== null) {
        setLockUntil(null);
        setFailedAttempts(0);
      }
      return null;
    }
    const seconds = Math.ceil((lockUntil - Date.now()) / 1000);
    return { ok: false, message: `Inténtalo de nuevo en ${seconds} segundos.` };
  }, [lockUntil]);

  const registerFailure = useCallback((reason?: string): AuthResult => {
    const next = failedAttempts + 1;
    if (next >= MAX_ATTEMPTS) {
      setFailedAttempts(0);
      setLockUntil(Date.now() + LOCKOUT_MS);
      return { ok: false, message: 'Bloqueamos el acceso durante 30 segundos para proteger tu cuenta.' };
    }
    setFailedAttempts(next);
    return {
      ok: false,
      message: `${reason ?? 'Los datos no coinciden.'} Te quedan ${MAX_ATTEMPTS - next} intentos.`,
    };
  }, [failedAttempts]);

  const signIn = useCallback(async (inputEmail: string, password: string): Promise<AuthResult> => {
    const lockout = checkLockout();
    if (lockout) return lockout;
    if (!supabase) {
      return {
        ok: false,
        message: 'La app no tiene configurado el acceso. Falta EXPO_PUBLIC_SUPABASE_URL en el .env.',
      };
    }
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: inputEmail.trim().toLowerCase(),
        password,
      });
      if (error || !data.user) {
        const message = describeSupabaseError(error);
        // Solo las credenciales malas gastan intentos; una red caída no.
        return message === 'El correo o la contraseña no coinciden.'
          ? registerFailure(message)
          : { ok: false, message };
      }
      setFailedAttempts(0);
      setLockUntil(null);
      setUserId(data.user.id);
      setEmail(data.user.email ?? null);
      setFirstName(metadataFirstName(data.user.user_metadata));
      rememberAccount(data.user.email);
      const storedPin = await readStoredPin(data.user.id);
      setNeedsPinSetup(storedPin === null);
      // La contraseña sola no abre la app: siempre sigue el PIN del dispositivo,
      // también con el acceso de demostración.
      setSessionLocked(true);
      try {
        await SecureStore.setItemAsync(TRUSTED_DEVICE_KEY, 'enabled', {
          keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
        });
        setBiometricSignInEnabled(biometricsAvailable);
      } catch {
        // El acceso continúa si el dispositivo no tiene un llavero disponible.
      }
      return { ok: true };
    } catch (cause) {
      return { ok: false, message: describeSupabaseError(cause) };
    }
  }, [biometricsAvailable, checkLockout, registerFailure, rememberAccount]);

  const signUp = useCallback(async (input: SignUpInput): Promise<SignUpResult> => {
    if (!supabase) {
      return {
        ok: false,
        message: 'La app no tiene configurado el acceso. Falta EXPO_PUBLIC_SUPABASE_URL en el .env.',
      };
    }
    try {
      const { data, error } = await supabase.auth.signUp({
        email: input.email.trim().toLowerCase(),
        password: input.password,
        // handle_new_auth_user() liga la cuenta a un customer existente o crea uno.
        options: {
          data: { first_name: input.firstName.trim(), last_name: input.lastName.trim() },
          // Sin esto el correo usa el Site URL de Supabase (localhost). Debe estar
          // en Authentication -> URL Configuration -> Redirect URLs.
          emailRedirectTo: Linking.createURL('sign-in'),
        },
      });
      if (error) return { ok: false, message: describeSupabaseError(error) };
      // Con la protección contra enumeración, un correo ya registrado regresa
      // un usuario sin identidades en vez de un error.
      if (data.user && data.user.identities?.length === 0) {
        return { ok: false, message: 'Ese correo ya tiene una cuenta. Inicia sesión.' };
      }
      rememberAccount(data.user?.email ?? input.email);
      if (!data.session || !data.user) return { ok: true, needsConfirmation: true };
      setFailedAttempts(0);
      setLockUntil(null);
      setUserId(data.user.id);
      setEmail(data.user.email ?? null);
      setFirstName(metadataFirstName(data.user.user_metadata));
      setNeedsPinSetup((await readStoredPin(data.user.id)) === null);
      setSessionLocked(true);
      return { ok: true, needsConfirmation: false };
    } catch (cause) {
      return { ok: false, message: describeSupabaseError(cause) };
    }
  }, [rememberAccount]);

  const setDevicePin = useCallback(async (pin: string): Promise<AuthResult> => {
    if (!/^\d{6}$/.test(pin)) {
      return { ok: false, message: `Tu PIN debe tener ${PIN_LENGTH} dígitos.` };
    }
    if (!userId) {
      return { ok: false, message: 'Inicia sesión antes de crear tu PIN.' };
    }
    try {
      // ponytail: el PIN vive tal cual en el llavero del dispositivo, que ya lo
      // cifra por hardware y no lo exporta. Hashearlo pediría expo-crypto; si
      // algún día se sincroniza entre dispositivos, eso deja de alcanzar.
      await SecureStore.setItemAsync(pinKey(userId), pin, {
        keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
      });
    } catch {
      return { ok: false, message: 'Este dispositivo no permitió guardar tu PIN de forma segura.' };
    }
    setNeedsPinSetup(false);
    setSessionLocked(false);
    setFailedAttempts(0);
    setLockUntil(null);
    return { ok: true };
  }, [userId]);

  const unlock = useCallback(async (pin: string): Promise<AuthResult> => {
    const lockout = checkLockout();
    if (lockout) return lockout;
    const stored = await readStoredPin(userId);
    if (stored === null) {
      setNeedsPinSetup(true);
      return { ok: false, message: 'Crea tu PIN para desbloquear la app.' };
    }
    if (pin !== stored) return registerFailure('El PIN no coincide.');
    setFailedAttempts(0);
    setLockUntil(null);
    setSessionLocked(false);
    return { ok: true };
  }, [checkLockout, registerFailure, userId]);

  const verifyTransactionPin = useCallback(async (pin: string) => {
    const stored = await readStoredPin(userId);
    return stored !== null && pin === stored;
  }, [userId]);

  const authenticateWithBiometrics = useCallback(async (): Promise<AuthResult> => {
    const lockout = checkLockout();
    if (lockout) return lockout;
    if (!biometricsAvailable) {
      return { ok: false, message: 'La biometría no está disponible o configurada en este dispositivo.' };
    }
    // La biometría desbloquea una sesión que ya existe; no puede crear una.
    if (!signedIn) {
      return { ok: false, message: 'Inicia sesión con tu correo y contraseña para activar el acceso biométrico.' };
    }
    if (needsPinSetup) {
      return { ok: false, message: 'Crea tu PIN antes de usar la biometría.' };
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Desbloquear tu sesión',
      cancelLabel: 'Cancelar',
      fallbackLabel: 'Usar PIN',
      biometricsSecurityLevel: 'strong',
    });
    if (!result.success) {
      return {
        ok: false,
        message: result.error === 'user_cancel' ? 'Autenticación cancelada.' : 'No pudimos verificar tu identidad.',
      };
    }
    setFailedAttempts(0);
    setLockUntil(null);
    setSessionLocked(false);
    return { ok: true };
  }, [biometricsAvailable, checkLockout, needsPinSetup, signedIn]);

  const signOut = useCallback(() => {
    // El PIN se queda: es del dispositivo, y volver a entrar no debe pedir uno nuevo.
    supabase?.auth.signOut().catch(() => undefined);
    setUserId(null);
    setEmail(null);
    setFirstName(null);
    setSessionLocked(false);
    setNeedsPinSetup(false);
    setFailedAttempts(0);
    setLockUntil(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    signedIn,
    userId,
    firstName,
    recentEmails,
    sessionLocked,
    needsPinSetup,
    ready,
    attemptsRemaining: MAX_ATTEMPTS - failedAttempts,
    lockUntil,
    biometricsAvailable,
    biometricSignInEnabled,
    biometricLabel,
    email,
    demoEmail: DEMO_EMAIL,
    demoPassword: DEMO_PASSWORD,
    demoPin: DEMO_PIN,
    signIn,
    signUp,
    forgetAccount,
    setDevicePin,
    unlock,
    authenticateWithBiometrics,
    verifyTransactionPin,
    lock: () => setSessionLocked(true),
    signOut,
  }), [authenticateWithBiometrics, biometricLabel, biometricSignInEnabled, biometricsAvailable, email, failedAttempts, firstName, forgetAccount, lockUntil, needsPinSetup, ready, recentEmails, sessionLocked, setDevicePin, signIn, signOut, signUp, signedIn, unlock, userId, verifyTransactionPin]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      {appState !== 'active' ? (
        <View style={[StyleSheet.absoluteFill, styles.privacyShield, { backgroundColor: palette.accentDeep }]}>
          <View style={[styles.shieldIcon, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
            <Text style={styles.shieldGlyph}>●</Text>
          </View>
          <Text style={styles.shieldTitle}>Contenido protegido</Text>
        </View>
      ) : null}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe usarse dentro de AuthProvider.');
  return value;
}

const styles = StyleSheet.create({
  privacyShield: {
    zIndex: 999,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  shieldIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shieldGlyph: { color: '#FFFFFF', fontSize: 21 },
  shieldTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
});
