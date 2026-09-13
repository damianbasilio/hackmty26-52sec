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
  if to_regtype('public.transfer_status') is null then
    create type public.transfer_status as enum ('pending', 'completed', 'failed', 'cancelled');
  end if;
  if to_regtype('public.split_status') is null then
    create type public.split_status as enum ('open', 'settled', 'cancelled', 'expired');
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

-- Nessie customers we refuse to serve. Keyed by the Nessie id and kept in its
-- own table on purpose: deleting the customer doesn't erase the decision, and
-- POST /sync brings the row back already flagged. See db/README.md.
create table if not exists excluded_nessie_customers (
  nessie_customer_id text primary key,
  reason text not null,
  excluded_at timestamptz not null default now()
);

alter table customers add column if not exists excluded_at timestamptz;
alter table customers add column if not exists exclusion_reason text;

-- The API key's own garbage: we can't delete it on Nessie's side, so every
-- sync re-imports it. These two rows are what makes it harmless.
insert into excluded_nessie_customers (nessie_customer_id, reason) values
  ('870d2c18-5422-4710-89a9-de3bff8309f0',
   'Siembra vieja: nombre corrompido y una renta de -95000000 centavos, error de 100x anterior al fix de float.'),
  ('31715ba5-8ed1-482a-8fbf-e4674efd17c3',
   'Siembra vieja: cliente sin ninguna cuenta.')
on conflict (nessie_customer_id) do nothing;

-- Re-applied on every insert and update, so a re-sync can't quietly un-flag a
-- customer we already threw out.
create or replace function public.apply_customer_exclusion() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  hit excluded_nessie_customers%rowtype;
begin
  if new.nessie_customer_id is null then
    return new;
  end if;
  select * into hit from excluded_nessie_customers e
  where e.nessie_customer_id = new.nessie_customer_id;
  if hit.nessie_customer_id is not null then
    new.excluded_at := coalesce(new.excluded_at, hit.excluded_at);
    new.exclusion_reason := hit.reason;
    -- An excluded customer never owns a session, however it got linked.
    new.auth_user_id := null;
  end if;
  return new;
end $$;

drop trigger if exists customers_apply_exclusion on customers;
create trigger customers_apply_exclusion
  before insert or update on customers
  for each row execute function public.apply_customer_exclusion();

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
-- What the user does in the app. These used to live in React state and died
-- with the process; they are rows now.
-- ---------------------------------------------------------------------------

