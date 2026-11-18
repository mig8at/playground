# sentinel — el vigía de producción

**Para qué existe:** saber pronto si algo que subió a producción está rompiendo la originación. Guarda cuatro semanas de
producción (sólo lectura: Redash y Loki) en bloques de 5 minutos y dice, por **entidad**, por **comercio**, por
**servicio** (errores de los logs) y para la **cola** (trabajos fallidos), si la última hora se salió de lo normal;
muestra la curva del día contra lo normal, con los **despliegues a producción** marcados. Es el frente «vigía de
producción» de `my-tools` (#96, antes `playground-local`; desde el 2026-11-13 dentro de `miguel`); su historia sigue en la tarea `sentinel`.

`make sentinel` (UI :5210 · API :5211) o la app Sentinel de Cockpit. En la vista de toda la originación, debajo de la
curva, **la línea del día** (`GET /api/day`, lo mismo que `bin/sentinel day`, con 10 min de caché): cada tramo que se
salió de lo normal hoy, los despliegues y los avisos. **La interfaz**: a la izquierda, toda la
originación y lo que se SIGUE, en dos secciones —entidades y comercios—, que se agregan a mano desde el buscador, cada
uno con su curva chica de hoy; al centro, el elegido; abajo, en la consola, la tabla de TODAS las señales (pestañas Errores · Entidades ·
Comercios, ordenable, con + para seguir); a la derecha, lo que pide atención, **una tarjeta por servicio en
producción** (su versión, sus errores y su señal de vida), los avisos y los despliegues.

`make sentinel ONCE=1` carga lo que falte, hace una pasada y la resume por consola. `go run ./sentinel/server -backtest 7` dice cuántas veces habrían sonado las reglas
en los últimos 7 días, con la lista de alertas: **es la vara antes de cambiar una regla**. Lee lo guardado (sin pasada:
~30 s para 650 señales, en paralelo; antes pasaba de 10 minutos porque leía producción primero); `-fresh` hace la
pasada antes y `-signals 'service:*,logs:*'` lo acota a lo que se está tocando.

## La consola: `bin/sentinel` (o `make sentinel-now|day|signal|deploy`)

Lee lo guardado en `sentinel/.data` y vuelve a evaluar con las reglas de hoy: **no necesita la API arriba** (si lo
guardado está viejo, lo dice primero). Todos aceptan `--json` para un agente. Es lo del día a día y lo que se le pasa a
un agente para que resuma.

| comando | contesta |
|---|---|
| `bin/sentinel now` | cómo está producción ahora: lo que pide atención, lo que se sigue y cada servicio con su versión |
| `bin/sentinel day [AAAA-MM-DD]` | el día: cuánto entró contra lo normal, qué se salió de lo normal y de qué hora a qué hora (con el porqué de su peor momento), los despliegues y los avisos |
| `bin/sentinel signal <señal\|nombre>` | una señal hora por hora, hoy contra lo normal; de una entidad, también sus errores en los logs |
| `bin/sentinel ack <señal> [--undo]` | reconoce un episodio («ya lo sé»): pasa de «Pide atención» a «Conocidos» hasta que se cierra o EMPEORA. Va por la API (`POST/DELETE /api/ack`), porque el avisador vive ahí; en la interfaz, «Reconocer» y «Devolver» |
| `bin/sentinel cases <señal> [--hours N]` · `bin/sentinel rules <entidad> [--hours N]` | solicitudes de ejemplo de la señal (con su enlace a tracer) · qué regla dura rechaza a la entidad, ahora contra antes (§«De la señal al caso»). Leen producción, no lo guardado |
| `bin/sentinel verdict [--make]` · `bin/sentinel why <señal>` | el dictamen de la mañana (el último guardado; `--make` arma el de hoy ya, ~30 s) · el porqué de una señal ahora, como hipótesis, sin guardar ni avisar (§«El dictamen y el porqué») |
| `bin/sentinel schema` | **la deriva de esquema**: lo que producción tiene y la base de dev/qa/staging ya NO (columnas renombradas o borradas por una migración que corrió en dev: lo que un servicio desplegado puede estar leyendo, como el `countries.cell_phone_lenght` del 18/11/2026), los cambios de tipo y las migraciones de dev que producción no corrió, con las que por el nombre renombran o borran. Sin respaldos, temporales ni vistas `VW_`. ~5 s, sólo lectura (`server/schema.go`) |
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
- **Cero líneas no es normal si todos los días comparables escribieron** (`stats.go`): alerta si el día más flojo llegó
  a `liveness.minMedian`, si no «para mirar», aunque z no llegue. Con 4 muestras de fin de semana la dispersión es tan
  ancha que el 14/11 dio «volvió a lo normal: escribió 0 líneas; lo normal es 798,5». Y un episodio de `logs:` no se
  cierra mientras el servicio escriba 0 líneas (`alerts.go`).
- **Errores: hace falta un mínimo** (`errors.minNow`, 10 por hora). Un servicio que casi nunca tiene errores daba alerta
  con 5.
- **Errores por entidad** (`lerr:<id>`): los errores en los logs que nombran a una entidad. Sólo dos fuentes la nombran:
  preapprovals-service, como metadato `lender_name` (el `slug` de `lenders`, con guion bajo: «creditop_x» es
  `creditop-x`), y legacy-backend, en el JSON de la línea (`context.lender_id`). En 7 días (medido el 2026-11-12), ~1.000
  y ~1.800 errores con entidad, de unos 35.000. No hay errores por comercio: casi ninguna línea lo nombra (90 en 7
  días). En la vista de una entidad van debajo de sus solicitudes, con su curva; en el sidebar, un «N err».
- **`logsVersion`** (`fetch.go`): cuando cambia lo que se lee de Loki, los días guardados con la versión anterior se
  vuelven a pedir (sólo Loki). El paso de 2 a 18 servicios recargó 29 días en ~11 minutos, una vez.

## Los proveedores externos (`server/outbound.go`)

Cada llamada de legacy-backend hacia afuera (Experian, Nequi, Mareigua, Netco, las entidades y los servicios internos)
queda en producción como una línea «Llamada saliente» con `context["saliente.proveedor"]` y
`context["saliente.desenlace"]` (ok · rechazo · error_del_proveedor · sin_conexion · limite_de_tasa): ~27.000 por día,
de ~50 proveedores (medido el 2026-11-18). Señal `out:<proveedor>`: Total, las llamadas; Denied, las que fallaron POR
EL PROVEEDOR (error, sin conexión, límite de tasa). «rechazo» (un 4xx) no es falla: pre_approvals rechaza ~300 por día.
Se evalúa la **tasa de falla** contra la de siempre a esa hora, con prueba binomial como las pantallas (alerta: z ≥ 4,5,
≥ 10 fallas y el doble de lo normal), con 20 llamadas como mínimo; uno chico mira 3, 6 o 24 horas. Es lo que habría
visto el 404 de Netco del 17/11 (en dev). Pestaña «Proveedores» en la tabla. `logsVersion` 4 recargó su historia.

## El rechazo de CreditopX y los cambios de política (`server/reject.go`)

Lo que las solicitudes no muestran: que una política o el perfilador empiecen a rechazar más con el MISMO tráfico. Sale
de `profiling_reviews.displayed_lenders` (lo que vio el cliente en cada perfilamiento, cada entidad con su `probability`),
sólo de las entidades CreditopX (`lenders.response_type` 2 y 3): el embudo de CreditopX de forecast (el panel comercial
del repo compartido), llevado a una señal. Señales `reject:<entidad>` y `reject:all`: Total, las ofertas; Approved, las
no rechazadas; Denied, las rechazadas. ⚠ Son perfilamientos, no personas.

Se evalúa la **tasa de rechazo** contra la de siempre a esa hora (binomial, como los proveedores): con 30 ofertas como
mínimo (una entidad chica mira 3, 6 o 24 horas), «para mirar» si sube 5 puntos y ×1,25; **alerta** si sube 10 puntos y
×1,5 con al menos **100 ofertas** en la ventana. Backtest del 11 al 18/11/2026: con 30 ofertas como piso de la alerta
daba 11, casi todas de madrugada con 34 a 46 ofertas; con 100, 4 (Refurbicredit sostenido en 24 % contra 12 % y CreditopX
entero dos veces). Cuesta ~1 s por día en Redash: va en cada pasada (las últimas horas) y completa la historia con
`rejectVersion` (`Day.Rej`). Si falla, la pasada sigue sin él y lo dice (`rejectNote`).

**Los cambios de política** (`lender_rules_snapshots`: cada versión de las reglas de una entidad, con su hora; sin el
contenido, que pesa cientos de KB) se leen cada 30 minutos, como los despliegues, y se marcan igual: en la curva de la
entidad y del rechazo, en la línea del día y en `bin/sentinel day`. El porqué de una señal de rechazo nombra el cambio de
política de su entidad de las 24 horas anteriores («cambió la política de X (versión 6) el 13/11 a las 13:38»). Pestaña
«Rechazo» en la tabla; el detalle de una entidad muestra su rechazo.

Medido al crearlo (2026-11-18): el rechazo de CreditopX venía en 14–16 % a comienzos de noviembre y pasó a 20–25 % desde
el 13, en varias entidades a la vez (Credi ASYCO, Dentix, Crédito Directo X LB, Credi Free, Refurbicredit); sólo Crédito
Directo X LB tuvo un cambio de política ese día.

## El embudo del backend (`server/funnel.go`)

Que entren igual y se queden en una etapa: el volumen no lo ve y las pantallas de PostHog sólo ven lo que el cliente
envía. Son las etapas de tracer (la herramienta del repo compartido que sigue UNA solicitud), sumadas para todas y sólo
con su parte de la base; el porqué de cada una sigue en tracer, por solicitud. Dos conversiones, contadas por la hora del
EVENTO (así lo de hoy no está «todavía avanzando»):

- `funnel:profiled`: de las que entraron, cuántas se perfilaron (`profiling_reviews`). Lo normal, 83–90 % por hora.
- `funnel:selected`: de las perfiladas, cuántas eligieron entidad (`user_request_records` con el estado 3). 35–45 %.

En lo guardado, como las pantallas: Approved es la etapa de antes y Total, las que llegaron. Se evalúa como la
conversión de una pantalla (binomial: alerta con z ≤ −4,5 y ≤ 60 % de lo normal; para mirar con z ≤ −3 y ≤ 75 %), con
30 solicitudes como mínimo. Sale de la misma lectura que el rechazo de CreditopX (`profilingReads`, `rejectVersion` 3),
~1 s por día. Pestaña «Embudo» en la tabla y una tabla debajo de la curva en la vista de toda la originación.

- ⚠ **Cuenta la primera vez de cada solicitud.** Contando todas, una solicitud que se vuelve a perfilar contaba dos
  veces, muchas horas tenían más perfiladas que entradas, lo normal daba 100 % y la semana del 11 al 17/11/2026 sumaba
  13 «para mirar» y una alerta; con la primera vez, 4 «para mirar» y ninguna alerta (`-backtest 7`).
- **El buró no entra**, medido el 18/11/2026: `risk_central_user_data` no tiene filas del 10 al 12/11 (sí de antes y
  de después) y tiene fechas de 2027; `user_request_risk_central_user_data` daba 0 por día y 536.266 el 18 (un relleno).
  Ninguna dice cuándo se consultó.
- **La autorización (11) y el desembolso tampoco**: pasan horas o días después de la elección; en una hora no hay con
  qué compararlas.

## La plata en juego (`server/stake.go`)

Cuánto pesa en lo desembolsado lo que pide atención: lo desembolsado de los últimos 28 días por entidad y por comercio
(por `disbursed_at`, `COALESCE(final_amount, amount)` como forecast), sólo comercios de Colombia (pesos; Perú fueron 21
desembolsos que suman 0). Se lee cada 30 minutos y queda en `sentinel/.data/stakes.json` para la consola. Ordena «Pide
atención» (a igual estado, primero lo que más plata mueve; antes, por volumen) en la interfaz y en `bin/sentinel now`;
el porqué de lo que está fuera de lo normal lo nombra («mueve 27 % de lo desembolsado (~$133,5 millones por día)») y el
detalle de una entidad o un comercio lo dice siempre. Lo de todo el flujo (toda la originación, el embudo, el rechazo de
todas) pesa todo; un servicio, nada que se pueda decir. Medido el 18/11/2026: $13.775 millones en 4.948 desembolsos;
Addi 27 % y Welli 26 %.

**Es lo desembolsado, no el revenue.** El revenue lo calcula forecast (SaaS + la comisión de cada pareja comercio–entidad
sobre lo que pase de su base mínima + la tasa general del comercio, `revenue.js`), pero sus tasas viven en la base
PROPIA de forecast (`lender_rates`, `merchant_config`, cargadas a mano), no en producción, y Sentinel no tiene
credenciales para leerla. Copiar las de octubre (`seeds/tarifas-*.sql`) sería un índice que envejece sin avisar. Para
ordenar alcanza con lo desembolsado; pasar a revenue pide leer esa base.

## El dictamen y el porqué de una alerta (`server/verdict.go`)

Lo que hacía Noctowl en Wally cuando se lo pedían, ahora solo, con el modelo de segundo plano (`lib/background`: Claude
por defecto, el elegido en Cockpit). El modelo no corre nada: recibe las salidas y contesta.

- **El dictamen**: de lunes a viernes, en la primera pasada desde las 7:30 (`maybeVerdict`, dentro de la API de fondo:
  no hace falta otro agendado), 🟢/🟡/🔴 con lo que hay que mirar ya, lo de echarle ojo, el ruido conocido y los
  despliegues. Lee lo mismo que `bin/sentinel now` y `bin/sentinel day` de ayer y de hoy. Queda en
  `.data/verdicts/<día>.md`, arriba de «Para mirar» en la interfaz (la primera línea a la vista, el resto plegado), y
  con un aviso (con sonido si es 🔴). Un intento fallido se reintenta a los 30 min.
- **El porqué de una alerta**: cuando una señal pasa a alerta y se avisa, una pregunta aparte con esa señal hora por
  hora, lo demás que está fuera de lo normal, el día (despliegues, cambios de política) y, si es de una entidad, qué
  regla dura rechaza (una consulta a producción, sólo lectura). Contesta en tres oraciones, como HIPÓTESIS; llega como
  un segundo aviso («Sentinel · por qué: …»), queda en el episodio (`alerts.json`) y se ve debajo de la alerta y en su
  detalle. Uno por episodio y como mucho 8 por día (`explainPerDay`). El backtest no explica nada.
- **Cómo leer Sentinel lo dicen las notas de Noctowl** (`wally/agents/noctowl.md`), que se leen en cada pregunta sin «Cómo
  trabajás»: un error de lectura se corrige en UN lugar para Wally, el dictamen y el porqué.
- **Medido el 2026-11-18**: el dictamen salió 🟡 en ~30 s (Credifamilia con 21 errores contra 0, el pico de OTP de la
  mañana, el rechazo de CreditopX); los números que cité, comprobados contra `bin/sentinel now` y `day`. La primera versión
  ocupaba 40 renglones: se le puso tope de 12. El porqué de `lerr:24` en ~17 s, bien razonado (otras entidades a la vez,
  sin despliegue ni política, reglas quietas), pero llamó «techo» a los conteos por hora (2 a 7) cuando el techo era 12:
  por eso va como hipótesis.

## Los errores que no estaban (`server/messages.go`)

Un conteo no ve una falla nueva de poco volumen (el «Unknown column 'cell_phone_lenght'» del form-service fueron 12 en
una hora). Por eso se lleva, por servicio, cada mensaje de error de producción —normalizado: sin números, ids, URLs ni
lo que va entre comillas largo o con números; un nombre de columna entre comillas se queda— con cuándo apareció por
primera vez (`sentinel/.data/messages.json`). La primera vez se siembra con los 7 días anteriores, de a una hora; hasta
que termina, nada es nuevo. Un mensaje que aparece después es `newmsg:<servicio>#<huella>` durante 6 horas: «para
mirar» desde 5 veces, alerta desde 10. Se olvida a los 14 días sin verse. El mensaje sale de `exception_message` (los
servicios en Go), del `message` del JSON (los monolitos) o de la línea. Tocar el aviso lleva a la vista del servicio.
⚠ La línea se recorta EN Loki al mensaje (`line_format`, 300 caracteres): las de legacy-backend traen la traza entera y
el conector corta las respuestas en 4 MB, así que la siembra fallaba en cada hora y la nota decía «aprendiendo» para
siempre; ahora la nota dice si falló. Medido el 18/11/2026: 187 mensajes distintos en 7 días (133 de legacy-backend), y
pasada la siembra 0 o 1 por día se repiten 10 veces; el 16/11 fueron 6, entre ellos un `Connection refused` contra la
base de producción (55 veces).

## De la señal al caso (`server/examples.go`)

Lo que hace tracer (la herramienta del repo compartido para seguir UNA solicitud) puesto al lado de cada señal, a pedido
(no en cada pasada: cada uno es una consulta):

- **Casos de ejemplo** (`GET /api/examples?signal=…&minutes=…`, `bin/sentinel cases <señal> [--hours N]`): hasta 8
  solicitudes de la ventana, con su enlace a tracer (`?ureq=N`, con la VPN de producción) y el mismo caso por consola
  (`bin/pg request timeline --target prod --ureq N`). De `reject:` salen los perfilamientos en que la entidad quedó
  «Rechazado»; de una entidad, un comercio o toda la originación, las solicitudes, negadas primero; de `lerr:` y
  `service:`, las líneas de error de Loki que traen `user_request_id`. Sólo números de solicitud: nada de cédula,
  teléfono ni nombre.
- **Qué regla rechaza** (`GET /api/rules?lender=N&hours=24`, `bin/sentinel rules <entidad> [--hours N]`): de
  `profiling_reviews.hard_rules`, en cuántos perfilamientos falló cada regla dura de la entidad, ahora contra los 7 días
  anteriores, de la que más subió a la que menos. Las reglas se copian a cada sucursal con otro id: se agrupan por lo que
  dicen. ⚠ El perfilador de varias entidades CreditopX no deja la regla por regla: ahí viene vacío. Medido el 18/11/2026
  con 120 h: en CrediPullman «ingresos mensuales» pasó de 2,4 % a 10,3 % y «ocupación» de 1,7 % a 6,9 %.

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
  my-tools»); si el avisador falla (sin permiso de avisos), por osascript, que avisa pero no abre nada al tocarlo, y el
  aviso guarda por dónde salió (`via`).
