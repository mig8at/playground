# Architecture · contexto
> **estado:** al día con main · Índice de los 3 repos de originación de CreditOp (application, legacy-backend, frontend-monorepo) y de las **costuras** por las que se hablan: una BD compartida + 4 saltos HTTP.

## Qué es

> ⚠ **Este nodo describe el monolito y sus vecinos conocidos, y eso NO es todo lo que corre.** Medido en
> Loki el 2026-08-07: **14 servicios** emiten logs en producción, y el más ruidoso de todos no es el
> monolito sino `financial-health-service` (el backend de la **app móvil**). El censo completo —con
> volumen, qué está clonado y qué indexa el árbol— está en el nodo **`microservicios`**. Empezá por ahí
> si la tarea toca algo que no encontrás en `legacy-backend` ni en `legacy-application`.
Nodo ÍNDICE del ecosistema. La misma originación de crédito vive repartida —y a menudo **duplicada**— en varios repos, así que antes de leer cualquier flujo conviene saber quién corre en prod, quién es reescritura, y **por dónde pasan los datos de un repo a otro**. Contexto BASE: sirve para casi cualquier tarea.

El hecho estructural central es el **strangler / parallel-run**: mucha lógica existe dos veces (application VIVO ↔ legacy reescrito) sobre la **misma base de datos**. Salvo indicación, **application es el que corre**; legacy solo recibe el tráfico de los comercios que un allowlist habilita explícitamente.

Este nodo cubre la **frontera**: qué repos hay, cómo se enganchan y dónde está el interruptor de cutover. El detalle interno de cada repo es de sus hijos.

## Antes de concluir
- **`auth.cognito` no autentica** (el detalle del middleware y quiénes lo usan → `actors`). Lo que importa acá: la barrera real es **de red/gateway, no de código** — y por eso el puente S2 funciona pese a no mandar `Authorization`.
- **Tres mecanismos de cutover distintos y sin relación** — filas de `settings` (originación), array PHP hardcodeado (checkout Corbeta) y `config/documents.php` (generación de PDFs). No hay un feature-flag único; para saber qué corre para un comercio hay que mirar los tres.
- **Ningún repo tiene el esquema completo** (47 + 67 migraciones exclusivas). Explica los "no lista el lender" al levantar local con un solo repo.
- **Las migraciones se copian a mano** (286 byte-idénticas): nada garantiza que la próxima siga sincronizada.
- **Deriva de gemelos en ambos sentidos** sobre la misma tabla `lenders`: el hardcode de Credifamilia solo en application, `isSmartpayChannel()` solo en legacy. Leer un modelo en un repo **no** dice cómo se comporta el otro.
- **`app/Http/Controllers` de legacy-backend es una copia mayormente muerta**: 33 controladores, pero **no hay `routes/web.php`** y la raíz solo monta el ping + exceptions. Los únicos alcanzables por ruta son los **dos** de `Api/CredifamiliaV2` (`CrossCoreController`, `EvidenteController`), que además son código nuevo, no heredado.
- **Share de Inertia muerto:** `HandleInertiaRequests.php:50-55` publica `newFrontendBaseUrl` y `newFrontendBranchHashes` a las páginas Vue, pero `newFrontend` aparece **0 veces** en `resources/`.
- **`product_type` es fantasma**: no existe la columna; usar `response_type` + `path_id`.
- Los prefijos de ruta del wizard están **duplicados a mano** en PHP y TS (`NewFrontendUrlService` ↔ `ROUTE_PREFIXES`); nada los mantiene sincronizados.

## Contenido

### Por qué hay DOS sistemas: la historia (y por qué se siente como una copia)
Sin esto, la duplicación se lee como descuido. Fuente: Miguel (2026-08-09), contrastada contra git.

CreditOp **nació en PHP con Inertia** — un monolito donde el back renderiza el front. Después entró un
arquitecto, **Yamid**, que concluyó que la forma de escalar era **matar Inertia y pasar a APIs y
microservicios**. De ahí nace `legacy-backend` + el wizard React.

