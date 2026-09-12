-- Supabase / Postgres schema. Mirrors /contracts/types.ts one-to-one.
-- Money is always BIGINT cents. Timestamps are timestamptz stored in UTC.
-- Run: psql "$SUPABASE_DB_URL" -f db/schema.sql

-- Pin it for the whole file: every unqualified table, type and policy below would
-- otherwise land wherever the session's search_path points. extensions is where
-- Supabase keeps pgcrypto/unaccent; on plain Postgres that entry is ignored.
set search_path = public, extensions;

create extension if not exists "pgcrypto";
create extension if not exists "unaccent";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Guard per type: a shared exception block would swallow the first duplicate and
-- silently skip every type after it, leaving a half-built schema behind.
-- Qualify with public. or to_regtype resolves through search_path and misses the
-- existing type when the file runs under a different one.
do $$ begin
  if to_regtype('public.account_type') is null then
    create type public.account_type as enum ('checking', 'savings', 'credit_card');
  end if;
  if to_regtype('public.transaction_type') is null then
    create type public.transaction_type as enum ('purchase', 'deposit', 'withdrawal', 'transfer', 'fee');
  end if;
  if to_regtype('public.transaction_status') is null then
    create type public.transaction_status as enum ('pending', 'completed', 'cancelled');
  end if;
  if to_regtype('public.merchant_category') is null then
    create type public.merchant_category as enum (
      'groceries', 'convenience', 'restaurants', 'delivery', 'transport', 'fuel',
      'utilities', 'telecom', 'streaming', 'fitness', 'housing', 'health',
      'shopping', 'education', 'insurance', 'fees', 'income', 'transfer', 'cash', 'other'
    );
  end if;
  if to_regtype('public.subscription_cadence') is null then
    create type public.subscription_cadence as enum ('weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'annual');
  end if;
  if to_regtype('public.subscription_status') is null then
    create type public.subscription_status as enum ('active', 'price_increased', 'paused', 'likely_cancelled', 'unused');
  end if;
  if to_regtype('public.anomaly_severity') is null then
    create type public.anomaly_severity as enum ('info', 'warning', 'critical');
  end if;
  if to_regtype('public.anomaly_resolution') is null then
    create type public.anomaly_resolution as enum ('dismissed', 'confirmed_fraud', 'confirmed_legit');
  end if;
  if to_regtype('public.score_band') is null then
    create type public.score_band as enum ('poor', 'fair', 'good', 'very_good', 'excellent');
  end if;
  if to_regtype('public.savings_rule_kind') is null then
    create type public.savings_rule_kind as enum ('round_up', 'fixed_recurring', 'percent_of_income', 'cancel_subscription', 'spend_cap');
  end if;
  if to_regtype('public.savings_rule_status') is null then
    create type public.savings_rule_status as enum ('suggested', 'active', 'paused', 'completed');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Core entities (lane A)
-- ---------------------------------------------------------------------------

create table if not exists customers (
  id text primary key,
  auth_user_id uuid unique references auth.users (id) on delete set null,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  nessie_customer_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists accounts (
  id text primary key,
  customer_id text not null references customers (id) on delete cascade,
  nickname text not null,
  type account_type not null,
  last_four text not null check (last_four ~ '^[0-9]{4}$'),
  balance_cents bigint not null default 0,
  currency text not null default 'MXN' check (currency = 'MXN'),
  nessie_account_id text unique,
  created_at timestamptz not null default now()
);

create index if not exists accounts_customer_idx on accounts (customer_id);

create table if not exists merchants (
  id text primary key,
  normalized_name text not null unique,
  display_name text not null,
  category merchant_category not null default 'other',
  raw_descriptor_samples text[] not null default '{}',
  is_recurring_biller boolean not null default false,
  logo_url text
);

-- Descriptor -> merchant lookup during enrichment.
create index if not exists merchants_descriptor_gin on merchants using gin (raw_descriptor_samples);

create table if not exists transactions (
  id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  amount_cents bigint not null,
  currency text not null default 'MXN' check (currency = 'MXN'),
  type transaction_type not null,
  status transaction_status not null default 'completed',
  raw_description text not null,
  occurred_at timestamptz not null,
  nessie_transaction_id text unique,
  created_at timestamptz not null default now()
);

-- Main app query: one account's movements over a date range, newest first.
create index if not exists transactions_account_occurred_idx
  on transactions (account_id, occurred_at desc);

-- Duplicate-charge detection scans a tight window per account.
create index if not exists transactions_dup_window_idx
  on transactions (account_id, amount_cents, occurred_at);

-- ---------------------------------------------------------------------------
-- Derived intelligence (lane B). Separate table so the engine never writes
-- the raw rows lane A owns.
-- ---------------------------------------------------------------------------

create table if not exists transaction_enrichment (
  transaction_id text primary key references transactions (id) on delete cascade,
  account_id text not null references accounts (id) on delete cascade,
  merchant_id text references merchants (id) on delete set null,
  category merchant_category not null default 'other',
  category_confidence numeric(4, 3) not null default 0 check (category_confidence between 0 and 1),
  is_recurring boolean not null default false,
  subscription_id text,
  amount_zscore numeric(8, 2),
  hour_of_day smallint not null check (hour_of_day between 0 and 23),
  day_of_week smallint not null check (day_of_week between 0 and 6),
  anomaly_alert_id text,
  occurred_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- "Gasto por comercio" grouping: merchant totals for one account in a range.
create index if not exists enrichment_account_merchant_occurred_idx
  on transaction_enrichment (account_id, merchant_id, occurred_at desc);

-- Category donut / monthly breakdown.
create index if not exists enrichment_account_category_occurred_idx
  on transaction_enrichment (account_id, category, occurred_at desc);

-- Subscription engine re-reads only recurring rows.
create index if not exists enrichment_recurring_idx
  on transaction_enrichment (account_id, occurred_at desc) where is_recurring;

create table if not exists subscriptions (
  id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  merchant_id text not null references merchants (id) on delete cascade,
  cadence subscription_cadence not null,
  amount_cents bigint not null,
  previous_amount_cents bigint,
  price_delta_cents bigint,
  price_increase_detected boolean not null default false,
  first_charge_at timestamptz not null,
  last_charge_at timestamptz not null,
  next_charge_on date not null,
  occurrence_count integer not null default 0,
  confidence numeric(4, 3) not null default 0 check (confidence between 0 and 1),
  status subscription_status not null default 'active',
  annual_cost_cents bigint not null default 0,
  explanation text not null default '',
  updated_at timestamptz not null default now(),
  unique (account_id, merchant_id, cadence)
);

create index if not exists subscriptions_account_next_idx
  on subscriptions (account_id, next_charge_on);

alter table transaction_enrichment
  drop constraint if exists transaction_enrichment_subscription_fk;
alter table transaction_enrichment
  add constraint transaction_enrichment_subscription_fk
  foreign key (subscription_id) references subscriptions (id) on delete set null;

create table if not exists anomaly_alerts (
  id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  transaction_id text references transactions (id) on delete cascade,
  subscription_id text references subscriptions (id) on delete cascade,
  severity anomaly_severity not null,
  score smallint not null check (score between 0 and 100),
  -- AnomalySignal[]; engine-owned shape, the app only reads kind/label/weight.
  signals jsonb not null default '[]'::jsonb,
  title text not null,
  explanation text not null,
  suggested_action text,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution anomaly_resolution
);

-- Alert feed: open alerts for one account, most severe first.
create index if not exists anomaly_open_feed_idx
  on anomaly_alerts (account_id, score desc, detected_at desc) where resolved_at is null;

alter table transaction_enrichment
  drop constraint if exists transaction_enrichment_alert_fk;
alter table transaction_enrichment
  add constraint transaction_enrichment_alert_fk
  foreign key (anomaly_alert_id) references anomaly_alerts (id) on delete set null;

create table if not exists cashflow_scores (
  id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  score smallint not null check (score between 300 and 850),
  previous_score smallint check (previous_score between 300 and 850),
  band score_band not null,
  -- CashflowComponent[]
  components jsonb not null default '[]'::jsonb,
  explanation text not null,
  top_actions text[] not null default '{}',
  period_start date not null,
  period_end date not null,
  computed_at timestamptz not null default now(),
  unique (account_id, period_end)
);

create index if not exists cashflow_latest_idx
  on cashflow_scores (account_id, computed_at desc);

create table if not exists savings_rules (
  id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  destination_account_id text references accounts (id) on delete set null,
  kind savings_rule_kind not null,
  title text not null,
  description text not null,
  status savings_rule_status not null default 'suggested',
  amount_cents bigint,
  percent numeric(4, 3) check (percent between 0 and 1),
  round_to_cents bigint,
  cadence subscription_cadence,
  category merchant_category,
  subscription_id text references subscriptions (id) on delete set null,
  projected_annual_savings_cents bigint not null default 0,
  saved_to_date_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  activated_at timestamptz
);

create index if not exists savings_rules_account_status_idx
  on savings_rules (account_id, status);

-- ---------------------------------------------------------------------------
-- Read surface the app consumes. Matches EnrichedTransaction exactly.
-- ---------------------------------------------------------------------------

-- security_invoker or the view runs as its owner and RLS on transactions is checked
-- against postgres instead of the caller: the anon key would read all 51 rows. PG 15+.
create or replace view enriched_transactions with (security_invoker = true) as
select
  t.id,
  t.account_id,
  t.amount_cents,
  t.currency,
  t.type,
  t.status,
  t.raw_description,
  t.occurred_at,
  t.nessie_transaction_id,
  t.created_at,
  e.merchant_id,
  m.normalized_name as merchant_normalized_name,
  m.display_name as merchant_display_name,
  coalesce(e.category, 'other'::public.merchant_category) as category,
  coalesce(e.category_confidence, 0) as category_confidence,
  coalesce(e.is_recurring, false) as is_recurring,
  e.subscription_id,
  e.amount_zscore,
  e.hour_of_day,
  e.day_of_week,
  e.anomaly_alert_id
from transactions t
left join transaction_enrichment e on e.transaction_id = t.id
left join merchants m on m.id = e.merchant_id;

-- ---------------------------------------------------------------------------
-- RLS. A customer only ever sees their own rows; the engine uses the service
-- role key, which bypasses these policies.
-- ---------------------------------------------------------------------------

alter table customers enable row level security;
alter table accounts enable row level security;
alter table transactions enable row level security;
alter table transaction_enrichment enable row level security;
alter table subscriptions enable row level security;
alter table anomaly_alerts enable row level security;
alter table cashflow_scores enable row level security;
alter table savings_rules enable row level security;
-- Shared catalog, no personal data: readable by anyone, writable by nobody. Without
-- RLS the default grants let the publishable key INSERT/UPDATE/DELETE it, and that
-- key ships inside the app bundle. The engine writes it with the service role.
alter table merchants enable row level security;

drop policy if exists read_merchants on merchants;
create policy read_merchants on merchants for select using (true);

create or replace function public.owns_account(target_account_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from accounts a
    join customers c on c.id = a.customer_id
    where a.id = target_account_id and c.auth_user_id = auth.uid()
  );
$$;

do $$
declare t text;
begin
  execute 'drop policy if exists own_customer on customers';
  execute 'create policy own_customer on customers for select using (auth_user_id = auth.uid())';
  execute 'drop policy if exists own_account on accounts';
  execute 'create policy own_account on accounts for select using (public.owns_account(id))';
  foreach t in array array['transactions', 'transaction_enrichment', 'subscriptions',
                           'anomaly_alerts', 'cashflow_scores', 'savings_rules']
  loop
    execute format('drop policy if exists own_rows on %I', t);
    execute format('create policy own_rows on %I for select using (public.owns_account(account_id))', t);
  end loop;
end $$;

-- The app toggles savings rules; nothing else is writable from the client.
drop policy if exists own_savings_update on savings_rules;
create policy own_savings_update on savings_rules
  for update using (public.owns_account(account_id)) with check (public.owns_account(account_id));

-- ---------------------------------------------------------------------------
-- Auth linking. Every RLS policy above resolves through customers.auth_user_id,
-- so a customer with that column null is invisible to everybody. This section
-- is the only thing that fills it in — the engine must not link users too.
-- ---------------------------------------------------------------------------

-- Resolves a customer by our own id or by its Nessie id, and an auth user by
-- email, then links them. Raises instead of doing nothing so a typo in a demo
-- script fails where you can see it.
create or replace function public.link_customer_to_auth_user(customer_key text, auth_email text)
returns table (customer_id text, auth_user_id uuid)
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  target_customer text;
  target_user uuid;
  taken text;
begin
  select c.id into target_customer from customers c
  where c.id = customer_key or c.nessie_customer_id = customer_key;
  if target_customer is null then
    raise exception 'No hay customer con id ni nessie_customer_id = %', customer_key;
  end if;

  select u.id into target_user from auth.users u where lower(u.email) = lower(auth_email);
  if target_user is null then
    raise exception 'No hay usuario de Auth con correo %. Créalo en Authentication -> Users primero.', auth_email;
  end if;

  -- auth_user_id is unique: say which customer holds it instead of leaking a
  -- bare constraint violation.
  select c.id into taken from customers c
  where c.auth_user_id = target_user and c.id <> target_customer;
  if taken is not null then
    raise exception 'El usuario % ya está ligado al customer %. Un usuario por cliente.', auth_email, taken;
  end if;

  update customers c set auth_user_id = target_user where c.id = target_customer;
  return query select target_customer, target_user;
end $$;

-- Fires on signup so a new Auth user picks up its customer with no manual SQL.
-- Match order, most explicit first: the signUp metadata the app sends, then the
-- Nessie id, then the email. Only ever claims a customer nobody owns yet.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  target_customer text;
begin
  select c.id into target_customer
  from customers c
  where c.auth_user_id is null
    and (
      c.id = new.raw_user_meta_data ->> 'customer_id'
      or c.nessie_customer_id = new.raw_user_meta_data ->> 'nessie_customer_id'
      or lower(c.email) = lower(new.email)
    )
  -- coalesce or the comparison is null for a customer with no nessie id, and
  -- `desc` sorts nulls first: the row that didn't match would outrank the one
  -- that did.
  order by
    coalesce(c.id = new.raw_user_meta_data ->> 'customer_id', false) desc,
    coalesce(c.nessie_customer_id = new.raw_user_meta_data ->> 'nessie_customer_id', false) desc
  limit 1;

  if target_customer is not null then
    update customers c set auth_user_id = new.id where c.id = target_customer;
  end if;
  return new;
exception when others then
  -- A raise here aborts the signup with "Database error saving new user".
  -- Losing the automatic link is recoverable; losing the account is not.
  raise warning 'handle_new_auth_user no pudo ligar a %: %', new.id, sqlerrm;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Realtime pushes new alerts to the app without polling.
do $$ begin
  alter publication supabase_realtime add table anomaly_alerts;
exception when duplicate_object then null; when undefined_object then null; end $$;
