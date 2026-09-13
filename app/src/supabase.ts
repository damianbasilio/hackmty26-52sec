import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

import { joinChunks, splitIntoChunks } from './chunk';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Solo la anon key llega aquí. La service_role jamás entra al bundle. */
export const supabaseConfigured = url.length > 0 && anonKey.length > 0;

async function readChunkCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(`${key}.n`);
  const count = Number(raw);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

const secureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    try {
      const count = await readChunkCount(key);
      if (count === 0) return null;
      const parts = await Promise.all(
        Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${key}.${i}`)),
      );
      return joinChunks(parts);
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      const previous = await readChunkCount(key);
      const chunks = splitIntoChunks(value);
      for (let i = 0; i < chunks.length; i += 1) {
        await SecureStore.setItemAsync(`${key}.${i}`, chunks[i], {
          keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        });
      }
      await SecureStore.setItemAsync(`${key}.n`, String(chunks.length), {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
      // Una sesión más corta deja pedazos viejos que corromperían la siguiente lectura.
      for (let i = chunks.length; i < previous; i += 1) {
        await SecureStore.deleteItemAsync(`${key}.${i}`);
      }
    } catch {
      // Sin llavero la sesión vive solo en memoria; entrar sigue funcionando.
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      const count = await readChunkCount(key);
      for (let i = 0; i < count; i += 1) {
        await SecureStore.deleteItemAsync(`${key}.${i}`);
      }
      await SecureStore.deleteItemAsync(`${key}.n`);
    } catch {
      // Nada que limpiar si el llavero no responde.
    }
  },
};

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        storage: secureStoreAdapter,
        autoRefreshToken: true,
        persistSession: true,
        // No hay barra de direcciones en una app nativa.
        detectSessionInUrl: false,
      },
    })
  : null;

/**
 * El mismo cliente que guarda la sesión, no uno aparte: con un segundo cliente
 * sin sesión toda policy resuelve `auth.uid()` a null y las lecturas dan 0 filas.
 */
export function getSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Faltan EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Con EXPO_PUBLIC_DATA_SOURCE=fixtures no hacen falta.',
    );
  }
  return supabase;
}

/** Traduce fallas de red y de Supabase a algo que el usuario pueda leer. */
export function describeSupabaseError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const message = raw.toLowerCase();
  if (message.includes('invalid login credentials')) {
    return 'El correo o la contraseña no coinciden.';
  }
  if (message.includes('email not confirmed')) {
    return 'Tu correo todavía no está confirmado.';
  }
  if (message.includes('already registered') || message.includes('already been registered')) {
    return 'Ese correo ya tiene una cuenta. Inicia sesión.';
  }
  if (message.includes('password should be') || message.includes('weak password')) {
    return 'Tu contraseña es muy débil. Usa al menos 8 caracteres.';
  }
  if (message.includes('signups not allowed') || message.includes('signup is disabled')) {
    return 'El registro de cuentas está deshabilitado por ahora.';
  }
  if (message.includes('invalid email') || message.includes('unable to validate email')) {
    return 'Revisa el formato de tu correo.';
  }
  if (message.includes('too many requests') || message.includes('rate limit')) {
    return 'Demasiados intentos. Espera un momento antes de volver a probar.';
  }
  if (message.includes('abort') || message.includes('timeout')) {
    return 'El servidor tardó demasiado en responder. Revisa tu conexión.';
  }
  if (message.includes('network') || message.includes('fetch')) {
    return 'No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.';
  }
  return 'No pudimos completar la operación. Inténtalo de nuevo.';
}