**El problema no fue la decisión, fue el resultado: hubo que seguir manteniendo `application` en
paralelo, y matarlo viene siendo un problema desde entonces.** Y la forma que tomó la reescritura explica
lo que este nodo documenta como rarezas: no se le quitó Inertia a `application` para exponer una API REST
sobre el mismo dominio — **se construyó casi una copia**. De ahí salen las 286 migraciones byte-idénticas,
los controladores gemelos por audiencia, las copias que divergen en numeración y el código muerto en
legacy-backend. La lectura retrospectiva de Miguel es que **habría sido mejor sacar Inertia de
`application` y ponerle API REST encima**, en vez de duplicar el dominio en otro repo.

**Contrastado contra git:** Yamid tiene **118 commits en `legacy-application`** (2025-05 → 2026-07) y
**123 en `legacy-backend`** (2025-06 → 2026-07), concentrados en `Modules/Onboarding` (48), el módulo con
más superficie HTTP. El repo nuevo arranca **un mes después** de su actividad en el viejo, y él siguió
commiteando en los dos — o sea que «mantener las dos cosas» está en el historial, no es una impresión.

Consecuencia práctica para cualquier tarea de migración: **el objetivo no es terminar una reescritura,
es apagar un sistema que nunca dejó de recibir cambios.** El inventario de qué falta para eso está en
`application` §5.

### Los repos (verificado en composer/package + estructura)

| Repo (clave índice) | Ruta en disco | Stack | Rol |
|---|---|---|---|
| **application** | `github/legacy-application` | `creditop/app` · Laravel 10 + **Inertia 1.0** (`resources/js`, 542 arch.) | Monolito full-stack (Aliados). **VIVO / default** |
| **legacy-backend** | `github/legacy-backend` | `creditop/legacy-backend` · Laravel 10 + **nwidart/laravel-modules 10** · **sin Inertia, sin `resources/js`** | Reescritura **API-only** (strangler) |
| **frontend-monorepo** | `github/frontend-monorepo` | pnpm + turbo · React Router v7 **SSR** | Wizard. **No toca la BD**: cliente HTTP puro |
| **pre-approvals-service** | `github/pre-approvals-service` | Go | Pre-aprobación rt≠0 (→ ver hijo **ms-preapprovals**) |

⚠ Los nombres engañan: **`legacy-backend` es el repo NUEVO**; el monolito viejo es el directorio `legacy-application` (clave de índice `application`).

### El puente real: una BD compartida, dos historiales de migraciones

No hay ORM remoto ni API de datos: los dos backends Laravel apuntan al **mismo MySQL** y se comunican **por tablas**. La evidencia dura:

- **286 migraciones con el mismo nombre en ambos repos, byte-idénticas** (`cmp` = 0 divergencias). Es una copia a mano del historial, no un submódulo.
- Además: **47 migraciones exclusivas de application** y **67 exclusivas de legacy-backend** (333 vs 353 en total). ⇒ **ningún repo tiene el esquema completo**; un dev que migra solo un repo obtiene una BD parcial.
- **161 de los 169 modelos de application existen en la MISMA ruta en legacy** (`app/Models/X.php`). Los gemelos incluyen todo el núcleo: `User`, `Allied`, `AlliedBranch`, `Lender`, `LendersByAllied`, `LendersByAlliedBranch`, `UserRequest`, `Setting`, `CreditopX*`.
- **0 migraciones dentro de `Modules/`**: pese a la modularización, todo el esquema vive en `database/migrations` en la raíz de cada repo.

El reparto de autoría del esquema se ve en las fechas: application casi no crea tablas nuevas desde 2026-01, mientras legacy-backend suma 67 migraciones propias con pico desde **2026-02** (p. ej. `paths` + `lenders.path_id`, que **solo existen en legacy**). Siguen compartiendo migraciones hasta 2026-03-31, así que **no hubo fork limpio: se copian a mano en ambos sentidos**.

### Las 4 costuras de código (todo lo demás pasa por la BD)

**S1 · application → frontend-monorepo (redirect del navegador).** Es el cutover de la originación. `NewFrontendUrlService` construye la URL del wizard sobre `NEW_FRONTEND_BASE_URL` y application hace `redirect()->away()` / `inertia()->location()`. **La compuerta NO es un array hardcodeado: son dos filas de la tabla `settings`**:

