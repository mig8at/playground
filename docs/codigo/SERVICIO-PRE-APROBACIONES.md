# Servicio de Pre-Aprobaciones (`pre-approvals-service`)

Microservicio **Go** que orquesta la consulta de pre-aprobación de **lenders de integración** (rt≠STANDARD) contra sus APIs externas, con un contrato unificado. Es el que el wizard de originación consulta por cada lender de integración del marketplace.

- **Repo:** `github/pre-approvals-service` (módulo `github.com/Creditop-SAS/go-template`).
- **Stack:** Go 1.24 · Gin (HTTP) · Uber FX (DI) · Viper (config) · DynamoDB (AWS SDK v2) · OpenTelemetry · `shopspring/decimal` (montos). Arquitectura **hexagonal estricta** (linter `depguard`).
- **Puerto:** **8082** = address del servicio en dev/prod (`http://pre-approvals-service.inertia-develop:8082`, vía VPN), el que resuelve `VITE_PREAPPROVALS_ENDPOINT`. **8086** = bind local del `http_server` (`config/config.example.yaml`). No es contradicción: red (deploy) vs bind (local).
- **Docs propios (autoritativos):** `pre-approvals-service/docs/ARCHITECTURE.md`, `docs/CONTEXT.md`, `openapi.yaml` (+ Swagger en `/docs`). Este doc es el resumen para el contexto de originación/testeo.

---

## 1. Qué hace / dónde encaja

En el marketplace, los lenders **STANDARD (rt=0)** se clasifican por reglas/probabilidad sin llamada externa. Los **de integración (rt≠0)** necesitan preguntarle a la entidad si pre-aprueba — eso es lo que hace este servicio: recibe un applicant + lender, llama a la **API externa de ese lender** (Welli, Meddipay, Prami, Bancolombia, etc.), mapea la respuesta a un estado unificado (`approved`/`rejected`/`pending`), lo **cachea en DynamoDB**, y opcionalmente notifica al legacy-backend para perfilamiento.

Antes había un camino **síncrono v1** (la pre-aprobación corría dentro del listado de lenders en legacy, uno por uno → lento, causaba "Server Timeout"). El wizard de `develop`/main ahora usa este MS **asíncrono**: el loader de `/lenders` lista rápido y dispara una pre-aprobación **diferida por lender** que React Router stream-ea. Ver [[lender-listing-cascade]] y [[refactor-perfilamiento-lenders]].

---

## 2. Contrato HTTP

`POST /v1/preapprovals/check` (server-to-server, sin CORS; lo llama el loader del wizard).

**Request** (`openapi.yaml` · `internal/openapi/types.gen.go`):
```json
{
  "applicant_id": "1827563",          // requerido — id del usuario (resuelve perfil en legacy)
  "merchant_id": "26",                 // requerido
  "lending_product_key": "meddipay",   // requerido — enum (ver matriz §4)
  "lending_product_id": "39",          // requerido — id numérico del lender
  "amount": 614640,                    // opcional — requerido por welli/meddipay/prami/bancolombia
  "allied_branch_hash": "76db47f5",    // opcional — requerido por meddipay/welli/prami (datos de tienda)
  "allied_branch_id": 123,             // opcional — se registra en el intento
  "user_request_id": 463837            // opcional — dispara intento + notificación a legacy
}
```

**Response 200** (campos clave): `status` (`approved`|`rejected`|`pending`), `approved_amount`, `available` (cupo), `probability`/`probability_color`/`sort` (para la UI), `transaction_id`, `transaction_data` (metadata por-lender, ej. cuotas/oferta), `checked_at`. *(⚠️ `expires_at` NO viaja en el response HTTP — es un campo interno de DynamoDB para el filtro de frescura/TTL; ausente de `PreApprovalResponse` en `types.gen.go`.)*

**Errores** (`ErrorResponse` = `{ "error": "<code>", "details": "<msg>" }`):
- `400` — JSON inválido, falta campo, o **`invalid lending product key`** (`lending product not found: <key>`).
- `422` — `AmountBelowMinimumResponse` = `{error, details, minimum_amount, lending_product_key}`.
- `500` — `internal server error` (típicamente `transport_error` del proveedor externo: timeout/unavailable).

