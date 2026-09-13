// Comprobantes: un PDF con formato para la hoja de compartir y, si el teléfono
// no puede generarlo, el mismo contenido en texto.

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

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

type Tone = 'positive' | 'warning' | 'danger';

export type ReceiptDocument = {
  kind: string;
  amountCents: number;
  headline: string;
  status: { label: string; tone: Tone };
  rows: { label: string; value: string }[];
  folio: string;
};

function when(iso: string): string {
  return `${formatLongDay(localDayKey(iso), true)} · ${localTime(iso)} h`;
}

export function transferReceipt(transfer: Transfer, source: Account | null): ReceiptDocument {
  const payeeBank = [transfer.payee_bank, transfer.payee_last_four ? `·· ${transfer.payee_last_four}` : null]
    .filter(Boolean)
    .join(' ');
  return {
    kind: 'Comprobante de transferencia',
    amountCents: transfer.amount_cents,
    headline: `Para ${transfer.payee_name}`,
    status: {
      label: TRANSFER_STATUS_LABELS[transfer.status],
      tone: transfer.status === 'completed' ? 'positive' : transfer.status === 'pending' ? 'warning' : 'danger',
    },
    rows: [
      { label: 'Beneficiario', value: transfer.payee_name },
      ...(payeeBank ? [{ label: 'Banco destino', value: payeeBank }] : []),
      ...(source ? [{ label: 'Cuenta origen', value: `${source.nickname} ·· ${source.last_four}` }] : []),
      { label: 'Concepto', value: transfer.concept || 'Transferencia' },
      { label: 'Fecha y hora', value: when(transfer.created_at) },
      ...(transfer.failure_reason ? [{ label: 'Motivo', value: transfer.failure_reason }] : []),
    ],
    folio: transfer.id,
  };
}

export function transactionReceipt(txn: EnrichedTransaction, account: Account): ReceiptDocument {
  const name = txn.merchant_display_name ?? txn.raw_description;
  return {
    kind: `Comprobante de ${TRANSACTION_TYPE_LABELS[txn.type].toLowerCase()}`,
    amountCents: txn.amount_cents,
    headline: name,
    status: {
      label: txn.status === 'completed' ? 'Aplicado' : txn.status === 'pending' ? 'Pendiente' : 'Cancelado',
      tone: txn.status === 'completed' ? 'positive' : txn.status === 'pending' ? 'warning' : 'danger',
    },
    rows: [
      { label: 'Comercio', value: name },
      { label: 'Categoría', value: CATEGORY_LABELS[txn.category] },
      { label: 'Cuenta', value: `${account.nickname} ·· ${account.last_four}` },
      { label: 'Descripción del banco', value: txn.raw_description },
      { label: 'Fecha y hora', value: when(txn.occurred_at) },
      ...(txn.nessie_transaction_id ? [{ label: 'Referencia bancaria', value: txn.nessie_transaction_id }] : []),
    ],
    folio: txn.id,
  };
}

