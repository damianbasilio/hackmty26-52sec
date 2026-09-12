import type {
  Account,
  AnomalyAlert,
  CashflowScore,
  Customer,
  EnrichedTransaction,
  SavingsRule,
  Subscription,
} from '@contracts/types';

import { supabase } from '../supabase';
import type {
  DataSource,
  TransactionQuery,
  Transfer,
  TransferDraft,
  TransferRecipient,
} from './DataSource';

/** Un engine colgado no debe dejar la pantalla cargando para siempre. */
const REQUEST_TIMEOUT_MS = 10_000;

const TRANSFER_COLUMNS =
  'id,account_id,payee_account_id,payee_name,payee_bank,payee_last_four,amount_cents,concept,status,failure_reason,created_at';

function requireSupabase() {
  if (!supabase) {
    throw new Error('La app no tiene configurado el acceso a tus datos. Falta EXPO_PUBLIC_SUPABASE_URL en el .env.');
  }
  return supabase;
}

/** Los códigos de Postgres no son para el usuario. */
function describeTransferError(error: { code?: string; message?: string } | null): string {
  if (error?.code === '42501') {
    return 'No pudimos confirmar que esa cuenta sea tuya. Vuelve a iniciar sesión.';
  }
  if (error?.code === '23514') {
    return 'La cantidad no es válida para una transferencia.';
  }
  if (error?.code === '23503') {
    return 'La cuenta de destino ya no existe.';
  }
  const message = (error?.message ?? '').toLowerCase();
  if (message.includes('jwt') || message.includes('expired')) {
    return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  }
  if (message.includes('fetch') || message.includes('network')) {
    return 'No pudimos conectarnos para enviar tu transferencia. Revisa tu conexión.';
  }
  return 'No pudimos enviar tu transferencia. Inténtalo de nuevo.';
}

/**
 * Talks to the FastAPI engine over HTTPS. Never point this at api.nessieisreal.com —
 * plain HTTP, iOS ATS blocks it. The engine is the only Nessie caller.
 */
export class ApiDataSource implements DataSource {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    // Sin `new URL`: el polyfill de React Native resuelve rutas relativas con
    // un endsWith que se come el path cuando la base es un túnel.
    const query = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${this.baseUrl.replace(/\/+$/, '')}${path}${query ? `?${query}` : ''}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') {
        throw new Error('El servidor tardó demasiado en responder. Revisa tu conexión.');
      }
      throw new Error('No pudimos conectarnos con el servidor. Revisa tu conexión.');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} en ${path}`);
    return (await res.json()) as T;
  }

  private get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    return this.request<T>('GET', path, params);
  }

  private post<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    return this.request<T>('POST', path, params);
  }

  getCustomer(): Promise<Customer> {
    return this.get<Customer>('/customers/me');
  }

  getAccounts(): Promise<Account[]> {
    return this.get<Account[]>('/accounts');
  }

  getTransactions({ accountId, from, to, limit }: TransactionQuery): Promise<EnrichedTransaction[]> {
    return this.get<EnrichedTransaction[]>('/transactions', { account_id: accountId, from, to, limit });
  }

  getSubscriptions(accountId: string): Promise<Subscription[]> {
    return this.get<Subscription[]>('/subscriptions', { account_id: accountId });
  }

  getAlerts(accountId: string, includeResolved = false): Promise<AnomalyAlert[]> {
    return this.get<AnomalyAlert[]>('/anomalies', { account_id: accountId, include_resolved: includeResolved });
  }

  getScore(accountId: string): Promise<CashflowScore> {
    return this.get<CashflowScore>('/score', { account_id: accountId });
  }

  getSavingsRules(accountId: string): Promise<SavingsRule[]> {
    return this.get<SavingsRule[]>('/savings/rules', { account_id: accountId });
  }

  async resolveAlert(alertId: string, resolution: NonNullable<AnomalyAlert['resolution']>): Promise<void> {
    await this.post(`/anomalies/${alertId}/resolve`, { resolution });
  }

  async activateSavingsRule(ruleId: string, destinationAccountId: string): Promise<void> {
    await this.post(`/savings/rules/${ruleId}/activate`, { destination_account_id: destinationAccountId });
  }

  // El engine no toca estas tres: la app inserta la fila en `transfers` con la
  // anon key y la RLS decide, tal como documenta db/README.md. El engine la
  // completa después con el service_role.

  async getRecipients(accountId: string): Promise<TransferRecipient[]> {
    const client = requireSupabase();
    const [accounts, previous] = await Promise.all([
      client.from('accounts').select('id,nickname,last_four'),
      client
        .from('transfers')
        .select('payee_account_id,payee_name,payee_bank,payee_last_four')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    if (accounts.error) throw new Error(describeTransferError(accounts.error));
    if (previous.error) throw new Error(describeTransferError(previous.error));

    const recipients: TransferRecipient[] = (accounts.data ?? [])
      .filter((account) => account.id !== accountId)
      .map((account) => ({
        id: `own_${account.id}`,
        name: account.nickname,
        bank: 'Capital One',
        last_four: account.last_four,
        account_id: account.id,
      }));

    const seen = new Set(recipients.map((r) => `${r.name}|${r.last_four ?? ''}`));
    for (const row of previous.data ?? []) {
      const key = `${row.payee_name}|${row.payee_last_four ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recipients.push({
        id: `payee_${key}`,
        name: row.payee_name,
        bank: row.payee_bank,
        last_four: row.payee_last_four,
        account_id: row.payee_account_id,
      });
    }
    return recipients;
  }

  async getTransfers(accountId: string): Promise<Transfer[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('transfers')
      .select(TRANSFER_COLUMNS)
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw new Error(describeTransferError(error));
    return (data ?? []) as Transfer[];
  }

  async createTransfer(draft: TransferDraft): Promise<Transfer> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('transfers')
      .insert({
        id: draft.id,
        account_id: draft.accountId,
        payee_account_id: draft.recipient.account_id,
        payee_name: draft.recipient.name,
        payee_bank: draft.recipient.bank,
        payee_last_four: draft.recipient.last_four,
        amount_cents: draft.amountCents,
        concept: draft.concept,
      })
      .select(TRANSFER_COLUMNS)
      .single();

    // 23505: la llave ya existe, o sea que este envío ya entró. Un reintento
    // del usuario devuelve la misma transferencia en vez de cobrar de nuevo.
    if (error?.code === '23505') {
      const existing = await client.from('transfers').select(TRANSFER_COLUMNS).eq('id', draft.id).single();
      if (existing.data) return existing.data as Transfer;
    }
    if (error || !data) throw new Error(describeTransferError(error));
    return data as Transfer;
  }
}
