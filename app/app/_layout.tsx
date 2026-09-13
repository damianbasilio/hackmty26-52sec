import { DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname, useRouter } from 'expo-router';
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from 'expo-screen-capture';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';

import { AuthProvider, useAuth } from '@/components/AuthProvider';
import { BankingProvider } from '@/components/BankingProvider';
import { useColorScheme } from '@/components/useColorScheme';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'sign-in',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  // Saldos, comprobantes y la clave dinámica no deben terminar en una captura.
  // Solo nativo: en web el módulo no existe y el hook deja una promesa rechazada.
  // EXPO_PUBLIC_ALLOW_SCREEN_CAPTURE=1 lo apaga para poder grabar la demo.
  useEffect(() => {
    if (Platform.OS === 'web' || process.env.EXPO_PUBLIC_ALLOW_SCREEN_CAPTURE === '1') return;
    preventScreenCaptureAsync().catch(() => undefined);
    return () => {
      allowScreenCaptureAsync().catch(() => undefined);
    };
  }, []);

  return (
    <AuthProvider>
      <BankingProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <AuthGate />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="sign-in" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="transferencias" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="dividir-gasto" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="clave-dinamica" options={{ animation: 'slide_from_right' }} />
          </Stack>
        </ThemeProvider>
      </BankingProvider>
    </AuthProvider>
  );
}

function AuthGate() {
  const { signedIn, sessionLocked } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const needsAccess = !signedIn || sessionLocked;
    if (needsAccess && pathname !== '/sign-in') {
      router.replace('/sign-in' as never);
    } else if (!needsAccess && pathname === '/sign-in') {
      router.replace('/' as never);
    }
  }, [pathname, router, sessionLocked, signedIn]);

  return null;
}
