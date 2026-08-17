# trazador

**¿Hasta dónde llegó una solicitud y por qué se rompió?** La herramienta de SOPORTE: se le da una cédula,
un teléfono o un número de solicitud y contesta con el flujo por etapas, al estilo de un run de CI.
No escribe nada en ningún ambiente: solo `SELECT` y `GET`.

```bash
npm run dev     # Vue en :5192 + server Go en :5199
```

## Cómo está armado

```
trazador/
  src/            Vue 3 + Pinia — SOLO pinta; no decide nada del negocio
  server/         Go: la API (:5199), el ensamblado y los modos de consola
    mapa/         el flujo declarado como DATO (etapas · sub-pasos · ramales)
  .env.<target>   local · dev · staging · prod   (gitignoreados)
```

**La regla que ordena todo:** el ensamblado vive en Go, en un solo lugar (`ArmarTraza`), y la consola, el
HTML y la Vue **renderizan el mismo `Traza`**. Si la Vue calculara estados habría dos definiciones de «esta
etapa falló» y en el primer cambio se contradirían.

## Los modos de consola

| | |
|---|---|
| `go run . -serve 127.0.0.1:5199` | la API que consume la Vue |
| `go run . -buscar <cédula\|teléfono\|uReq>` | la **historia de la persona**, no sólo lo que coincidió |
| `go run . -ureq <n> [-html f.html] [-json]` | la traza por etapas |
| `go run . -validar <corpus>` | audita el mapa: solapes, patrones mudos, decisiones que no resuelven |
| `go run . -slack <días>` | lee #tech-ops y clasifica los reportes (**solo lectura**) |
| `go run . -posthog [-ureq <n>]` | **qué VIO el cliente en el navegador** — sonda de acceso + censo; con `-ureq`, su timeline |
| `go run .` | la sonda de acceso: ¿puedo leer los logs de este ambiente? |

Todos aceptan `-target local|dev|staging|prod`.

### Buscar devuelve la persona, no la coincidencia

Se prueban los **tres** campos (`ur.id`, `cell_phone`, `document_number`) y se dice cuál coincidió —
adivinar por la forma del número muestra la solicitud de otra persona con total seguridad. Después se
**expande por `user_id`**: un número de solicitud sacado de Jira abre la historia completa del cliente sin
buscar de nuevo, que era el paso manual de todos los días. Por `user_id` y no por documento a propósito: el
documento se corrige en el camino (F-97, la cédula transpuesta) y buscar por el valor final se comería los
intentos hechos con el equivocado.

Lo que trajo la búsqueda literal va marcado (`◂`); el resto es contexto. El resumen —cuántas aprobadas /
rotas / abandonadas, en qué rango de fechas, cuántas el mismo día, cuántos comercios— sale de Go
(`armarHistoria`) y no de la vista, porque «roto» es una definición de negocio y ya hubo dos que no
coincidían: `ArmarTraza` contemplaba `abandonado` y el buscador de la API no, así que la misma solicitud
salía «en curso» en la lista y «abandonado» al abrirla. Hoy las dos llaman a `desenlaceDe`.

Señales que cambian el diagnóstico y por eso se dicen en texto: **N intentos el mismo día** (reintento, no
cliente indeciso), **⚠ recortado en 40** (un «12 solicitudes» que en realidad son 228 cambia «reintentó» por
«algo reintenta solo») y **⚠ N clientes distintos** (el valor es ambiguo: mirá bien cuál buscabas).

## Y QUÉ VIO EL CLIENTE en el navegador

Al lado del código, la otra mitad: los eventos de PostHog de esa solicitud, en orden.

       17:32:06  registration_form_viewed
       17:32:56  expedition_date_screen_viewed
       17:34:06  registration_field_error
       17:34:06  identity_validation_error
       17:43:36  expedition_date_identity_rejected
       17:48:46  results_screen_viewed

Contesta lo que el backend no puede: *«el backend dice que llegó a firmar — ¿el cliente llegó a ver
esa pantalla?»*.

