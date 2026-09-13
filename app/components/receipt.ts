// Comprobantes en texto plano para la hoja de compartir del sistema. Texto y no
// imagen: no pide dependencias y se pega igual en WhatsApp, correo o notas.

import type { Account, EnrichedTransaction } from '@contracts/types';

import { CATEGORY_LABELS, localDayKey, localTime } from '@/components/display';
import type { Transfer } from '@/src/data/DataSource';
import { formatCents, formatLongDay } from '@/src/format';

export const TRANSACTION_TYPE_LABELS: Record<EnrichedTransaction['type'], string> = {
  purchase: 'Compra',
  deposit: 'Depósito',
  withdrawal: 'Retiro',
  transfer: 'Transferencia',
  fee: 'Comisión',
};

export const TRANSFER_STATUS_LABELS: Record<Transfer['status'], string> = {
  pending: 'En proceso',
  completed: 'Aplicada',
  failed: 'No se pudo aplicar',
  cancelled: 'Cancelada',
};

function when(iso: string): string {
  return `${formatLongDay(localDayKey(iso), true)} · ${localTime(iso)} h`;
}

export function transferReceipt(transfer: Transfer, source: Account | null): string {
  const payee = [transfer.payee_bank, transfer.payee_last_four ? `·· ${transfer.payee_last_four}` : null]
    .filter(Boolean)
    .join(' ');
  return [
    'Comprobante de transferencia · 52pay',
    '',
    `Monto: ${formatCents(transfer.amount_cents)} MXN`,
    `Para: ${transfer.payee_name}${payee ? ` (${payee})` : ''}`,
    source ? `Desde: ${source.nickname} ·· ${source.last_four}` : null,
    `Concepto: ${transfer.concept}`,
    `Estado: ${TRANSFER_STATUS_LABELS[transfer.status]}`,
    `Fecha: ${when(transfer.created_at)}`,
    `Folio: ${transfer.id}`,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

export function transactionReceipt(txn: EnrichedTransaction, account: Account): string {
  return [
    'Comprobante de movimiento · 52pay',
    '',
    `${TRANSACTION_TYPE_LABELS[txn.type]}: ${txn.merchant_display_name ?? txn.raw_description}`,
    `Monto: ${formatCents(txn.amount_cents)} MXN`,
    `Categoría: ${CATEGORY_LABELS[txn.category]}`,
    `Cuenta: ${account.nickname} ·· ${account.last_four}`,
    `Descripción del banco: ${txn.raw_description}`,
    `Fecha: ${when(txn.occurred_at)}`,
    `Folio: ${txn.id}`,
  ].join('\n');
}
