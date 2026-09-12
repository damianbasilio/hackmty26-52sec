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

## Transferencias y divisiones de gasto

Lo que el usuario **hace** en la app: antes vivía en estado de React y se perdía al cerrarla.

| Tabla | Quién escribe | Qué guarda |
|---|---|---|
| `transfers` | la app inserta, el engine completa | quién manda, a quién, cuánto, concepto, estado y el id que devolvió Nessie |
| `split_requests` | la app | total, creador, código temporal y su expiración |
| `split_participants` | la app y `join_split()` | la parte de cada quien y si ya pagó |

Montos en `bigint` centavos en las tres, como en todo el esquema.

### transfers

`amount_cents` es **siempre positivo**: la dirección ya la dice `account_id`, que es la cuenta de
donde sale el dinero. La copia con signo es la fila de `transactions` que la transferencia
produce, y queda apuntada en `transfer.transaction_id`.

El flujo tiene dos manos a propósito:

1. La app inserta la fila en `pending`. Es lo único que puede hacer — hay policy de `insert` y de
   `select`, ninguna de `update`.
2. El engine llama a Nessie con el `service_role`, guarda `nessie_transfer_id`, enlaza
   `transaction_id` y mueve `status` a `completed` o `failed` con `failure_reason`.

Si el cliente pudiera escribir el estado podría dar por completada una transferencia que nunca
salió del banco. Por eso no puede.

Destino fuera del banco: deja `payee_account_id` en null y llena `payee_name`, `payee_bank` y
`payee_last_four`.

### split_requests y split_participants

`code` es el código corto que teclea quien se une. Un índice único **parcial** impide que dos
divisiones **abiertas** compartan código; una división ya liquidada conserva el suyo como
historia y lo libera. Si el insert choca, la app genera otro código y reintenta.

`paid` es una columna **generada** a partir de `paid_at`. Para marcar pagado escribes `paid_at`;
`paid` no se escribe nunca y por eso no puede contradecir a la fecha.

**Unirse no pasa por RLS.** Quien se une todavía no es participante, así que ninguna policy lo
puede ver, y el código que teclea no es columna de la fila que se inserta. Va por función:

```sql
select * from public.join_split('4821', 'Beto');
-- participant_id | split_id | total_cents | share_cents
```

Valida que el código sea de una división abierta y sin expirar, inserta al participante y
reparte de nuevo. Unirse dos veces devuelve la misma fila en vez de duplicar.

`public.rebalance_split(split_id)` divide `total_cents` en partes iguales y reparte el sobrante
de centavo en centavo a quien llegó primero — la misma regla que `sharesFor()` en la app, para
que las dos no difieran por un peso. `sum(share_cents)` siempre da `total_cents`.

### La RLS de una división no es la de una transferencia

Una transferencia es privada de quien la mandó: `owns_account(account_id)` y ya.

Una división la ven **todos sus participantes**, no solo el creador, y un participante no es
dueño de ninguna cuenta de esa división — `owns_account()` sola lo dejaría fuera. Por eso
`public.can_see_split()` tiene dos mitades unidas por `or`: dueño de la cuenta **o** fila propia
en `split_participants`.

Marcar pagado necesita una tercera cosa. La RLS filtra **filas, no columnas**: la policy tiene
que dejar a un participante actualizar su fila, y con eso sola también podría bajarse
`share_cents` a un peso en una cena de mil. Se cierra con permisos de columna:

```sql
revoke update on split_participants from anon, authenticated;
grant  update (paid_at, transfer_id) on split_participants to authenticated;
```

Comprobado: el `update` a `paid_at` pasa, el de `share_cents` responde
`permiso denegado a la tabla split_participants`.

Resumen de quién ve qué, con tres usuarios (A crea, B se une, C es ajeno):

| | `split_requests` | `split_participants` | `transfers` de A |
|---|---|---|---|
| A (creador) | 1 | 2 | 1 |
| B (participante) | 1 | 2 | 0 |
| C (ajeno) | 0 | 0 | 0 |

## Realtime

`schema.sql` deja la publicación `supabase_realtime` configurada. **Solo estas cuatro tablas
emiten**; lo demás la app lo lee cuando lo necesita.