- **Un aviso que no sale no se pierde** (`Pending` en `alerts.json`): cada pasada los reintenta en UNO solo («3 avisos
  no salieron desde…»). Mientras esperan, lo dicen `bin/sentinel now`, `make sentinel-status` y una franja roja en
  «Para mirar»; en la lista de avisos, los que no salieron llevan «no salió». `-notify-test` sale 2 si llegó por el
  respaldo y 1 si no llegó. Del 14 al 18/11/2026 Sentinel estuvo mudo: macOS le quitó el permiso al avisador y 7
  alertas quedaron sólo en `notices.jsonl`. «Volvió a lo normal» no se guarda: atrasado no sirve.
- **Uno por episodio.** El episodio sigue abierto hasta que la señal pasa `clearMinutes` (30) en lo normal: una que va y
  viene entre alerta y «para mirar» no avisa cada 5 minutos. Avisa otra vez sólo si empeora. Al cerrarse, «volvió a lo
  normal», sin sonido.
- **Si no puede leer producción 30 min** (la VPN caída), avisa una vez «Sentinel no está mirando», y otra cuando vuelve.
- **El hueco se mide por reloj** (`gapSince`, en `main.go`): si lo guardado llegaba hasta hace más de `staleMinutes`
  (el Mac dormido, la API apagada: no hay pasadas que fallen), la primera pasada al volver repasa el tramo ya relleno
  (hasta 72 h) y manda UN aviso: «No miró 2 días, de … a …. En ese tramo pasaron a alerta 2: …», con sonido sólo si hubo
  alertas. Queda en `gaps.jsonl` y la curva de hoy sombrea el tramo. Del 14 al 17/11/2026 no miró 64 h sin decirlo.
