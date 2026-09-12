# expo-nearby-split

Módulo nativo local. Descubrimiento por cercanía entre teléfonos con
MultipeerConnectivity. **Solo iOS.**

## Decisión: Android no lleva contraparte nativa

Tomada el 2026-09-12 por el carril D, de acuerdo con el equipo.

El módulo no tiene lado Android. Antes eso significaba que en Android la división de
gastos **no existía**: el botón para unirse estaba detrás de `nearbySplit.isAvailable`,
que es `false` cuando no hay módulo nativo, así que un juez con Android no podía
unirse a nada.

Se evaluaron dos salidas:

| Opción | Costo | Qué cubre |
|---|---|---|
| Escribir el lado Android con Nearby Connections (Kotlin) | Alto: código nativo, permisos de ubicación en tiempo de ejecución y un development build nuevo | Paridad real de cercanía |
| **Que el código temporal funcione en cualquier dispositivo** | Bajo | El caso completo, en las dos plataformas |

**Se eligió la segunda.** El flujo por código de 4 dígitos es ahora el camino
principal y funciona igual en iOS, Android y en el simulador, porque se resuelve
contra la base: `public.join_split(join_code, joiner_name)` en `db/schema.sql` ya es
independiente del transporte, y Realtime empuja los cambios a todos los
participantes.

La cercanía queda como **atajo de iOS**, no como requisito. Ninguna parte del estado
depende de ella.

### Por qué la cercanía no puede ser el camino principal

`joinNearby(displayName, roomCode)` manda el `roomCode` en el contexto de la
invitación y el anfitrión lo compara contra `expectedRoomCode`. Es decir: el código
es una **contraseña que quien se une ya tiene que conocer**, no un mecanismo de
descubrimiento. La cercanía nunca ahorró teclear el código, solo transportaba los
montos — y eso ahora lo hacen la base y Realtime, que además sobreviven a que la app
se cierre.

Por eso en la pantalla la cercanía solo se muestra como indicador de presencia.

## Qué pasa en cada plataforma

| | Crear división | Unirse por código | Descubrimiento cercano |
|---|---|---|---|
| iOS con development build | sí | sí | sí |
| Android | sí | sí | no |
| Simulador / Expo Go | sí | sí | no |

`requireOptionalNativeModule` devuelve `null` donde no hay binario nativo, así que
`isAvailable` es `false` y cada método es un no-op que resuelve. No hay que proteger
las llamadas con `if`.

## Si alguien retoma el lado Android

Va en `android/` con Nearby Connections de Google Play Services, respetando los
mismos nombres de evento que declara `index.ts` (`onStatus`, `onPeerJoined`,
`onPeerLeft`, `onPayload`). No hace falta tocar la pantalla: ya no depende de este
módulo para funcionar.
