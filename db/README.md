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

Reparte las llaves por canal privado, nunca por el repo. El `service_role` solo va al engine:
jamás a `/app`, porque todo `EXPO_PUBLIC_*` es legible por cualquiera con el binario.

**2. Esquema y datos**
```bash
psql "$SUPABASE_DB_URL" -f db/schema.sql    # idempotente, córrelo las veces que quieras
node db/seed.js | psql "$SUPABASE_DB_URL"   # on conflict do nothing
node db/seed.js > db/seed.sql               # opcional: solo generar el SQL y revisarlo
```
Debe quedar: `transactions` 51, `enriched_transactions` con comercio 51, `merchants` 18,
`subscriptions` 4, `anomaly_alerts` 3, `savings_rules` 4, y el score 671 / `good`.

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