- **El porqué nombra el despliegue** que lo volvió más sensible («· más sensible tras el despliegue de legacy-backend
  v0.6.53 a las 17:02»), y «volvió a lo normal» lo corta.
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

- **Lo normal es la misma hora en los días comparables**: hábiles con hábiles, y los de descanso —fines de semana y
  **festivos de Colombia** (`days_off.go`: los fijos, los de la Ley Emiliani trasladados al lunes y los de la Pascua,
  calculados por año)— entre sí. Antes un festivo se comparaba con hábiles y parecía una caída de todo el día: el lunes
  16/11/2026 dio 739 solicitudes contra 1.341 y 39 tramos fuera de lo normal; ahora, contra 754 y 30 tramos,
  de los últimos 14 días (`baselineDays`). De ahí, la mediana y la dispersión robusta (MAD × 1,4826, con piso de
  Poisson `√mediana`), y un z = (ahora − mediana) / dispersión.
- **Volumen (solicitudes): lo malo es que CAIGA.** Para mirar con z ≤ −2,5; alerta con z ≤ −3,5; las dos además con
  ahora ≤ 0,6 × lo normal. Con lo normal por debajo de 3, «poco volumen»: no avisa.
- **Errores (logs y cola): lo malo es que SUBAN.** z ≥ 3 / 4,5 y ahora ≥ 1,5 × lo normal, **y además** por encima del
  **techo**: el percentil 99 de TODAS las horas de los días comparables (para alerta, el doble). Los errores llegan en
  ráfagas a cualquier hora; sin el techo, la última semana daba 37 alertas (28 de legacy-application), con él 3.
