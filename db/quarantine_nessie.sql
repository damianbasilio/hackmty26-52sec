-- Borra de Supabase los clientes envenenados que ya entraron por POST /sync.
-- La marca no se va con ellos: vive en excluded_nessie_customers, que schema.sql
-- llena, así que el siguiente sync los vuelve a traer ya excluidos e invisibles.
--
--   psql "$SUPABASE_DB_URL" -f db/quarantine_nessie.sql
--
-- Idempotente: si ya no están, borra 0 filas y reporta lo mismo.

\set ON_ERROR_STOP on

\echo '--- antes ---'
select c.id, c.first_name || ' ' || c.last_name as nombre,
       c.excluded_at is not null as excluido,
       count(distinct a.id) as cuentas, count(t.id) as movimientos,
       coalesce(min(t.amount_cents), 0) as monto_minimo
from customers c
left join accounts a on a.customer_id = c.id
left join transactions t on t.account_id = a.id
group by 1, 2, 3 order by 1;

-- Cascada: accounts, transactions, enrichment, subscriptions, alerts, scores y
-- savings_rules cuelgan de aquí por FK.
delete from customers c
using excluded_nessie_customers e
where c.nessie_customer_id = e.nessie_customer_id;

\echo '--- después ---'
select c.id, c.first_name || ' ' || c.last_name as nombre,
       count(distinct a.id) as cuentas, count(t.id) as movimientos,
       coalesce(min(t.amount_cents), 0) as monto_minimo
from customers c
left join accounts a on a.customer_id = c.id
left join transactions t on t.account_id = a.id
group by 1, 2 order by 1;

\echo '--- en cuarentena (sobrevive al borrado y al siguiente sync) ---'
select nessie_customer_id, reason from excluded_nessie_customers order by 1;

-- Ningún movimiento por arriba de $500,000 debe quedar vivo. Si esto devuelve
-- filas, hay otro error de 100x que nadie ha visto.
\echo '--- montos absurdos que sigan vivos ---'
select t.id, t.account_id, t.amount_cents, t.raw_description
from transactions t where abs(t.amount_cents) > 50000000 order by t.amount_cents;
