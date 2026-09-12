import type {
  Account,
  AnomalyAlert,
  CashflowScore,
  Customer,
  EnrichedTransaction,
  ISODate,
  SavingsRule,
  Subscription,
} from '@contracts/types';

export type TransactionQuery = {
  accountId: string;
  /** Inclusive lower bound, calendar day. */
  from?: ISODate;
  /** Inclusive upper bound, calendar day. */
  to?: ISODate;
  limit?: number;
};

/**
 * Transfers are not in @contracts/types: they are what the user *does*, not what
 * the engines derive. Shapes mirror the `transfers` table in db/schema.sql.
 */

/** Somewhere money can go. `account_id` is set only for the customer's own accounts. */
export type TransferRecipient = {
  id: string;
  name: string;
  bank: string | null;
  last_four: string | null;
  account_id: string | null;
};

/** The app only ever writes `pending`; the engine moves it from there. */
export type TransferStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

export type Transfer = {
  id: string;
  account_id: string;
  payee_account_id: string | null;
  payee_name: string;
  payee_bank: string | null;
  payee_last_four: string | null;
  /** Always positive. Direction is "out of account_id". */
  amount_cents: number;
  concept: string;
  status: TransferStatus;
  failure_reason: string | null;
  created_at: string;
};

export type TransferDraft = {
  /**
   * Idempotency key, and the row's primary key. Generated once with
   * `newTransferId()` before the first attempt and reused on every retry, so a
   * second tap can never charge twice.
   */
  id: string;
  accountId: string;
  recipient: TransferRecipient;
  amountCents: number;
  concept: string;
};

/**
 * Must match the engine's `^[A-Za-z0-9_-]{8,80}$`.
 *
 * ponytail: Date.now + Math.random, no uuid dependency. Collisions only matter
 * within one customer's own transfers, where the primary key catches them.
 * Swap for crypto.randomUUID the day a polyfill lands in the bundle.
 */
export function newTransferId(): string {
  return `txf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Everything the UI is allowed to ask for. Screens depend on this, never on fetch or JSON. */
export interface DataSource {
  getCustomer(): Promise<Customer>;
  getAccounts(): Promise<Account[]>;
  getTransactions(query: TransactionQuery): Promise<EnrichedTransaction[]>;
  getSubscriptions(accountId: string): Promise<Subscription[]>;
  getAlerts(accountId: string, includeResolved?: boolean): Promise<AnomalyAlert[]>;
  getScore(accountId: string): Promise<CashflowScore>;
  getSavingsRules(accountId: string): Promise<SavingsRule[]>;
  resolveAlert(alertId: string, resolution: NonNullable<AnomalyAlert['resolution']>): Promise<void>;
  activateSavingsRule(ruleId: string, destinationAccountId: string): Promise<void>;
  /** Own accounts plus whoever this account has already paid. */
  getRecipients(accountId: string): Promise<TransferRecipient[]>;
  getTransfers(accountId: string): Promise<Transfer[]>;
  /** Idempotent: re-sending the same draft returns the transfer already filed. */
  createTransfer(draft: TransferDraft): Promise<Transfer>;
}
