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
import * as SecureStore from 'expo-secure-store';

import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';

const DEMO_EMAIL = 'ana.trevino@example.mx';
const DEMO_PASSWORD = 'CapitalOne26!';
const DEMO_PIN = '482126';
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;
const BACKGROUND_LOCK_MS = 15_000;
const TRUSTED_DEVICE_KEY = 'capital-one.trusted-device.v1';

type AuthResult = { ok: true } | { ok: false; message: string };

type AuthContextValue = {
  signedIn: boolean;
  sessionLocked: boolean;
  attemptsRemaining: number;
  lockUntil: number | null;
  biometricsAvailable: boolean;
  biometricSignInEnabled: boolean;
  biometricLabel: string;
  demoEmail: string;
  demoPassword: string;
  demoPin: string;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  unlock: (pin: string) => Promise<AuthResult>;
  authenticateWithBiometrics: () => Promise<AuthResult>;
  verifyTransactionPin: (pin: string) => Promise<boolean>;
  lock: () => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export function AuthProvider({ children }: PropsWithChildren) {
  const palette = usePalette();
  const [signedIn, setSignedIn] = useState(false);
  const [sessionLocked, setSessionLocked] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [appState, setAppState] = useState(AppState.currentState);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [biometricSignInEnabled, setBiometricSignInEnabled] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('biometría');
  const backgroundedAt = useRef<number | null>(null);

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
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppState(nextState);
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

  const registerFailure = useCallback((): AuthResult => {
    const next = failedAttempts + 1;
    if (next >= MAX_ATTEMPTS) {
      setFailedAttempts(0);
      setLockUntil(Date.now() + LOCKOUT_MS);
      return { ok: false, message: 'Bloqueamos el acceso durante 30 segundos para proteger tu cuenta.' };
    }
    setFailedAttempts(next);
    return {
      ok: false,
      message: `Los datos no coinciden. Te quedan ${MAX_ATTEMPTS - next} intentos.`,
    };
  }, [failedAttempts]);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const lockout = checkLockout();
    if (lockout) return lockout;
    await wait(520);
    if (email.trim().toLowerCase() !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
      return registerFailure();
    }
    setFailedAttempts(0);
    setLockUntil(null);
    setSignedIn(true);
    setSessionLocked(false);
    try {
      await SecureStore.setItemAsync(TRUSTED_DEVICE_KEY, 'enabled', {
        keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
      });
      setBiometricSignInEnabled(biometricsAvailable);
    } catch {
      // El acceso continúa si el dispositivo no tiene un llavero disponible.
    }
    return { ok: true };
  }, [biometricsAvailable, checkLockout, registerFailure]);

  const unlock = useCallback(async (pin: string): Promise<AuthResult> => {
    const lockout = checkLockout();
    if (lockout) return lockout;
    await wait(360);
    if (pin !== DEMO_PIN) return registerFailure();
    setFailedAttempts(0);
    setLockUntil(null);
    setSessionLocked(false);
    return { ok: true };
  }, [checkLockout, registerFailure]);

  const verifyTransactionPin = useCallback(async (pin: string) => {
    await wait(420);
    return pin === DEMO_PIN;
  }, []);

  const authenticateWithBiometrics = useCallback(async (): Promise<AuthResult> => {
    const lockout = checkLockout();
    if (lockout) return lockout;
    if (!biometricsAvailable) {
      return { ok: false, message: 'La biometría no está disponible o configurada en este dispositivo.' };
    }
    if (!signedIn && !biometricSignInEnabled) {
      return { ok: false, message: 'Inicia sesión una vez con tu contraseña para activar el acceso biométrico.' };
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: signedIn ? 'Desbloquear tu sesión' : 'Acceder a Capital One',
      cancelLabel: 'Cancelar',
      fallbackLabel: signedIn ? 'Usar PIN' : 'Usar contraseña',
      biometricsSecurityLevel: 'strong',
    });
    if (!result.success) {
      return { ok: false, message: result.error === 'user_cancel' ? 'Autenticación cancelada.' : 'No pudimos verificar tu identidad.' };
    }
    setFailedAttempts(0);
    setLockUntil(null);
    setSignedIn(true);
    setSessionLocked(false);
    return { ok: true };
  }, [biometricSignInEnabled, biometricsAvailable, checkLockout, signedIn]);

  const signOut = useCallback(() => {
    setSignedIn(false);
    setSessionLocked(false);
    setFailedAttempts(0);
    setLockUntil(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    signedIn,
    sessionLocked,
    attemptsRemaining: MAX_ATTEMPTS - failedAttempts,
    lockUntil,
    biometricsAvailable,
    biometricSignInEnabled,
    biometricLabel,
    demoEmail: DEMO_EMAIL,
    demoPassword: DEMO_PASSWORD,
    demoPin: DEMO_PIN,
    signIn,
    unlock,
    authenticateWithBiometrics,
    verifyTransactionPin,
    lock: () => setSessionLocked(true),
    signOut,
  }), [authenticateWithBiometrics, biometricLabel, biometricSignInEnabled, biometricsAvailable, failedAttempts, lockUntil, sessionLocked, signIn, signOut, signedIn, unlock, verifyTransactionPin]);

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
