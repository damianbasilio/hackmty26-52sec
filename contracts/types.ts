/**
 * Central data model. Read-only for every lane except the integrator.
 *
 * Conventions (non negotiable):
 * - Money is ALWAYS an integer number of cents (MXN). Never a float.
 * - Timestamps are ISO 8601 strings in UTC with a trailing `Z`.
 * - Calendar-only values are `YYYY-MM-DD`.
 * - Identifiers, field names and comments in English. User-facing copy in es-MX.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Instant in time, ISO 8601 UTC, e.g. `2026-09-12T18:04:00Z`. */
export type ISODateTime = string;

/** Calendar day, no timezone, e.g. `2026-09-12`. */
export type ISODate = string;

/** Integer minor units. 12345 === $123.45 MXN. Never fractional. */
export type Cents = number;

/** Only currency we handle in the hackathon scope. */
export type Currency = 'MXN';

/** Stable ids are opaque strings; Nessie ids are 24-char hex. */
export type Id = string;

// ---------------------------------------------------------------------------
// Core entities — produced by lane A (db + Nessie sync)
// ---------------------------------------------------------------------------

/** End user of the app; mirrors a Nessie customer. Produced by lane A. */
export interface Customer {
  id: Id;
  /** Supabase auth user id, null while the row is seed-only. */
  auth_user_id: Id | null;
  first_name: string;
  last_name: string;
  email: string;
  /** E.164, e.g. `+528181234567`. */
  phone: string | null;
  /** Nessie `_id`, null for locally seeded demo customers. */
  nessie_customer_id: Id | null;
  created_at: ISODateTime;
}

export type AccountType = 'checking' | 'savings' | 'credit_card';

/** Bank account owned by a customer. Produced by lane A. */
export interface Account {
  id: Id;
  customer_id: Id;
  /** Display nickname shown in the UI, es-MX. */
  nickname: string;
  type: AccountType;
  /** Last 4 digits only; we never store a full number. */
  last_four: string;
  balance_cents: Cents;
  currency: Currency;
  nessie_account_id: Id | null;
  created_at: ISODateTime;
}

export type MerchantCategory =
  | 'groceries'
  | 'convenience'
  | 'restaurants'
  | 'delivery'
  | 'transport'
  | 'fuel'
  | 'utilities'
  | 'telecom'
  | 'streaming'
  | 'fitness'
  | 'housing'
  | 'health'
  | 'shopping'
  | 'education'
  | 'insurance'
  | 'fees'
  | 'income'
  | 'transfer'
  | 'cash'
  | 'other';

/** Canonical merchant after descriptor normalization. Produced by lane B. */
export interface Merchant {
  id: Id;
  /** Normalization key: lowercase, no accents, no store number. e.g. `oxxo`. */
  normalized_name: string;
  /** Pretty name for the UI, e.g. `OXXO`. */
  display_name: string;
  category: MerchantCategory;
  /** Raw descriptors that collapsed into this merchant, for debugging. */
  raw_descriptor_samples: string[];
  /** True when this merchant is a known subscription biller. */
  is_recurring_biller: boolean;
  logo_url: string | null;
}

export type TransactionType = 'purchase' | 'deposit' | 'withdrawal' | 'transfer' | 'fee';
export type TransactionStatus = 'pending' | 'completed' | 'cancelled';

/** Raw movement as it arrives from Nessie or the seeder. Produced by lane A. */
export interface Transaction {
  id: Id;
  account_id: Id;
  /** Positive = money in, negative = money out. Integer cents. */
  amount_cents: Cents;
  currency: Currency;
  type: TransactionType;
  status: TransactionStatus;
  /** Untouched bank descriptor, e.g. `OXXO TEC 4412 MTY`. */
  raw_description: string;
  /** When the money moved. */
  occurred_at: ISODateTime;
  nessie_transaction_id: Id | null;
  created_at: ISODateTime;
}

// ---------------------------------------------------------------------------
// Derived intelligence — produced by lane B (FastAPI engines)
// ---------------------------------------------------------------------------

/** Raw transaction plus the features every engine and screen reads. Produced by lane B. */
export interface EnrichedTransaction extends Transaction {
  merchant_id: Id | null;
  /** Denormalized for rendering without a join. */
  merchant_normalized_name: string | null;
  merchant_display_name: string | null;
  category: MerchantCategory;
  /** 0..1 confidence of the merchant + category assignment. */
  category_confidence: number;
  /** True when this movement belongs to a detected Subscription. */
  is_recurring: boolean;
  subscription_id: Id | null;
  /** Deviation from the customer's own mean for this merchant, in sigmas. */
  amount_zscore: number | null;
  /** Local-time bucket, useful for "compra a las 3am" style signals. */
  hour_of_day: number;
  day_of_week: number;
  /** Set when an anomaly engine flagged this movement. */
  anomaly_alert_id: Id | null;
}

export type SubscriptionCadence = 'weekly' | 'biweekly' | 'monthly' | 'bimonthly' | 'quarterly' | 'annual';
export type SubscriptionStatus = 'active' | 'price_increased' | 'paused' | 'likely_cancelled' | 'unused';

