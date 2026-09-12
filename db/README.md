# db — esquema y semilla
Postgres en Supabase (15+, la vista usa `security_invoker`). Montos `bigint` en centavos, fechas `timestamptz` en UTC.

## Crear el proyecto
1. supabase.com → New project; guarda la contraseña de la base.
2. Settings → Database → Connection string (URI) → `SUPABASE_DB_URL` en `.env`.
3. Settings → API → Project URL + `anon` key → al equipo por canal privado, nunca al repo.
   El `service_role` key solo va al engine; jamás a `/app`.

## Correr
```bash
psql "$SUPABASE_DB_URL" -f db/schema.sql    # idempotente
node db/seed.js | psql "$SUPABASE_DB_URL"   # on conflict do nothing
node db/seed.js > db/seed.sql               # solo generar el SQL y revisarlo
```
Debe quedar: `transactions` 51, `subscriptions` 4, `anomaly_alerts` 3, score 671 / `good`.

## Probar la RLS
`customers.auth_user_id` viene en null, así que al inicio nadie ve nada. Crea un usuario en
Auth y lígalo: `update customers set auth_user_id = '<uuid>' where id = 'cus_0001';`
Sin sesión, `transactions` y `enriched_transactions` deben dar 0 filas; con ese usuario, 51.

## Resetear
```sql
drop view if exists enriched_transactions;
drop table if exists transaction_enrichment, savings_rules, cashflow_scores, anomaly_alerts, subscriptions, transactions, merchants, accounts, customers cascade;
```

## Si el seed choca
Correrlo dos veces no duplica. Si truena por FK, respeta el orden: `transaction_enrichment` va al final porque apunta a subscriptions y alerts. Para pisar datos viejos, resetea y siembra.
