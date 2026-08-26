---
id: 0
title: "Logs que describen el negocio, no sólo el paso"
stage: evaluation
created: "2026-08-25T17:00:00-05:00"
context_nodes: [architecture, trazador, onboarding, profiling]
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Hacer que los logs del flujo de originación digan **qué decidió el sistema y con qué datos**, para que
una traza se pueda leer sin abrir el código — y de paso funcione como documentación viva del negocio.

**No es «faltan logs».** `legacy-backend` ya emite **10.674 líneas/hora** en producción con `trace_id`
en el 94 %. Lo que falta es **contexto de negocio en las líneas que ya salen**, y logs **justo donde se
decide**, que es donde hoy hay silencio.

Lo que ya está relevado y **no hay que volver a investigar**: el inventario del tracer, el reparto de
logs en el camino listado→selección, las etiquetas reales de Loki en prod, la cardinalidad medida, y
por dónde se corta la traza entre servicios. Todo está abajo con su evidencia.

**El próximo paso es:** escribir la convención de campos (§«Cómo se ataca», paso 1) y validarla contra
`trazador/server/mapa/etapas.json`, porque los mensajes de log son API y cambiarlos rompe herramientas.

## Objetivo

Que estas tres preguntas se contesten **leyendo una traza**, sin abrir el código ni la base:

1. ¿De qué comercio, en qué país y por qué sucursal entró esta solicitud?
2. ¿Qué entidades se evaluaron, cuáles se descartaron y **por qué regla, con qué valor contra qué umbral**?
3. ¿Cuál eligió el cliente y cuándo?

Y que la respuesta a la 2 sirva además como **descripción del negocio**: quien lee el log entiende la
regla aunque no conozca el sistema.

## Dónde se toca

Todo en `legacy-backend`, salvo lo que se indique.

| | |
|---|---|
| `app/Otel/TracerService.php` | el tracer, singleton registrado en `GrafanaServiceProvider` |
| `app/Logging/LokiHandler.php` | el handler propio: **119/123** promueven `trace_id`/`span_id` a etiqueta; **126** tiene la allowlist `['lender','provider']` |
| `app/Http/Kernel.php` | donde va el middleware de contexto (**no** en el grupo `api`, ver Riesgos) |
| `Modules/Onboarding/App/Services/lenders/` | el camino: `LenderRetrievalService` (v1) · `LenderListingService` (v2) · `LenderValidationService` · `ProfilingRulesService` · `RiskCentralValidationService` · `LenderProbabilitySortingService` |
| `Modules/Onboarding/App/Services/UserRequestService.php` | la selección de entidad |
| `Modules/CommonsV1/App/Utils/TracingUtils.php` | el helper que envuelve al tracer |
| `playground/trazador/server/mapa/etapas.json` | ⚠ matchea logs **por texto** |
| `playground/workers/logs.json` | ⚠ ídem: mensaje → archivo:línea |

## Cómo se ataca

**1 · La convención, antes de tocar código.** Nombres de campo en `snake_case`, al **nivel raíz** del
JSON (no anidados bajo `context`): `formatEntry()` ya lo hace con `trace_id`, y si no se replica, PHP se
filtra con `| json | context_x` y los servicios Go con `| x` — dos convenciones para lo mismo. Definir
qué es **campo de request** (viaja en todas las líneas) y qué es **campo de línea**. Alinear con lo que
`preapprovals-service` ya emite.

**2 · El contexto común, en el kernel global.** Un helper `conContextoDeSolicitud($ureq, $fn)` sobre
`Log::shareContext()`, con `flushSharedContext()` en el `finally`. El middleware es **un llamador más**:
crones, jobs y observers no pasan por HTTP y necesitan el mismo contexto. Pasar por `PiiSanitizer`, que
ya existe y hoy sólo se usa en `OnboardingLogger`.

**3 · El país como etiqueta.** Es la única dimensión con cardinalidad de índice. Con valor `unknown`
explícito cuando no hay request: una etiqueta ausente hace que `{country_code="CO"}` descarte los crones
en silencio.

**4 · Los logs donde se decide.** Es el paso que cambia soporte, y el que hace la autodocumentación:

- la **selección**: hoy no existe. `UserRequestService` ya tiene `lenderName` y `countryId` en la mano.
- el **rechazo por regla**: emitir la regla, **el valor evaluado y el umbral**, en `info` (hoy el detalle
  vive en `$response_rules` y se guarda en `profiling_reviews.hard_rules`, pero no se loguea).
