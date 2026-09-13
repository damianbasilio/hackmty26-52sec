import type {
  Account,
  AnomalyAlert,
  CashflowScore,
  Cents,
  Customer,
  EnrichedTransaction,
  Id,
  ISODate,
  ISODateTime,
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

/**
 * Somewhere money can go. `clabe` is how the engine finds anyone, including
 * other customers; `account_id` is set only for the customer's own accounts.
 */
export type TransferRecipient = {
  id: string;
  name: string;
  bank: string | null;
  last_four: string | null;
  clabe: string | null;
  account_id: string | null;
};

/** The app only ever writes `pending`; the engine moves it from there. */
export type TransferStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

export type Transfer = {
  id: string;
  account_id: string;
  payee_account_id: string | null;
  payee_clabe: string | null;
  payee_name: string;
  payee_bank: string | null;
  payee_last_four: string | null;
  /** Always positive. Direction is "out of account_id". */
  amount_cents: number;
  concept: string;
  status: TransferStatus;
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
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

/**
 * Idempotency key for paying one share of a split. Derived from the participant
 * so every retry sends the same id: one share can only ever be charged once,
 * even if the app dies between the transfer and the `paid_at` write.
 */
export function splitShareTransferId(participantId: string): string {
  return `txf_split_${participantId}`;
}

export type SplitStatus = 'open' | 'settled' | 'cancelled' | 'expired';

/** Row of `split_requests`. The code and its expiry live in the database. */
export type SplitRequest = {
  id: Id;
  account_id: Id;
  created_by: Id;
  title: string;
  total_cents: Cents;
  code: string;
  code_expires_at: ISODateTime;
  status: SplitStatus;
  created_at: ISODateTime;
  settled_at: ISODateTime | null;
};

/** Row of `split_participants`. `paid` is generated from `paid_at` in Postgres. */
export type SplitParticipant = {
  id: Id;
  split_request_id: Id;
  customer_id: Id | null;
  display_name: string;
  share_cents: Cents;
  is_creator: boolean;
  paid: boolean;
  paid_at: ISODateTime | null;
  transfer_id: Id | null;
  joined_at: ISODateTime;
};

export type Split = {
  request: SplitRequest;
  /** Ordered by `joined_at`, the same order the remainder cent follows. */
  participants: SplitParticipant[];
};

export type CreateSplitInput = {
  accountId: Id;
  totalCents: Cents;
  title?: string;
};

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
  /** Opens one more savings account for the current customer, starting at zero. */
  createSavingsAccount(nickname: string): Promise<Account>;
  /** Own accounts plus whoever this account has already paid. */
  getRecipients(accountId: string): Promise<TransferRecipient[]>;
  getTransfers(accountId: string): Promise<Transfer[]>;
  /** Idempotent: re-sending the same draft returns the transfer already filed. */
  createTransfer(draft: TransferDraft): Promise<Transfer>;

  createSplit(input: CreateSplitInput): Promise<Split>;
  getSplit(splitId: string): Promise<Split>;
  /** Resolves the code against the database; throws when it expired or never existed. */
  joinSplitByCode(code: string, displayName: string): Promise<Split>;
  /** Somebody who banks elsewhere: a row with no `customer_id`. */
  addSplitGuest(splitId: string, displayName: string): Promise<Split>;
  /** Pays one share through the real transfer flow and stamps `paid_at`. */
  paySplitShare(splitId: string, participantId: string): Promise<Split>;
  /** Returns the unsubscribe callback. Screens must call it on unmount. */
  subscribeToSplit(splitId: string, onChange: (split: Split) => void): () => void;
  /** Same contract for new alerts: returns the unsubscribe callback. */
  subscribeToAlerts(accountId: string, onInsert: (alert: AnomalyAlert) => void): () => void;
}
