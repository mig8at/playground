# MS Pre-approvals · contexto
> **estado:** al día con main · MS Go hexagonal (`pre-approvals-service`, **AHORA INDEXADO** — 133 nodos Go en el árbol). Resuelve la pre-aprobación de lenders rt≠0 (principalmente rt=1) del wizard nuevo contra las APIs externas, vía un workflow de 4 etapas, cachea en DynamoDB y espeja el resultado a legacy. Este nodo cubre **ambos lados**: el CLIENTE (front/legacy que consume el MS) y el SERVIDOR (el microservicio Go real).

## Qué es
Microservicio **Go** de arquitectura **hexagonal estricta** (`pre-approvals-service`, módulo `github.com/Creditop-SAS/go-template`; Go 1.24 · Gin · Uber FX · Viper `platform/config` · DynamoDB · OTel · `shopspring/decimal`). Resuelve la **pre-aprobación de lenders de integración (rt≠0)** para el wizard nuevo: recibe un `POST /v1/preapprovals/check` **por lender**, resuelve credenciales del comercio, se autentica, golpea la **API externa del proveedor** (Welli, Meddipay, Prami, Bancolombia BNPL/Consumo, Sistecrédito, Credifamilia, CreditopX), canoniza el veredicto a `approved`/`rejected`/`pending`, lo **cachea en DynamoDB** y, best-effort, **espeja el resultado terminal a legacy** para el perfilamiento.

Coexiste con el path viejo (`PreApprovedLenderService` PHP en application/legacy) en **parallel-run**: el wizard nuevo consume este MS directamente; el monolito sigue con su switch por id. Los dos mundos pueden divergir. El detalle a nivel de **flujo rt=1** (familia de lenders, handoff/entrega, Corbeta, webhooks de cierre) es del nodo hermano **Aggregator**; acá se describe el **servicio** (la pieza de arquitectura) y su consumo.

**Frontera de responsabilidad (rt=1):** CreditOp solo (a) decide **qué** lenders consultar, (b) aporta **datos** del solicitante (Experian/KYC vía user-service legacy) y **credenciales** del comercio, (c) **traduce** la respuesta y **ordena**. La **decisión de crédito, monto y cupo la calcula 100% la API externa** — por eso rt=1 **NO es inyectable/simulable** de punta a punta (a lo sumo se mockea el transporte HTTP, tarea del nodo Harness).

## Arquitectura cliente → MS → proveedor
```
WIZARD (frontend-monorepo)                 MS Go (pre-approvals-service)                    EXTERNOS
available-lenders.tsx (loader)   ──POST──▶  Handler.Check (handler.go:45)
  · lee VITE_PREAPPROVALS_ENDPOINT          · valida key + amount/hash/minimum (:103)
  · 1 Promise por lender rt≠0               · factory.CreateLendingProduct (factory.go:45)
  · fallback lenders esperan el batch       · CheckPreApprovalUseCase.Execute (:56)
fetch-lender-preapproval.ts (POST)            ├─ cache DynamoDB ShouldCheckAgain (:81)
  · status→estado UI, hide 5xx, 422           ├─ GetApplicant → legacy user-service ────▶ /api/onboarding/user/{id} (Experian)
                                               ├─ Welli 141/142→23 override (:122)
                                               └─ PreApprovalWorkflow.CheckPreApproval (workflow.go:52)
                                                    ├─ runCredentials ──────────────────▶ legacy /credentials/get-by-lender
                                                    ├─ runAuth (AuthStrategy) ──────────▶ OAuth2 / token / api-key del proveedor
                                                    ├─ runAPICall (Client) ─────────────▶ API EXTERNA del lender  ★ decisión
                                                    └─ runAdapt (ResponseAdapter) → approved/rejected/pending
                                             · Save/Replace en DynamoDB + lender attempt
                                             · notifyLenderResult (best-effort) ────────▶ legacy /loan-application/{ur}/lender-result
ListLenderController::storeLenderResult ◀────  (solo approved|rejected con user_request_id)
  → profiling_reviews.displayed_lenders
```

