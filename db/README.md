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
la RLS filtra todo. Ver [Auth real](#auth-real) para el alta completa. La versión corta:

1. Authentication → Users → Add user, con correo y contraseña.
2. ```bash
   psql "$SUPABASE_DB_URL" -v customer_key=cus_0001 -v auth_email=<correo> -f db/link_auth_user.sql
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

Para vincularlo, crea el usuario en Authentication → Users y corre `db/link_auth_user.sql`
con el `nessie_customer_id` como `customer_key` (ver [Auth real](#auth-real)).

Un cliente por usuario de Auth: `auth_user_id` es `unique`, así que ligar el mismo uuid a dos
clientes falla. Volver a correr `POST /sync` **no borra el vínculo** — el upsert va por
`nessie_customer_id` y solo toca las columnas que manda, y `auth_user_id` no es una de ellas.

## Auth real

El vínculo entre un usuario de Supabase Auth y una fila de `customers` **vive en la base**, no en
el engine. Está en `db/schema.sql` y son dos piezas:

| Pieza | Cuándo corre | Qué hace |
|---|---|---|
| `public.handle_new_auth_user()` + trigger `on_auth_user_created` | automático, al insertarse la fila en `auth.users` | liga el usuario recién creado con un customer libre |
| `public.link_customer_to_auth_user(customer_key, auth_email)` | a mano | liga un par concreto y truena si no puede |

**El engine no debe ligar usuarios.** Si `nessie_sync` empezara a mandar `auth_user_id` en su
upsert habría dos dueños de la misma columna y el que corriera al final ganaría en silencio.

### Alta de un usuario, de punta a punta

**1. Crear el usuario.** Authentication → Users → Add user. También sirve el `signUp` de la app.
No insertes en `auth.users` por SQL: GoTrue deja `confirmation_token`, `recovery_token`,
`email_change` y `email_change_token_new` en null y después el login truena con
`500 Database error querying schema`.

**2. Ligarlo.** El trigger ya lo intentó solo. Busca un customer **sin dueño** en este orden:

1. `raw_user_meta_data ->> 'customer_id'` — lo que manda el `signUp` de la app:
   ```ts
   supabase.auth.signUp({ email, password, options: { data: { customer_id: 'cus_0001' } } })
   ```
2. `raw_user_meta_data ->> 'nessie_customer_id'`.
3. `customers.email` igual al correo del usuario, sin distinguir mayúsculas.

Si ninguno pega, el trigger no hace nada y **el alta igual se completa**: un `raise` ahí adentro
abortaría el signup con `Database error saving new user`, y perder el vínculo se arregla,
perder la cuenta no. Para ligarlo después:

```bash
psql "$SUPABASE_DB_URL" \
  -v customer_key=cus_0001 \
  -v auth_email=ana.trevino@midominio.mx \
  -f db/link_auth_user.sql
```

`customer_key` acepta `customers.id` o `nessie_customer_id`. Repetir el mismo par no hace nada;
apuntar un usuario a un segundo customer truena a propósito (`auth_user_id` es `unique`).

**3. Verificar.** No des por hecho que quedó: compruébalo con los dos usuarios.

```bash
psql "$SUPABASE_DB_URL" \
  -v owner_email=ana.trevino@midominio.mx \
  -v other_email=otro@midominio.mx \
  -f db/verify_rls.sql
```

El script hace lo mismo que PostgREST en cada request — `set local role` más el GUC
`request.jwt.claims` — así que lo que reporta es literalmente lo que ve la anon key:

| Escenario | transactions | enriched | accounts | merchants |
|---|---|---|---|---|
| anon sin sesión | 0 | 0 | 0 | 18 |
| dueño ligado | 51 | 51 | 2 | 18 |
| otro usuario | 0 | 0 | 0 | 18 |

Y el `update` a `transactions` del final debe reportar `UPDATE 0`: desde el cliente el ledger es
de solo lectura. `merchants` en 18 en los tres casos es correcto — es catálogo público, sin dato
personal.

Si el dueño sale en 0, el vínculo no existe: revisa `select id, auth_user_id from customers`.

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
