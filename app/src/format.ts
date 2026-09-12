// Shared formatters. Keep them pure and Intl-free: Hermes ICU support varies per platform.

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** 1425000 -> "$14,250.00". Never divide cents anywhere else. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const pesos = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${pesos}.${String(abs % 100).padStart(2, '0')}`;
}

/** ISO UTC timestamp -> "11 sep" in America/Monterrey (UTC-6, no DST since 2022). */
export function formatShortDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 6 * 3600 * 1000);
  return `${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]}`;
}