---

## 3. Cómo lo consume el wizard + taxonomía de UI

El wizard lo lee de **`VITE_PREAPPROVALS_ENDPOINT`** (`frontend-monorepo/apps/loan-request-wizard/app/routes/lenders-marketplace/available-lenders.tsx:124`). **Sin ese env el bloque se saltea (`:162`) y TODOS los rt≠0 muestran "No pudimos consultar esta entidad".** Cableado en el harness: `frontend-e2e/bin/asesor` (boot) + `frontend-e2e/.env.dev` (`E2E_PREAPPROVALS_ENDPOINT`).

El adapter del cliente (`fetch-lender-preapproval.ts`) hace `POST` directo al endpoint y mapea el `status` → estado de UI:

| Resultado del MS | Estado wizard | UI |
|---|---|---|
| `approved` | `approved` | Card pre-aprobado (recomendado) con **Valor a financiar + Cuota + cupo** |
| `rejected` | `rejected` | Chip soft **"Sin cupo disponible"** (`probability-medium`); no se auto-pre-aprueba pero el asesor puede continuar a mano (`lender-resolution.service.ts:55`, `LenderCardProcessing.tsx:26`) |
| `pending` | `processing` | Skeleton "Consultando oferta…"; Credifamilia hace **polling** (hasta 180s) |
| error `http_4xx` (negocio) | `error` | **"No pudimos consultar esta entidad" + Reintentar** |
| error `http_5xx`/timeout (server) | `error` | **Card OCULTA** — `SERVER_ERROR_REASON = /http_5\d{2}$/` → `isServerErrorResolution` → filtrada en `AvailableLenders.tsx:412-416` |

→ Por eso un proveedor externo caído (ej. Meddipay/tars-dev `500`) **desaparece** del marketplace en vez de mostrar error.

> **Ocultamiento — hay 3 predicados** (`visibleLoanOptions`, `AvailableLenders.tsx`), no solo el 5xx: (a) **error 5xx propio** del lender (tabla de arriba); (b) **fallback** — un lender `is_fallback_lender` se oculta si **otro** lender (no-fallback) responde `approved` con monto ≥ umbral (`fallback-lender.service.ts`); (c) **variante Welli** — cuando Welli Tasa Full (23) aprueba, se oculta 23 **o** Riesgo Compartido (166) según `comision_aliado` (`welli-shared-risk.service.ts`). Un `rejected` (4xx / sin cupo) **nunca** oculta: deja la card con "Sin cupo disponible". Los no-STANDARD se piden en paralelo (batch primario) y los `is_fallback_lender` esperan al batch vía `Promise.allSettled`.

> **Status `frontend_response` (solo front).** El wizard maneja un 4º status `frontend_response` (+ campo `encrypt_code`) que **este MS Go NO emite** (su enum es `approved`/`rejected`/`pending`). Es un status de **Bancolombia que vive en el legacy PHP** (`config/api_bancolombia_loan_requests.php`) — rama del wizard sin emisor conocido en el MS actual (¿path legacy vivo o forward-looking?). Ídem `encrypt_code` (lo genera el legacy para el handoff Bancolombia, no el MS).

---

## 4. Matriz de lenders (key → proveedor externo)

Adapters en `internal/infra/lending_products/<lender>/`. URLs **staging** (de `config/profiles/lenders-staging.yaml.example`; dev usa lambdas-mock, ver §6).

