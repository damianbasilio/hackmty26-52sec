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

const MONTHS_ES_LONG = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Calendar day "2026-10-05" -> "5 de octubre". No timezone shift: the day is already local. */
export function formatLongDay(day: string, withYear = false): string {
  const [y, m, d] = day.split('-').map(Number);
  const text = `${d} de ${MONTHS_ES_LONG[m - 1]}`;
  return withYear ? `${text} de ${y}` : text;
}

/** Signed whole days from today in America/Monterrey to a calendar day. Future is positive. */
export function daysFromToday(day: string, now: Date = new Date()): number {
  const local = new Date(now.getTime() - 6 * 3600 * 1000);
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const [y, m, d] = day.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - today) / 86400000);
}

/** `2026-09` (or any ISO day/timestamp) -> `septiembre`. */
export function formatMonthName(monthKey: string): string {
  return MONTHS_ES_LONG[Number(monthKey.slice(5, 7)) - 1] ?? monthKey;
}
