# ms-preapprovals · contexto
> **estado:** al día con main · MS Go hexagonal (`pre-approvals-service`). Resuelve la pre-aprobación rt=1 del wizard nuevo contra las APIs externas de los lenders, vía un workflow de 4 etapas, y espeja el resultado a legacy.

<!-- Seed desde playground/flow; superficie de código a linkar en la fase de data. -->

## Qué es
Microservicio Go de arquitectura hexagonal (`pre-approvals-service`). Resuelve la **pre-aprobación rt=1** para el wizard nuevo: recibe un `/v1/preapprovals/check` por lender, arma el payload, golpea la API externa del proveedor y traduce el veredicto. Repo aparte (`github/pre-approvals-service`).

Coexiste con el path viejo (`PreApprovedLenderService` PHP en application/legacy) en **parallel-run**: el wizard nuevo consume este MS directamente; el monolito sigue teniendo su propio switch por id. Los dos mundos pueden divergir.

## Contenido
Camino B del rt=1 (MAP.md S6):

- **Handler HTTP** — `main.go:90` levanta el server; `handler.go:252` expone las rutas `/check` + `/me/check` (header `X-User-Id`); `:45` es el `Check`.
- **Usecase core** — `check_preapproval.go:56 Execute`: cache DynamoDB → applicant → request → `:122` override Welli (141/142→23) → `:126 CheckPreApproval` → attempt → `:160 notifyLenderResult`.
- **Factory por producto** — `factory/factory.go:45` mapea **8 keys** de producto; `lending_product.go` define requisitos (amount/hash, mínimos).
- **Workflow de 4 etapas** — `workflow.go:52`: `credentials(:101) → auth(:117) → api_call(:131) → adapt(:145)`; `:193 normalizeStageError`.
- **Adapter por producto** — `welli/adapter.go:62 Adapt`, `:111` (approved solo si estado==approved && monto>0); `welli/error_adapter.go:66` (5xx retryable, 4xx no).
- **Taxonomía de errores** — `lender_error.go` (stage+code+retryable), `errors.go` (sentinels); `handler.go:221` (→HTTP), `:121` (422 below_minimum).
- **Respuesta + espejo a legacy** — `mapper.go:10 PreApprovalToAPI`; `lender_result_service.go:41` postea el webhook `/{id}/lender-result`.
- **Dependencias externas** — `applicant_service.go:116` (`GET {customer-service}/user/{id}` + ExperianProfile); `credentials_service.go:50` (`POST {legacy}/api/onboarding/credentials/get-by-lender`).

**Frontera de responsabilidad (rt=1):** CreditOp solo (a) decide qué lenders consultar, (b) aporta datos del solicitante (Experian/KYC vía customer-service) y credenciales del comercio, (c) traduce la respuesta y ordena. La **decisión de crédito, monto y cupo la calcula 100% la API externa** — por eso rt=1 NO es inyectable/simulable localmente.

## Dónde mirar
**pre-approvals-service** (índice maestro, MAP.md Apéndice C):
- **Entry**: `cmd/http-server/main.go`
- **Handlers** (`internal/infra/handlers/preapprovals/`): `handler.go` · `mapper.go`
- **Usecase** (`internal/core/usecases/preapproval/`): `check_preapproval.go:56`
- **Domain** (`internal/core/domain/`): `preapproval.go` · `lending_product.go` · `lender_error.go` · `errors.go`
- **Lending products** (`internal/infra/lending_products/`): `workflow.go:52` · `factory/factory.go:45` · `contract_fields.go` · `welli/{adapter,error_adapter}.go`
- **Services** (`internal/infra/services/`): `applicant_service.go:116` · `credentials_service.go:50` · `lender_result_service.go:41`

Endpoints: `POST /v1/preapprovals/check` (+ `/me/check`). Env: `VITE_PREAPPROVALS_ENDPOINT` (lo consume el front).

## Gotchas / riesgos
- **Dos mundos paralelos que divergen**: p.ej. Welli id 166 solo existe en application; en legacy/MS es 23/141/142.
- **Race Credifamilia deliberado**: el timeout del front (40s) supera el write_timeout del MS (30s) a propósito (abortar duplicaba transacciones).
- **El espejo a legacy es best-effort**: si el webhook `/lender-result` falla, se loguea pero no bloquea → posible deriva entre lo que ve el usuario y lo que persiste el profiling review.
- **Meddipay nunca cachea** (`ShouldCheckAgain=true` siempre).
- **Código muerto / sin contrato**: campo `encrypt_code` que el MS nunca emite; `transaction_data` sin contrato (`json.RawMessage`).

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (MAP.md §0 tabla Repos + S6 camino B + Apéndice C índice pre-approvals-service).

## Enlaces
- Padre: **Architecture**. Mapa: playground/flow/MAP.md §0/S6/Apéndice C. Simulador: playground/flow.