| key | forma del `value` (cast `json`) | granularidad |
|---|---|---|
| `new_frontend_allied_branches` | `{"hashes": ["<hash sucursal>", …]}` | sucursal |
| `new_frontend_allieds` | `{"<allied_id>": true, …}` | comercio |

Se evalúan con **OR** (`$isAllowedBranch \|\| $isAllowedAllied`); si da false cae al flujo Inertia de siempre. **Ninguna migración ni seeder crea esas filas** → son datos de operación, y **legacy-backend no las conoce** (cero referencias): la decisión de cutover vive 100 % en application.

**S2 · application → legacy-backend (HTTP).** Hay exactamente **un cliente de código**: `GenerateServicesBridgeClient`, con un solo consumidor (`ClientCodeController@confirmCode`). Postea a `LEGACY_BACKEND_BASE_URL` + `/api/onboarding/generate-services/code/{consult,consumConfirm}`, y **legacy actúa de proxy** hacia el servicio externo de códigos (`/api/v1/generate/code/...`). Aparte de eso hay **un segundo salto, este sí hardcodeado**: el checkout de ecommerce de los comercios del gate Corbeta (la lista exacta de esta costura incluye a Kalley 311 y DIVERGE de las demás listas «Corbeta» → `corbeta` §gate) se redirige a `…/api/onboarding/checkout/{hash}` con **hostnames escritos a mano por ambiente**.

**S3 · frontend-monorepo → legacy-backend (HTTP, SSR).** `VITE_API_URL` apunta a legacy-backend (el fallback literal en código es `http://legacy-backend.inertia-develop`). El front consume las APIs modulares: `/api/onboarding/*`, `/api/loans/*`, `/api/identity/*`.

**S4 · frontend-monorepo → application (SSO HMAC).** Costura que el mapa anterior no registraba: el wizard puede devolver al asesor a Aliados firmando `HMAC-SHA256(accessToken|ts, INTERNAL_SSO_TOKEN)` contra `ALIADOS_BASE_URL`; application valida la firma, consulta `userInfo` en Cognito, mapea por **email** y exige rol **`Comercial`**. Además el front tiene la URL de producción de application **hardcodeada** (`LEGACY_BASE_URL = "https://aliados.creditop.com"`) para linkear a `/solicitudes`, `/solicitudes-originadas` y `/autorizacion`.

*(La quinta costura —front y legacy contra el MS Go de pre-aprobación, incluido el callback `…/lender-result`— es material del hijo **ms-preapprovals**.)*

### Superficie HTTP de legacy-backend → nodo `legacy-backend`

La tabla módulo→prefijo, cuáles de los 20 exponen rutas, la mudanza del dashboard a `Backoffice` y la
evolución V1/V2 (con el falso negativo del grep) viven en el **nodo del repo** — un hecho, una casa.
Lo que importa desde el cross-repo: `routes/api.php` de la raíz es un ping y no hay `web.php` (toda la
API la montan los módulos), y Onboarding monta además un grupo **público** (`webhooks.php`, sin
Cognito) para lo que entra de afuera: callback biométrico CrossCore, el callback del MS de lenders y el
protocolo **VTEX** (`/vtex/init`, `/vtex/settel`).

### Quién atiende qué hoy (parallel-run)

- **Ya en legacy (default):** cupo rt=2 (`POST /api/loans/lender/available-quota`, no existe en application), listado `lenders-v2`, OTP de **onboarding**, y la KYC V2 de Credifamilia (CrossCore/Evidente).
- **Todavía en application:** **todos los webhooks de agregadores rt=1** — Bancolombia (BNPL y consumo), Payvalida, Prami, Meddipay, Sistecrédito, Approbe, Banco de Bogotá, Welli, Corbeta, SelfManager, Pash. Son el bloqueo duro del cutover: mientras los lenders externos posteen a application, no se puede apagar.
- **Duplicado:** el OTP de **firma de pagaré** sigue en application aunque el de onboarding ya migró.

⚠ **La BD compartida NO es un detalle de los webhooks: es lo que sostiene el parallel-run entero.** Un
webhook que llega al viejo actualiza una solicitud que pudo haber creado el nuevo, y funciona porque los
dos escriben la misma tabla. Sin eso no se podrían mover comercios de a uno.

