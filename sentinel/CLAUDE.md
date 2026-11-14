# sentinel — el vigía de producción

**Para qué existe:** saber pronto si algo que subió a producción está rompiendo la originación. Guarda cuatro semanas de
producción (sólo lectura: Redash y Loki) en bloques de 5 minutos y dice, por **entidad**, por **comercio**, por
**servicio** (errores de los logs) y para la **cola** (trabajos fallidos), si la última hora se salió de lo normal;
muestra la curva del día contra lo normal, con los **despliegues a producción** marcados. Es el frente «vigía de
producción» de `playground-local` (#96, desde el 2026-11-13 dentro de `miguel`); su historia sigue en la tarea `sentinel`.

`make sentinel` (UI :5210 · API :5211) o la app Sentinel de Cockpit. **La interfaz**: a la izquierda, toda la
originación y lo que se SIGUE, en dos secciones —entidades y comercios—, que se agregan a mano desde el buscador, cada
uno con su curva chica de hoy; al centro, el elegido; abajo, en la consola, la tabla de TODAS las señales (pestañas Errores · Entidades ·
Comercios, ordenable, con + para seguir); a la derecha, lo que pide atención, **una tarjeta por servicio en
producción** (su versión, sus errores y su señal de vida), los avisos y los despliegues.

`make sentinel ONCE=1` carga lo que falte, hace una pasada y la resume por consola. `go run ./sentinel/server -backtest 7` dice cuántas veces habrían sonado las reglas
en los últimos 7 días, con la lista de alertas: **es la vara antes de cambiar una regla**.

## La consola: `bin/sentinel` (o `make sentinel-now|day|signal|deploy`)

Lee lo guardado en `sentinel/.data` y vuelve a evaluar con las reglas de hoy: **no necesita la API arriba** (si lo
guardado está viejo, lo dice primero). Todos aceptan `--json` para un agente. Es lo del día a día y lo que se le pasa a
un agente para que resuma.

| comando | contesta |
|---|---|
| `bin/sentinel now` | cómo está producción ahora: lo que pide atención, lo que se sigue y cada servicio con su versión |
| `bin/sentinel day [AAAA-MM-DD]` | el día: cuánto entró contra lo normal, qué se salió de lo normal y de qué hora a qué hora (con el porqué de su peor momento), los despliegues y los avisos |
| `bin/sentinel signal <señal\|nombre>` | una señal hora por hora, hoy contra lo normal; de una entidad, también sus errores en los logs |
| `bin/sentinel deploy <repo> [versión] [--hours 2]` | **¿se dañó algo después de un despliegue?** Las horas de después contra las mismas de antes y contra esa franja en los días comparables, en TODAS las señales: errores que subieron, solicitudes que cayeron (con piso de volumen), servicios que se callaron. Sin versión, el último a producción del repo (GitHub). Que algo empeore después no prueba que lo causó: dos repos que se despliegan juntos se ven igual |

**La trazabilidad del día** queda escrita en `sentinel/.data/days/<día>.md` (lo mismo que `bin/sentinel day`): la API
la reescribe cada 30 minutos y, al cambiar de día, deja cerrado el de ayer. Los conteos de 5 minutos (`<día>.json`)
son la fuente: el resumen se puede volver a armar para cualquier día guardado.

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

## Los servicios en producción (`server/services.go`)

- **Todo servicio que escribe en el Loki de producción** (18 el 2026-11-12) tiene dos señales: `service:<s>`, sus
  líneas de error, y `logs:<s>`, TODAS sus líneas (la señal de vida). ⚠ El nivel se lee de `detected_level`, no de la
  etiqueta `level`: `level` y `environment` sólo los ponen los dos monolitos; los servicios en Go mandan por
  OpenTelemetry. Con `level` se veían 2 servicios de 18 (`server/fetch.go`).
- **La versión** es el tag del último despliegue a producción en GitHub (`gh run list` del repo, un workflow con «prod»
  en el nombre), cada 30 minutos. Es lo que se DESPLEGÓ, no lo que corre: eso lo sabe ECS, con credenciales de AWS de
  producción. El `service_version` de Loki no sirve (casi todos dicen «1.0.0»). Si el último falló, la tarjeta lo dice
  y nombra el último que salió bien. El repo de cada servicio sale de su nombre, con excepciones en `serviceRepos`.
- **La señal de vida avisa sólo si el servicio casi deja de escribir** (`liveness`: 10 % de lo normal, con lo normal
  ≥ 20 líneas por hora), no cuando baja el tráfico. Así salió, el 2026-11-12, que customer-profiling-service y
  kyc-gateway-service no escriben nada desde el 11 y el 10 de noviembre.
- **«Callado desde…»** (`silence`, en `stats.go`): si un servicio lleva sin escribir una línea más que el silencio más
  largo de las semanas guardadas (y más de una hora), es «para mirar»; el doble, alerta. Va por encima de la
  estadística de la hora, así un silencio que dura no pasa a ser «lo normal» en dos semanas; la tarjeta lo marca hasta
  que vuelve a escribir. Las noches de un servicio que sólo trabaja de día cuentan como su silencio normal.
- **«Poco volumen» no cierra un episodio** (`alerts.go`): sólo lo cierra volver a lo normal. Un servicio callado pasaba
  a «poco volumen» de noche, se cerraba y avisaba otra vez cada mañana.
- **Errores: hace falta un mínimo** (`errors.minNow`, 10 por hora). Un servicio que casi nunca tiene errores daba alerta
  con 5.
- **Errores por entidad** (`lerr:<id>`): los errores en los logs que nombran a una entidad. Sólo dos fuentes la nombran:
  preapprovals-service, como metadato `lender_name` (el `slug` de `lenders`, con guion bajo: «creditop_x» es
  `creditop-x`), y legacy-backend, en el JSON de la línea (`context.lender_id`). En 7 días (medido el 2026-11-12), ~1.000
  y ~1.800 errores con entidad, de unos 35.000. No hay errores por comercio: casi ninguna línea lo nombra (90 en 7
  días). En la vista de una entidad van debajo de sus solicitudes, con su curva; en el sidebar, un «N err».
- **`logsVersion`** (`fetch.go`): cuando cambia lo que se lee de Loki, los días guardados con la versión anterior se
  vuelven a pedir (sólo Loki). El paso de 2 a 18 servicios recargó 29 días en ~11 minutos, una vez.

## Las pantallas del wizard (`server/steps.go`, PostHog)

Lo que el backend no ve: si un despliegue del front rompe una pantalla, simplemente no llegan pedidos. Por paso
(`step:otp`, `step:amount`, `step:registration`, `step:offer`, `step:amount-update`) y por comercio (`step:otp@94`):
**la conversión** (de los que VIERON la pantalla, cuántos la ENVIARON) y **la tasa de fallo** del resultado
(`success = false`), contra la mediana de los días comparables a esa hora, con una prueba binomial (alerta: z ≤ −4,5 y
la conversión ≤ 60 % de lo normal; fallos: z ≥ 4,5, ≥ 10 fallos y el doble de lo normal). Pide 20 vistas para hablar; un
comercio chico mira 3, 6 o 24 horas. Avisan las del wizard entero y las de los comercios que se siguen.

- ⚠ **`toDateTime('…')` en HogQL se lee en la hora del PROYECTO (Bogotá), no en UTC**: sin `'UTC'` explícito, cada
  pasada pedía 5 horas en el futuro, recibía nada y borraba lo guardado. `phVersion` 2 lo recargó.
- **La versión del front sale de PostHog, no de GitHub.** `app_version` siempre dice «1.0.0», y el último «Deploy Loan
  Request Wizard Production» de GitHub es la v1.11.4 (2026-10-30) mientras en producción corre la v1.11.7: el front se
  despliega por un camino que no se ve en los workflows. Lo que sí llega es `$exception_release` (el commit con que se
  construyó y se subieron los source maps): cada commit nuevo visto en producción es un despliegue, a la hora en que
  aparece por primera vez, y se traduce a su tag (`frontReleases`). Antes de la v1.11.7 los errores no traían versión.
  Entra en la lista de despliegues, en la tarjeta `frontend-monorepo` y en `bin/sentinel deploy frontend-monorepo`.
- **Los errores de JavaScript del front** (`jserr:front`, unos 455 por día): cuántos contra lo normal, como los de un
  servicio. El mensaje está en `$exception_values` (`$exception_message` llega vacío). `bin/sentinel deploy` lista
  además los mensajes NUEVOS: los que aparecen después del despliegue y no en los 7 días de antes.
- La semana del 2026-11-05 al 12, las pantallas sumaron 7 avisos de alerta (3 del wizard entero, 4 de Pullman).

## Cómo avisa (`server/alerts.go`)

- **Un aviso de macOS cuando una señal pasa a alerta** (el estado sostenido, el mismo que muestra la interfaz), con
  sonido. Tocarlo abre Cockpit en esa señal (`cockpit://sentinel/#/lender/6`). Sale por el avisador del chat («Chat de
  my-tools», que ya tiene permiso de avisos); sin él, por osascript.
- **Uno por episodio.** El episodio sigue abierto hasta que la señal pasa `clearMinutes` (30) en lo normal: una que va y
  viene entre alerta y «para mirar» no avisa cada 5 minutos. Avisa otra vez sólo si empeora. Al cerrarse, «volvió a lo
  normal», sin sonido.
- **Si no puede leer producción 30 min** (la VPN caída), avisa una vez «Sentinel no está mirando», y otra cuando vuelve.
- **Si una pasada se cuelga** (no devuelve nunca, así que tampoco falla), avisa el perro guardián (`watch`, en
  `main.go`): más de 2× el intervalo sin avanzar da el mismo «Sentinel no está mirando», una vez. No corta la pasada:
  avisa. Los procesos de afuera (`gh`, `go run` de los despliegues) llevan plazo (`runTool`, en `services.go`).
- **En Linux** el aviso sale por `notify-send` si está en el PATH (alerta: urgencia crítica); no abre nada al tocarlo.
- **Una fuente que no contesta se dice**: `logsNote` (Loki), `stepsNote` (PostHog) y `deploysNote` (los despliegues y
  las versiones, `gh`) van en la vista y la interfaz los muestra sobre el grupo afectado y en el pie. Las tres fuentes
  se leen a la vez; sólo Redash hace fallar la pasada (sin solicitudes, la última hora se leería como una caída).
- El estado vive en `sentinel/.data/alerts.json` (un reinicio no repite avisos) y cada aviso queda en `notices.jsonl`;
  la interfaz muestra los últimos en «Avisos». Sólo avisa la API que escucha: `-once` y `-backtest` no.
- **De los comercios avisa sólo los que se SIGUEN** (`notify.merchants`: `following` por defecto, `all` para todos).
  Son más de cien y casi todos chicos. Entidades, servicios y la cola avisan siempre. El episodio de un comercio que no
  se sigue se lleva igual (aparece en «Para mirar»), y si se lo empieza a seguir en medio, avisa en la pasada siguiente.
  Lo que se sigue vive en el servidor, `sentinel/.data/following.json` (`server/following.go`; `POST /api/following
  {"signal":"merchant:94"}`, `DELETE /api/following?signal=…`), no en el navegador: por eso decide los avisos de fondo.
- Se ajusta en `rules.json`, bajo `notify`: `level` (`alert` por defecto, `warn` para avisar también «para mirar»,
  `off`), `clearMinutes`, `staleMinutes`, `recovered`. **El `-backtest` dice qué avisos habrían salido**: la semana del
  2026-11-05 al 11, con 2 servicios, 3 de alerta y 3 de «volvió a lo normal»; con los 18 servicios y su señal de vida
  (del 2026-11-05 al 12), 15 de alerta: las ráfagas de legacy-application, los errores nuevos de customer-service y
  messaging-service tras sus despliegues del 9 y 10, y los dos servicios que se callaron. `-notify-test` manda uno de prueba.

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
- **Lo que se sigue y es chico mira más tiempo** (`followedWindows`: 180, 360 y 1440 min): si en una hora lo normal no llega a
  `minMedian`, se usa la primera ventana más larga en la que sí, y la interfaz lo dice («últimas 3 horas»). Pullman
  (~2,5 por hora) quedaba siempre en «poco volumen» y no podía alertar; con 3 horas se compara (lo normal 4,5 a media
  mañana). La de 24 horas MÓVILES es para lo muy chico: Credifamilia entra ~9 por día y en 6 horas lo normal es 2. Ojo:
  con tan poco, la dispersión es ancha (casi siempre entre 1 y 14 por día) y ni un día en cero llega a alerta; ahí sirve
  la curva, no el aviso. Sólo para el volumen de lo que se sigue: lo demás sigue en una hora y su backtest no cambia.
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
| lo que se sigue (y de qué comercios avisa) | `server/following.go` |
| las pantallas del wizard (PostHog) | `server/steps.go` |
| los servicios en producción: versión y tarjetas | `server/services.go` |
| el LaunchAgent (de fondo) | `server/agent.go` |
| los despliegues a producción | `go run ./tablero/server/cmd/deploys -json` (lo mismo que `make deploys`) |
| la interfaz: el semáforo, la curva y las alertas | `src/App.vue`, con la base de `tools/ui` (`make estilo-sync`) |

## Lo que falta

Los errores de pantalla que vio el cliente (PostHog), por pantalla. Avisar por otro canal (Slack, el chat del equipo)
si los avisos de macOS no alcanzan. Las decisiones
abiertas (qué vigilar, qué tan sensible, por dónde avisar) están en el frente de #96.
