// Display helpers for lane C screens. Amounts always go through formatCents.

import type { MerchantCategory, SavingsRuleKind } from '@contracts/types';

import { formatCents, formatShortDate } from '@/src/format';

export const CATEGORY_LABELS: Record<MerchantCategory, string> = {
  groceries: 'Súper',
  convenience: 'Conveniencia',
  restaurants: 'Restaurantes',
  delivery: 'A domicilio',
  transport: 'Transporte',
  fuel: 'Gasolina',
  utilities: 'Servicios',
  telecom: 'Teléfono e internet',
  streaming: 'Streaming',
  fitness: 'Gimnasio',
  housing: 'Vivienda',
  health: 'Salud',
  shopping: 'Compras',
  education: 'Educación',
  insurance: 'Seguros',
  fees: 'Comisiones',
  income: 'Ingresos',
  transfer: 'Transferencias',
  cash: 'Efectivo',
  other: 'Otros',
};

export const SAVINGS_KIND_LABELS: Record<SavingsRuleKind, string> = {
  round_up: 'Redondeo',
  fixed_recurring: 'Apartado fijo',
  percent_of_income: 'Parte de tu ingreso',
  cancel_subscription: 'Cancelación',
  spend_cap: 'Tope de gasto',
};

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

// America/Monterrey: UTC-6 fixed, sin horario de verano desde 2022.
const TZ_OFFSET_MS = 6 * 60 * 60 * 1000;

/** ISO UTC timestamp -> `YYYY-MM-DD` as seen in Monterrey. */
export function localDayKey(iso: string): string {
  return new Date(new Date(iso).getTime() - TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** ISO UTC timestamp -> `YYYY-MM` as seen in Monterrey. */
export function localMonthKey(iso: string): string {
  return localDayKey(iso).slice(0, 7);
}

export function todayKey(): string {
  return localDayKey(new Date().toISOString());
}

/** ISO UTC timestamp -> `21:12` as seen in Monterrey. */
export function localTime(iso: string): string {
  return new Date(new Date(iso).getTime() - TZ_OFFSET_MS).toISOString().slice(11, 16);
}

/** `2026-09-12` -> `Hoy`, `Ayer` or `vie 12 sep`. */
export function formatDayHeading(dayKey: string, today = todayKey()): string {
  if (dayKey === today) return 'Hoy';
  const yesterday = new Date(new Date(`${today}T12:00:00Z`).getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  if (dayKey === yesterday) return 'Ayer';
  const weekday = WEEKDAYS[new Date(`${dayKey}T12:00:00Z`).getUTCDay()];
  return `${weekday} ${formatShortDate(`${dayKey}T12:00:00Z`)}`;
}

/** Same amount rendering everywhere: entradas con `+`, salidas con el `-` de formatCents. */
export function formatSignedCents(cents: number): string {
  return cents > 0 ? `+${formatCents(cents)}` : formatCents(cents);
}

/** `Mariana Ríos` -> `MR`. Un solo nombre da una letra. */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

const AVATAR_TINTS = ['#E3F0FA', '#FCE7E5', '#E7F4EB', '#F3ECFB', '#FDF1DF'];

/** Color estable por nombre: el mismo contacto sale igual en cada pantalla. */
export function avatarTintFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 100000;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}
