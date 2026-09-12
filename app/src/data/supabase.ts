import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

/**
 * Único cliente de la app. Perezoso a propósito: en `fixtures` la demo corre sin
 * llaves y crearlo al importar rompería el arranque.
 *
 * La sesión vive en memoria mientras el carril C conecta el login real; sin
 * sesión toda policy resuelve `auth.uid()` a null y las lecturas dan 0 filas.
 */
export function getSupabase(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      'Faltan EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Con EXPO_PUBLIC_DATA_SOURCE=fixtures no hacen falta.',
    );
  }
  if (!client) {
    // detectSessionInUrl es de navegador: en React Native no hay URL que leer.
    client = createClient(url, anonKey, {
      auth: { detectSessionInUrl: false },
    });
  }
  return client;
}
