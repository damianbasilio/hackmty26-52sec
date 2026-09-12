import type {
  Account,
  AnomalyAlert,
  CashflowScore,
  Customer,
  EnrichedTransaction,
  SavingsRule,
  Subscription,
} from '@contracts/types';

import type { DataSource, TransactionQuery } from './DataSource';

/**
 * Talks to the FastAPI engine over HTTPS. Stub: lane B fills the bodies in as each
 * engine endpoint lands. Never point this at api.nessieisreal.com — plain HTTP, iOS ATS
 * blocks it. The engine is the only Nessie caller.
 */
export class ApiDataSource implements DataSource {
  constructor(private readonly baseUrl: string) {}

  private async get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString(), { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} en ${path}`);
    return (await res.json()) as T;
  }

  private async post<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString(), { method: 'POST', headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} en ${path}`);
    return (await res.json()) as T;
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
}