create table if not exists transfers (
  id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  -- Only set when the destination is an account we already know about; a
  -- contact at another bank leaves it null and fills the payee_* columns.
  payee_account_id text references accounts (id) on delete set null,
  payee_name text not null,
  payee_bank text,
  payee_last_four text check (payee_last_four ~ '^[0-9]{4}$'),
  -- Always positive. The direction is "out of account_id"; the signed copy of
  -- the amount is the transactions row this transfer produces.
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'MXN' check (currency = 'MXN'),
  concept text not null default '',
  status transfer_status not null default 'pending',
  -- Filled by the engine once the money lands in the ledger.
  transaction_id text references transactions (id) on delete set null,
  nessie_transfer_id text unique,
  failure_reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Transfer history on Inicio: one account, newest first.
create index if not exists transfers_account_created_idx
  on transfers (account_id, created_at desc);

create table if not exists split_requests (
  id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  created_by text not null references customers (id) on delete cascade,
  title text not null default '',
  total_cents bigint not null check (total_cents > 0),
  currency text not null default 'MXN' check (currency = 'MXN'),
  -- Short code typed by whoever joins; dead once it expires.
  code text not null,
  code_expires_at timestamptz not null,
  status split_status not null default 'open',
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

-- Two live splits can't share a code or join_split() couldn't tell them apart.
-- Partial on purpose: a settled split keeps its code as history, and the code
-- becomes reusable. An insert that collides fails; the app retries with another.
create unique index if not exists split_requests_live_code_idx
  on split_requests (code) where status = 'open';

create index if not exists split_requests_account_created_idx
  on split_requests (account_id, created_at desc);

create table if not exists split_participants (
  id text primary key,
  split_request_id text not null references split_requests (id) on delete cascade,
  -- null while the participant is a guest who joined by code and banks elsewhere.
  customer_id text references customers (id) on delete set null,
  display_name text not null,
  share_cents bigint not null default 0 check (share_cents >= 0),
  is_creator boolean not null default false,
  -- paid is derived so the flag and the timestamp can't drift apart: to mark
  -- somebody as paid you write paid_at, never paid.
  paid_at timestamptz,
  paid boolean generated always as (paid_at is not null) stored,
  transfer_id text references transfers (id) on delete set null,
  joined_at timestamptz not null default now()
);

create index if not exists split_participants_request_idx
  on split_participants (split_request_id, joined_at);

-- One row per customer per split. Guests are exempt: unique treats nulls as
-- distinct, which is exactly right for people we can't identify.
create unique index if not exists split_participants_request_customer_idx
  on split_participants (split_request_id, customer_id) where customer_id is not null;

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
alter table transfers enable row level security;
alter table split_requests enable row level security;
alter table split_participants enable row level security;
-- Shared catalog, no personal data: readable by anyone, writable by nobody. Without
-- RLS the default grants let the publishable key INSERT/UPDATE/DELETE it, and that
-- key ships inside the app bundle. The engine writes it with the service role.
alter table merchants enable row level security;

drop policy if exists read_merchants on merchants;
create policy read_merchants on merchants for select using (true);

-- excluded_at filters here and nowhere else: every policy on every table goes
-- through this function, so one condition blinds the whole app to quarantined
-- data instead of ten policies that have to remember.
create or replace function public.owns_account(target_account_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from accounts a
    join customers c on c.id = a.customer_id
    where a.id = target_account_id
      and c.auth_user_id = auth.uid()
      and c.excluded_at is null
  );
$$;

create or replace function public.current_customer_id() returns text
language sql stable security definer set search_path = public as $$
  select c.id from customers c
  where c.auth_user_id = auth.uid() and c.excluded_at is null
  limit 1;
$$;

do $$
declare t text;
begin
  execute 'drop policy if exists own_customer on customers';
  execute 'create policy own_customer on customers for select using (auth_user_id = auth.uid() and excluded_at is null)';
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
-- Transfers and splits. A transfer is private to whoever sent it; a split is
-- shared, so it needs a second rule: participants see it too, not just the
-- creator.
-- ---------------------------------------------------------------------------

-- Creator or participant. Both halves are needed: the creator is not
-- necessarily in split_participants, and a participant owns no account here.
create or replace function public.can_see_split(target_split_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from split_requests s
    where s.id = target_split_id and public.owns_account(s.account_id)
  ) or exists (
    select 1 from split_participants p
    join customers c on c.id = p.customer_id
    where p.split_request_id = target_split_id and c.auth_user_id = auth.uid()
  );
$$;

drop policy if exists own_transfers on transfers;
create policy own_transfers on transfers for select using (public.owns_account(account_id));

-- Insert only. The engine flips status and fills nessie_transfer_id with the
-- service role: if the client could write those it could claim a transfer
-- completed that never left the bank.
drop policy if exists own_transfers_insert on transfers;
create policy own_transfers_insert on transfers for insert
  with check (public.owns_account(account_id));

drop policy if exists see_split_requests on split_requests;
create policy see_split_requests on split_requests for select using (public.can_see_split(id));

drop policy if exists own_split_requests_insert on split_requests;
create policy own_split_requests_insert on split_requests for insert
  with check (public.owns_account(account_id) and created_by = public.current_customer_id());

drop policy if exists own_split_requests_update on split_requests;
create policy own_split_requests_update on split_requests for update
  using (public.owns_account(account_id)) with check (public.owns_account(account_id));

drop policy if exists see_split_participants on split_participants;
create policy see_split_participants on split_participants for select
  using (public.can_see_split(split_request_id));

-- The creator adds their own row and anyone they picked off the nearby list.
-- Everybody else arrives through join_split().
drop policy if exists creator_split_participants_insert on split_participants;
create policy creator_split_participants_insert on split_participants for insert
  with check (exists (
    select 1 from split_requests s
    where s.id = split_request_id and public.owns_account(s.account_id)
  ));

-- Marking yourself paid. The creator can too, for a guest who paid in cash.
drop policy if exists pay_own_share on split_participants;
create policy pay_own_share on split_participants for update
  using (
    customer_id = public.current_customer_id()
    or exists (select 1 from split_requests s
               where s.id = split_request_id and public.owns_account(s.account_id))
  )
  with check (
    customer_id = public.current_customer_id()
    or exists (select 1 from split_requests s
               where s.id = split_request_id and public.owns_account(s.account_id))
  );

-- RLS gates rows, not columns, and the policy above has to let a participant
-- update their own row. Without this they could also rewrite share_cents and
-- pay one peso of a thousand-peso dinner.
revoke update on split_participants from anon, authenticated;
grant update (paid_at, transfer_id) on split_participants to authenticated;
revoke update on split_requests from anon, authenticated;
grant update (title, total_cents, status, settled_at, code_expires_at) on split_requests to authenticated;

-- Evenly, remainder one cent at a time to whoever joined first. Same rule as
-- sharesFor() in the app, so the two never disagree by a peso.
create or replace function public.rebalance_split(target_split_id text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  total bigint;
  headcount int;
begin
  if not public.can_see_split(target_split_id) then
    raise exception 'No puedes ver la división %', target_split_id;
  end if;

  select s.total_cents into total from split_requests s where s.id = target_split_id;
  select count(*) into headcount from split_participants p where p.split_request_id = target_split_id;
  if headcount = 0 then
    return;
  end if;

  update split_participants p
  set share_cents = total / headcount
      + case when ranked.position <= total % headcount then 1 else 0 end
  from (
    select id, row_number() over (order by joined_at, id) as position
    from split_participants
    where split_request_id = target_split_id
  ) as ranked
  where p.id = ranked.id;
end $$;

-- Joining is the one write RLS can't express: the person joining is not a
-- participant yet, so no policy can see them, and the code they typed is not a
-- column of the row being inserted. Definer function, code checked in here.
create or replace function public.join_split(join_code text, joiner_name text)
returns table (participant_id text, split_id text, total_cents bigint, share_cents bigint)
language plpgsql volatile security definer set search_path = public as $$
declare
  target split_requests%rowtype;
  me text := public.current_customer_id();
  existing text;
  new_id text;
begin
  select * into target from split_requests s
  where s.code = join_code and s.status = 'open' and s.code_expires_at > now();
  if target.id is null then
    raise exception 'El código % no corresponde a ninguna división activa.', join_code;
  end if;

  if me is not null then
    select p.id into existing from split_participants p
    where p.split_request_id = target.id and p.customer_id = me;
  end if;

  if existing is null then
    new_id := 'spp_' || replace(gen_random_uuid()::text, '-', '');
    insert into split_participants (id, split_request_id, customer_id, display_name)
    values (new_id, target.id, me, joiner_name);
  else
    new_id := existing;
  end if;

  perform public.rebalance_split(target.id);

  return query
    select p.id, p.split_request_id, target.total_cents, p.share_cents
    from split_participants p where p.id = new_id;
end $$;

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
  current_owner uuid;
  excluded_because text;
begin
  select c.id, c.exclusion_reason into target_customer, excluded_because from customers c
  where c.id = customer_key or c.nessie_customer_id = customer_key;
  if target_customer is null then
    raise exception 'No hay customer con id ni nessie_customer_id = %', customer_key;
  end if;
  -- The whole point of the quarantine: nobody demos the $950,000 rent.
  if excluded_because is not null then
    raise exception 'El customer % está excluido y no se liga a nadie: %', target_customer, excluded_because;
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

  -- And the other direction: re-pointing a customer that already has an owner
  -- hands somebody else's ledger over. Un-link it on purpose first if that is
  -- really what you want.
  select c.auth_user_id into current_owner from customers c where c.id = target_customer;
  if current_owner is not null and current_owner <> target_user then
    raise exception 'El customer % ya tiene dueño. Libéralo antes de ligarlo a otro usuario.', target_customer;
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
    and c.excluded_at is null
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
  else
    -- Nobody to claim: a fresh signup gets its own empty customer and checking
    -- account, or every RLS read and split insert fails for it.
    target_customer := 'cus_' || replace(new.id::text, '-', '');
    insert into customers (id, auth_user_id, first_name, last_name, email)
    values (
      target_customer,
      new.id,
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''), split_part(new.email, '@', 1)),
      coalesce(trim(new.raw_user_meta_data ->> 'last_name'), ''),
      new.email
    );
    insert into accounts (id, customer_id, nickname, type, last_four)
    values (
      'acc_checking_' || replace(new.id::text, '-', ''),
      target_customer,
      'Cuenta de cheques',
      'checking',
      lpad((abs(hashtext(new.id::text)) % 10000)::text, 4, '0')
    );
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

-- Postgres grants EXECUTE to PUBLIC on every new function, and PostgREST serves
-- anything in `public` as /rest/v1/rpc/<name> to whoever holds the anon key —
-- which ships inside the app bundle. These three are admin and trigger plumbing,
-- not app surface: a reachable link_customer_to_auth_user is an account takeover.
-- The functions the RLS policies call (owns_account, current_customer_id,
-- can_see_split) and the one the app calls (join_split) stay reachable on purpose.
revoke all on function public.link_customer_to_auth_user(text, text) from public;
revoke all on function public.handle_new_auth_user() from public;
revoke all on function public.apply_customer_exclusion() from public;

-- ---------------------------------------------------------------------------
-- Realtime. Only these tables emit; everything else the app reads on demand.
-- Postgres Changes re-checks the RLS policies above per subscriber, so a
-- published table leaks nothing a select wouldn't.
-- ---------------------------------------------------------------------------

-- replica identity full or an update/delete only ships the primary key, and
-- Realtime can't evaluate a policy like owns_account(account_id) against a row
-- it doesn't have: the event gets dropped instead of delivered.
do $$
declare t text;
begin
  foreach t in array array['anomaly_alerts', 'transfers', 'split_requests', 'split_participants']
  loop
    execute format('alter table %I replica identity full', t);
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception
      -- already published, or no supabase_realtime publication on plain Postgres
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end loop;
end $$;
