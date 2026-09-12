# Guion de demo — 4 minutos

Regla: la demo corre con `EXPO_PUBLIC_DATA_SOURCE=fixtures` aunque el engine esté vivo.
Si el engine responde, se cambia la variable en el último minuto y se vuelve a abrir la app.
Nunca se demuestra sobre una API que acaba de cambiar.

| # | Tiempo | Pantalla | Qué se dice | Dato que debe salir en pantalla |
|---|--------|----------|-------------|--------------------------------|
| 1 | 0:00 | Inicio | El problema: el cliente no sabe a dónde se le va el dinero. | Saldo $23,136.00 y 51 movimientos |
| 2 | 0:40 | Movimientos | Normalizamos el comercio: `OXXO TEC 4412 MTY` y `OXXO GONZALITOS 8871` son OXXO. | Agrupación por comercio |
| 3 | 1:20 | Suscripciones | Nadie se las dio de alta: las detectamos por cadencia. | 4 suscripciones, Netflix marcado con aumento de $40.00 |
| 4 | 2:00 | Inicio (alertas) | Dos alertas con explicación en español, no solo un número. | Cargo duplicado de Rappi $334.00 y compra inusual en OXXO $418.00 |
| 5 | 2:40 | Salud | Score 671 con desglose: lo que lo sube y lo que lo baja. | 5 componentes con puntos y explicación |
| 6 | 3:20 | Ahorro | Cerramos el ciclo: la alerta se convierte en una acción concreta. | Cancelar Smart Fit, $5,388.00 al año |
| 7 | 3:50 | — | Cierre y escalabilidad (diagrama 2 de `docs/architecture.md`). | — |

## Antes de presentar

- Celular en modo avión **no**: la app necesita el bundle del dev server. Mejor build instalado.
- Brillo al máximo, notificaciones en silencio, zoom de acompañamiento listo.
- Abrir las 5 pestañas una vez para que todo esté cacheado.
- Tener `docs/architecture.md` abierto en otra ventana para el cierre.

## Plan B

Si la app no abre: video de 60 s grabado con el mismo guion, en el teléfono y en la laptop.
