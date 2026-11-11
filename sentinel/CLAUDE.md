# sentinel — el vigía de producción

**Para qué existe:** saber pronto si algo que subió a producción está rompiendo la originación. Cada 5 minutos lee
producción (sólo lectura, por Redash) y dice, por **entidad** y por **comercio**, si lo que entró en la última hora se
salió de lo normal; muestra la curva del día contra lo normal, con los **despliegues a producción** marcados, y los
trabajos fallidos de la cola. Es el frente «vigía de producción» de `playground-local` (#96).

`make sentinel` (UI :5210 · API :5211) o la app Sentinel de Cockpit. `make sentinel ONCE=1` hace una pasada por consola
en JSON y sale.

## Cómo decide

- **Lo normal es la MISMA hora de los 7 días anteriores**, no un umbral fijo: el volumen cambia mucho por hora y día
  (de madrugada entran 2; a las 17, 140). Por cada uno: la mediana, el mínimo y el máximo.
- **Alerta** (rojo): en la última hora no entró nada, y en cada uno de los 7 días anteriores a esa hora entró al menos
  una (con lo normal en 3 o más). Si algún día también fue 0, que hoy sea 0 es posible: no avisa.
- **Para mirar** (ámbar): entró menos del 40 % de lo normal (con lo normal en 5 o más), o las negadas subieron más de
  30 puntos sobre lo normal (con al menos 5 terminadas).
- **Poco volumen** (gris): lo normal es menos de 3 por hora; no hay con qué comparar. Las que tienen 0 de costumbre y 0
  hoy van plegadas al final («sin movimiento a esta hora»).

Pocas reglas a propósito: muchas alertas falsas cansan y se ignoran. Antes de agregar una, mirá cuántas veces habría
sonado en los días anteriores.

## Lo que ya costó

- **Las horas.** En producción `created_at` está en hora de Bogotá y `NOW()` de la base en UTC (medido el 2026-11-11):
  `NOW() - INTERVAL 1 DAY` mira 29 horas. Las ventanas se arman en Go, en hora de Bogotá, y van como fechas literales.
- **Los números de Redash llegan como `json.Number`** (el conector usa `UseNumber` para no perder precisión): leerlos
  como `float64` daba todo en 0, sin error.
- **Negada no es falla**: los estados 6 (Negada) y 8 (Cancelado) son decisiones, no errores (`user_request_statuses`
  de producción). Los grupos de estados están en `server/main.go` (`approvedStates`, `deniedStates`).
- **Una pasada tarda ~20 s** (Redash): por eso corre de fondo cada 5 min y la interfaz lee lo último.

## Cómo está construido

| pieza | dónde |
|---|---|
| la lectura de producción, lo normal y el veredicto | `server/main.go` (usa `connectors/sql`, con su guarda de sólo lectura) |
| los despliegues a producción | `go run ./tablero/server/cmd/deploys -json` (lo mismo que `make deploys`) |
| la interfaz: el semáforo, la curva y las alertas | `src/App.vue`, con la base de `tools/ui` (`make estilo-sync`) |

## Lo que falta

Avisar solo (macOS, el chat o Slack) cuando algo pasa a alerta, sin repetir el mismo aviso; más seguido y más sensible
en las 2 horas después de un despliegue; los errores de los logs de producción (Loki) por servicio. Las decisiones
abiertas (qué vigilar, qué tan sensible, por dónde avisar) están en el frente de #96.