## Contrato del servicio (endpoints reales)
Rutas registradas en `main.go` (grupo `/v1`) + `/docs`:
- **`POST /v1/preapprovals/check`** (`handler.go:45 Check`) — server-to-server, sin CORS. **Request** (`openapi.PreApprovalRequest`, tipos en `internal/openapi/types.gen.go`): `applicant_id`, `merchant_id`, `lending_product_key` (enum de 8), `lending_product_id` (numérico = el id del lender en BD), `amount`/`allied_branch_hash`/`allied_branch_id` (opcionales, requeridos por algunos lenders), `user_request_id` (opcional → dispara **attempt** + **notify** a legacy). **Response 200** (`PreApprovalResponse` vía `mapper.go:10`): `id`, `applicant_id`, `lending_product_key`, `lending_product_id`, `status`, `approved_amount` (string), `available` (cupo float), `probability`/`probability_color`/`sort`, `pre_approved_lender`, `transaction_id`, `transaction_data` (blob por-lender), `checked_at`. **NO viajan** `expires_at`/`created_at`/`raw_response` (internos de DynamoDB).
- **`POST /v1/preapprovals/me/check`** (`handler.go:146 CheckMe`) — variante self-service: toma el `applicant_id` del header **`X-User-Id`** (falta → `401 unauthorized`); resto idéntico.
- **`POST /v1/lender-attempts`** (`lender_attempts/handler.go:42 Register`) — **NUEVO surface**. Registra un intento (`lender_id`, `user_request_id`, `allied_branch_id`, `status` opcional SUCCESS/FAIL/TIMEOUT). `201 Created`; duplicado idempotente → `409 conflict` (`ErrLenderAttemptAlreadyExists`).
- **`GET /v1/lender-attempts/by-lender/:lender`** (`:112 ListByLender`) — lista paginada de intentos por lender; query `from`/`to` (RFC3339), `limit`, `next_token`. Alimenta métricas/trazabilidad de intentos por entidad.
- **`GET /docs`** + **`GET /docs/spec`** (`handlers/docs/http_handler.go`) — Swagger UI + el `openapi.yaml` servido (swagger habilitable por `http_server.swagger.enabled`).

**Errores del `check`**: `400` (JSON inválido / `invalid lending product key` / `amount is required` / `allied_branch_hash is required`), `422` `amount_below_minimum` + `minimum_amount` (`handler.go:121`), `401` (auth), `404` (applicant no encontrado), `500` (todo lo demás). **OJO — coarsening deliberado**: dentro del workflow cada fallo produce un `LenderError` con taxonomía fina (ver abajo), pero el handler `executeCheckPreApproval` (`:221`) lo colapsa: solo mapea las sentinelas `ErrNotFound→404`, `ErrInvalidInput→400`, `ErrAuthenticationFailed→401`; **cualquier fallo de proveedor (transport/5xx/4xx upstream) cae a `500`** porque su `Cause` es `ErrLendingProductUnavailable` (no está en esos sets). La taxonomía rica vive **solo en logs/spans OTel**, no en el status HTTP.

## Requisitos por lender (validación de entrada, `domain/lending_product.go`)
- **8 keys válidas**: `bancolombia_bnpl`, `bancolombia_consumer_loan`, `sistecredito`, `meddipay`, `creditop_x`, `welli`, `credifamilia`, `prami`. Key desconocida (ej. `banco-de-bogota`) → `400`.
- **RequiresAmount**: `bancolombia_consumer_loan`, `meddipay`, `prami`, `welli`.
- **RequiresAlliedBranchHash**: `meddipay`, `prami`, `welli` (arman payload con datos de sucursal).
- **MinimumAmount** (→ `422`): consumer_loan `1.000.000`, bnpl `100.000`, meddipay `50.000`, prami `300.000`, welli `180.000`. (creditop_x, sistecredito, credifamilia sin mínimo declarado.)
- **CredentialScope**: **Merchant** (una credencial por comercio, ignora el hash) = Bancolombia BNPL/Consumo, Meddipay; **Branch** (por sucursal, reenvía `allied_branch_hash`) = Sistecrédito, CreditopX, Welli, Prami, Credifamilia. (`workflow.go:69` limpia el hash si scope=Merchant y no lo requiere.)

## Workflow de 4 etapas (`workflow.go:52`, idéntico para todo lender)
`runCredentials(:101)` → `runAuth(:117)` → `runAPICall(:131)` → `runAdapt(:145)`. Cada etapa abre un span OTel (`lender.<key>.<stage>`) y, si falla, pasa por `failStage(:167)` → `normalizeStageError(:193)` que construye/enriquece un `LenderError`. Cada lender aporta **3 piezas intercambiables** que la **factory** (`factory/factory.go:45`) cablea por key: **AuthStrategy**, **Client** (`LendingProductClient.CallAPI`) y **Adapter** (`ResponseAdapter.Adapt`) — más un **CredentialsService** (real para todos salvo CreditopX, que usa `NewNoOpCredentialsService`). Puertos del hexágono: `ports/{auth_strategy,lending_product_client,response_adapter,credentials_service,preapproval_repository,lender_attempt_repository}.go`.

