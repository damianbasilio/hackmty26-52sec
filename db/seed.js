#!/usr/bin/env node
// Emits SQL that loads /contracts/fixtures into the schema. No dependencies.
//   node db/seed.js > db/seed.sql
//   node db/seed.js | psql "$SUPABASE_DB_URL"
// Idempotent: every insert is ON CONFLICT (id) DO NOTHING.

const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, '..', 'contracts', 'fixtures');
const read = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));

const lit = (v) => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    // text[] of plain strings; anything richer goes through jsonb instead
    if (v.every((x) => typeof x === 'string')) return `array[${v.map(lit).join(', ')}]::text[]`;
    return `${lit(JSON.stringify(v))}::jsonb`;
  }
  if (typeof v === 'object') return `${lit(JSON.stringify(v))}::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

const insert = (table, columns, rows, conflictKey = 'id') => {
  if (!rows.length) return '';
  const values = rows
    .map((r) => `  (${columns.map((c) => lit(r[c])).join(', ')})`)
    .join(',\n');
  return `insert into ${table} (${columns.join(', ')}) values\n${values}\non conflict (${conflictKey}) do nothing;\n`;
};

const pick = (row, columns) => Object.fromEntries(columns.map((c) => [c, row[c]]));

const enriched = read('enriched_transactions');

const parts = [
  'begin;',
  insert('customers', ['id', 'auth_user_id', 'first_name', 'last_name', 'email', 'phone', 'nessie_customer_id', 'created_at'], read('customers')),
  insert('accounts', ['id', 'customer_id', 'nickname', 'type', 'last_four', 'balance_cents', 'currency', 'nessie_account_id', 'created_at'], read('accounts')),
  insert('merchants', ['id', 'normalized_name', 'display_name', 'category', 'raw_descriptor_samples', 'is_recurring_biller', 'logo_url'], read('merchants')),
  insert('transactions', ['id', 'account_id', 'amount_cents', 'currency', 'type', 'status', 'raw_description', 'occurred_at', 'nessie_transaction_id', 'created_at'], read('transactions')),
  insert('subscriptions', ['id', 'account_id', 'merchant_id', 'cadence', 'amount_cents', 'previous_amount_cents', 'price_delta_cents', 'price_increase_detected', 'first_charge_at', 'last_charge_at', 'next_charge_on', 'occurrence_count', 'confidence', 'status', 'annual_cost_cents', 'explanation'], read('subscriptions')),
  insert('anomaly_alerts', ['id', 'account_id', 'transaction_id', 'subscription_id', 'severity', 'score', 'signals', 'title', 'explanation', 'suggested_action', 'detected_at', 'resolved_at', 'resolution'], read('anomaly_alerts')),
  insert('cashflow_scores', ['id', 'account_id', 'score', 'previous_score', 'band', 'components', 'explanation', 'top_actions', 'period_start', 'period_end', 'computed_at'], read('cashflow_scores')),
  insert('savings_rules', ['id', 'account_id', 'destination_account_id', 'kind', 'title', 'description', 'status', 'amount_cents', 'percent', 'round_to_cents', 'cadence', 'category', 'subscription_id', 'projected_annual_savings_cents', 'saved_to_date_cents', 'created_at', 'activated_at'], read('savings_rules')),
  // enrichment last: its FKs point at subscriptions and alerts
  insert(
    'transaction_enrichment',
    ['transaction_id', 'account_id', 'merchant_id', 'category', 'category_confidence', 'is_recurring', 'subscription_id', 'amount_zscore', 'hour_of_day', 'day_of_week', 'anomaly_alert_id', 'occurred_at'],
    enriched.map((e) => ({ ...pick(e, ['account_id', 'merchant_id', 'category', 'category_confidence', 'is_recurring', 'subscription_id', 'amount_zscore', 'hour_of_day', 'day_of_week', 'anomaly_alert_id', 'occurred_at']), transaction_id: e.id })),
    'transaction_id'
  ),
  'commit;',
];

process.stdout.write(parts.filter(Boolean).join('\n') + '\n');
