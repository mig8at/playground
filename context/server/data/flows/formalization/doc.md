# Formalization · contexto
> **estado:** al día con main · Fase de CIERRE después de elegir lender (user_request estado 3 → 11): la cadena se ramifica por `response_type` hasta el desenlace del crédito.

<!-- Seed desde playground/flow; superficie de código a linkar en la fase de data. -->

## Qué es
La formalización es lo que pasa **después de que el cliente elige una entidad** (estado 3 = "Selección de entidad") y hasta el desenlace (Estado 11 "Autorizada" o el terminal que corresponda). En el simulador es el nodo **Formalización** (`LifecycleNode`, tipo "GitHub Actions": un paso por fila, círculo de estado que se puede tocar para simular que falla) más el nodo **Estado del crédito** (`CreditStatusNode`) al costado.

Lo distintivo: la cadena de pasos **se ramifica por `response_type`** igual que el perfilamiento, y el estado terminal es una **función pura de (rt + toggles)** (`creditStatus()` en `store.js`) — no hay estado propio que se desincronice. La pre-aprobación del listado ya ocurrió antes; acá empieza el journey de cierre.

## Contenido
**Las tres cadenas** (`POSTSEL_STEPS` en `store.js:867`). `pass` = el valor del toggle que deja avanzar; cualquier otro corta ahí y marca `failedAt`:

- **rt=2 CreditopX / rt=3 Rotativo** (misma cadena, corre 100% local):
  `plan (elige) → kyc (valida) → firma (firma) → enganche (paga)` → **Estado 11 "Autorizada"** + aviso a la tienda (`notifyEcommerceStore`).
  - **plan** — se elige el plazo y la 1ª fecha, se arma el cronograma real (`GetPaymentSchedulesUc`/`GetFirstPaymentDatesUc`). El plazo se fija ACÁ; en el listado la cuota era solo estimación. Cuota = capital (financiado + costos admin + fondo·IVA 19%) → anualidad(tasa, plazo) + seguros.
  - **kyc** — liveness/biometría en el portal EXTERNO de ADO (página completa, no iframe): enroll → callback identity-validation-status → polling StatusCheck (re-despacho 2s) → evento Echo. ADO se da por validado con `state_id == 2`. NO es el KYC inicial (ese, TusDatos/AML, corre antes del listado); para Credifamilia V2 es Jumio/Evidente → ver contexto **kyc**.
  - **firma** — pagaré + OTP: `send-otp → verify-otp (transitionToIntermediate) → authorize`; `authorize → loanAuthorizationService->authorize` → Estado 11 + firma real (Netco/Deceval). Rechaza si ya está autorizado.
  - **enganche** — **condicional**: solo aplica si `initial_fee > 0` (`postSelApplies` en `store.js:882`). Checkout hospedado de Wompi: `initiate → checkout_url → redirect → down-payment-validation` (confirma por Echo). El % del enganche lo **FIJA la categoría de perfilamiento**, no el comercio.
- **rt=1 agregador**: `radica (radica) → decision (aprueba)`. La cartera queda del lender.
  - **radica** — se manda la solicitud FORMAL a la API del agregador (2ª decisión externa; radicar ≠ pre-aprobar). Credifamilia (rt=4) es asíncrona.
  - **decision** — `aprueba / rechaza / timeout ("en proceso")`; vuelve por webhook `lender-result`, espejado a legacy. Mapeo estado externo → id: BdB `Disbursed→11`, `Failed→7`, `Pending→10`.
- **rt=0 redirect**: `redirect (abre)`. CreditOp escribe `url_utm`, redirige al sitio del lender y **pierde visibilidad total** — no hay Estado 11 rastreable.

**Estados terminales** (`CreditStatusNode`): rt=2/3 → "Desembolsado" (Estado 11); rt=1 → "Aprobado/Radicado" o "Rechazado" o "En proceso" (timeout); rt=0 → "Fuera de CreditOp" (desconocido).

## Subcontextos
- **dynamic-forms** — los formularios backend-driven (el backend define qué campos pide el wizard); se persisten como EAV en `user_field_values`.

## Dónde mirar
> MAP.md no detalla el journey de cierre con archivo:línea (corta en la selección + el webhook); los servicios nombrados abajo salen de `fieldDocs.js` (`psel.*`, evidencia FLUJO-CREDITOPX §journey), sin línea.

- **Selección → estado 3** (application): `app/Http/Controllers/Customer/UserRequestController.php:646 updateUserRequest` — MAP.md §S3 fila 8.
- **Selección → estado 3** (legacy): `Modules/Onboarding/App/Services/UserRequestService.php:284-296` — MAP.md §S3 fila 8.
- **Plan / KYC / Firma / Enganche** (legacy, sin línea): `GetPaymentSchedulesUc`/`GetFirstPaymentDatesUc` · `AdoController` (RiskCentrals/Ado) · `ValidateOtpPromissoryNoteController::verifyOtp/disburse` → `loanAuthorizationService->authorize` · `InitialFeePaymentController` (Wompi) — fieldDocs `psel.plan/kyc/firma/enganche`.
- **Webhook decisión rt=1** (legacy): `POST /api/onboarding/loan-application/{id}/lender-result` — MAP.md §S6 endpoints.
- **Webhook decisión rt=1** (pre-approvals): `internal/infra/services/lender_result_service.go:41` (webhook `/{id}/lender-result`) — MAP.md §S6 fila 14.
- **Redirect rt=0** (legacy): columna `lenders_by_allied_branches.url_utm` — fieldDocs `psel.redirect`.

## Gotchas / riesgos
- **rt=1 NO es inyectable localmente**: la 2ª decisión externa no se fuerza desde BD → el toggle es "ficción honesta" (contrasta con rt=2, que corre local paso a paso).
- **Carrera Credifamilia (rt=4)**: timeout del front 40s > write_timeout del MS 30s a propósito (abortar duplicaba transacciones).
- **El enganche lo fija la CATEGORÍA de perfilamiento** (rt=2), no el comercio; ya no hay ramas `initial_fee/standBy` en la action de selección — el enganche es un paso del journey.
- **Dos máquinas de estado se confunden**: originación (hasta 11/26) ≠ préstamo vivo (1 al día / 2 mora / 3 paz y salvo / 4 cancelado); el 11 es el puente. Mora/cartera post-11 es **otro grafo** (servicing).
- **Espejo a legacy best-effort**: si el webhook falla se loguea pero no bloquea → posible deriva app↔legacy entre lo que ve el usuario y lo que persiste.
- **rt=0 es un callejón sin salida** para la plataforma: no sabe si el crédito se dio.

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (nodos `LifecycleNode` + `CreditStatusNode`, `store.js` `POSTSEL_STEPS`/`creditStatus`, `fieldDocs.js` `node.lifecycle`/`psel.*` + MAP.md §S3/§S6).

## Enlaces
- Padre: **CreditOp** (raíz). Simulador: playground/flow (nodos Formalización + Estado del crédito). Mapa: playground/flow/MAP.md §S3 (selección) / §S6 (webhook rt=1).
- Relacionado: **kyc** (la identidad/KYC-V2 y la biometría ADO se re-usan en la firma; no se duplica acá), **profiling** (fija el enganche/cupo), **onboarding** (fase previa).
