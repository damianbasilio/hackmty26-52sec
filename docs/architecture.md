# Arquitectura — 52sec (HackMTY 2026, reto Capital One)

## Qué construimos en 36 horas

Una app bancaria móvil que lee movimientos, los normaliza por comercio y corre cuatro motores
encima: detección de suscripciones, alertas de anomalías, score de salud de flujo de efectivo y
reglas de ahorro. Nessie es la fuente externa de movimientos y **solo el backend la toca**.

```mermaid
flowchart TB
  subgraph device["Dispositivo (iOS / Android)"]
    app["Expo + Expo Router<br/>development build"]
    ds{"DataSource<br/>EXPO_PUBLIC_DATA_SOURCE"}
    fx["FixtureDataSource<br/>/contracts/fixtures"]
    api["ApiDataSource<br/>HTTPS"]
    app --> ds
    ds -->|fixtures| fx
    ds -->|api| api
  end

  subgraph cloud["Nube"]
    sb[("Supabase<br/>Postgres + Realtime + Storage")]
    eng["FastAPI engine (Docker)<br/>/subscriptions /anomalies /score /savings"]
  end

  nessie["Capital One Nessie API<br/>http://api.nessieisreal.com<br/>HTTP plano"]

  api -->|"REST sobre HTTPS"| eng
  app <-->|"auth + Realtime (alertas)"| sb
  eng -->|"service role key"| sb
  eng -->|"única ruta permitida"| nessie
  nessie x--x app

  classDef blocked stroke-dasharray: 4 4,stroke:#c00,color:#c00
  class nessie blocked
```

**Por qué la app nunca llama a Nessie.** Nessie sirve HTTP plano. App Transport Security de iOS
bloquea HTTP por defecto; abrirle una excepción es una bandera roja en revisión y además expondría
la API key dentro del bundle. El engine habla HTTP hacia Nessie desde el servidor y HTTPS hacia la
app.

### Flujo de datos, de movimiento crudo a pantalla

```mermaid
sequenceDiagram
  participant N as Nessie
  participant E as FastAPI engine
  participant DB as Supabase Postgres
  participant A as App

  E->>N: GET /accounts/{id}/purchases
  N-->>E: movimientos (montos float en pesos)
  E->>E: to_cents() una sola vez
  E->>DB: upsert transactions (lane A schema)
  E->>E: normalizar comercio -> merchants
  E->>DB: upsert transaction_enrichment
  E->>E: motores: cadencia, anomalías, score, ahorro
  E->>DB: upsert subscriptions / anomaly_alerts / cashflow_scores / savings_rules
  DB-->>A: SELECT vía anon key + RLS
  DB-->>A: Realtime push de anomaly_alerts nuevas
```

## Cómo escalaría a 150 millones de clientes

Lo de 36 horas es el mismo pipeline con `for` loops y tablas. A escala Capital One, cada paso se
convierte en una etapa con su propio SLA: ingesta por stream, features materializadas, modelos
servidos aparte del motor de reglas, y alertas como cola con deduplicación.

```mermaid
flowchart TB
  subgraph ingest["Ingesta"]
    core["Core bancario / autorizaciones"]
    cdc["CDC + Kafka<br/>topic: transactions<br/>particionado por account_id"]
    core --> cdc
  end

  subgraph stream["Procesamiento en stream"]
    flink["Flink / Spark Streaming<br/>normalización de comercio,<br/>ventanas de velocidad y duplicados"]
    cdc --> flink
  end

  subgraph features["Feature store"]
    online[("Online store<br/>Redis / DynamoDB<br/>p99 < 10 ms")]
    offline[("Offline store<br/>Iceberg sobre S3<br/>entrenamiento y backfill")]
    flink --> online
    flink --> offline
  end

  subgraph serving["Serving de modelos"]
    cadence["Modelo de cadencia<br/>(suscripciones)"]
    anomaly["Modelo de anomalías<br/>(isolation forest + reglas)"]
    scoring["Modelo de score<br/>(300-850, GBM)"]
    online --> cadence
    online --> anomaly
    online --> scoring
    offline -.->|reentrenamiento diario| cadence
    offline -.->|reentrenamiento diario| anomaly
    offline -.->|reentrenamiento semanal| scoring
  end

  subgraph alerting["Motor de alertas"]
    rules["Reglas + umbrales por segmento"]
    dedupe["Deduplicación y rate limit<br/>por cliente y por tipo"]
    outbox["Outbox + push / in-app"]
    anomaly --> rules --> dedupe --> outbox
  end

  subgraph api["Capa de lectura"]
    gw["API Gateway + BFF<br/>agrega score, subs y feed"]
    cache[("Cache de lectura<br/>por cliente")]
    scoring --> gw
    cadence --> gw
    outbox --> gw
    gw <--> cache
  end

  mobile["App móvil"]
  gw --> mobile
  outbox --> mobile

  subgraph gov["Gobierno"]
    audit["Audit log inmutable"]
    explain["Registro de explicaciones<br/>por alerta y por score"]
    lineage["Lineage de features"]
  end

  rules --> audit
  scoring --> explain
  flink --> lineage
```

### Qué cambia y por qué

| Pieza | 36 horas | 150 M clientes | Motivo |
|---|---|---|---|
| Ingesta | pull a Nessie bajo demanda | CDC → Kafka particionado por cuenta | pull no aguanta; el orden por cuenta importa para duplicados y velocidad |
| Enriquecimiento | función Python por lote | job de stream con estado | la normalización de comercio necesita ventanas, no un `for` |
| Features | columnas en `transaction_enrichment` | feature store online + offline | la app pide p99 bajo; el entrenamiento pide historia completa |
| Motores | reglas en el mismo proceso | modelos servidos aparte + motor de reglas | reentrenar sin redeploy del API; umbrales por segmento |
| Alertas | fila en `anomaly_alerts` | outbox con deduplicación y rate limit | sin dedupe, un comercio con retry manda 4 push al mismo cliente |
| Lecturas | `select` directo con RLS | BFF + cache por cliente | 5 pantallas × 150 M no se sirven con queries crudas |
| Explicabilidad | campo `explanation` en texto | registro de explicaciones versionado | requisito regulatorio: poder decir por qué se disparó una alerta hace 8 meses |

### Invariantes que sobreviven a los dos diagramas

- Montos como enteros en centavos. La única conversión desde float pasa por `to_cents()` en el engine.
- Fechas en ISO 8601 UTC. La zona (`America/Monterrey`, UTC-6 sin horario de verano) se aplica solo al presentar.
- Toda alerta y todo score llevan `explanation` en español; un número sin explicación no se muestra.
- El cliente nunca ve datos de otro cliente: RLS en Supabase hoy, autorización en el BFF después.