⚠ **Sin `-tel` se ve la mitad.** Medido sobre 7 días: `phone_<e164>` identifica 47.792 eventos y
`loan_request_<n>` sólo 24.006 — la fase de AUTH ocurre **antes de que exista la solicitud** y PostHog
no une las dos identidades solo. Un recorrido que empieza en «monto» no es que el cliente entrara por
ahí: es que no le pasamos el teléfono.

⚠ Y **no todas las solicitudes tienen eventos**: esta fuente cubre el **wizard**, no el flujo clásico
de `legacy-application`. Cuando no hay, la sección no aparece — no es que el cliente no viera nada.

⚠ **No hizo falta un mapa evento→archivo.** Se evaluó: los 141 eventos del wizard se emiten desde ~6
rutas, y 2 de los 3 lugares donde aparece cada nombre son declaraciones (la taxonomía y el tipo TS).
Un mapa así contestaría siempre «una de estas seis». El backend justifica el suyo porque son miles de
archivos; el front no es un pajar.

## Y el CÓDIGO que dejó rastro

Al final de la traza, qué archivos emitieron esas líneas — en orden de primera aparición y con las
líneas exactas. Es la pregunta que sigue a «¿por qué se rompió?», y hasta ahora obligaba a copiar el
mensaje a otra herramienta:

       6×  …/RegisterCellPhoneController.php  :43,57,48,73,69,63
      15×  …/RegisterCellPhoneService.php     :72,83,67,87,121,125,94,221
       9×  …/OtpService.php                   :376,364,358,392,415,438,488,499

⚠ **El mapa lo construye Python, no esto.** `workers/logs.py` lee los 12 repos y arma
`workers/logs.json`; acá sólo se consume (`archivos.go`). Es a propósito: tener la misma tabla en dos
lenguajes ya costó dos veces en este playground, y una divergencia acá no fallaría — **atribuiría
líneas al archivo equivocado**, que es peor. Lo único reimplementado es la búsqueda, y hay una prueba
que compara Go contra Python sobre mensajes reales: `go test ./... -run Mapa`.

Si el mapa no está construido (`workers/cli.py logs --construir`), la sección **no aparece** en vez de
mostrar cero — un «0 archivos» se leería como «no corrió ninguno».

⚠ Y dice qué archivos **dejaron rastro**, no cuáles se ejecutaron. Lo que no loguea es invisible acá:
la misma regla que rige toda esta herramienta.

## De dónde salen los datos

**La BD dice QUÉ pasó, los logs dicen POR QUÉ.** Un estado ocurrió o no, y eso se puede afirmar; un log
ausente tiene cuatro causas indistinguibles (no se logueó · el level lo filtró · el batch no hizo flush ·
lag de ingesta), así que los logs **explican** pero nunca dictaminan.

| target | esqueleto | logs |
|---|---|---|
| `local` | MySQL en Docker | Loki local (`harness/bin/loki-local`) |
| `dev` · `staging` | MySQL dev (compartida) | `creditopdev` |
| `prod` | **Redash** (`execute_query`, asíncrono y **auditado a nombre del token**) | `creditop` |

⚠ Redash vive detrás de un **ELB interno**: sin VPN el síntoma es un *timeout*, no un 401.

### La tercera fuente: PostHog dice qué VIO el cliente

La BD y los logs comparten un punto ciego: **el navegador**. Un «abandonado» tapa cuatro historias que
desde la BD se leen igual —el cliente se fue · el front reventó antes de llegar al backend · nunca vio la
pantalla · la vio y no lo dejó avanzar— y son cuatro conversaciones distintas con el cliente que llama.

El wizard ya instrumenta eso en PostHog, y el empalme **no es heurística**: identifica con
`distinct_id = loan_request_<user_request_id>` y manda `loan_request_id` como propiedad canónica de todo
evento (unificando seis alias) — `analytics-taxonomy.ts` en `frontend-monorepo`. El trazador ya tiene el
`ureq`, así que el join es exacto. Encima el vocabulario es **cerrado** (≈100 nombres de evento en un
`z.enum`, 13 `known_exception_reason`), igual que `mapa/etapas.json`: se puede mapear, no adivinar.

