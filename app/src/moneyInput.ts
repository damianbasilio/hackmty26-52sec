export function normalizeMoneyInput(value: string): string {
  // La coma son miles en es-MX, igual que como formatCents imprime $14,250.00.
  // Tratarla como decimal convertia "14,250.00" en $14.25. La excepción es una
  // sola coma sin punto y con 0 a 2 dígitos detrás: es la tecla decimal de un
  // teclado configurado en otra región ("150,50").
  const digitsAndCommas = value.replace(/[^0-9,]/g, '');
  const decimalComma = !value.includes('.') && /^\d*,\d{0,2}$/.test(digitsAndCommas);
  const source = decimalComma ? digitsAndCommas.replace(',', '.') : value;
  const cleaned = source.replace(/,/g, '').replace(/[^0-9.]/g, '');
  const [whole = '', ...decimalParts] = cleaned.split('.');
  const decimal = decimalParts.join('').slice(0, 2);
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '').slice(0, 9);
  return decimalParts.length > 0 ? `${normalizedWhole || '0'}.${decimal}` : normalizedWhole;
}

/** Al salir del campo: "150" -> "150.00", así el monto siempre muestra sus centavos. */
export function withCents(value: string): string {
  if (!value) return value;
  const [whole, decimal = ''] = value.split('.');
  return `${whole || '0'}.${decimal.padEnd(2, '0')}`;
}

/**
 * Tope del TextInput. Con dos centavos escritos el teclado ya no acepta un
 * tercero: antes aparecía un instante y normalizeMoneyInput lo borraba.
 */
export function moneyMaxLength(value: string): number {
  const dot = value.indexOf('.');
  return dot === -1 ? 10 : dot + 3;
}

export function moneyInputToCents(value: string): number {
  const [whole = '0', decimal = ''] = value.split('.');
  const wholeCents = Number(whole || '0') * 100;
  const fractionalCents = Number(decimal.padEnd(2, '0').slice(0, 2) || '0');
  if (!Number.isSafeInteger(wholeCents) || !Number.isSafeInteger(fractionalCents)) return 0;
  return wholeCents + fractionalCents;
}
