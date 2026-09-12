import type {
  Account,
  AnomalyAlert,
  CashflowScore,
  Customer,
  EnrichedTransaction,
  SavingsRule,
  Subscription,
} from '@contracts/types';

import accountsJson from '@contracts/fixtures/accounts.json';
import alertsJson from '@contracts/fixtures/anomaly_alerts.json';
import customersJson from '@contracts/fixtures/customers.json';
import enrichedJson from '@contracts/fixtures/enriched_transactions.json';
import rulesJson from '@contracts/fixtures/savings_rules.json';
import scoresJson from '@contracts/fixtures/cashflow_scores.json';
import subscriptionsJson from '@contracts/fixtures/subscriptions.json';

import type {
  DataSource,
  TransactionQuery,
  Transfer,
  TransferDraft,
  TransferRecipient,
} from './DataSource';

const customers = customersJson as Customer[];
const accounts = accountsJson as Account[];
const transactions = enrichedJson as EnrichedTransaction[];
const subscriptions = subscriptionsJson as Subscription[];
const alerts = alertsJson as AnomalyAlert[];
const scores = scoresJson as CashflowScore[];
const rules = rulesJson as SavingsRule[];

/** Mutations only live in memory; a reload resets them. Good enough for the demo. */
const resolved = new Map<string, NonNullable<AnomalyAlert['resolution']>>();
const activated = new Set<string>();
const sentTransfers: Transfer[] = [];

export class FixtureDataSource implements DataSource {
  async getCustomer(): Promise<Customer> {
    return customers[0];
  }

  async getAccounts(): Promise<Account[]> {
    return accounts;
  }

  async getTransactions({ accountId, from, to, limit }: TransactionQuery): Promise<EnrichedTransaction[]> {
    const out = transactions
      .filter((t) => t.account_id === accountId)
      .filter((t) => (from ? t.occurred_at.slice(0, 10) >= from : true))
      .filter((t) => (to ? t.occurred_at.slice(0, 10) <= to : true))
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    return limit ? out.slice(0, limit) : out;
  }

  async getSubscriptions(accountId: string): Promise<Subscription[]> {
    return subscriptions
      .filter((s) => s.account_id === accountId)
      .sort((a, b) => b.annual_cost_cents - a.annual_cost_cents);
  }

  async getAlerts(accountId: string, includeResolved = false): Promise<AnomalyAlert[]> {
    return alerts
      .filter((a) => a.account_id === accountId)
      .map((a) => (resolved.has(a.id) ? { ...a, resolution: resolved.get(a.id)!, resolved_at: new Date().toISOString() } : a))
      .filter((a) => includeResolved || !a.resolved_at)
      .sort((a, b) => b.score - a.score);
  }

  async getScore(accountId: string): Promise<CashflowScore> {
    const score = scores.find((s) => s.account_id === accountId);
    if (!score) throw new Error(`No hay score en fixtures para la cuenta ${accountId}`);
    return score;
  }

  async getSavingsRules(accountId: string): Promise<SavingsRule[]> {
    return rules
      .filter((r) => r.account_id === accountId)
      .map((r) => (activated.has(r.id) ? { ...r, status: 'active' as const } : r));
  }

  async resolveAlert(alertId: string, resolution: NonNullable<AnomalyAlert['resolution']>): Promise<void> {
    resolved.set(alertId, resolution);
  }

  async activateSavingsRule(ruleId: string): Promise<void> {
    activated.add(ruleId);
  }

  async getRecipients(accountId: string): Promise<TransferRecipient[]> {
    const own: TransferRecipient[] = accounts
      .filter((account) => account.id !== accountId)
      .map((account) => ({
        id: `own_${account.id}`,
        name: account.nickname,
        bank: 'Capital One',
        last_four: account.last_four,
        account_id: account.id,
      }));
    const seen = new Set(own.map((r) => `${r.name}|${r.last_four ?? ''}`));
    for (const transfer of sentTransfers.filter((t) => t.account_id === accountId)) {
      const key = `${transfer.payee_name}|${transfer.payee_last_four ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      own.push({
        id: `payee_${key}`,
        name: transfer.payee_name,
        bank: transfer.payee_bank,
        last_four: transfer.payee_last_four,
        account_id: transfer.payee_account_id,
      });
    }
    return own;
  }

  async getTransfers(accountId: string): Promise<Transfer[]> {
    return sentTransfers.filter((transfer) => transfer.account_id === accountId);
  }

  async createTransfer(draft: TransferDraft): Promise<Transfer> {
    const already = sentTransfers.find((transfer) => transfer.id === draft.id);
    if (already) return already;
    const transfer: Transfer = {
      id: draft.id,
      account_id: draft.accountId,
      payee_account_id: draft.recipient.account_id,
      payee_name: draft.recipient.name,
      payee_bank: draft.recipient.bank,
      payee_last_four: draft.recipient.last_four,
      amount_cents: draft.amountCents,
      concept: draft.concept,
      // Igual que contra la base: la app solo puede dejarla pendiente.
      status: 'pending',
      failure_reason: null,
      created_at: new Date().toISOString(),
    };
    sentTransfers.unshift(transfer);
    return transfer;
  }
}