Lo que aporta que hoy no existe: `screen_viewed` (la última pantalla que **vio**, contra el último estado
que llegó a la BD — la diferencia entre las dos es el diagnóstico), `known_exception_captured` con su
`known_exception_reason` (`otp_invalid`, `no_offers`, `session_expired`…) y el `$session_id`, que los
eventos de servidor también llevan (`withPostHogSession`) — o sea, el **link a la grabación** si el
proyecto tiene replay prendido.

⚠ **Cobertura, y va en pantalla:** solo el **wizard nuevo** (`app_name = loan-request-wizard`). Una
solicitud del flujo clásico de `legacy-application` no aparece, y **«sin eventos» no es «el cliente no
hizo nada»** — el modo imprime las cuatro causas indistinguibles en vez de dejar creer la fácil.

El token es de **lectura** (Personal API key `phx_`, scope `query:read`) y este archivo solo consulta: el
trazador **no se instrumenta a sí mismo**. Renderiza cédulas y teléfonos de producción, y mandar eso a un
SaaS es justo lo que no queremos — ver `.env.prod.example`.

```bash
go run . -posthog                 # ¿tengo acceso? + censo por ambiente / app / canal / evento
go run . -posthog -ureq 519245    # el timeline del navegador de esa solicitud + link a la grabación
```

El **censo se mira antes** de creerle a un timeline vacío: dice si el proyecto es uno por ambiente o uno
solo, y cuántos eventos traen `loan_request_id`. Por eso `POSTHOG_ENV` arranca vacío — filtrar antes de
mirar puede esconder todo y leerse como «no hay datos».

## La sonda de acceso (el modo original)

"¿Ya tengo acceso?" no se contesta con un 200. Un token de Grafana Cloud puede autenticar perfecto y no
servir para nada: si la access policy quedó en el realm equivocado, `/labels` devuelve **200 con la lista
vacía** y `query_range` devuelve **cero streams**. Desde afuera los dos casos se leen igual —"no hay
logs"— y son problemas distintos: uno se **pide**, el otro se arregla **mirando otra ventana de tiempo**.
La sonda separa las preguntas y dice en cuál se cayó:

| | |
|---|---|
| 1 | ¿el token es válido y qué permisos trae? — `grafana.com/api`, **sin** necesitar URL ni ID |
| 2 | ¿autentica contra Loki? — `GET /loki/api/v1/labels` |
| 3 | ¿aparecen las etiquetas de CreditOp? — `GET /loki/api/v1/label/<x>/values` |
| 4 | ¿puedo leer líneas de verdad? — `GET /loki/api/v1/query_range` |

El paso 1 es el que más rinde y el que nadie hace: los scopes del token se averiguan **antes** de tener
la URL. Se pide un endpoint que exige `accesspolicies:read` y, si el token no lo tiene, el 401 llega con
la lista de lo que **sí** tiene (`received [logs:read]`). Un error que trae adentro el dato que buscabas.
Eso separa de entrada *"el token está mal emitido"* de *"el token está bien y me falta un dato de
conexión"* — que es la diferencia entre volver a molestar a quien lo emitió o pedirle una sola cosa.

## Configuración

**Un archivo por STACK, no por rama** — el nombre del target dice a qué Grafana le hablás:

| target | stack | `User` | estado |
|---|---|---|---|
| `prod` (default) | `creditop.grafana.net` | `1339721` | ✅ confirmado 2026-08-04 |
| `dev` | `creditopdev.grafana.net` | `1339770` | ✅ confirmado 2026-08-04 |

**Misma URL (`logs-prod-036`) y mismo token para los dos** — los dos stacks viven en la misma región. Lo
único que cambia es el `User`, que es **por stack**. Y `creditopdev` sirve **dev y qa a la vez**: ver abajo.

Copiá `.env.prod.example` al target que necesites (gitignoreado) y completá. **Lo único obligatorio es el
token**: la URL se deduce de la región que el token trae codificada adentro, y cuando la sonda acierta
imprime la línea exacta para pegar. Cada archivo es **autosuficiente**: no hay capa compartida (el
`playground/.env` donde vivía el token se eliminó el 2026-08-04 y su contenido pasó a `sonda/.env.prod`).
Se aceptan además los nombres `GRAFANA_LOKI_*` que usa legacy-backend, para pegar las variables del deploy
tal como están.

