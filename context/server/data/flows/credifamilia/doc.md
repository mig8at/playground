# Credifamilia · flujo
> **estado:** al día con main · **Único lender `response_type = 4`**, híbrido: CreditOp origina in-platform pero el crédito se radica en Credifamilia por SOAP.

## Qué es
Credifamilia (lender **24**) es el único `response_type = 4` (un valor sin fila en el catálogo `response_types` 0-3). Es un **híbrido**: CreditOp origina **adentro** (identidad, plan de pagos, firma) como un CreditopX in-platform, pero el crédito se **radica en Credifamilia por SOAP** y lo gestiona el lender. Producto: **libranza privada de consumo** (`tipoProducto='Libranza'`).

| Pregunta | Respuesta |
|---|---|
| ¿Quién decide? | **Mixto**: gate LOCAL en el listado (0% si `totalNs<12` o `!debtCapacity`, en `SpecialConditionsController`) + decisión FINAL del lender al radicar |
| ¿Quién pone la plata / cobra? | Credifamilia |
| ¿Cómo cierra? | Origina in-platform → **radicación SOAP** → *polling* hasta APROBADO/RECHAZADO (estados **40/41** de `lender_transaction_statuses`, otro namespace que `user_request_statuses`) |
| ¿Simulable E2E? | ⚠ **Parcial**: el gate local sí es inyectable; KYC V2 (Evidente/CrossCore/Jumio) y la radicación SOAP son externos |

## Cómo funciona
**Las 3 integraciones = 3 etapas:**
1. **REST (pre-aprobación)** — Credifamilia es el ÚNICO lender con **polling** contra `/v1/preapprovals/check` (gateado por id=24, backoff 2/4/8/16/20s, 6 intentos, 180s) y el ÚNICO con **plan de cuotas dinámico** por backend (`supportsDynamicPaymentPlan(24)`).
2. **KYC V2 greenfield** (todo en legacy-backend) — jornada de identidad que ramifica por `step_details.type`: **Evidente** (validar → OTP → cuestionario → verificar) o **CrossCore + Jumio** (biométrico → webhook → evaluate) o AWS/ADO.
3. **Consumo SOAP (radicación)** — al autorizar (**Estado 11**), si `response_type==4` se dispara la formalización SOAP (`transaccionConsumo` + `guardarDocumentoOpenKm`) que radica el crédito con un PDF unificado de todos los documentos firmados.

**Recorrido punta a punta:** `/lenders` (Credifamilia "Pre aprobado", polling) → seleccionar → `update-user-request` → (rt=2 in-platform, sin URL) → `/confirmation` (cliente) + `/continue` (asesor, QR de autogestión) → jornada de identidad (Evidente / CrossCore+Jumio / AWS) → `first-payment-date` + plan de pagos (amortización francesa en backend) → `payment-schedule` → `sign-documents` (pagaré Deceval + docs Netco, OTP) → authorize (**Estado 11**) → **formalización SOAP** → voucher + notificación al comercio.

## Dónde mirar
- **Marketplace / pre-aprobación / selección** (front): `available-lenders.tsx`, `AvailableLenders.tsx`, `fetch-lender-preapproval.ts` (el polling), `lender-response.mapper.ts`, `lender.constants.ts` (`CREDIFAMILIA_LENDER_ID=24`, `supportsDynamicPaymentPlan`).
- **Handoff / identidad** (front): `loan-confirmation.tsx`, `loan-continue.tsx`, módulo `identity-validation/*` (UCs de Evidente + CrossCore).
- **Plan de cuotas dinámico** (front): `usePaymentPlanOptions.ts`, `payment-plan.repository.ts`, `payment-plan-options.tsx`.
- **Orquestación** (legacy): `ContinueUserFlowController.php`, `CreditopXFlowService.php`, `lenders/{LenderRetrievalService,PreApprovedLenderService}.php`.
- **Identidad — Evidente** (legacy): `app/Services/Lenders/CredifamiliaV2/Evidente/*` + `EvidenteController`.
- **Identidad — CrossCore + Jumio** (legacy): `app/Services/Lenders/CredifamiliaV2/CrossCore/*` + `CrossCoreController` + `ProcessCrossCoreEvaluation`.
- **Plan de pagos / amortización** (legacy): `app/Services/PaymentPlan/Credifamilia/*` (Engine/Math/ValueObjects) + los 7 controladores `PaymentPlan/Credifamilia*`.
- **Firma** (legacy): `Signing/Netco/*`, `CredifamiliaDocumentsBuilder`, `DocumentSigningService`, `DecevalPromissoryNoteService`.
- **Formalización SOAP** (legacy): `Pdf/{CredifamiliaFormalizationService,CredifamiliaLegalizationDocumentService,PdfMergeService}`, `Actions/Lenders/CredifamiliaConsumo/*`, `CredifamiliaConsumoService`, `LoanAuthorizationService`.
- **Bonificación / condiciones especiales** (legacy): `Jobs/Lenders/Credifamilia/*`, `SpecialConditionsController`.

## Gotchas / riesgos
- **Único con flujo legal de documentos completo**: `ENABLED_LENDERS_FOR_LEGAL=[24]` — TyC sin firmar por WhatsApp, PDF vía `pdf-mapper-service`, custodia en **S3**. Es el patrón de firma/custodia que el plan Motai/Alta generaliza.
- **Gate local exigente** (por qué "no sale" en pruebas): requiere fila de buró con `economicSector==1`, **≥12 'N' consecutivas**, sin negativos, y `cuota×1000/ingreso ≤ 0.4`. El fixture base trae sector 3/4 → `totalNs=0` → **0% por defecto**.
- **⚠ [CRÍTICO] Ambigüedad rt=2 vs rt=4**: el front y la memoria del equipo lo tratan como **rt=2** (CreditopX), pero la formalización SOAP y el plan extra-details en legacy **solo corren con `response_type==4`**. La BD confirma **rt=4** para id=24. Riesgo de configurarlo mal.
- **Colisión de ID**: lender 24 = Credifamilia, pero **allied 24 = Creditop**. Verificar el namespace antes de tocar un "24".
- No confundir con **"Credifamilia-addi"** (entrada redirect del catálogo en algunas sucursales).

## Bitácora
- **2026-07-17** — Nodo creado desde la raíz con la documentación de referencia. Superficie curada: **134 archivos** (107 legacy + 27 front, 134/134 resuelven en el índice). Flujo verificado adversarialmente contra el análisis maestro.

## Enlaces
- `docs/codigo/CREDIFAMILIA-FLUJO-ANALISIS.md` (flujo, verificado adversarialmente) · `docs/codigo/CREDIFAMILIA-PIPELINE-DOCUMENTOS.md` (pipeline de documentos) · ficha `docs/lenders/CREDIFAMILIA.md`.