## Matriz de proveedores (lender → adapter Go)
Todos viven en `internal/infra/lending_products/<lender>/` con la tripleta `client.go` (llamada externa) + `<auth>_strategy.go` + `adapter.go` (canon del veredicto), y varios un `error_adapter.go` (fabricantes de `LenderError` por stage) y `sandbox.go` (remap en no-prod).

| key | scope | auth (strategy) | API externa | regla APPROVED (en adapter) | `available` | notas |
|---|---|---|---|---|---|---|
| `bancolombia_bnpl` | Merchant | OAuth2 client-credentials (`oauth2_strategy.go`) | `…/prospect-validation/validate-quota` | `data.validate==true && len(errors)==0` | — (nil) | `sandbox.go` remap en no-prod; hosts vía env `BANCOLOMBIA_*` |
| `bancolombia_consumer_loan` | Merchant | OAuth2 (`oauth2_strategy.go`) | `…/customers/validate` | `data.validate=="Success"` (case-insensitive); error `BP40920507`→rejected | — | **transaction_data lleva challenge** `urlAuthenticate`+`customerValidateKey` (autenticación del cliente) |
| `sistecredito` | Branch | API key (`api_key_strategy.go`) | `getCreditLimitClient` | `data.status==1 && data.isActive` | `availableCreditLimit` | `errorCode!=0` → **error** (`ErrLendingProductUnavailable`→500), no rejected |
| `meddipay` | Merchant | login user/pass/app (`token_strategy.go`) | CreateOrder | `creditLimit.result=="APP"` | `creditLimit` | **nunca cachea** (nuevo `order_id`/request); `transaction_data=data` completo; `error_adapter.go` con taxonomía auth+api |
| `creditop_x` | Branch | **NoAuth** (`no_auth_strategy.go` + `no_op_credentials_service.go`) | `…/loans/lender/available-quota` (hardcode) | `has_quota && status=="approved"` | `quota_details.total_available` | **ExpiresAt = now+60min** (TTL corto); rt=2; el cupo rt=2 productivo se sella en legacy, no acá |
| `welli` | Branch | access token de creds metadata (`access_token_strategy.go`) | `/api/externals/risk/run_risk/` | `estado=='approved' && monto_aprobado>0` | `monto_maximo_credito` | remap sandbox del applicant en no-prod; override **141/142→23** en el use case; `error_adapter.go` |
| `prami` | Branch | API key (`api_key_strategy.go`) | `/v1/creditop/{evaluate,quota-options,confirm-credit}` (combinado) | `Evaluate.MaxApprovedAmount>0` | `maxApprovedAmount` | `transaction_data`=`{quotas,order_id,maxApprovedAmount}` |
| `credifamilia` | Branch | OAuth2 **password grant** (`oauth2_strategy.go`) | preapproval REST combinada | `status==3 && statusDetail=="APROBADO"`; `status∈{0,1,2,4}`→**PENDING**; else rejected | `ValorDisponibleParaComprar` | **ÚNICO que emite `pending`** (async, front hace polling); timeout **30s** (resto 10s); `lender_data.go` = blob rico (cuotas, tasas, seguros, `checkout_url`) |

`BuildContractFields` (`contract_fields.go:20`) fija el contrato de presentación con el front: approved → `'Pre aprobado'`/`text-success`/`sort=1`/`pre_approved_lender=true`; else → `'Rechazado'`/`text-info`/`sort=2`. Credifamilia tiene su propio `buildContractFields` (`lender_data.go:19`) que agrega un tercer estado `'En validación'` para el pending.

