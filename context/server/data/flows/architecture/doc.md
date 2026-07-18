# Architecture · contexto
> **estado:** al día con main · Índice de los 3 repos de originación de CreditOp (application, legacy-backend, frontend-monorepo) y de las **costuras** por las que se hablan: una BD compartida + 4 saltos HTTP.

## Qué es
Nodo ÍNDICE del ecosistema. La misma originación de crédito vive repartida —y a menudo **duplicada**— en varios repos, así que antes de leer cualquier flujo conviene saber quién corre en prod, quién es reescritura, y **por dónde pasan los datos de un repo a otro**. Contexto BASE: sirve para casi cualquier tarea.

El hecho estructural central es el **strangler / parallel-run**: mucha lógica existe dos veces (application VIVO ↔ legacy reescrito) sobre la **misma base de datos**. Salvo indicación, **application es el que corre**; legacy solo recibe el tráfico de los comercios que un allowlist habilita explícitamente.

Este nodo cubre la **frontera**: qué repos hay, cómo se enganchan y dónde está el interruptor de cutover. El detalle interno de cada repo es de sus hijos.

## Contenido

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

**S2 · application → legacy-backend (HTTP).** Hay exactamente **un cliente de código**: `GenerateServicesBridgeClient`, con un solo consumidor (`ClientCodeController@confirmCode`). Postea a `LEGACY_BACKEND_BASE_URL` + `/api/onboarding/generate-services/code/{consult,consumConfirm}`, y **legacy actúa de proxy** hacia el servicio externo de códigos (`/api/v1/generate/code/...`). Aparte de eso hay **un segundo salto, este sí hardcodeado**: el checkout de ecommerce de 5 comercios Corbeta (`[24, 209, 210, 211, 311]`) se redirige a `…/api/onboarding/checkout/{hash}` con **hostnames escritos a mano por ambiente**.

**S3 · frontend-monorepo → legacy-backend (HTTP, SSR).** `VITE_API_URL` apunta a legacy-backend (el fallback literal en código es `http://legacy-backend.inertia-develop`). El front consume las APIs modulares: `/api/onboarding/*`, `/api/loans/*`, `/api/identity/*`.

**S4 · frontend-monorepo → application (SSO HMAC).** Costura que el mapa anterior no registraba: el wizard puede devolver al asesor a Aliados firmando `HMAC-SHA256(accessToken|ts, INTERNAL_SSO_TOKEN)` contra `ALIADOS_BASE_URL`; application valida la firma, consulta `userInfo` en Cognito, mapea por **email** y exige rol **`Comercial`**. Además el front tiene la URL de producción de application **hardcodeada** (`LEGACY_BASE_URL = "https://aliados.creditop.com"`) para linkear a `/solicitudes`, `/solicitudes-originadas` y `/autorizacion`.

*(La quinta costura —front y legacy contra el MS Go de pre-aprobación, incluido el callback `…/lender-result`— es material del hijo **ms-preapprovals**.)*

### Superficie HTTP de legacy-backend (módulo → prefijo)

`routes/api.php` de la raíz es **un ping de 9 líneas** y **no existe `routes/web.php`**: toda la API la montan los módulos.

| Módulo | Prefijo | Módulo | Prefijo |
|---|---|---|---|
| Onboarding | `api/onboarding` | OnboardingV2 | `api/v2/onboarding` |
| Loans | `api/loans` (+ `/customer`, `/admin`) | RiskV2 | `api/v2/risk` |
| Identity | `api/identity` | Risk | `api/risk` |
| Partner | `api/partners` | System | `api/system` |
| Payments | `api/payments` | UsersV1 | `api/v1/users` |

Hay **16 módulos habilitados** pero **solo 10 exponen rutas**; los otros 6 (`AuthV1`, `AlliedBranchV1`, `UserRequestV1`, `EcommerceRequestsV1`, `LegalV1`, `CommonsV1`) son capas internas (`App/Services`, `App/Repositories`, `Contracts/`) sin superficie propia.