- `can_check_preapproval` con sus tres banderas.
- el filtro silencioso de `LenderListingService`.

**5 · Higiene del índice.** Sacar `span_id`; podar las etiquetas de un solo valor (`environment`,
`deployment_environment`, `channel`, `app`). ⚠ `trace_id` **no** se saca hasta migrar el trazador y el
harness, que hoy lo usan como etiqueta.

## Lo que se evaluó y NO se eligió

**Comercio y entidad como etiquetas de Loki.** Es lo primero que uno quiere y es lo que rompe el stack.
Medido: la base sana son **56 streams** (14 servicios × 4 niveles); con comercio y entidad como etiquetas
serían **32.648** contra la configuración viva, **16.296** contra el tráfico real de 30 días, y
**346.920** si la granularidad fuera la sucursal. Van en el **cuerpo estructurado**, donde se filtran con
`| json | allied_id="24"`.

**Reusar la etiqueta `lender` que ya existe.** Está declarada en la allowlist de `LokiHandler:126` y en
24 horas la usaron **3 líneas**. Reusarla es adoptar el antipatrón con nombre propio.

**Poner los nombres en todas las líneas.** Los ids alcanzan para filtrar; los nombres sirven en las dos
o tres líneas de frontera (apertura del listado, cierre, selección). A ~650 B por línea, los nombres en
las 174.000 diarias son **+23-34 % de ingesta permanente**, y Grafana factura por GB.

**Tocar los ~1.269 call sites.** Es lo que el contexto común existe para evitar.

**Revivir `#[Traced]`.** El middleware que lo consume está muerto y el atributo se usa en **0 archivos**.
Resucitarlo obliga a anotar cada método: el mismo trabajo que el contexto común evita.

## Lo que está decidido

> **DECISIÓN · 2026-08-25 (Miguel)** — los logs deben describir **la lógica de negocio**, no sólo el
> paso técnico, y ser autodescriptivos: leer una traza tiene que dejar entender el negocio.
> «sería otra fase de autodocumentación».

> **DECISIÓN · 2026-08-25** — **se loguean los DATOS de la decisión, no una frase sobre la decisión.**
> Es la diferencia entre que esto envejezca o no. Un log que dice «no cumple el perfilamiento» es una
> glosa: se desincroniza de la regla igual que un comentario. Un log que dice
> `regla=ingreso_minimo valor=900000 umbral=1200000 veredicto=excluye` **lo emite el código que decide**,
> con los números que usó — no puede mentir sin que el sistema esté roto. Ese es el único sentido en que
> un log documenta.

> **DECISIÓN · 2026-08-25** — el país va como **etiqueta**; comercio, sucursal, entidad y solicitud van
> en el **cuerpo**. Ver §«Lo que se evaluó y NO se eligió» para los números.

## Lo que está bloqueado

> **PREGUNTA · 2026-08-25 · infraestructura** — ¿cuál es el límite de streams contratado en este stack de
> Grafana Cloud? El token tiene `logs:read` y `traces:read` pero no `stacks:read`, así que no sale por API.
> Importa porque hoy hay **58.089 streams en 24 h**, y el default de Loki son 5.000.

> **PREGUNTA · 2026-08-25 · equipo** — ¿hay dashboards o alertas montados sobre `span_id`, o sobre el
> TEXTO de algún mensaje de log? Si los hay, el paso 5 y cualquier reescritura de mensajes los rompe.

> **PREGUNTA · 2026-08-25 · plataforma** — ¿el tenant acepta *structured metadata*? Es lo único que da
> paridad con los servicios Go: hoy `LokiHandler::groupByLabels()` empuja 2 elementos, así que filtrar
> por comercio va a ser **escaneo con parseo**, no índice.

## Riesgos

> **RIESGO · 2026-08-25** — **`Modules/Onboarding` monta sus rutas SIN el grupo `api`**:
> `RouteServiceProvider.php:41-42` usa `['otel','auth.cognito']`, el único de los módulos que lo omite. Y
> ahí viven `lenders/{ureq}`, `lenders-v2/{ureq}` y `update-user-request/{ureq}` — justo lo que se quiere
> trazar. Un middleware puesto en el grupo `api` **no los cubriría**, y el hueco no avisa: las líneas
> saldrían sin contexto y se leerían como «no pasó por ahí».

> **RIESGO · 2026-08-25** — **los mensajes de log son API.** `trazador/server/mapa/etapas.json` y
> `workers/logs.json` matchean por texto. Un mensaje reescrito deja al trazador en `sin-evidencia`, que
> **se lee igual que «no pasó»**. Cualquier cambio de texto va con su actualización en los dos mapas.