## Taxonomía de errores (`domain/lender_error.go`)
`LenderError{Lender, Stage, Code, Message, StatusCode, Body (sin truncar, por auditoría), Cause, Retryable}` — forma única que todo lender devuelve al workflow, pensada para dashboards Grafana (los códigos son **estables a propósito**).
- **Stages**: `credentials`, `auth`, `api_call`, `adapt`.
- **Codes (~20)**: `missing_credentials`, `credentials_lookup_failed`, `invalid_input`, `auth_unauthorized`, `auth_http_error`, `auth_transport_error`, `auth_decode_error`, `auth_empty_token`, `upstream_4xx`, `upstream_5xx`, `upstream_unexpected_status`, `upstream_logical_failure`, `transport_error`, `read_body_failed`, `decode_response_failed`, `missing_transaction_id`, `adapt_failed`, `branch_lookup_failed`, `build_client_failed`, `unknown`.
- **Retryable=true** en transport y `upstream_5xx` (los `error_adapter.go` de welli/meddipay lo marcan; ej. `apiHTTP`: `>=500`→5xx retryable, `>=400`→4xx no-retryable). El `failStage` emite estos como atributos de span + log estructurado; **el `Retryable` NO se auto-reintenta en el MS** (el reintento lo hace el front vía `preapproval-retry.tsx`).

## Use case / cache / notify (`usecases/preapproval/check_preapproval.go`)
`Execute(:56)`: coerción amount/branch → **cache lookup** `FindLatestPreApproval` → `ShouldCheckAgain` (`preapproval.go:42`) → si sirve, devuelve cacheado + registra attempt; si no, `GetApplicant` (legacy, trae `ExperianProfile` con score/estimated_income/bucket_mora/edad/sectores) → **override Welli 141/142→'23'** (`:122`; **166 NO se colapsa**) → workflow → `Save` (nueva fila, preserva historial) o `Replace` (si el previo era `pending`: mantiene ID/CreatedAt para no romper el polling) → `registerAttempt` (si hay `user_request_id`) → `notifyLenderResult`.
- **`ShouldCheckAgain`**: **Meddipay siempre re-consulta** (`:45`); `pending` siempre (`:49`); `rejected` si cambió el monto o pasó `RejectedRetryHours=12h` (`:53`); `approved` válido si `ExpiresAt` futuro **y** el monto no cambió (`:61`).
- **`registerAttempt`**: idempotente por `user_request_id+lender_id+allied_branch_id`; parsea `lending_product_id`→lender_id; status `SUCCESS`. Se registra **también en cache-hit** (todo check cuenta como intento).
- **`notifyLenderResult`** (`lender_result_service.go:41`): `POST {legacy}/api/onboarding/loan-application/{ur}/lender-result` con `{lender_id, is_approved, available_amount}`. Guardas: **solo** si hay `user_request_id` **Y** status `approved`|`rejected` (**`pending` y sin-UR se saltan**); best-effort (falla = log, no bloquea). En legacy lo recibe `ListLenderController::storeLenderResult` (`:88`) que repuebla `profiling_reviews.displayed_lenders`; ruta backend-to-backend **sin Cognito**, `withoutMiddleware(AddOriginationFlowType)` (`webhooks.php:18-20`).

## Servicios de plataforma (infra) hacia legacy
- **CredentialsService** (`credentials_service.go`): `POST {legacy}/api/onboarding/credentials/get-by-lender` con `{lender_id, merchant_id, allied_branch_hash?}`; respuesta `data`=`domain.Credentials` (mapa opaco de claves por-lender). Cache in-memory `sync.Map` por `key:id:merchant:hash` con `ClearCache`. Vacío → `ErrInvalidCredentials`.
- **ApplicantService** (`applicant_service.go`): `GET {user_service}/user/{id}`; parsea el user legacy + `experian_profile` a `domain.Applicant`/`ExperianProfile`. `404`/`success=false` → `ErrUserNotFound`.
- **AlliedBranchService** (`allied_branch_service.go`): `GET /api/onboarding/allied-branch/{hash}` (lo usan Welli/Meddipay/Prami para meter datos de sucursal en el payload).