- **Errores dos horas seguidas sobre un normal en ~0**: «para mirar» aunque el techo los deje pasar (no avisa por
  defecto). El techo se quedó como está a propósito: calcularlo por día típico (la mediana, o el percentil 70 entre
  días) para que una ráfaga de un día no lo suba para todos daba 20 a 36 avisos por semana contra 7, porque
  messaging-service tiene ráfagas casi todos los días desde el 9/11/2026 (medido el 18/11 con `-backtest 7`).
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
| los proveedores externos (`out:`) | `server/outbound.go` |
| los errores que no estaban (`newmsg:`) | `server/messages.go` |
| casos de ejemplo y qué regla rechaza | `server/examples.go` |
| el embudo del backend (`funnel:`) | `server/funnel.go` |
| el dictamen de la mañana y el porqué de una alerta | `server/verdict.go` |
| la plata en juego (lo desembolsado por entidad y comercio) | `server/stake.go` |
| los servicios en producción: versión y tarjetas | `server/services.go` |
| el LaunchAgent (de fondo) | `server/agent.go` |
| los despliegues a producción | `go run ./tablero/server/cmd/deploys -json` (lo mismo que `make deploys`) |
| la interfaz: el semáforo, la curva y las alertas | `src/App.vue`, con la base de `tools/ui` (`make style-sync`) |

## Lo que falta

Los errores de pantalla que vio el cliente (PostHog), por pantalla. Avisar por otro canal (Slack, el chat del equipo)
si los avisos de macOS no alcanzan. Las decisiones
abiertas (qué vigilar, qué tan sensible, por dónde avisar) están en el frente de #96.
