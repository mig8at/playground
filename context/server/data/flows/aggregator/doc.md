# Aggregator · contexto
> **estado:** al día con main · Familia de prestamistas por INTEGRACIÓN/API (rt=1): CreditOp origina, pero la API externa del lender decide, pone el cupo y gestiona la cartera — NO inyectable.

<!-- Seed desde playground/flow; superficie de código a linkar en la fase de data. -->

## Qué es
Familia de prestamistas por **integración/API** (`response_type` **1**): CreditOp solo origina, pero **la decisión de crédito, el monto y el cupo los calcula 100% la API externa** del agregador (Welli, Bancolombia, Meddipay, Prami, Sistecrédito, Credifamilia…). Por eso rt=1 **NO es inyectable/simulable localmente**: no hay palanca en BD que fuerce el veredicto (contraste con rt=2, cuyo cupo se decide local). En el simulador se modela con un switch honesto **aprueba/rechaza/timeout**.

## Contenido
La pre-aprobación rt=1 vive en **dos mundos paralelos** (MAP.md §S6):

1. **application (VIVO, listado v1/v2 del monolito)** → `PreApprovedLenderService` despacha por **lender-id cableado a mano** (ids 9, 68, 100, 23/141/142/166, 24, 39, 12, 133) a una `Action` que golpea la API del proveedor, y **conserva (arriba, sort=1) o excluye (`unset`)** del listado según el veredicto. **No hay `/available-quota` para rt=1**: el cupo llega horneado en la respuesta externa (`available`).
2. **wizard nuevo (React Router)** → NO usa ese PHP: su loader dispara server-to-server una `Promise` por lender contra el **MS Go `pre-approvals-service`** (`VITE_PREAPPROVALS_ENDPOINT → POST /v1/preapprovals/check`) y **streamea** cada card. El "streaming" de `lenders-v2` lo hace el front resolviendo lender-a-lender, no es SSE del backend.

**La frontera de responsabilidad** (rt=1): CreditOp solo (a) decide **qué** lenders consultar (base sucursal + filtros), (b) aporta **datos** del solicitante (Experian/KYC vía customer-service) y **credenciales** del comercio, (c) **traduce** la respuesta y **ordena**. El veredicto es de la API externa.

## Dónde mirar
- **Camino A · application** (VIVO): `app/Services/lenders/PreApprovedLenderService.php:33 validatePreApproveLender` → `:67` foreach → `:87` mapa de ids. Actions: `app/Actions/Lenders/Welli.php`, `BancolombiaBnpl.php`, `BancolombiaConsumerLoan.php`, `Sistecredito.php`, `Meddipay.php`, `Prami.php`, `Credifamilia.php`, `BancoDeBogotaCeroPay.php`.
- **Camino B · MS Go** (pre-approvals): `cmd/http-server/main.go:90` · `internal/infra/handlers/preapprovals/handler.go:45 Check` · `internal/core/usecases/preapproval/check_preapproval.go:56 Execute` · `internal/infra/lending_products/workflow.go:52` (credentials→auth→api_call→adapt).
- **Front** (frontend): `apps/loan-request-wizard/app/routes/lenders-marketplace/available-lenders.tsx:120` · `.../adapters/fetch-lender-preapproval.ts:146`.

## Gotchas / riesgos
- **Dos mundos que divergen**: p.ej. Welli **166 solo existe en application**; en legacy/MS es 23/141/142. El front nuevo consume el MS Go directo (no pasa por el PHP viejo).
- **Bancolombia Consumo (100)** fuerza `amount=1000000` y **degrada a "media"** en vez de excluir (asimétrico).
- **Meddipay nunca cachea** (`ShouldCheckAgain=true` siempre).
- **Race Credifamilia**: timeout del front (40s) > write_timeout del MS (30s) a propósito (abortar duplicaba transacciones).
- **`$lender->action`** (FQCN) es el despachador general; el mapa id→proveedor de `PreApprovedLenderService:87` está hardcodeado.
- El **espejo a legacy es best-effort**: si el webhook `lender-result` falla, se loguea pero no bloquea → posible deriva entre lo que ve el usuario y lo que persiste.

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (LendersNode rt≠2 + psel.radica/psel.decision + MAP.md §S6 + Apéndice A).

## Enlaces
- Padre: **Entities**. Simulador: playground/flow (nodo "Perfilamiento" switch aprueba/rechaza/timeout + "Entidades disponibles" prob. baja). Mapa: playground/flow/MAP.md §S6, Apéndice A.
