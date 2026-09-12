# 52sec

App bancaria móvil para el reto de **Capital One — HackMTY 2026**.

Lee movimientos bancarios, normaliza el comercio y corre cuatro motores encima:

| Motor | Qué hace |
|---|---|
| **Suscripciones** | Detecta cargos recurrentes por cadencia, sin que el usuario los dé de alta. Marca aumentos de precio. |
| **Anomalías** | Cargos duplicados, montos fuera de patrón, horarios raros. Cada alerta trae explicación en español. |
| **Salud de flujo** | Score 300–850 con desglose por componente y las acciones que más lo suben. |
| **Ahorro** | Convierte cada hallazgo en una regla concreta: redondeo, apartado quincenal, cancelar lo que no usas. |

---

## Estructura

```
app/         Expo + TypeScript + Expo Router (development build)
engine/      FastAPI contenedorizado — los cuatro motores
db/          schema.sql de Supabase + seeder
contracts/   types.ts y fixtures JSON — el contrato entre todas las partes
docs/        arquitectura, guion de demo, notas de pitch
```

`contracts/` es la fuente de verdad del modelo de datos. La app, el engine y la base de datos
se derivan de ahí, no al revés.

---

## Correrlo

```bash
cp .env.example .env           # llena las llaves
ln -sf ../.env app/.env        # Expo lee el .env de su propia raíz

# app — funciona sin backend, con los fixtures
cd app && npm install && npx expo start

# engine
cd engine
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000     # http://localhost:8000/docs

# base de datos
psql "$SUPABASE_DB_URL" -f db/schema.sql
node db/seed.js | psql "$SUPABASE_DB_URL"
```

La app arranca en **modo fixtures**: `EXPO_PUBLIC_DATA_SOURCE=fixtures` lee
`contracts/fixtures/` y no necesita engine ni base de datos. Para apuntarla al engine real,
`EXPO_PUBLIC_DATA_SOURCE=api` y `EXPO_PUBLIC_ENGINE_URL=https://...`.

Es un **development build**, no Expo Go: necesitamos cámara y push nativos.
La primera vez: `npx expo prebuild && npx expo run:ios` (o `run:android`).

### Verificar que todo está sano

```bash
cd app && npx tsc --noEmit     # valida los fixtures contra contracts/types.ts
node src/format.check.ts        # self-check de los formateadores de dinero
curl -s localhost:8000/health
```

---

## Convenciones que no se rompen

- **Montos: enteros en centavos.** `1425000` es $14,250.00. Nunca float, en ningún lenguaje.
  La única conversión desde float vive en `engine/app/nessie.py::to_cents()`.
- **Fechas: ISO 8601 UTC** con `Z`. La zona (`America/Monterrey`, UTC−6) se aplica solo al presentar.
- **Moneda: MXN.**
- **Textos de interfaz en español de México. Identificadores y comentarios en inglés.**
- **Toda señal lleva `explanation`.** Un número sin razón no se muestra.

### La app nunca llama a Nessie

La Nessie API sirve HTTP plano. App Transport Security de iOS lo bloquea, y la API key no debe
vivir dentro del bundle. Solo `engine/app/nessie.py` habla con `api.nessieisreal.com`;
la app habla con el engine por HTTPS.

Nada de `service_role` de Supabase en `app/`: todo `EXPO_PUBLIC_*` es legible por cualquiera
que tenga el binario.

---

## Arquitectura

`docs/architecture.md` tiene dos diagramas: lo que se construye en 36 horas y cómo escala
el mismo modelo de datos a 150 millones de clientes (stream de transacciones, feature store,
serving de modelos, motor de alertas con deduplicación).