⚠ **Y cuidado con el atajo «migramos los webhooks de rt=1 y apagamos el viejo».** Es falso, y por un
orden de magnitud. Medido el 2026-08-23 sobre `legacy-application`: de sus **435 rutas**, las de webhook
y URL de retorno son unas **26** (≈6 %); las de cartera, pagos y desembolso rondan las 32 y las de
onboarding las 62. Lo que de verdad lo ancla es el **servicing**, y ahí la asimetría es la que manda:
**24 crons en application contra 5 en legacy-backend**. Los webhooks son una estaca de varias, no la
principal. Por qué rt=1 tampoco se puede *probar* hoy: **F-170**.

### El eje que decide todo: `response_type` (+ `path_id`)

**No existe columna `product_type`** en ninguna migración de ninguno de los dos repos. El "tipo de producto" se modela con dos columnas de `lenders`:

| rt | Constante del front | Quién decide el crédito | Inyectable local |
|---|---|---|---|
| **0** | `STANDARD` | Nadie (redirige a la web del lender) | n/a |
| **1** | `PRE_APPROVED` | API externa del lender (Welli, Bancolombia, Meddipay…) | ❌ |
| **2** | `CREDITOP_X` | CreditOp (motor de categorías local) | ✅ |
| **3** | `CREDITOP_X_REVOLVING` | CreditOp (cupo rotativo local) | ✅ |
| **4** | *(sin constante)* | El front lo acepta en el set de "pre-approval flow" | — |

`path_id` es el segundo eje: **2 = flujo IMEI**, **3 = lender gestionado manualmente**. La tabla `paths` y la columna existen **solo en legacy-backend**.

## Subcontextos
- **application** — el monolito viejo (Aliados). Runtime por defecto; alta de entidades, panel admin y todo el servicing.
- **legacy-backend** — el backend refactor (Laravel modular). Destino de la migración; reconstruyó el núcleo CreditopX.
- **frontend-monorepo** — el wizard (React Router SSR). No toca la BD; cliente HTTP puro.
- **ms-preapprovals** — microservicio Go de pre-aprobación (rt≠0) para el wizard nuevo.

## Dónde mirar

**Cutover al frontend nuevo (S1)**
- `application/app/Http/Controllers/Customer/SimulatorController.php:121-139` — lee las 2 filas de `settings`, OR, y `redirect()->away($this->urlService->init(...))`.
- `application/app/Http/Controllers/Customer/UserRequestController.php:1499-1507` — el mismo gate; `:1518-1535`, `:1568-1587`, `:1590-1607` = las 3 bifurcaciones (personal-info / lenders / employment-info), cada una con su `// Legacy flow` de fallback.
- `application/app/Http/Controllers/Customer/UserRequestController.php:1615-1632` — `registerImei` **NO consulta el allowlist**: siempre manda al frontend nuevo.
- `application/app/Services/NewFrontendUrlService.php:8-10` (prefijos), `:23` (`services.new_frontend.base_url`), `:68-75` (`init`).
- `application/app/Models/Setting.php:10-12` — `value` es `varchar` en el esquema pero el modelo lo castea a `json`.

**Puente de código application → legacy (S2)**
- `application/app/Services/Api/GenerateServicesBridgeClient.php:17-18` (endpoints), `:36` (path `/api/onboarding/generate-services`), `:293-315` (fallback `host.docker.internal` bajo Sail).
- `application/config/services.php:232-241` — `generate_services_bridge.base_url = LEGACY_BACKEND_BASE_URL`; `:251-253` — `new_frontend.base_url`.
- `application/app/Http/Controllers/Customer/ClientCodeController.php:50` — único consumidor del puente.
- `legacy-backend/Modules/Onboarding/routes/api.php:140-146` — el otro extremo; `legacy-backend/Modules/Onboarding/App/Repositories/GenerateServiceRepository.php:18-19,28` — legacy reenvía al servicio externo (`services.code_generation_service`).
- `application/app/Http/Controllers/Customer/WoocommerceController.php:45-48` — array hardcodeado `[24, 209, 210, 211, 311]`; `:580-601` — hostnames de legacy escritos a mano por ambiente. Destino: `legacy-backend/Modules/Onboarding/routes/api.php:28`.