| Lender | `lending_product_key` | Auth | Monto mín. | Req. sucursal | Req. Experian | Async | Proveedor externo (staging) |
|---|---|---|---|:---:|:---:|:---:|---|
| Welli | `welli` | AccessToken | 180.000 | ✓ | ✗ | ✗ | `stg.api.myabe.welli.com.co` `/api/externals/risk/run_risk/` |
| Meddipay | `meddipay` | Token | 50.000 | ✓ | ✗ | ✗ | `tars-dev.azurewebsites.net` `/CREDITOP/Customer/CreateOrder` (+ auth `sora-authentication-dev`) |
| Prami | `prami` | APIKey | 300.000 | ✓ | **✓** | ✗ | `prami-develop-env…elasticbeanstalk.com` `/v1/creditop/evaluate` + `/quota-options` |
| Credifamilia | `credifamilia` | OAuth2 + **mTLS** | — | ✓ | ✗ | **✓** (polling) | `pruebas.credifamilia.com.mx` `/servicescf/consumo/radicacion[/estado]` |
| Sistecrédito | `sistecredito` | APIKey | — | ✗ | ✗ | ✗ | `api.credinet.co/pos/getCreditLimitClient` |
| Bancolombia BNPL | `bancolombia_bnpl` | OAuth2 | 100.000 | ✗ | ✗ | ✗ | `gw-sandbox-qa.apps.ambientesbc.com` `…/bnpl/prospect-validation/validate-quota` |
| Bancolombia Consumo | `bancolombia_consumer_loan` | OAuth2 | 1.000.000 | ✗ | ✗ | ✗ | `gw-sandbox-qa…` `…/consumer-loan/customers/validate` |
| CreditopX | `creditop_x` | Ninguna | — | ✓ | ✗ | ✗ | `api.creditop-x.com/api/loans/lender/available-quota` (hardcoded) |

Resolución por `factory.go` (key → cliente+auth-strategy+adapter). **Key desconocida** (ej. `banco-de-bogota`) → `ErrLendingProductNotFound` → `400 invalid lending product key`.

---

## 5. Flujo interno (usecase)

`internal/core/usecases/preapproval/check_preapproval.go`:
1. **Cache (DynamoDB):** busca el último preapproval por `(applicant_id, merchant_id, lending_product_key, lending_product_id, allied_branch_hash)` y `ShouldCheckAgain()` decide si reusa. Reglas: **Meddipay siempre re-consulta** (commit `6a5e11c` — necesita nuevo `order_id`); `pending` siempre; `rejected` si cambió el monto o pasaron 12h; `approved` si expiró o cambió el monto.
2. **Applicant:** `applicantService.GetApplicant` → legacy `…/api/onboarding/user/{id}` (trae perfil Experian).
3. **Adapter:** `factory` resuelve el lender → llama su API externa → mapea a `approved`/`rejected`/`pending`.
4. **Persistencia:** `Save`/`Replace` en DynamoDB (`preapprovals-dev`); si había `user_request_id`, registra **lender attempt** (`preapproval_attempts-dev`, único por `user_request_id+lender_id+allied_branch_id`).
5. **Notificación:** si `approved`/`rejected` + `user_request_id`, `POST …/loan-application/{ur}/lender-result` al legacy → alimenta perfilamiento ([[refactor-perfilamiento-lenders]]).

Servicios de apoyo (`internal/infra/services/`): `credentials_service` (credenciales por lender desde legacy, cacheadas), `applicant_service`, `allied_branch_service` (datos de tienda), `lender_result_service`.

---

## 6. Config / perfiles

`LENDER_PROFILE` selecciona el perfil (`config/profiles/`):
- **`lambdas-local`** → mocks en `localhost:3001-3003`.
- **`lambdas-aws`** → mocks lambda en AWS (probar el contrato sin levantar nada).
- **`lenders-staging`** / **`lenders-production`** → sandboxes/prod reales (`.yaml` gitignoreado; URLs/credenciales por Secrets/SSM). ⚠️ prod cuenta a central de riesgo.

Otros (`config/config.yaml`): DynamoDB (`preapprovals-dev`, `preapproval_attempts-dev`, region us-east-2), `legacy_backend_service.base_url = http://legacy-backend.inertia-develop`, timeouts (10s, Credifamilia 30s), otel collector.

---

## 7. Implicaciones para testeo (synth)

Confirma la frontera de [[synth-lender-type-boundary]]: los rt≠0 deciden vía **API externa real**, no inyectable. En el flujo synth (`bin/asesor … lenders`):

