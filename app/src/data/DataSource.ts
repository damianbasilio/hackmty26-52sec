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
}