> **RIESGO · 2026-08-25** — el paso 4 sube líneas a `info`. Con `LOG_LEVEL` mal puesto en algún ambiente,
> o se pierden o se multiplican. Confirmar `LOG_LEVEL` y `LOG_CHANNEL` por ambiente antes de empezar.

> **RIESGO · 2026-08-26** — **el handler de logs puede corromper la respuesta HTTP.**
> `LokiHandler::__destruct()` llama a `flush()`, y si Loki no responde la excepción se renderiza
> **después del cuerpo** de la respuesta: el endpoint devuelve 200 con JSON válido seguido de un volcado,
> y cualquier cliente que parsee revienta. Visto en local con el Loki local caído: el harness reportó
> «register HTTP 200» y parecía un fallo del endpoint. Cualquier trabajo que aumente el volumen de logs
> aumenta la superficie de esto — va antes que el resto.

## Lo que NO entra

- `legacy-application`: tiene el mismo stack pero su `OpenTelemetryMiddleware` **nunca se registró en el
  Kernel**, así que ni siquiera hay span raíz. Es otra tarea, y más grande.
- Los 12 microservicios Go: ya usan `Creditop-SAS/platform` con `otelgin` y están **mejor** que los
  monolitos. Se los deja.
- Arreglar la propagación entre servicios (ver §«Cómo se comprueba»): está identificado pero es
  independiente y se puede entregar aparte.
- El front. PostHog ya cubre lo que ve el cliente.

## Cómo se comprueba

El criterio de aceptación técnico es **una sola consulta**: dada una solicitud, una consulta LogQL
devuelve su recorrido completo con comercio, país, entidades evaluadas, motivo de cada descarte y la
elegida — sin `grep` al código.

Para la línea base, antes de tocar nada:

    make trazador-acceso TARGET=prod QUERY='sum(count_over_time({service_name="legacy-backend"} [1h]))' SINCE=1h
    make trazador-acceso TARGET=prod QUERY='count(count by (trace_id) (count_over_time({service_name="legacy-backend"} [1h])))' SINCE=1h

⚠ **Para contar se usa una expresión métrica, nunca `trazador-acceso` a secas**: muestra una MUESTRA.
Y **la ausencia de una línea no prueba nada** — tiene cuatro causas indistinguibles (no se logueó · el
level la filtró · el batch no hizo flush · lag de ingesta).

> **MEDICIÓN · 2026-08-25 · el volumen de hoy, en prod**
>
>     legacy-backend        10.674 líneas/hora · trace_id en 10.075 (94%) · 584 errores/hora
>     legacy-application       964 líneas/hora
>     merchant-api              28 líneas/hora
>     menciona "allied"      1.235 líneas/hora (11%) · menciona "country" 61 (0,6%)
>
> `make trazador-acceso TARGET=prod QUERY='sum(count_over_time({service_name="…"} [1h]))' SINCE=1h`

> **MEDICIÓN · 2026-08-25 · el silencio, donde importa** — el camino listado→selección tiene **20**
> llamadas a log, todas en 3 archivos (`LenderRetrievalService` 7 · `LenderValidationService` 8 ·
> `LenderListingService` 5) y **CERO** en los otros cinco: `ProfilingRulesService`,
> `RiskCentralValidationService`, `LenderProbabilitySortingService`, `ListLenderController`,
> `LenderListingController`.
>
> Donde se excluye por datacrédito (`RiskCentralValidationService`, tres `$remove_lender = true`) **no hay
> ni una línea**. El único log que nombra una entidad excluida —`LenderValidationService:302`— dice
> `aprobado`/`rechazado` pero **no cuál regla falló ni con qué valor**, aunque ese detalle está en memoria.
> El **nombre del comercio no se loguea nunca** (sólo `allied_id`) y **el país no se loguea en ningún lado**.
> Y `|= "update-user-request"` en prod **no devuelve líneas**: la selección de entidad es invisible.

> **MEDICIÓN · 2026-08-25 · la cardinalidad ya está enferma** — `trace_id` y `span_id` **ya son
> etiquetas** (`LokiHandler.php:119,123`), y eso deja **58.089 streams en 24 h para 191.086 líneas**:
> 3,29 líneas por stream, con chunks de 2.433 B contra un objetivo de 1,5 MB (**0,15 % de llenado**).
> El **91,8 %** de esos streams son de legacy-backend. Medido aparte: **860 streams/hora** sólo por
> `trace_id`. La patología que esta tarea quiere evitar **ya está instalada**.
>
> Dimensiones reales de prod: **331 comercios** (160 activos) · **2.241 sucursales** (2.218 activas) ·
> **189 entidades activas** · **2 países** · **861,1 solicitudes/día** (promedio de 30 días).