**Frontera HTTP e identidad (S3)**
- `legacy-backend/Modules/Onboarding/App/Providers/RouteServiceProvider.php:41-44` — `api/onboarding` con `['otel','auth.cognito']`; `:50-54` — webhooks con `['api','otel']` (público).
- `legacy-backend/app/Http/Kernel.php:66` — `auth.cognito` → `ResolveCognitoUser`.
- `legacy-backend/app/Http/Middleware/ResolveCognitoUser.php:17-34` — **no valida token**: lee `x-user-id` / `x-cognito-identity-id`, hace `Auth::login()` y **siempre** deja pasar.
- `frontend-monorepo/apps/loan-request-wizard/app/utils/backend-auth-headers.server.ts:12` — el front emite esas cabeceras (solo server-side).
- `frontend-monorepo/apps/loan-request-wizard/app/entry.server.tsx:15` — `streamTimeout` (45 s; 240 s en staging).

**SSO frontend → application (S4)**
- `frontend-monorepo/apps/loan-request-wizard/app/utils/aliados-sso.server.ts:14-23` — arma `HMAC-SHA256(accessToken|ts)`.
- `application/app/Http/Controllers/Customer/SsoCognitoController.php:16-22` (contrato), y la verificación de firma + `hasRole('Comercial')`. Ruta: `application/routes/customer.php:35`.
- `frontend-monorepo/apps/loan-request-wizard/app/utils/route-helpers.ts:11-15` (`ROUTE_PREFIXES`, espejo manual de las constantes PHP) y `:17-23` (`LEGACY_BASE_URL` hardcodeado).

**Esqueleto de rutas**
- `application/app/Providers/RouteServiceProvider.php:52-76` — 5 grupos por namespace: Api, Admin, Customer, Profile, Web (949 líneas de rutas en total).
- `legacy-backend/app/Providers/RouteServiceProvider.php:36-44` — la raíz solo registra `api.php` (ping) y `exceptions.php`.
- `application/routes/api.php:22-123` — los webhooks de agregadores rt=1 que siguen en el monolito.

**Gemelos y su deriva**
- `application/app/Models/Lender.php:55-62` — accessor que fuerza `response_type = 1` si `id == 24` (Credifamilia).
- `legacy-backend/app/Models/Lender.php:75-78` — **no tiene ese accessor**; sí tiene `isSmartpayChannel()` contra `config/lenders.php:24` (160 en prod, 153 fuera), que **application no tiene**.
- `application/app/Http/Controllers/Customer/ListLenderController.php` (614 líneas, Inertia) vs `legacy-backend/Modules/Onboarding/routes/api.php:50` (`lenders-v2` → `LenderListingController`): el par de gemelos del listado.

**Otros cutovers por config**
- `legacy-backend/config/documents.php:53` — driver por documento **y por lender** (`blade` \| `microservice`; `24 => 'microservice'`); `:73-78` — `vinculacion` arranca en `microservice` **sin fallback** a Blade por decisión de diseño.
- `legacy-backend/config/services.php:201-203` — `pre_approvals.base_url`; consumido en `legacy-backend/Modules/Loans/App/Actions/PreApprovalsAction.php:15,37`.

## Observabilidad: dos stacks de Grafana, y etiquetas que engañan

Los logs de la aplicación van a **Grafana Cloud Loki** (`app/Logging/LokiHandler.php`, registrado por `app/Providers/GrafanaServiceProvider.php` según `config/grafana.php`). Hay **dos stacks**, y el nombre del host no dice cuál:

| stack | qué ambientes | `User` de Loki |
|---|---|---|
| `creditop.grafana.net` | **producción** | 1339721 |
| `creditopdev.grafana.net` | **dev y qa a la vez** | 1339770 |

Misma URL de datos (`logs-prod-036.grafana.net`) y mismo token para los dos: lo único que cambia es el `User`, que es **por stack**. ⚠ El `prod` del hostname es de la infraestructura de Grafana, no del ambiente — un stack de dev también vive en un host `logs-prod-NNN`.

