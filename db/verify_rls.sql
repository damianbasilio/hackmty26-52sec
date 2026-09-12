-- Proves the RLS actually isolates customers, without leaving the psql session.
-- `set local role` + the request.jwt.claims GUC is exactly what PostgREST does
-- per request, so this reproduces what the anon key sees from the app.
--
--   psql "$SUPABASE_DB_URL" \
--     -v owner_email=ana.trevino@midominio.mx \
--     -v other_email=otro@midominio.mx \
--     -f db/verify_rls.sql
--
-- Expected: sin sesion 0 / 0, el dueno 51 / 51, el otro usuario 0 / 0.
-- Run it as postgres: the role switches happen inside, and only postgres can
-- read auth.users to resolve the two emails.

\set ON_ERROR_STOP on

select id as owner_uid from auth.users where lower(email) = lower(:'owner_email') \gset
select id as other_uid from auth.users where lower(email) = lower(:'other_email') \gset

-- 1. anon, no session: everything private must be empty, merchants must not be.
begin;
set local role anon;
select 'anon sin sesion' as escenario,
       (select count(*) from transactions) as transactions,
       (select count(*) from enriched_transactions) as enriched,
       (select count(*) from accounts) as accounts,
       (select count(*) from merchants) as merchants_publicos;
rollback;

-- 2. the linked owner.
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_uid')::text, true);
set local role authenticated;
select 'dueno ligado' as escenario,
       (select count(*) from transactions) as transactions,
       (select count(*) from enriched_transactions) as enriched,
       (select count(*) from accounts) as accounts,
       (select count(*) from merchants) as merchants_publicos;
rollback;

-- 3. a different authenticated user sees nothing of the owner's.
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'other_uid')::text, true);
set local role authenticated;
select 'otro usuario' as escenario,
       (select count(*) from transactions) as transactions,
       (select count(*) from enriched_transactions) as enriched,
       (select count(*) from accounts) as accounts,
       (select count(*) from merchants) as merchants_publicos;
rollback;

-- 4. the client is read-only on the ledger: this must report 0 rows.
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_uid')::text, true);
set local role authenticated;
update transactions set raw_description = 'HACK' where true;
rollback;
