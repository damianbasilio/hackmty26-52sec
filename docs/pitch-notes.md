# Notas de pitch

## Una línea

Un banco que no solo te muestra tus movimientos, te dice qué está mal con ellos y en español.

## El problema, con número

El cliente promedio tiene suscripciones que no recuerda haber contratado y cargos duplicados que
nunca reclama. Nadie cancela lo que no ve. La app del banco le muestra una lista de cargos crudos
(`RAPPI*RESTAURANTES`) y lo deja solo con el trabajo de interpretarlos.

## Qué hacemos distinto

1. **Normalizamos el comercio antes de mostrar nada.** Sin esto, ningún análisis funciona.
2. **Cuatro motores encima del mismo dato enriquecido**: suscripciones, anomalías, score, ahorro.
3. **Toda señal trae explicación.** Un score sin razones es un número que el cliente ignora.
4. **La acción está a un toque de la alerta.** Detectamos que no usas el gimnasio y te ofrecemos cancelarlo.

## Por qué es creíble en producción

- Montos enteros en centavos de punta a punta: cero errores de redondeo en dinero.
- Nessie solo se toca desde el backend. La app nunca habla HTTP plano ni guarda la API key.
- RLS en Supabase desde el primer día: un cliente no puede leer a otro ni por error de query.
- El segundo diagrama de `docs/architecture.md` muestra el camino a 150 M de clientes sin rediseñar el modelo de datos.

## Preguntas que nos van a hacer

| Pregunta | Respuesta corta |
|---|---|
| ¿Cómo detectan una suscripción? | Cadencia + comercio normalizado + monto estable, con `confidence` y mínimo de ocurrencias. |
| ¿Y los falsos positivos? | Cada alerta se puede marcar como legítima; eso alimenta el umbral por cliente. |
| ¿Por qué 300-850? | El cliente ya entiende esa escala; lo nuevo es que es flujo de efectivo, no crédito. |
| ¿Esto aguanta 150 M? | Mismo modelo de datos, distinto plomería: stream, feature store, modelos servidos aparte. |
| ¿Datos reales? | Nessie para movimientos; los fixtures son para demo determinista. |
