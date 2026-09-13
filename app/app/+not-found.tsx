import { Link, Stack } from 'expo-router';
import { StyleSheet } from 'react-native';

import { PremiumSurface } from '@/components/PremiumSurface';
import { Text } from '@/components/Themed';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Página no encontrada', headerStyle: { backgroundColor: '#070A0D' }, headerTintColor: '#F7F8FA' }} />
      <PremiumSurface style={styles.container}>
        <Text style={styles.code}>404</Text>
        <Text style={styles.title}>Esta pantalla no existe.</Text>

        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Volver a Inicio</Text>
        </Link>
      </PremiumSurface>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    color: '#F7F8FA',
    fontSize: 24,
    fontWeight: '700',
  },
  code: {
    color: '#FF3B57',
    fontSize: 72,
    fontWeight: '800',
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontSize: 16,
    color: '#FF3B57',
    fontWeight: '700',
  },
});