**V1/V2 = evolución, NO gemelos (aclaración del equipo — Miguel, 2026-07-18).** Los prefijos `api/v2/*` no son una copia de los `api/*`: son la versión donde se MOVIÓ lógica al front. Caso confirmado: el endpoint de **lenders v2 quitó la pre-aprobación del backend** — la v2 ya no pre-aprueba los rt≠0 desde legacy, lo hace el **frontend** llamando directo al MS (ver **ms-preapprovals**). Esto explica el aparente "cero consumidores de `/api/v2/*`" que dio el análisis estático: el front no escribe la ruta literal, la arma en runtime desde `VITE_API_URL` + repository classes → un `grep '/api/v2/'` no la encuentra (falso negativo). Los `api/v2` CON rutas (OnboardingV2/RiskV2) están vivos; lo que sigue sin verificar son los 6 módulos SIN rutas de arriba.

Aparte del grupo autenticado, Onboarding monta un grupo **público** (`webhooks.php`, sin Cognito) para lo que entra de afuera: callback biométrico CrossCore, el callback del MS de lenders, y el protocolo **VTEX** (`/vtex/init`, `/vtex/settel`).

### Quién atiende qué hoy (parallel-run)

- **Ya en legacy (default):** cupo rt=2 (`POST /api/loans/lender/available-quota`, no existe en application), listado `lenders-v2`, OTP de **onboarding**, y la KYC V2 de Credifamilia (CrossCore/Evidente).
- **Todavía en application:** **todos los webhooks de agregadores rt=1** — Bancolombia (BNPL y consumo), Payvalida, Prami, Meddipay, Sistecrédito, Approbe, Banco de Bogotá, Welli, Corbeta, SelfManager, Pash. Son el bloqueo duro del cutover: mientras los lenders externos posteen a application, no se puede apagar.
- **Duplicado:** el OTP de **firma de pagaré** sigue en application aunque el de onboarding ya migró.

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
- `application/app/Http/Controllers/Customer/UserRequestController.php:1498-1506` — el mismo gate; `:1518-1535`, `:1568-1587`, `:1590-1607` = las 3 bifurcaciones (personal-info / lenders / employment-info), cada una con su `// Legacy flow` de fallback.
- `application/app/Http/Controllers/Customer/UserRequestController.php:1610-1627` — `registerImei` **NO consulta el allowlist**: siempre manda al frontend nuevo.
- `application/app/Services/NewFrontendUrlService.php:8-10` (prefijos), `:23` (`services.new_frontend.base_url`), `:68-75` (`init`).
- `application/app/Models/Setting.php:10-12` — `value` es `varchar` en el esquema pero el modelo lo castea a `json`.

**Puente de código application → legacy (S2)**
- `application/app/Services/Api/GenerateServicesBridgeClient.php:17-18` (endpoints), `:36` (path `/api/onboarding/generate-services`), `:293-315` (fallback `host.docker.internal` bajo Sail).
- `application/config/services.php:232-241` — `generate_services_bridge.base_url = LEGACY_BACKEND_BASE_URL`; `:251-253` — `new_frontend.base_url`.
- `application/app/Http/Controllers/Customer/ClientCodeController.php:49` — único consumidor del puente.
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

