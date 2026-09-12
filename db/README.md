# db — esquema y semilla
Postgres en Supabase (15+, la vista usa `security_invoker`). Montos `bigint` en centavos, fechas `timestamptz` en UTC.

## Arranque en frío
Sigue esto en orden. Al final la app y el engine devuelven datos reales.

**1. Crear el proyecto**
1. supabase.com → New project; guarda la contraseña de la base.
2. Settings → Database → Connection string (URI) → `SUPABASE_DB_URL` en `.env` (copia de `.env.example`).
3. Settings → General → Reference ID → `SUPABASE_PROJECT_REF`.
4. Settings → API → Project URL → `SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_URL`.
5. Settings → API → `anon` key → `EXPO_PUBLIC_SUPABASE_ANON_KEY`; `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`.

En los proyectos nuevos la llave pública sale como `sb_publishable_...` en vez de la JWT `anon`
de antes; va igual en `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Las dos llaves se leen del dashboard, no
por SQL.

Reparte las llaves por canal privado, nunca por el repo. El `service_role` solo va al engine:
jamás a `/app`, porque todo `EXPO_PUBLIC_*` es legible por cualquiera con el binario.

**2. Esquema y datos**
```bash
psql "$SUPABASE_DB_URL" -f db/schema.sql    # idempotente, córrelo las veces que quieras
node db/seed.js | psql "$SUPABASE_DB_URL"   # on conflict do nothing
node db/seed.js > db/seed.sql               # opcional: solo generar el SQL y revisarlo
```
Verifica los conteos contra los fixtures en vez de confiar en que no tronó:
```bash
psql "$SUPABASE_DB_URL" -c "
select 'customers' t, count(*) n, 1 esperado from customers
union all select 'accounts', count(*), 2 from accounts
union all select 'merchants', count(*), 18 from merchants
union all select 'transactions', count(*), 51 from transactions
union all select 'transaction_enrichment', count(*), 51 from transaction_enrichment
union all select 'subscriptions', count(*), 4 from subscriptions
union all select 'anomaly_alerts', count(*), 3 from anomaly_alerts
union all select 'cashflow_scores', count(*), 1 from cashflow_scores
union all select 'score_components', count(*), 5 from cashflow_scores, jsonb_array_elements(components)
union all select 'savings_rules', count(*), 4 from savings_rules
union all select 'enriched_con_comercio', count(*), 51 from enriched_transactions
  where merchant_display_name is not null order by 1;"
```
Las 11 filas deben cuadrar y el score salir 671 / `good`.

Un conteo **más alto** que el esperado no siempre es un bug del seed: en cuanto alguien corre los
`POST` del paso 4, el engine agrega sus propias filas. `savings_rules` en 5 con los cuatro
`svr_000*` presentes es eso, no una semilla duplicada. Compara ids, no totales.

**3. Ligar un usuario de Auth**
Los fixtures traen `customers.auth_user_id` en null, así que recién sembrado **nadie ve nada**:
la RLS filtra todo. Crea un usuario en Authentication → Users y lígalo:
```sql
update customers set auth_user_id = '<uuid del usuario>' where id = 'cus_0001';
```
Si la app aparece vacía, revisa esto antes de sospechar de las policies.

**4. Poblar lo que calcula el engine** (esto es del carril B, aquí solo va el orden)
Los `GET` del engine leen filas guardadas, no calculan. En una base recién sembrada hay que
disparar los `POST` una vez, en este orden, porque cada uno consume lo del anterior:
```
POST /subscriptions/detect    →  POST /anomalies/scan
POST /score/compute           →  POST /savings/suggest
```
El engine necesita `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en el `.env` de la raíz;
sin ellas responde 500 en todos sus GET.

## Clientes que llegan por la ingesta de Nessie

`POST /sync` escribe clientes con el `service_role`, que **se salta la RLS**. El mapeo no manda
`auth_user_id`, así que toda fila que entra por ahí queda con `auth_user_id` en null, igual que
los fixtures. Los ids no chocan: la ingesta usa `cus_nessie_<hex24>` / `acc_nessie_<hex24>` y
guarda el id original en `nessie_customer_id`.

Qué implica para la RLS: **nada de eso es visible desde la app.** Las policies filtran por
`auth_user_id = auth.uid()`, y `owns_account()` llega a las transacciones cruzando
`accounts → customers`. Con el dueño en null ninguna fila hace match, para nadie: no es que se
vea a medias, es 0 filas en `transactions`, `subscriptions`, `anomaly_alerts`, `cashflow_scores`
y `savings_rules`. El engine igual las lee y procesa, porque va con `service_role`. Por eso el
síntoma clásico es "el engine ve 51 movimientos y la app ninguno".

Para vincularlo, crea el usuario en Authentication → Users y liga por `nessie_customer_id`:
```sql
update customers set auth_user_id = '<uuid del usuario>'
where nessie_customer_id = '<hex24 de nessie>';
```
Un cliente por usuario de Auth: `auth_user_id` es `unique`, así que ligar el mismo uuid a dos
clientes falla. Volver a correr `POST /sync` **no borra el vínculo** — el upsert va por
`nessie_customer_id` y solo toca las columnas que manda, y `auth_user_id` no es una de ellas.

## Probar la RLS
Con la anon key y sin sesión, `transactions` y `enriched_transactions` deben dar **0 filas**.
Con el usuario ligado al paso 3, **51 y 51**. Otro usuario autenticado distinto debe dar 0.
La app solo puede escribir en `savings_rules`; un `update` a `transactions` afecta 0 filas.

## Resetear
```sql
drop view if exists enriched_transactions;
drop table if exists transaction_enrichment, savings_rules, cashflow_scores, anomaly_alerts, subscriptions, transactions, merchants, accounts, customers cascade;
```
Los enums sobreviven; `schema.sql` los reusa. Después repite desde el paso 2.

## Si el seed choca
Correrlo dos veces no duplica. Si truena por FK, respeta el orden: `transaction_enrichment` va
al final porque apunta a subscriptions y alerts. Para pisar datos viejos, resetea y siembra.
Si un conteo no cuadra, el fixture manda: arregla `seed.js`, nunca `/contracts`.