```bash
go run .                                  # el chequeo completo contra prod
go run . -target dev                      # contra creditopdev, cuando exista .env.dev
go run . -query '{service_name="legacy-backend"}'   # forzar un selector en vez de descubrirlo
go run . -since 24h -limit 50             # ventana y cantidad
```

## Qué etiquetas busca

Las que **de verdad** escribe el backend, no las que uno supondría. Según
`legacy-backend/config/grafana.php` y `app/Logging/LokiHandler.php`:

- `app` — `GRAFANA_TEMPO_SERVICE_NAME`, default `creditop-api`
- `environment` — `APP_ENV`
- `level`, `channel`, y opcionalmente `lender`, `provider`, `trace_id`, `span_id`

La línea es un JSON `{message, context, extra}`; la sonda saca `message` para que se lea. Si no encuentra
ninguna etiqueta con pinta de CreditOp, cae a la primera de baja cardinalidad para al menos probar que la
lectura funciona.

## Tres trampas que esta sonda ya pagó

Están acá porque cada una cuesta media hora la primera vez, y las tres **mienten sobre su causa**:

1. **Un Bearer pelado nunca funciona contra Grafana Cloud Loki.** Devuelve `legacy auth cannot be
   upgraded because the host is not found`, que suena a URL equivocada — y no lo es: el mensaje es
   **idéntico en los 25 hosts reales** de Loki. Es el gateway pidiendo el par `<ID de instancia>:<token>`.
   Con basic-auth el error cambia a `invalid authentication credentials`, o sea que ahí sí parseó el par.
   **Esa diferencia de mensajes es el diagnóstico**, y es lo que separa "token inválido" de "falta el ID".
2. **`*.grafana.net` tiene un CNAME comodín.** Un hostname inventado resuelve igual que uno real y
   después devuelve `530 / error 1016`, que se lee como "Grafana está caída". Los hosts reales tienen
   registro A propio; los falsos heredan el comodín. Por eso el DNS se chequea **antes** de pegarle.
3. **La región del token no es el hostname.** `prod-us-east-0` es una región *legacy* y su Loki es
   `logs-prod3.grafana.net` — no `logs-prod-us-east-0`, no `logs-prod-006`.

## Estado: acceso CONFIRMADO (2026-08-04)

Lectura verificada corriendo: 200, etiquetas resueltas y líneas devueltas.

```
LOKI_URL=https://logs-prod-036.grafana.net
LOKI_USER=1339721
```

El token es el `glc_` de la access policy `custom-tool-logs-reader` (org `1493278`, región
`prod-us-east-0`), y vive en `playground/.env` como `LOKY`. El UUID que también llegó por Slack
(`4e043b4f-…`) **no sirve para nada**: grafana.com no lo reconoce como token y como `X-Scope-OrgID` se
ignora.

Dos cosas que se descartaron **midiendo**, no opinando:

- **No era la VPN.** Con el túnel activo (`utun4`, salida `3.151.190.239`) el error era idéntico. El
  fallo estaba en la capa de autenticación, no en la red — un bloqueo por IP allowlist da 403 con otro
  mensaje.
- **El host no era deducible.** `logs-prod-036` no se puede derivar de la región del token; hay que
  pedirlo. Barrer `logs-prod-0NN` tampoco alcanzó: el barrido llegó hasta 030.

### El ambiente es el STACK, y `creditopdev` trae cuatro

En `creditop` (prod) `environment` tiene **un único valor**: `production`. Los otros ambientes viven en
`creditopdev`, y ahí sí hay varios — medido en 30 días:

| `environment` | quién | sirve al target |
|---|---|---|
| `development` (+ `develop`) | `legacy-backend` y los 14 microservicios Go | **dev** |
| `qa` | **`legacy-backend-stg`** | **staging** |
| `local` | `CreditopDev` — una máquina de desarrollo empujando | (ver abajo) |
| `testing` | `CreditopDev` | — |

