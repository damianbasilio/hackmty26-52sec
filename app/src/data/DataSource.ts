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

export type TransferStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

/** Row of `transfers`. Always positive: the direction is "out of account_id". */
export type Transfer = {
  id: Id;
  account_id: Id;
  payee_name: string;
  payee_bank: string | null;
  payee_last_four: string | null;
  amount_cents: Cents;
  concept: string;
  status: TransferStatus;
  failure_reason: string | null;
  created_at: ISODateTime;
  completed_at: ISODateTime | null;
};

export type TransferInput = {
  accountId: Id;
  payeeName: string;
  payeeBank?: string;
  payeeLastFour?: string;
  amountCents: Cents;
  concept?: string;
};

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

  sendTransfer(input: TransferInput): Promise<Transfer>;
  getTransfers(accountId: string): Promise<Transfer[]>;

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
