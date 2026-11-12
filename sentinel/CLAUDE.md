# sentinel — el vigía de producción

**Para qué existe:** saber pronto si algo que subió a producción está rompiendo la originación. Guarda cuatro semanas de
producción (sólo lectura: Redash y Loki) en bloques de 5 minutos y dice, por **entidad**, por **comercio**, por
**servicio** (errores de los logs) y para la **cola** (trabajos fallidos), si la última hora se salió de lo normal;
muestra la curva del día contra lo normal, con los **despliegues a producción** marcados. Es el frente «vigía de
producción» de `playground-local` (#96).

`make sentinel` (UI :5210 · API :5211) o la app Sentinel de Cockpit. `make sentinel ONCE=1` carga lo que falte, hace
una pasada y la resume por consola. `go run ./sentinel/server -backtest 7` dice cuántas veces habrían sonado las reglas
en los últimos 7 días, con la lista de alertas: **es la vara antes de cambiar una regla**.

## Cómo guarda

- **Un archivo por día** en `sentinel/.data/<día>.json` (fuera de git), con los conteos de cada señal por bloque de 5
  minutos (`server/store.go`). Las señales: `all:production`, `lender:<id>`, `merchant:<id>`, `service:<servicio>`,
  `queue:failed`.
- **La carga inicial** pide entero cada día que falte de los últimos 28 (`historyDays`): la primera vez, 29 días en
  ~125 s y ~700 KB. Después arranca en segundos.
- **Cada pasada (5 min) vuelve a pedir sólo las últimas 3 horas** y las reemplaza: una solicitud cambia de estado
  horas después de entrar, y reemplazar (no sumar) evita contar dos veces.

## De fondo: mide aunque nada esté abierto

`make sentinel-install` deja la API corriendo como **LaunchAgent** de macOS (`com.creditop.sentinel`, `server/agent.go`):
arranca con la sesión, se vuelve a levantar si se cae y mide cada 5 minutos aunque Cockpit esté cerrado. Corre el
binario compilado `sentinel/bin/sentinel` (fuera de git): **después de cambiar el servidor, `make sentinel-install` de
nuevo**. `make sentinel-status` dice si está vivo y hasta dónde llegó lo guardado; `make sentinel-uninstall` lo saca.
Su salida queda en `~/Library/Logs/sentinel.log`.

- **Dos APIs no se pisan.** Si el puerto 5211 ya lo tiene otra de Sentinel (la de Cockpit, por `make sentinel`), la que
  llega después espera y toma el relevo cuando se suelta. Sólo la que escucha lee producción y escribe lo guardado.
- **Sin huecos.** Cada pasada pide desde donde llegó lo guardado (`reach`), no sólo las últimas 3 horas: el Mac dormido
  o la VPN de producción caída dejan un hueco que la pasada siguiente llena entero.
- **Al abrir hay datos de entrada.** La última vista se guarda en `sentinel/.data/last.json`; al arrancar la API la
  sirve marcada `stale` («lo guardado de las HH:MM; leyendo lo de ahora…») hasta que termina la primera pasada.

## Cómo decide (`server/stats.go`)

- **Lo normal es la misma hora en los días comparables**: hábiles con hábiles, fines de semana con fines de semana,
  de los últimos 14 días (`baselineDays`). De ahí, la mediana y la dispersión robusta (MAD × 1,4826, con piso de
  Poisson `√mediana`), y un z = (ahora − mediana) / dispersión.
- **Volumen (solicitudes): lo malo es que CAIGA.** Para mirar con z ≤ −2,5; alerta con z ≤ −3,5; las dos además con
  ahora ≤ 0,6 × lo normal. Con lo normal por debajo de 3, «poco volumen»: no avisa.
- **Errores (logs y cola): lo malo es que SUBAN.** z ≥ 3 / 4,5 y ahora ≥ 1,5 × lo normal, **y además** por encima del
  **techo**: el percentil 99 de TODAS las horas de los días comparables (para alerta, el doble). Los errores llegan en
  ráfagas a cualquier hora; sin el techo, la última semana daba 37 alertas (28 de legacy-application), con él 3.
- **Sostenido**: el estado que se muestra es el que duró 3 lecturas seguidas (una cada 10 min). Una alerta que recién
  empieza se ve como «para mirar»; `raw` es el nivel del instante.
- **Después de un despliegue a producción (2 h)** los umbrales se multiplican por 0,75: más sensible.
- **Cambio de nivel** (`shift`): la mediana diaria de la última semana contra la de los días 8–28 atrás. Si se movió ×2
  o a la mitad, se muestra como nota, no como alerta: ya pasó a ser lo normal. Por esto `baselineDays` es 14 y no 28:
  con 28, un cambio que se queda mezcla dos regímenes y la dispersión se infla.
- **Las negadas** se muestran pero no alertan: lo de hoy todavía no terminó de avanzar y se compara con días asentados.
- Todo se puede ajustar sin tocar código en `sentinel/rules.json` (opcional; lo que no dice queda por defecto), con
  `signals` para ignorar una señal o subirle el mínimo. Antes de cambiar algo, corré el `-backtest`.

## Lo que ya costó

- **Las horas.** En producción `created_at` está en hora de Bogotá y `NOW()` de la base en UTC (medido el 2026-11-11):
  `NOW() - INTERVAL 1 DAY` mira 29 horas. Las ventanas se arman en Go, en hora de Bogotá, y van como fechas literales.
- **Los números de Redash llegan como `json.Number`** (el conector usa `UseNumber` para no perder precisión): leerlos
  como `float64` daba todo en 0, sin error.
- **Negada no es falla**: los estados 6 (Negada) y 8 (Cancelado) son decisiones, no errores (`user_request_statuses`
  de producción). Los grupos de estados están en `server/fetch.go` (`approvedStates`, `deniedStates`).
- **Loki**: se pide con `query_range` y paso de 300 s; cada punto cuenta los 5 minutos que TERMINAN en él, así que va
  al bloque que empieza 5 minutos antes. Si Loki no contesta, la pasada sigue sin esa señal y lo dice (`logsNote`).
- **Lo normal de 28 días mezclaba regímenes**: los errores de legacy-backend están ×5 desde el 2026-10-30 (de 08–09 h,
  sin despliegue de legacy-backend a producción entre el 27 y el 1); de ahí los 14 días y el cambio de nivel aparte.

## Cómo está construido

| pieza | dónde |
|---|---|
| lo guardado, por día y bloque de 5 min | `server/store.go` |
| la lectura de producción (Redash y Loki) | `server/fetch.go` (usa `connectors/sql`, con su guarda de sólo lectura, y `connectors/logs`) |
| lo normal, el veredicto, el cambio de nivel y el backtest | `server/stats.go` |
| la carga, las pasadas y la API | `server/main.go` |
| el LaunchAgent (de fondo) | `server/agent.go` |
| los despliegues a producción | `go run ./tablero/server/cmd/deploys -json` (lo mismo que `make deploys`) |
| la interfaz: el semáforo, la curva y las alertas | `src/App.vue`, con la base de `tools/ui` (`make estilo-sync`) |

## Lo que falta

Avisar solo (macOS, el chat o Slack) cuando algo pasa a alerta, sin repetir el mismo aviso (un estado por señal); los
errores de pantalla que vio el cliente (PostHog), por pantalla. Las decisiones
abiertas (qué vigilar, qué tan sensible, por dónde avisar) están en el frente de #96.
