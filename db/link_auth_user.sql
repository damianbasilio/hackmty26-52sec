-- Links one Auth user to one customer row. The user has to exist already:
-- create it in Authentication -> Users, or let the app sign it up.
--
--   psql "$SUPABASE_DB_URL" \
--     -v customer_key=cus_0001 \
--     -v auth_email=ana.trevino@midominio.mx \
--     -f db/link_auth_user.sql
--
-- customer_key takes either customers.id or nessie_customer_id.
-- Re-running it on the same pair is a no-op; pointing a user at a second
-- customer fails on purpose.

\set ON_ERROR_STOP on

select customer_id, auth_user_id
from public.link_customer_to_auth_user(:'customer_key', :'auth_email') \gset linked_

select c.id, c.first_name, c.last_name, c.email, c.auth_user_id,
       count(a.id) as accounts,
       (select count(*) from transactions t
        join accounts a2 on a2.id = t.account_id
        where a2.customer_id = c.id) as transactions
from customers c
left join accounts a on a.customer_id = c.id
where c.id = :'linked_customer_id'
group by 1, 2, 3, 4, 5;
