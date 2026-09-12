import type {
  Account,
  AnomalyAlert,
  CashflowScore,
  Customer,
  EnrichedTransaction,
  SavingsRule,
  Subscription,
} from '@contracts/types';

import type {
  DataSource,
  TransactionQuery,
  Transfer,
  TransferDraft,
  TransferRecipient,
} from './DataSource';

/** Un engine colgado no debe dejar la pantalla cargando para siempre. */
const REQUEST_TIMEOUT_MS = 10_000;
/** Mover dinero real toca Nessie dos veces; tarda más que una lectura. */
const TRANSFER_TIMEOUT_MS = 25_000;

/** El engine manda su propio texto en español dentro de `detail`. */
function readDetail(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  // 422 de pydantic: lista de errores por campo, no sirve para el usuario.
  return null;
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
    body?: unknown,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    // Sin `new URL`: el polyfill de React Native resuelve rutas relativas con
    // un endsWith que se come el path cuando la base es un túnel.
    const query = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${this.baseUrl.replace(/\/+$/, '')}${path}${query ? `?${query}` : ''}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: body === undefined
          ? { accept: 'application/json' }
          : { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
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
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(readDetail(payload) ?? `${res.status} ${res.statusText} en ${path}`);
    }
    return payload as T;
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

  // El engine es quien mueve el dinero: hace el retiro y el depósito en Nessie
  // y deja la fila en `transfers`. Es idempotente por `id`, así que reenviar el
  // mismo borrador reconcilia en vez de cobrar dos veces.

  async getRecipients(accountId: string): Promise<TransferRecipient[]> {
    const [accounts, previous] = await Promise.all([
      this.getAccounts(),
      this.getTransfers(accountId),
    ]);

    const recipients: TransferRecipient[] = accounts
      .filter((account) => account.id !== accountId)
      .map((account) => ({
        id: `own_${account.id}`,
        name: account.nickname,
        bank: 'Capital One',
        last_four: account.last_four,
        account_id: account.id,
      }));

    const seen = new Set(recipients.map((r) => `${r.name}|${r.last_four ?? ''}`));
    for (const transfer of previous) {
      const key = `${transfer.payee_name}|${transfer.payee_last_four ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recipients.push({
        id: `payee_${key}`,
        name: transfer.payee_name,
        bank: transfer.payee_bank,
        last_four: transfer.payee_last_four,
        account_id: transfer.payee_account_id,
      });
    }
    return recipients;
  }

  getTransfers(accountId: string): Promise<Transfer[]> {
    return this.get<Transfer[]>('/transfers', { account_id: accountId });
  }

  createTransfer(draft: TransferDraft): Promise<Transfer> {
    return this.request<Transfer>(
      'POST',
      '/transfers',
      {},
      {
        id: draft.id,
        account_id: draft.accountId,
        payee_account_id: draft.recipient.account_id,
        payee_name: draft.recipient.name,
        payee_bank: draft.recipient.bank,
        payee_last_four: draft.recipient.last_four,
        amount_cents: draft.amountCents,
        concept: draft.concept,
      },
      TRANSFER_TIMEOUT_MS,
    );
  }
}