## Config / puertos / perfiles (`config/config.example.yaml`, no indexado — conocimiento)
- **8082** = address de red en dev/prod (`http://pre-approvals-service.inertia-develop:8082`, lo resuelve `VITE_PREAPPROVALS_ENDPOINT`); **8086** = bind local del `http_server` (`config.yaml:port`) — red (deploy) vs bind (local), no es contradicción. `read/write_timeout=30s`.
- **DynamoDB**: region `us-east-2`, tablas `preapprovals-dev` + `preapproval_attempts-dev`; `endpoint` vacío = AWS real (local vía docker-compose en `:9000`).
- **Timeout por lender**: 10s todos, **Credifamilia 30s**.
- **Precedencia de config** (`cmd/http-server/config_loader.go`): `profiles/<LENDER_PROFILE>.yaml` (más bajo) < `config.yaml` < **env vars** (ganan). Perfiles: `lambdas-local` (mocks welli:3001/meddipay:3002/prami:3003/credifamilia:3000), `lambdas-aws`, `lenders-staging`, `lenders-production` (los `.yaml` reales gitignoreados; ⚠️ prod pega a central de riesgo). Aliases Bancolombia por env (`BANCOLOMBIA_HOST/AUTH_*/BNPL_PREFIX/…`, `main.go:56`).
- **`app.env`** ∈ {production, prod} → `isProductionEnv` → apaga los remaps de sandbox (Welli/Bancolombia). `HTTP_DUMP_ENABLED=true` imprime cada intercambio HTTP (auth+API) estilo curl a stdout (off por default, evita filtrar tokens/PII). Tracer OTel → `otel-collector.inertia-develop:4318`.

## Consumo desde el wizard (lado cliente, ya en el nodo)
El loader de `available-lenders.tsx` lee `VITE_PREAPPROVALS_ENDPOINT` (`:147`) y **sin endpoint / `user_id` / `allied_id` salta TODO el bloque** (`:185`) → todos los rt≠0 quedan "No pudimos consultar esta entidad". Dispara una `Promise` por lender: los no-fallback en paralelo, los `is_fallback_lender` **esperan al batch primario** (`Promise.allSettled`, `:235`), y Welli usa un consult-lender especial (`:206-226`). El cliente `fetch-lender-preapproval.ts` hace `POST` y mapea `status` → estado UI: `approved` → card pre-aprobado; `rejected` → chip "Sin cupo disponible" (soft, **no oculta**); `pending` → skeleton (Credifamilia hace polling); error `http_5xx` → **card OCULTA** (`SERVER_ERROR_REASON=/^http_5\d{2}$/`; `isServerErrorResolution` en `AvailableLenders.tsx:435`); error `http_4xx` (negocio) → "No pudimos consultar" + **Reintentar** (`preapproval-retry.tsx` re-golpea el MS). El `422` se mapea a `below_minimum`+`minimumAmount`. El front postea `visibleLoanOptions` de vuelta a legacy vía `/lender-results` **plural** (`storeLenderResults`) — relay distinto del notify singular del MS. `validate-preapproved-loan.uc.ts` valida al SELECCIONAR la entidad.

## Contraparte legacy (parallel-run)
`PreApprovedLenderService::validatePreApproveLender` (`:41`): switch **bifurcado por `lender->id`** (no polimórfico) que consulta la misma API externa y **empuja** a `$approvedLenders` (sort=1) **o excluye** con `unset`. Filtro **temporal** en `LenderRetrievalService.php:252` `[12, 23, 141, 142, 166]` (Prami + variantes Welli + 166; `// TODO: [TEMPORAL]` en `:248`) los saca del preaprobado sincrónico porque erroran por falta de datos en `employment-info`.

## Fronteras (qué cede este nodo)
- **Harness** (nodo hermano): el mock/ejercitador del MS (mockery-lambdas, panel de inyección, perfiles `lambdas-local`). Este nodo describe el **servicio real**, no cómo se mockea. Las `sandbox.go`/remaps SÍ son del servicio (viven en él) y se documentan acá; los mocks HTTP externos (welli-mockery-lambda, etc.) son del harness.
- **Aggregator** (nodo hermano): la **decisión de negocio rt=1** del lender (familia de agregadores, handoff/entrega, Corbeta batch, webhooks de cierre, cartera del tercero). Este nodo NO absorbe la resolución cliente de aggregator; conserva los suyos (`available-lenders.tsx`, `fetch-lender-preapproval.ts`, `preapproval-retry.tsx`, `validate-preapproved-loan.*`, `lender-results` relay).
- **Profiling** (consumidor): recibe el notify y repuebla `displayed_lenders` — este nodo llega hasta `storeLenderResult`, no modela el perfilamiento.
- **Credifamilia** tiene nodo propio (rt=4, formalización SOAP); acá solo el tramo de pre-aprobación async (el adapter que emite `pending`).