> **MEDICIÓN · 2026-08-25 · la traza se corta al entrar al monolito** — `legacy-backend` **inyecta** el
> `traceparent` en toda llamada saliente (`Http::globalRequestMiddleware` + `TraceContextInjector`) pero
> **nunca llama a `propagator()->extract()`**. O sea: toda traza que le llega desde el wizard o desde un
> servicio Go **muere ahí** y él abre una nueva. Es puntual y arreglable, y explica por qué hoy no se
> puede seguir una solicitud de punta a punta.
>
> ⚠ Y `level` **sólo existe como etiqueta para los dos PHP**: la receta `{service_name="x", level="error"}`
> devuelve **CERO en silencio** para los 12 servicios Go.

## Registro

### 2026-08-25

Relevamiento completo con 47 agentes, verificado contra `origin/develop` (no contra el working tree, que
está en rama de trabajo). Se comprobaron a mano las cuatro afirmaciones que sostienen el diseño:
`LokiHandler:119/123/126`, `#[Traced]` en 0 archivos, `RouteServiceProvider:41-42` sin el grupo `api`, y
los 860 streams/hora por `trace_id`.

Tres cosas que salieron de paso y son deuda de otro lado, anotadas para no perderlas:

- `harness/pkg/loki.ts:20-22` afirma que «los microservicios Go no emiten `trace_id` en absoluto».
  **Está desactualizado**: el nodo `architecture` lo contradice y la medición también.
- Los tres porcentajes de líneas que anclan a una solicitud —~8 % (harness), 11 % (workers), 13 % (F-102)—
  **no están reconciliados**: miden cosas parecidas pero distintas y nadie dijo cuál aplica a qué.
- Dos nodos de `context/` se contradicen sobre si `qa` existe como valor de `environment` en el stack
  `creditopdev`.

<!-- ─────────────────────────────────────────────────────────────────────────────────────────────
     DE ACÁ PARA ABAJO ES LO ÚNICO QUE SALE A JIRA.
     ───────────────────────────────────────────────────────────────────────────────────────────── -->

## Tarea (publicable)

## En una línea
Que leer el registro de una solicitud alcance para entender qué decidió el sistema y por qué, sin
necesidad de que alguien abra el código.

## Por qué
Hoy, cuando a un cliente no le aparece una entidad, nadie puede decir por qué sin pedirle a un
desarrollador que revise el código. La razón existe —el sistema la calculó— pero no queda registrada en
ningún lado: se descarta apenas se usa. Soporte y producto quedan dependiendo de una consulta técnica
para responder algo que el sistema ya sabe.

## Qué cambia
Cada decisión sobre una solicitud queda registrada con sus datos: qué comercio, en qué país, qué
entidades se evaluaron, cuál se descartó, contra qué condición y con qué valor. Y cuál eligió el cliente,
que hoy no se registra en absoluto.

El registro pasa a describir el negocio: quien lo lee entiende la regla que se aplicó, aunque no conozca
el sistema por dentro.

## Alcance
El flujo de originación, desde que entra la solicitud hasta que el cliente elige entidad. No entra el
resto del ciclo de vida del crédito, ni la plataforma antigua, ni lo que ve el cliente en pantalla —eso
ya está cubierto por otra herramienta.

## Dónde probar
Local y dev. No requiere datos de producción.

## Cómo validar
Tomar una solicitud de prueba a la que le aparezcan pocas entidades y, sin abrir el código, responder:
de qué comercio y país es, qué entidades se evaluaron, por qué se descartó cada una y cuál eligió el
cliente. Hoy esas preguntas no se pueden contestar así.

## Criterios de aceptación
Una sola consulta devuelve el recorrido completo de una solicitud con esa información. Un descarte por
condición indica la condición, el valor evaluado y el límite. La elección del cliente queda registrada.
El volumen de registros no crece más de lo acordado con infraestructura.

## Dependencias / contraparte
Hace falta confirmar con infraestructura el límite de capacidad contratado del sistema de registros, y
con el equipo si hay tableros o alertas construidos sobre el formato actual —cambiarlo los rompería.