- **Prami** → `400 invalid_input: applicant.experian_profile required` — **frontera synth pura** (necesita Experian real que el sintético no tiene).
- **Meddipay / Welli** → `500 transport_error` cuando sus APIs (tars-dev / stg.welli) timeoutean → **card oculta** (no es bug del wizard). Son **intermitentes** (Welli observado caído y luego `approved` en corridas consecutivas).
- **Banco de Bogotá** → `400 invalid lending product key` (`banco-de-bogota` no está en el `factory` del MS de dev) — gap de config del MS, no del wizard.
- **Cache DynamoDB:** un `approved` cacheado se reusa hasta expirar/cambiar monto; Meddipay nunca cachea. Afecta re-runs.
- **Para que un rt≠0 se vea pre-aprobado en synth** hace falta que su proveedor responda `approved` (ej. Welli cuando stg.welli está arriba → card con Valor a financiar/Cuota). Lo que no responde por timeout (5xx) se oculta; lo que rechaza por negocio (4xx) muestra "No pudimos consultar".

---

## 8. Mock local para happy path (`bin/mock-preapprovals`)

Para avanzar pruebas sin depender de los proveedores externos (intermitentes: Welli/Meddipay timeoutean) ni de la frontera synth (rechazos reales), hay un **mock determinista** del MS en `frontend-e2e/mock-preapprovals/server.mjs` (Node, cero deps).

- **Integrado:** `bin/asesor <comercio> lenders --mock-pa` → levanta el mock (`:8095`), reinicia el wizard apuntándolo (`--fresh`), maneja hasta lenders. **Todas las cards de integración salen "Pre aprobado · Cupo $25.000.000"** con selector de cuotas + "Activar mi crédito" — incluido Banco de Bogotá (que el MS real rechaza por key desconocida). Verificado e2e en sonria (5/5 pre-aprobados, flujo ~49s sin timeouts).
- **Standalone:** `bin/mock-preapprovals [start|stop|status|logs]` + apuntar `VITE_PREAPPROVALS_ENDPOINT=http://localhost:8095/v1/preapprovals/check`.
- **Shape** (matchea `LenderPreApprovalResultSchema`): `status:"approved"` + `available` (cupo) + `approved_amount` + `probability:"Pre aprobado"` + `sort:1` + `transaction_data` por-lender (Welli `plan_de_cuotas`, Meddipay `commercialOffer`, Prami `quotas`, resto `null` → camino genérico con `credit_lines` + amortización client-side). La cuota se calcula por amortización francesa (rate `MOCK_PA_RATE`, default 1.88% M.V).
- **Knobs (env):** `MOCK_PA_STATUS=approved|rejected|pending` (global), `MOCK_PA_CUPO` (25M), `MOCK_PA_RATE` (0.0188), `MOCK_PA_PORT` (8095). Por request: `?status=`, header `x-mock-status`, o `body.force_status` → probar deterministamente "Sin cupo disponible" (rejected) o skeleton (pending).
- **Toggle:** `--mock-pa` reinicia el wizard. Para volver al MS real, correr sin `--mock-pa` **+ `--fresh`** (el reuse de :5174 solo trackea `VITE_API_URL`, no el endpoint de pre-aprobaciones).

## 9. Archivos clave

- **Servicio:** `pre-approvals-service/internal/infra/handlers/preapprovals/handler.go` (rutas), `…/core/usecases/preapproval/check_preapproval.go` (flujo), `…/infra/lending_products/factory/factory.go` (key→adapter), `…/lending_products/<lender>/` (adapters), `config/profiles/*` (URLs), `docs/ARCHITECTURE.md`+`docs/CONTEXT.md`+`openapi.yaml`.
- **Wizard (consumo):** `frontend-monorepo/apps/loan-request-wizard/app/routes/lenders-marketplace/available-lenders.tsx` (loader, `VITE_PREAPPROVALS_ENDPOINT`), `…/lenders-marketplace/src/lib/infrastructure/adapters/fetch-lender-preapproval.ts` (cliente), `…/components/available-lenders/AvailableLenders.tsx` (hide por server-error).
- **Harness:** `frontend-e2e/bin/asesor` + `frontend-e2e/.env.dev` (`E2E_PREAPPROVALS_ENDPOINT`).