**El ambiente NO es una etiqueta, es el stack.** Dentro de `creditop` la etiqueta `environment` tiene un único valor (`production`); dentro de `creditopdev` tiene `development`, `qa`, `local` y `testing`. El servicio `legacy-backend-stg` es el de la rama `qa` (staging). Y como **dev y staging comparten la BD**, un mismo `user_request_id` tiene líneas de las **dos ramas de código**: sin filtrar por `environment` se están mirando dos ramas mezcladas — la misma trampa que ya documenta este nodo para dev vs staging.

Tres trampas de las etiquetas, todas medidas:

- **`service_name` es la única etiqueta universal** (15 servicios). `environment` y `deployment_environment` son convenciones **excluyentes**: la primera la escriben los monolitos Laravel (`LokiHandler`, desde `APP_ENV`) y la segunda los microservicios Go (OTel). Filtrar por una **descarta la otra mitad de la flota en silencio** — `{environment="production"}` devuelve 2 servicios y `{deployment_environment="production"}` devuelve 13.
- **El `trace_id` no se propaga entre servicios.** `legacy-backend` y `legacy-application` no comparten ni un trace, y ningún trace del monolito continúa en un microservicio. ⚠ *Corregido el 2026-08-06: la versión anterior decía que los MS Go «no emiten `trace_id` en absoluto» — falso para `preapprovals-service`, que emite trace y span PROPIOS.* El matiz que importa: en los MS el `trace_id` es metadata estructurada, **no etiqueta indexada** — `{trace_id="…"}` como selector devuelve 0 para sus líneas aunque existan (hay que filtrar con `| trace_id="…"` dentro de un selector por `service_name`). No se puede seguir una solicitud cruzando servicios por trace; dentro de cada servicio sí.
- **`LokiHandler` promueve `trace_id` y `span_id` a ETIQUETAS**, y en Loki cada valor distinto crea un stream: 959 streams cada 15 minutos. Una consulta amplia sobre el lado Laravel (`{environment="production"}` a 30 días) devuelve 14,5 MB de series y expira. Hay que acotar siempre por `service_name`.

**Y una cuarta, la que más limita lo que se puede afirmar: sólo el 13 % de las líneas dice a qué solicitud pertenece** — y cuando lo dice, usa tres nombres de campo distintos (`context_user_request_id`, `context_userRequestId` en la integración BNPL, `context_request_id` en el cliente del MS de PDFs). Consecuencia: reconstruir el recorrido de una solicitud obliga a anclar y **expandir por `trace_id`**, y eso mezcla solicitudes de un mismo cliente. Medido en prod sobre 8 solicitudes de 7 comercios; el contraste es Corbeta **58 %** de líneas afirmables contra Credifamilia **4 %**, y no es volumen — Corbeta loguea menos, pero identifica lo que loguea. Detalle, mediciones y el arreglo en **F-102**. ⚠ No confundirlo con «logs y trazas separados»: el `trace_id` está en el **100 %** de las líneas y esa parte funciona; lo que falta es la identidad de la solicitud dentro del log. (Y los **nombres de los spans** —`tracer->startSpan('Clase::metodo')`— tampoco viajan a Loki: viven en Tempo, que hoy no se consulta.)

**La BD de producción se lee por Redash** (`redash.creditop.com`, fuente `id=1 "Live"`, permiso `execute_query`), que es la única puerta: no hay acceso directo. Tres cosas que conviene saber antes de usarla: es **asíncrona** (job → polling → resultado), queda **auditada a nombre del dueño del token**, y devuelve los `datetime` en hora **local**, no UTC (ver **F-98** para el efecto de equivocarse con eso). El ELB es **interno**: sin VPN el síntoma es un *timeout*, no un 401.

## Lo que NO está verificado
- Qué apunta a qué en producción: la BD compartida está probada por código (migraciones y modelos idénticos), no por config verificada contra el despliegue.
- Los dos puertos del MS de pre-aprobación (`PRE_APPROVALS_BASE_URL` default `:8086` vs `VITE_PREAPPROVALS_ENDPOINT`): sin verificar si son el mismo despliegue.
