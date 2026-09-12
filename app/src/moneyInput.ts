export function normalizeMoneyInput(value: string): string {
  // La coma son miles en es-MX, igual que como formatCents imprime $14,250.00.
  // Tratarla como decimal convertia "14,250.00" en $14.25.
  const cleaned = value.replace(/,/g, '').replace(/[^0-9.]/g, '');
  const [whole = '', ...decimalParts] = cleaned.split('.');
  const decimal = decimalParts.join('').slice(0, 2);
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '').slice(0, 9);
  return decimalParts.length > 0 ? `${normalizedWhole || '0'}.${decimal}` : normalizedWhole;
}

export function moneyInputToCents(value: string): number {
  const [whole = '0', decimal = ''] = value.split('.');
  const wholeCents = Number(whole || '0') * 100;
  const fractionalCents = Number(decimal.padEnd(2, '0').slice(0, 2) || '0');
  if (!Number.isSafeInteger(wholeCents) || !Number.isSafeInteger(fractionalCents)) return 0;
  return wholeCents + fractionalCents;
}