function receiptText(doc: ReceiptDocument): string {
  return [
    `${doc.kind} · 52pay`,
    '',
    `Monto: ${formatCents(Math.abs(doc.amountCents))} MXN`,
    `Estado: ${doc.status.label}`,
    ...doc.rows.map((row) => `${row.label}: ${row.value}`),
    `Folio: ${doc.folio}`,
  ].join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const TONE_COLORS: Record<Tone, { background: string; color: string }> = {
  positive: { background: '#DFF1E6', color: '#087A46' },
  warning: { background: '#F7ECD7', color: '#95600B' },
  danger: { background: '#FBE5E2', color: '#D03027' },
};

export function receiptHtml(doc: ReceiptDocument, issuedAt = new Date().toISOString()): string {
  const tone = TONE_COLORS[doc.status.tone];
  const rows = doc.rows
    .map((row) => `<tr><td class="label">${escapeHtml(row.label)}</td><td class="value">${escapeHtml(row.value)}</td></tr>`)
    .join('');
  return `<!doctype html>
<html lang="es-MX"><head><meta charset="utf-8" />
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #F2F4F7; color: #071A3D; font-family: -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif; }
  .page { padding: 56px 52px; }
  .card { background: #FFFFFF; border: 1px solid #E1E5EB; border-radius: 20px; overflow: hidden; }
  .header { background: #004977; color: #FFFFFF; padding: 26px 34px; display: flex; align-items: center; gap: 14px; }
  .mark { width: 46px; height: 46px; border-radius: 13px; background: #FFFFFF; color: #004977; font-weight: 800; font-size: 16px; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; }
  .mark span { position: absolute; width: 62px; height: 6px; border-radius: 6px; background: #D03027; top: 8px; right: -18px; transform: rotate(-18deg); }
  .brand { font-size: 19px; font-weight: 700; letter-spacing: -0.3px; }
  .brand small { display: block; margin-top: 3px; font-size: 12px; font-weight: 500; opacity: 0.78; }
  .summary { padding: 34px 34px 28px; text-align: center; border-bottom: 1px dashed #CDD3DC; }
  .kind { font-size: 12px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; color: #667080; }
  .amount { margin: 12px 0 6px; font-size: 46px; font-weight: 800; letter-spacing: -1.2px; }
  .amount small { font-size: 16px; font-weight: 600; color: #667080; letter-spacing: 0; }
  .headline { font-size: 16px; color: #3A4556; }
  .pill { display: inline-block; margin-top: 16px; padding: 6px 16px; border-radius: 999px; font-size: 12px; font-weight: 700; background: ${tone.background}; color: ${tone.color}; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 14px 34px; font-size: 14px; line-height: 1.4; border-bottom: 1px solid #EEF1F4; vertical-align: top; }
  td.label { width: 38%; color: #667080; }
  td.value { text-align: right; font-weight: 600; word-break: break-word; }
  .folio { display: flex; justify-content: space-between; gap: 16px; padding: 18px 34px; background: #F7F8FA; font-size: 12px; color: #667080; }
  .folio strong { color: #071A3D; font-family: Menlo, 'Courier New', monospace; font-weight: 600; word-break: break-all; text-align: right; }
  .footer { margin: 24px 12px 0; text-align: center; font-size: 11px; line-height: 1.6; color: #8A93A3; }
</style></head>
<body><div class="page">
  <div class="card">
    <div class="header">
      <div class="mark"><span></span>C1</div>
      <div class="brand">Capital One<small>52pay · Banca inteligente</small></div>
    </div>
    <div class="summary">
      <div class="kind">${escapeHtml(doc.kind)}</div>
      <div class="amount">${escapeHtml(formatCents(Math.abs(doc.amountCents)))} <small>MXN</small></div>
      <div class="headline">${escapeHtml(doc.headline)}</div>
      <div class="pill">${escapeHtml(doc.status.label)}</div>
    </div>
    <table>${rows}</table>
    <div class="folio"><span>Folio de operación</span><strong>${escapeHtml(doc.folio)}</strong></div>
  </div>
  <p class="footer">
    Comprobante generado en 52pay el ${escapeHtml(when(issuedAt))}.<br />
    Operación del entorno de pruebas de Capital One (Nessie). No tiene validez fiscal.
  </p>
</div></body></html>`;
}

/** Genera el PDF y abre la hoja de compartir. Sin PDF disponible, comparte el texto. */
export async function shareReceipt(doc: ReceiptDocument): Promise<void> {
  let uri: string | null = null;
  try {
    if (await Sharing.isAvailableAsync()) {
      uri = (await Print.printToFileAsync({ html: receiptHtml(doc), width: 612, height: 792 })).uri;
    }
  } catch {
    uri = null;
  }
  if (!uri) {
    await Share.share({ title: doc.kind, message: receiptText(doc) }).catch(() => undefined);
    return;
  }
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: doc.kind }).catch(
    () => undefined,
  );
}