⚠ **Dev y staging comparten el stack Y la base de datos.** O sea que el mismo `user_request_id` tiene
líneas de las **dos ramas de código** (`legacy-backend` en `develop` y `legacy-backend-stg` en `qa`). Sin
filtrar por `environment` estás mirando dos ramas mezcladas — la misma trampa que ya costó corridas
creyendo que un feature estaba roto. Por eso `E2E_LOKI_ENV` en el harness **no es opcional**.

⚠ Ojo con `develop` vs `development`: `web-auth-service` usa la primera y el resto la segunda. Un filtro
exacto por `development` lo deja afuera; de ahí que el valor sea una alternativa de regex.

💡 **`local` existe**, lo cual quiere decir que el camino rápido del harness **sí se puede observar**: no
hace falta Loki en Docker, alcanza con poner `GRAFANA_LOKI_ENABLED=true` y estas credenciales en el `.env`
del legacy-backend local. Eso desmiente lo que parecía un callejón sin salida.

### Qué hay adentro

13 servicios en `service_name`: `legacy-backend`, `legacy-application`, `preapprovals-service`,
`form-service`, `onboarding-forms-service`, `pdf-mapper-service`, `merchant-api`,
`merchant-gateways-service`, `customer-profiling-service`, `financial-health-service`, `otp-service`,
`reportery-service`, `self-manager-api`.

Y las etiquetas que hacen esto útil para una tarea: **`lender`** (`bancolombia`, `bancolombia_bnpl`, `ado`,
`welli`, `deceval`, `device_locking`, `139`, `160`, `163`), **`provider`** (`netco`) y **`trace_id` /
`span_id`**, que permiten seguir una solicitud entera cruzando servicios:

```bash
go run . -query '{service_name="legacy-backend", lender="bancolombia"}' -since 6h
go run . -query '{trace_id="788912dc72ce8af65d6b2b2fa8a5ac1a"}' -since 24h
```

## Cómo consultar sin pisar las dos minas

Dos hallazgos medidos el 2026-08-04 que cambian cómo se escribe una query acá:

**1. Filtrá por `service_name`, no por `environment`.** Conviven dos convenciones de etiqueta y son
**excluyentes**, así que filtrar por una descarta la otra mitad de la flota **en silencio**:

| selector | qué devuelve |
|---|---|
| `{environment="production"}` | **solo 2**: `legacy-backend`, `legacy-application` (convención Laravel, `LokiHandler`) |
| `{deployment_environment="production"}` | **los 13** microservicios Go (convención OTel) |
| `{service_name="..."}` | **funciona para los 15** — es la única etiqueta universal |

**2. Nunca consultes el lado Laravel sin acotar.** `LokiHandler.php` promueve **`trace_id` y `span_id` a
etiquetas**, y en Loki cada valor distinto crea un stream nuevo: son 959 streams cada 15 minutos. Un
`{environment="production"}` a 30 días devolvió **14,5 MB de series y expiró** a los 45 s. Del lado Go no
pasa porque no ponen el trace en etiquetas.

O sea: agregá siempre `service_name` (y si podés `lender`) y una ventana corta. El `trace_id` sirve
perfecto como filtro **puntual** — `{trace_id="..."}` es barato y es la mejor forma de seguir una
solicitud cruzando servicios; lo caro es *enumerarlos*.

## El ambiente NO es una etiqueta, es el stack

`environment` y `deployment_environment` tienen **un solo valor** (`production`): filtrar por ellas no
discrimina nada. La separación de ambientes está a nivel de **stack** de Grafana Cloud, y hay dos —
`creditop.grafana.net` y **`creditopdev.grafana.net`** (verificado: los dos vivos, Grafana Enterprise
13.2.0, misma región). Cambiar de ambiente es apuntar la sonda a otro stack, no agregar un matcher.

Para sumar dev, lo barato es **agregar `creditopdev` a los Realms de la access policy que ya existe** (el
campo acepta varios) en vez de emitir un segundo token, y capturar su par `URL` + `User` en Details → Loki.
⚠ **El `User` es distinto por stack** aunque la URL puede repetirse — asumir que se reusa da
`invalid authentication credentials` y parece un token roto.
