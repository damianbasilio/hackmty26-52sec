// SecureStore corta los valores de más de 2048 bytes y la sesión de Supabase los
// pasa. Partirla y volverla a juntar es donde se pierde una sesión entera, así
// que la aritmética vive aquí, sin dependencias, y format.check.ts la prueba.

export const CHUNK_SIZE = 1800;

/** Nunca devuelve cero pedazos: un valor vacío es un pedazo vacío. */
export function splitIntoChunks(value: string, size = CHUNK_SIZE): string[] {
  if (value.length === 0) return [''];
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += size) {
    chunks.push(value.slice(i, i + size));
  }
  return chunks;
}

/** Un pedazo faltante deja la sesión ilegible: se trata como ausente, no como texto a medias. */
export function joinChunks(parts: (string | null)[]): string | null {
  if (parts.length === 0) return null;
  return parts.some((part) => part === null) ? null : parts.join('');
}