## Gotchas / riesgos
- **Coarsening HTTP**: la taxonomía fina de `LenderError` (20 códigos × 4 stages) **NO llega al status HTTP** — todo fallo de proveedor es `500` para el front (→ card oculta). Las 4xx/422 que ve el front son **validación pre-workflow** (key/amount/hash/mínimo) o applicant-not-found (404). Un **rechazo de negocio** del proveedor NO es error: es HTTP 200 `status:"rejected"` (chip suave).
- **Dos mundos paralelos que divergen**: Welli id **166 solo existe en application**; en legacy/MS es 23/141/142 — y el MS colapsa 141/142→23 pero **NO** 166.
- **El espejo a legacy es best-effort**: si `/lender-result` falla se loguea pero no bloquea → posible deriva entre lo que ve el usuario y lo que persiste el profiling. Y **`pending` NO repuebla `displayed_lenders`** (solo approved/rejected disparan el notify).
- **Meddipay nunca cachea** (`ShouldCheckAgain=true` siempre → nuevo `order_id`). **CreditopX cachea 60min** (TTL corto). El resto expira a 30 días (salvo lo que diga la fecha del proveedor, ej. Meddipay `dateExpiration`).
- **Credifamilia es el único async**: el único adapter que emite `StatusPending` (status 0/1/2/4); el front tolera más que el `write_timeout=30s` a propósito (abortar mid-flight duplicaba transacciones) y hace polling.
- **Bancolombia Consumo trae un challenge**: su `transaction_data` (`urlAuthenticate`/`customerValidateKey`) es una **autenticación del cliente** que fluye verbatim al front — matiza la creencia de que el `frontend_response`/`encrypt_code` es puro legacy PHP; el MS también forwardea un blob de challenge para consumer_loan.
- **Estados que el MS NO emite**: su core enum son 3 (`approved`/`rejected`/`pending`). El front reconoce además `not_eligible` (sin emisor en el core; defensivo). `transaction_data` es un **blob por-lender sin contrato** (`json.RawMessage`) que fluye verbatim al front.
- **`creditop_x` es una de las 8 keys del factory** (available-quota rt=2 hardcodeada, NoAuth+NoOpCreds), pero el cupo rt=2 productivo se sella en legacy `/available-quota`; no confundir el nodo (rt≠0/integración) con esa key.
- **`/v1/lender-attempts` es surface nuevo**: store idempotente de intentos por lender (SUCCESS/FAIL/TIMEOUT), separado del `check`. El `check` registra attempts internamente; el POST expuesto permite registrarlos desde afuera y el GET los lista paginados (trazabilidad de intentos por entidad).

## Bitácora
- **2026-07-18** — Refresh: `pre-approvals-service` ahora INDEXADO (133 nodos Go). Sumada la superficie del **lado servidor** (57 archivos Go: contrato/handlers, factory+workflow, matriz de 8 proveedores con adapter/client/strategy, dominio+taxonomía de errores, use case+cache+notify, servicios a legacy, ports) a los 15 previos del lado cliente. 72 archivos, 0 DROP. Nota: el índice solo tiene `.go` — config yaml, docs md, openapi.yaml y el paquete `storage/dynamodb/*` NO están indexados (quedan como conocimiento; se referencian `internal/openapi/types.gen.go` y los ports `preapproval_repository`/`lender_attempt_repository` como equivalentes del contrato/persistencia).
- **2026-07-17** — Fase de data: superficie de código curada + doc enriquecido desde `git 159906a:docs/codigo/SERVICIO-PRE-APROBACIONES.md`, verificado contra el repo real y los 3 repos indexados.

## Enlaces
- Padre: **Architecture** (los repos del ecosistema). Flujos hermanos: **Aggregator** (rt=1: negocio del lender, Corbeta, webhooks) · **Redirect** (rt=0) · **Harness** (mock/inyección del MS). Consumidor del notify: **Profiling** (`displayed_lenders`). Credifamilia = rt=4 (async/polling, su propio flujo).
- Docs propios del repo (no indexados): `docs/ARCHITECTURE.md`, `docs/CONTEXT.md`, `openapi.yaml`, `README.md`, `config/config.example.yaml`.
- Fuente profunda histórica: `git 159906a:docs/codigo/SERVICIO-PRE-APROBACIONES.md` · `…/AGREGADORES-FLUJO-ANALISIS.md`.
- Memorias: `pre-approvals-service`, `synth-lender-type-boundary`, `refactor-perfilamiento-lenders`, `lender-listing-cascade`.