| Tabla | Qué evento le importa a la app |
|---|---|
| `anomaly_alerts` | alerta nueva sin que la app pregunte |
| `transfers` | el engine mueve `status` de `pending` a `completed` o `failed` |
| `split_requests` | el creador liquida o cancela la división |
| `split_participants` | alguien se une, o alguien paga (`paid_at`) |

Las cuatro quedan en `replica identity full`. Sin eso un `update` o un `delete` solo publica la
llave primaria, y Realtime no puede evaluar una policy como `owns_account(account_id)` contra una
fila que no tiene: en vez de entregar el evento lo tira. Con `full` viaja la fila completa y la
RLS se aplica igual que en un `select`, así que publicar una tabla no filtra nada que el usuario
no pudiera leer de todos modos.

Del lado de la app (carriles C y D), un canal por tabla y filtro por cuenta:

```ts
supabase
  .channel('alertas')
  .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'anomaly_alerts',
        filter: `account_id=eq.${accountId}` },
      (payload) => { /* ... */ })
  .subscribe();
```

Realtime hay que habilitarlo también en el dashboard: Database → Replication → `supabase_realtime`.
Correr `schema.sql` agrega las tablas a la publicación, pero si el proyecto trae Realtime apagado
no sale ningún evento.

## Datos envenenados de Nessie — decisión del equipo

La API key de Nessie arrastra basura de siembras viejas que **no se puede borrar del lado de
Nessie**. Ya está sincronizada a Supabase:

| Cliente de Nessie | Qué tiene mal |
|---|---|
| `870d2c18-5422-4710-89a9-de3bff8309f0` | nombre corrompido (`Ana Sofia Trevi?o Garza`) y una renta de `-95000000` centavos — **-$950,000.00** en vez de -$9,500.00, error de 100x anterior al fix de float |
| `31715ba5-8ed1-482a-8fbf-e4674efd17c3` | cliente sin ninguna cuenta |

El cliente limpio es **`c5333ecf-b2ce-4812-95a6-f31172e4812f`**, con 27 movimientos correctos.

**Decisión: se borran de Supabase Y se marcan como excluidos.** Las dos cosas, porque ninguna
sola alcanza:

- Borrar solo, no dura. `sync_all()` recorre **todos** los clientes que ve la API key y los
  vuelve a crear idénticos. Habría que re-borrar después de cada `POST /sync`, y el día que
  alguien no lo haga, la demo sale con una renta de novecientos cincuenta mil pesos.
- Marcar solo, deja la basura a la vista de cualquiera que abra el dashboard o corra un `select`.

Cómo se sostiene la marca después del borrado: la exclusión **no vive en `customers`**, vive en
`excluded_nessie_customers`, con el `nessie_customer_id` de llave. Borrar el cliente no borra la
decisión. Cuando el sync lo revive, el trigger `customers_apply_exclusion` lo vuelve a marcar
antes de que la fila llegue a la tabla.

```bash
psql "$SUPABASE_DB_URL" -f db/quarantine_nessie.sql
```

Idempotente: si ya no están, borra 0 filas y reporta lo mismo. Al final lista los movimientos
por arriba de $500,000 que sigan vivos — si esa consulta devuelve algo, hay otro error de 100x
que nadie ha visto todavía.

### Qué protege esto, exactamente

Un cliente excluido queda **inservible para una demo**, no solo feo:

1. `owns_account()` filtra `excluded_at is null`. Como **toda** policy de **toda** tabla pasa por
   ahí, la app queda ciega a sus movimientos, suscripciones, alertas y score de una sola vez.
2. `link_customer_to_auth_user()` truena en vez de ligarlo.
3. El trigger de signup lo salta.
4. Y si alguien fuerza el vínculo con un `update` directo, el trigger pone `auth_user_id` de
   vuelta en null. Comprobado.

Para sacar a un cliente de la cuarentena, borra su fila de `excluded_nessie_customers` y limpia
`excluded_at` y `exclusion_reason` a mano. No hay atajo, y así debe ser.

### Nota para el carril B

`fetch_current_customer()` en `engine/app/repository.py` no conoce `excluded_at`: con
`ACTIVE_CUSTOMER_ID` vacío y más de un cliente sincronizado, sigue tronando por ambiguo aunque
los otros estén excluidos. Mientras tanto, la solución es fijar `ACTIVE_CUSTOMER_ID`.

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