## Gotchas / riesgos
- **`auth.cognito` no autentica.** Resuelve identidad desde cabeceras planas y nunca bloquea: cualquiera que alcance legacy-backend puede suplantar a un usuario con `x-user-id`. El repo asume que **no está expuesto directo** (la barrera real es de red/gateway, no de código). Consecuencia práctica: el puente S2 funciona pese a no mandar `Authorization`.
- **Tres mecanismos de cutover distintos y sin relación** — filas de `settings` (originación), array PHP hardcodeado (checkout Corbeta) y `config/documents.php` (generación de PDFs). No hay un feature-flag único; para saber qué corre para un comercio hay que mirar los tres.
- **Ningún repo tiene el esquema completo** (47 + 67 migraciones exclusivas). Explica los "no lista el lender" al levantar local con un solo repo.
- **Las migraciones se copian a mano** (286 byte-idénticas): nada garantiza que la próxima siga sincronizada.
- **Deriva de gemelos en ambos sentidos** sobre la misma tabla `lenders`: el hardcode de Credifamilia solo en application, `isSmartpayChannel()` solo en legacy. Leer un modelo en un repo **no** dice cómo se comporta el otro.
- **`app/Http/Controllers` de legacy-backend es una copia mayormente muerta**: 33 controladores, pero **no hay `routes/web.php`** y la raíz solo monta el ping + exceptions. Los únicos alcanzables por ruta son los **dos** de `Api/CredifamiliaV2` (`CrossCoreController`, `EvidenteController`), que además son código nuevo, no heredado.
- **Share de Inertia muerto:** `HandleInertiaRequests.php:50-55` publica `newFrontendBaseUrl` y `newFrontendBranchHashes` a las páginas Vue, pero `newFrontend` aparece **0 veces** en `resources/`.
- **`product_type` es fantasma**: no existe la columna; usar `response_type` + `path_id`.
- Los prefijos de ruta del wizard están **duplicados a mano** en PHP y TS (`NewFrontendUrlService` ↔ `ROUTE_PREFIXES`); nada los mantiene sincronizados.

## Preguntas abiertas
- **Qué apunta a qué en producción.** `DB_HOST`/`DB_DATABASE` son env: la BD compartida está probada por el código (migraciones y modelos idénticos), no por config verificada. Falta confirmar contra el despliegue real.
- **Dos puertos para el MS de pre-aprobación**: legacy usa `PRE_APPROVALS_BASE_URL` (default `:8086`) y el front `VITE_PREAPPROVALS_ENDPOINT`. Sin verificar si son el mismo servicio o dos despliegues.
- **`VITE_PREAPPROVALS_ENDPOINT` no está en `.env.example`** del wizard pese a usarse en loaders SSR: ¿se inyecta en el deploy?
- **rt=4** aparece en el front como "pre-approval flow" pero no tiene constante ni respaldo verificado en estos 3 repos.
- **`microservices` y el resto de repos Go** (messaging, otp, code-generation, pdf-mapper) no están en el índice, así que no se pudo verificar cuáles tienen consumidor real. Desde estos 3 repos, los que sí están cableados en config son: `pre_approvals`, `messaging_service`, `otp_service`, `code_generation_service`, `pdf_mapper_service`.
- Los **6 módulos sin rutas** (`AuthV1`, `AlliedBranchV1`, …): no se verificó si son andamiaje de una arquitectura en curso o código sin invocar. (Los V2 CON rutas —OnboardingV2/RiskV2— sí están vivos: el front los consume vía `VITE_API_URL`; ver "V1/V2 = evolución" arriba.)

## Bitácora
- **2026-07-18** — Fase de data: nodo documentado por ANALISIS DE CODIGO (no habia doc fuente) + superficie curada.
- **2026-07-17** — Contexto sembrado desde playground/flow (MAP.md §0: tabla de Repos + strangler/parallel-run + tabla response_type).

## Enlaces
- Raíz: **CreditOp**. Hijos: **application**, **legacy-backend**, **frontend-monorepo**, **ms-preapprovals**, **harness** (arnés de pruebas E2E: `backend-e2e` Go + `frontend-e2e` Playwright, recién indexados).
- Nodos relacionados: **onboarding** (el camino que cruza estas costuras), **creditopx** (rt=2/3), **aggregator** (rt=1, los webhooks que siguen en application), **merchants** (comercios/sucursales = la granularidad del allowlist).
- Memorias: `migracion-application-a-legacy-estado`, `refactor-perfilamiento-lenders`, `docs-consolidacion` (para las verdades de BD; el árbol `docs/` salió de main, se cita como `git 159906a:docs/<ruta>`).