/** Recurring charge inferred from transaction history. Produced by lane B. */
export interface Subscription {
  id: Id;
  account_id: Id;
  merchant_id: Id;
  merchant_display_name: string;
  category: MerchantCategory;
  cadence: SubscriptionCadence;
  /** Most recent charge amount. */
  amount_cents: Cents;
  /** Charge before the latest change; null when never changed. */
  previous_amount_cents: Cents | null;
  /** amount_cents - previous_amount_cents. Positive means it got pricier. */
  price_delta_cents: Cents | null;
  /** Convenience flag for the UI badge "subió de precio". */
  price_increase_detected: boolean;
  first_charge_at: ISODateTime;
  last_charge_at: ISODateTime;
  /** Forecast, calendar day. */
  next_charge_on: ISODate;
  /** How many charges backed the detection. */
  occurrence_count: number;
  /** 0..1 confidence the cadence is real and not a coincidence. */
  confidence: number;
  status: SubscriptionStatus;
  /** Annualized cost at the current amount; precomputed to avoid UI math bugs. */
  annual_cost_cents: Cents;
  /** One-sentence rationale in es-MX. */
  explanation: string;
}

export type AnomalySeverity = 'info' | 'warning' | 'critical';

export type AnomalySignalKind =
  | 'amount_outlier'
  | 'new_merchant'
  | 'duplicate_charge'
  | 'unusual_hour'
  | 'unusual_location'
  | 'velocity_spike'
  | 'subscription_price_hike'
  | 'balance_risk';

/** One reason an alert fired. Several signals can stack on one alert. */
export interface AnomalySignal {
  kind: AnomalySignalKind;
  /** 0..1 contribution of this signal to the final severity. */
  weight: number;
  /** Short es-MX phrase rendered as a chip in the UI. */
  label: string;
  /** Raw evidence, shape depends on `kind`. Engine-owned, UI must not assume keys. */
  evidence: Record<string, string | number | boolean | null>;
}

/** Flagged movement or pattern needing the user's attention. Produced by lane B. */
export interface AnomalyAlert {
  id: Id;
  account_id: Id;
  /** Null when the alert is about a pattern rather than one movement. */
  transaction_id: Id | null;
  subscription_id: Id | null;
  severity: AnomalySeverity;
  /** 0..100, drives sort order in the feed. */
  score: number;
  signals: AnomalySignal[];
  /** Headline in es-MX, <= 60 chars, shown in the card title. */
  title: string;
  /** Plain-language es-MX explanation of why this fired. */
  explanation: string;
  /** Suggested next action in es-MX, e.g. `Revisar cargo duplicado`. */
  suggested_action: string | null;
  detected_at: ISODateTime;
  /** Set when the user dismissed or confirmed it. */
  resolved_at: ISODateTime | null;
  resolution: 'dismissed' | 'confirmed_fraud' | 'confirmed_legit' | null;
}

export type CashflowComponentKey =
  | 'income_stability'
  | 'spending_discipline'
  | 'buffer_days'
  | 'recurring_load'
  | 'overdraft_risk';

/** One weighted piece of the score. Sum of weights === 1. */
export interface CashflowComponent {
  key: CashflowComponentKey;
  /** es-MX label for the breakdown row. */
  label: string;
  /** 0..100 raw subscore before weighting. */
  value: number;
  /** 0..1 weight inside the total. */
  weight: number;
  /** Signed contribution in score points, so the UI never recomputes it. */
  points: number;
  /** es-MX one-liner: what moved this component. */
  explanation: string;
}

/** FICO-shaped cashflow health score, 300..850. Produced by lane B. */
export interface CashflowScore {
  id: Id;
  account_id: Id;
  /** 300..850. */
  score: number;
  /** 300..850 for the previous period, null on first computation. */
  previous_score: number | null;
  band: 'poor' | 'fair' | 'good' | 'very_good' | 'excellent';
  components: CashflowComponent[];
  /** Paragraph in es-MX summarizing the score. */
  explanation: string;
  /** Ranked es-MX actions that would raise the score most. */
  top_actions: string[];
  /** Window the score was computed over. */
  period_start: ISODate;
  period_end: ISODate;
  computed_at: ISODateTime;
}

export type SavingsRuleKind =
  | 'round_up'
  | 'fixed_recurring'
  | 'percent_of_income'
  | 'cancel_subscription'
  | 'spend_cap';

export type SavingsRuleStatus = 'suggested' | 'active' | 'paused' | 'completed';

/** Automation the user can accept to save money. Suggested by lane B, toggled by the app. */
export interface SavingsRule {
  id: Id;
  account_id: Id;
  /** Destination savings account; null while the rule is only a suggestion. */
  destination_account_id: Id | null;
  kind: SavingsRuleKind;
  /** es-MX name shown on the card, e.g. `Redondeo de cada compra`. */
  title: string;
  /** es-MX description of the mechanics. */
  description: string;
  status: SavingsRuleStatus;
  /** Fixed amount for `fixed_recurring`, cap for `spend_cap`, else null. */
  amount_cents: Cents | null;
  /** 0..1 for `percent_of_income`, else null. */
  percent: number | null;
  /** Rounding target for `round_up`, e.g. 1000 === round to $10.00. */
  round_to_cents: Cents | null;
  cadence: SubscriptionCadence | null;
  /** Scope for `spend_cap` / `cancel_subscription`. */
  category: MerchantCategory | null;
  subscription_id: Id | null;
  /** Engine's projection of savings over 12 months. */
  projected_annual_savings_cents: Cents;
  /** Money actually moved by this rule so far. */
  saved_to_date_cents: Cents;
  created_at: ISODateTime;
  activated_at: ISODateTime | null;
}

// ---------------------------------------------------------------------------
// Fixture bundle — the exact shape of /contracts/fixtures
// ---------------------------------------------------------------------------

/** Everything FixtureDataSource loads. One file per key, same name. */
export interface FixtureBundle {
  customers: Customer[];
  accounts: Account[];
  merchants: Merchant[];
  transactions: Transaction[];
  enriched_transactions: EnrichedTransaction[];
  subscriptions: Subscription[];
  anomaly_alerts: AnomalyAlert[];
  cashflow_scores: CashflowScore[];
  savings_rules: SavingsRule[];
}
