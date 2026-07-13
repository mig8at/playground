# Credifamilia — Análisis completo del flujo (CreditopX, response_type=4, lender id 24)

> Documento de contexto para arrancar tareas sobre Credifamilia. Síntesis de 10 reportes de lectura paralela sobre `frontend-monorepo` (wizard CreditopX), `legacy-backend`, los docs del equipo y la comparación con el `application` viejo.
>
> Convención: se citan rutas `archivo:línea` en todo el documento. Donde los reportes se contradicen o una afirmación es frágil, se dice explícitamente. Identificadores de código (clases, métodos, constantes, endpoints) se dejan verbatim; la prosa va en español.
>
> **Estado de verificación:** un agente crítico verificó adversarialmente las afirmaciones load-bearing (secuencia de estados, gating rt=4, mapeos ruta→controlador→servicio, ubicación de la UI de identidad, relación Consumo↔V2) contra el código real → **confianza ALTA, todas se sostienen**. Las correcciones del crítico (matiz del TyC id=18, atribución del gate rt==4, confirmación del bug de credenciales, drift de línea de `getNextStepData`) y los gaps de inventario ya están **incorporados** en este documento.
>
> **Dónde encaja:** esta ficha cubre solo lo **distintivo** de Credifamilia (rt=4 híbrido). El **tronco común** que da por sabido (entrada → OTP → datos personales/laborales → marketplace) es dueño de [REFERENCIA-FLUJOS.md §1](./REFERENCIA-FLUJOS.md); el **encadenamiento FE↔BE**, de [MAPA-FLUJOS.md](./MAPA-FLUJOS.md); y la **comparación transversal por entidad** (quién decide/financia/cobra/cierra/simulable), de [lenders/README.md](../lenders/README.md).

---

## 1. Resumen ejecutivo

**Credifamilia** es un lender colombiano integrado en CreditOp como **CreditopX in-platform** (fila `lenders` id=24 con **`response_type=4`** confirmado en BD — el frontend y la memoria del equipo lo tratan como `LENDER_RESPONSE_TYPE.CREDITOP_X`/rt=2; esa ambigüedad rt=2 vs rt=4 se detalla en el aviso transversal más abajo y en §11–§13), con **frontend lender id = 24** (`CREDIFAMILIA_LENDER_ID=24`, `lender.constants.ts`). El producto que radica es **libranza privada de consumo** (no vivienda/hipotecario: payload SOAP fijo `tipoProducto='Libranza'`, `detalleProducto='Libranza privada'`). Es **in-platform/autogestión**: a diferencia de un agregador rt=1 (Bancolombia, que decide vía API externa), Credifamilia decide 100% dentro de legacy, lo que lo hace **inyectable para pruebas E2E sintéticas** (ver memoria `synth-lender-type-boundary`).

**Flujo punta a punta (1 párrafo):** El cliente/asesor llega al marketplace (`/lenders`), donde Credifamilia se lista como **"Pre aprobado"** y su pre-aprobación se resuelve por **polling** contra el microservicio `/v1/preapprovals/check` (es el ÚNICO lender con polling, gateado por id=24). Es también el ÚNICO lender con **plan de cuotas dinámico** calculado por backend (`supportsDynamicPaymentPlan(24)`). Al seleccionarlo se hace POST a `update-user-request`, y al ser rt=2 in-platform sin URL externa la solicitud se lleva a la pantalla `/confirmation` (y al asesor a `/continue` con QR de autogestión). En `/confirmation` el backend devuelve un `step_details.type` que enruta la **jornada de validación de identidad** (Evidente OTP+cuestionario, o CrossCore+Jumio biométrico, o AWS/ADO). Tras identidad aprobada + AML, se elige plan de pagos (motor de amortización francés en backend), se firma por OTP el pagaré (Deceval) y los documentos (Netco), y al **autorizar** (estado 11) se dispara la **formalización SOAP** (`transaccionConsumo` + `guardarDocumentoOpenKm`) que radica el crédito en Credifamilia con un PDF unificado de todos los documentos firmados, terminando en voucher/desembolso y notificación al comercio.

**Diagrama de etapas:**

```mermaid
flowchart TD
    A[/solicitar - monto/] --> B[/lenders - marketplace CreditopX/]
    B -->|polling /v1/preapprovals/check| B
    B -->|seleccionar lender 24| C[update-user-request]
    C -->|rt=2 in-platform, sin url| D[/confirmation/ cliente + /continue/ asesor con QR]
    D -->|confirm: step_details.type| E{Identidad}
    E -->|evidente_validation| E1[Evidente: validar -> OTP -> preguntas -> verificar]
    E -->|crosscore_validation| E2[Jumio biometrico -> webhook -> CrossCore evaluate]
    E -->|aws_validation / ado_validation| E3[AWS doc+rostro / ADO]
    E -->|no_validation_required| F
    E1 --> F[/first-payment-date/ + plan de pagos]
    E2 --> F
    E3 --> F
    F --> G[payment-schedule: motor amortizacion frances]
    G --> H[sign-documents: pagare Deceval + 6 docs Netco, OTP]
    H --> I[authorize / disburse -> Estado 11]
    I -->|response_type==4 EXTERNAL_MANAGED| J[Formalizacion SOAP: transaccionConsumo + guardarDocumentoOpenKm]
    J --> K[Voucher + notificacion al comercio]
```

> **Aviso transversal sobre `response_type` (CRÍTICO — el crítico debe validar):** la memoria del equipo y todo el frontend tratan a Credifamilia como **rt=2** (CreditopX in-platform). PERO en `legacy-backend` la **formalización SOAP y el plan de pagos extra-details solo se disparan si `lender.response_type == 4`** (`EXTERNAL_MANAGED_RESPONSE_TYPE`/`EXTRA_DETAILS_RESPONSE_TYPE`), mientras que `rt=2` es `CANCEL_OTHER_LOANS_RESPONSE_TYPE`. No hay seeder en el repo que fije la fila `lenders` id=24, pero la **consulta directa a la BD confirma `response_type=4`** para id=24 (lo que es coherente con que la formalización SOAP y el plan extra-details, gateados a `rt==4`, sí apliquen a Credifamilia). Además, en el `application` VIEJO `LenderRetrievalService` **forzaba `response_type=1`** para id=24 (lender de integración BNPL, NO CreditopX). Ver §11, §12 y §13.

---

## 2. Mapa de repos y archivos clave

| Subsistema | Repo | Archivos principales |
|---|---|---|
| Marketplace / listado / pre-aprobación / selección | frontend-monorepo | `apps/loan-request-wizard/app/routes/lenders-marketplace/available-lenders.tsx`; `modules/loan-request-wizard/lenders-marketplace/src/components/available-lenders/AvailableLenders.tsx`; `.../lib/infrastructure/adapters/fetch-lender-preapproval.ts`; `.../lib/mappers/lender-response.mapper.ts`; `.../lib/domain/services/lender-resolution.service.ts`; `.../lib/domain/constants/lender.constants.ts` |
| Handoff / confirmación / identidad (front) | frontend-monorepo | `apps/loan-request-wizard/app/routes/loan-confirmation.tsx`; `.../loan-continue.tsx`; `.../additional-identity-validation*.tsx`; `.../identity-validation*.tsx`; `modules/loan-request-wizard/identity-validation/src/lib/infrastructure/identity-validation.repository.ts` |
| Plan de cuotas dinámico (front) | frontend-monorepo | `.../components/hooks/usePaymentPlanOptions.ts`; `.../lib/infrastructure/repositories/payment-plan.repository.ts`; `.../lib/domain/entities/payment-plan.entity.ts`; `apps/.../routes/lenders-marketplace/lenders/payment-plan-options.tsx` |
| Orquestación onboarding (espina dorsal) | legacy-backend | `Modules/Loans/App/Http/Controllers/Customer/ContinueUserFlowController.php`; `Modules/Loans/App/Services/CreditopXFlowService.php`; `Modules/Onboarding/App/Services/lenders/{LenderRetrievalService,PreApprovedLenderService,UserRequestService}.php` |
| Identidad — Evidente | legacy-backend | `app/Services/Lenders/CredifamiliaV2/Evidente/*` (EvidenteFlowService, EvidenteOtpFlowService, EvidenteClient, EvidenteAuthService [OAuth], EvidenteFlowStateStore, EvidenteFlowStepRecorder + EvidenteConsumptionRecorder [doble auditoría], EvidenteRiskCentralResolver [central de riesgo], EvidenteFlowResponsePresenter, EvidenteException); `app/Http/Controllers/Api/CredifamiliaV2/EvidenteController.php` |
| Identidad — CrossCore + Jumio | legacy-backend | `app/Services/Lenders/CredifamiliaV2/CrossCore/*` (CrossCoreClient, CrossCoreAuthService [OAuth], CrossCorePayloadBuilder, CrossCoreResponseInterpreter, CrossCoreDecisionMapper, CrossCoreScenarioResolver [stub], CrossCoreRiskCentralResolver, JumioOnboardingService, JumioAccountService, JumioAuthService, JumioRetrievalService, CrossCoreException); `app/Http/Controllers/Api/CredifamiliaV2/CrossCoreController.php`; `app/Jobs/Credifamilia/CrossCore/ProcessCrossCoreEvaluation.php` |
| Estado de validaciones (polling) | legacy-backend | `Modules/Identity/App/Services/ValidationStatusService.php`; `Modules/Identity/App/Services/IdentityValidationStepResolver.php`; `Modules/Identity/App/Enums/IdentityValidationType.php` |
| Motor de plan de pagos / amortización | legacy-backend | `app/Services/PaymentPlan/Credifamilia/*` (Engine/, Math/, ValueObjects/, DTO/, LoanOptions/, InstallmentPlan/, PaymentDates/, ContinueRequest/, Voucher/, PaymentPlanSummary/, CredifamiliaPayloadBuilder.php) + 7 controladores en `Modules/Onboarding/.../PaymentPlan/` |
| Firma (Netco) + pagaré (Deceval) | legacy-backend | `Modules/Loans/App/Services/Signing/Netco/*`; `Modules/Loans/App/Services/Signing/Credifamilia/CredifamiliaDocumentsBuilder.php`; `Modules/Loans/App/Services/DocumentSigningService.php`; `Modules/Loans/App/Services/DocumentGeneration/Payload/OnboardingPayloadBuilder.php`; `config/netco_signer.php`, `config/documents.php` |
| Formalización / radicación SOAP | legacy-backend | `app/Services/Pdf/{CredifamiliaFormalizationService,CredifamiliaLegalizationDocumentService,PdfMergeService}.php`; `app/Actions/Lenders/CredifamiliaConsumo/{CredifamiliaConsumo,SoapClient,TransactionRequest,DocumentRequest}.php`; `Modules/Onboarding/App/Services/lenders/CredifamiliaConsumo/CredifamiliaConsumoService.php`; `Modules/Loans/App/Services/LoanAuthorizationService.php` |
| Pre-aprobación V1 REST (radicación BNPL) | legacy-backend | `app/Actions/Lenders/Credifamilia.php` (register/show/authorize) |
| Bonificación + condiciones especiales | legacy-backend | `app/Jobs/Lenders/Credifamilia/{BonificationCheck,SendBonificationReport}.php`; `app/Mail/Lenders/Credifamilia/BonificationReport.php`; `app/Http/Controllers/Customer/SpecialConditionsController.php` |
| Docs del equipo | legacy-backend | `docs/lenders/credifamilia/{README,RESUMEN,ESTADO,FORMALIZACION-PDF-CONTEXTO,PRUEBAS-Y-CONSULTAS-CREDIFAMILIA}.md`; `docs/credifamilia/README.md`; `docs/credifamilia-vinculacion-payload-mapping.md` |
| App VIEJO (comparación migración) | application (bitbucket) | `app/Actions/Lenders/Credifamilia.php`; `app/Http/Controllers/Customer/Lenders/CredifamiliaController.php`; `resources/js/pages/customer/lenders/list/v2/ListLenders.vue` |
| Config externa | legacy-backend | `config/services.php` (bloques `credifamilia`, `credifamilia_consumo`, `crosscore`, `jumio`, `evidente`); `app/Services/Integrations/IntegrationSettingsService.php` (override desde tabla `settings`) |

---

## 3. Frontend (wizard CreditopX)

### 3.1 Listado y pre-aprobación
- **Loader** (`available-lenders.tsx:103`, `:133`): trae los lenders vía `GetLoanOptionsUc` → `LoanOptionsRepository.getByLoanRequestId` (`loan-options.repository.ts:25`) = GET `/api/onboarding/loan-application/lenders-v2/:id`. `mapApiResponseToEntities` (`lender-response.mapper.ts:264`) convierte cada `LenderResponse` a `LoanOptionEntity`.
- **Mapeo de Credifamilia** (`lender-response.mapper.ts`): tag `'Pre aprobado'` (`createTags:51`, `isCreditopXType`), `actionText='Validar Pre aprobado'` (`getActionText:93`, case 2/3), `isRecommended=true` (`:272-273`), `installmentOptions` desde `credit_lines.fee_numbers` (`:232`), `buildCategorySync (:134)` espeja `credit_lines.{max_amount,max_fee_number}`.
- **Orden** (`filterAndSortLenders:301`): bloque "pre-aprobado" arriba; **ignora la `probability` de perfilado** (en v2 Credifamilia suele llegar `0%` obsoleto) y ordena por `sort` (Credifamilia → Welli → Meddipay).
- **Kickoff server-side de pre-aprobación** (`:158-194`): para lenders rt!=0 lanza `fetchLenderPreApproval` SIN await (stream React Router). Credifamilia es primary (no fallback). `amount=Math.trunc(totalAmount)` calculado con `CalculateLoanFinancialsUc`.
- **Polling exclusivo** (`fetch-lender-preapproval.ts:261`, `:264`): como `config.lender.id === CREDIFAMILIA_LENDER_ID`, entra a `pollUntilTerminal` con `DEFAULT_CREDIFAMILIA_POLL` (backoff 2/4/8/16/20s, 6 intentos, overall 180s). Los demás lenders hacen un solo `attemptOnce`.
- **Product key:** el payload (`:152`) usa `lending_product_key='creditop_x'` (`CREDITOP_X_PRODUCT_KEY`), **NO el slug `'credifamilia'`**, porque `isCreditopXType(2)` gana sobre el slug (`:146`); `lending_product_id=String(24)`.
- **Cliente:** `DeferredLenderResolutionAdapter` (`:23`) hace `.then` sobre `preApprovals[24]` → `useProgressiveLenderResolution`. `mergeLenderWithResolution` (`lender-resolution.service.ts:104`) pliega `available`, `initial_fee_percentage` (`:135`), `rate` (`:128`, solo si key=creditop_x) y reconstruye tags.

### 3.2 Plan de cuotas dinámico (exclusivo Credifamilia)
- `usePaymentPlanOptions` (`LenderCard.tsx:509`) corre con `isEnabled = supportsDynamicPaymentPlan(24) && isPreApprovalReady`. **`supportsDynamicPaymentPlan` está hardcodeado a `lenderId === 24`** (`lender.constants.ts:106`).
- `fetcher.submit` (debounce 800ms) a `/lenders/payment-plan-options`; el action (`payment-plan-options.tsx`) hace GET `/api/onboarding/payment-plan/:slug/loan-options/:id/:amount` → `{lender, interest_rate, available_amount, plans:[{term, monthly_installment}]}`.
- En `LenderCardContent.tsx:887` `isDynamicLender=true`: los plazos salen de `dynamicSource.plans` (no de `credit_lines`); la cuota es `plan.monthly_installment` (`:912`).
- **Cuota inicial:** `requiresInitialFee(2)=true` SIEMPRE (`lender.constants.ts:72`); `minRequiredInitialFee` usa `lender.available` (cupo aprobado del MS) como cap (`calculate-loan-financials.uc.ts:135-141`). El "Pago mínimo requerido" (`LenderCardContent.tsx:554/880`) es **solo display informativo, NO botón de pago ni redirección a Wompi**.

### 3.3 Selección y handoff
- Selección (`useLenderSelection.ts:138`): payload `{lender_id:24, fee_number, original_amount, amount, initial_fee, rate, response_type:2, transaction_data(JSON), is_recommended}` → POST.
- Action (`available-lenders.tsx:272`, `:407`): `SelectLenderUc` → `selectLender` (POST `update-user-request/:id`). `getLenderSelectionNextStep` (`:71-101`) ramifica. **Ambigüedad documentada:** el comentario en `:509` dice *"Lenders with external redirect without popup (e.g. Credifamilia)"* (branch url + `!openNewTab`), pero el handoff KYC real pasa por `/confirmation` (`:484`, showModal + url=null → `/continue?url=qrUrl`). La rama efectiva la decide el backend, no el front.
- `/confirmation` (`loan-confirmation.tsx`): loader trae datos + `paymentPlan`. Si 403 con `ContinuationGuard ('continue-link-sent')` → `MobileContinuationPrompt` con QR (`:324-332`). El **action** (`:176`) es el verdadero punto de bifurcación de identidad: `confirmLoanRequest` → `stepRouteMap` (`:218-239`) mapea `step_details.type`:
  - `aws_validation` → `identity-validation` (captura biométrica documento+rostro)
  - `ado_validation` / `crosscore_validation` → `identity-validation-instructions`
  - `evidente_validation` → `additional-identity-validation`
  - `no_validation_required` → `first-payment-date`
- `/continue` (`loan-continue.tsx`): pantalla del ASESOR (ventana A del modelo 2-dispositivos), genera QR (`GenerateQrUc`) y hace polling de `advisor-status`.

### 3.4 Dónde vive (y dónde NO) la UI de identidad/Evidente
- **SÍ vive en el frontend-monorepo**, en el paquete `@creditop/identity-validation`: las pantallas Evidente (`additional-identity-validation.tsx` + `-otp.tsx` + `-questionnaire.tsx` + `-questionnaire-start.tsx`) y las ADO/CrossCore/AWS (`identity-validation-instructions.tsx`, `identity-validation.tsx`, `identity-validation-status.tsx`) están todas en este repo.
- Jornada Evidente: `StartEvidenteValidationUc` (POST `evidente/flow/{id}/start`) → si `otpGenerated` → `/otp` → `VerifyEvidenteOtpUc` (POST `evidente/flow/{id}/otp/verify`); si `requiresQuestionnaire` → cuestionario (GET `.../questions`, POST `.../answers`). `approved` → `first-payment-date`; cualquier rechazo → `request-canceled` (sin reintento intra-Evidente).
- CrossCore biométrico: `EnrollCrosscoreValidationUc` (POST `crosscore/biometric/start` → redirect a `web_href`, típicamente Jumio); callback `SubmitCrosscoreCallbackUc` (POST `crosscore/evaluate` con `account_id_jm/workflow_id_jm`). **Ojo:** el método del repo se llama `submitCrosscoreCallback` pero NO es el webhook server-to-server (ese es `/api/identity/crosscore/biometric/callback`).
- **NO existe en el frontend-monorepo:** ningún campo `standBy/stand_by/standby` (grep vacío), ni ruta `/initial-fee-payment`, ni integración Wompi en el wizard. El fix `&& !response.data.standBy` que recuerda la memoria `asesor-solicitar-bounce` NO está presente en el `available-lenders.tsx` actual. **Frágil/abierto:** verificar si ese fix se revirtió, o si vivía en `application`/`legacy-backend`. (La causa-raíz del rebote /lenders→/solicitar→/continue sigue siendo coherente con el camino `:484`.)

---

## 4. Backend — secuencia de etapas (la espina dorsal)

La máquina de estados completa de Credifamilia (lender 24), etapa por etapa. El estado macro vive en `user_request_status_id`; el estado del KYC vive en stores propios (Evidente `EvidenteFlowStateStore`, CrossCore en tablas `crosscore_evaluations`/`jumio_accounts`), NO en `user_request_status_id`.

| # | Etapa | Endpoint(s) | Servicio | Estado/status que escribe | Sistema externo |
|---|---|---|---|---|---|
| 0 | Pre-condiciones de captura | (form personal-info) | `UserService` rama `hasCredifamilia` → `terms_and_conditions_id=18` (es la TyC REAL `TERMINOS_Y_CONDICIONES_CREDIFAMILIA_V20260518`, asignada en `UserService.php:325`; ver matiz en gotcha #56); fecha de nacimiento MANUAL (`ManualPersonalDataAllieds::MANUAL_BIRTH_LENDER_IDS` incluye 24) | — | — |
| 1 | Pre-aprobación V1 (durante listado) | (interno, en `getLenders`) | `LenderRetrievalService::getLenders` (`:83`) → `PreApprovedLenderService::validatePreApproveLender` rama `id==24` (`:307`) → `Credifamilia::register()` | `LenderTransaction` lender_id=24 → `CREDIT_IN_PROCESS=40`; luego 41/42 | Credifamilia REST `/servicescf/consumo/radicacion` (mTLS + OAuth2) |
| 1b | Polling pre-aprobación V1 | GET `lenders/{ur}/{lender}/pre-approval-status` | `Credifamilia::show()` → `/servicescf/consumo/radicacion/estado` (mapea API 1/2→40, 3→41, 4→42) | actualiza perfilamiento (`updateAsyncLender`) | Credifamilia REST |
| 2 | Selección del lender | POST `update-user-request/:id` | `UserRequestService` | `user_request_status_id=3` (Selección); para rt 2/4 sin credencial → `standBy=true`, url `/self-service/{hash}/{id}/confirmation` | — |
| 3 | Continue / self-service | GET `requests/{user_request_id}` | `ContinueUserFlowController::index` (`:38`) → `resolveExtraDetails` (paymentPlan si rt==4) | — | — |
| 4 | Confirmar + decidir identidad | POST `requests/confirm` | `ContinueUserFlowController::confirm` (`:68`) → Tusdatos AML background + `CreditopXFlowService::getNextStepData` (llamado en `ContinueUserFlowController.php:105`; def. en `CreditopXFlowService.php:69`) → `IdentityValidationStepResolver::resolve` | next_step de identidad | TusDatos (AML) |
| 5a | Identidad — Evidente (si `validation_type=6`) | POST `identity/evidente/flow/{id}/{start,otp/verify,questions,answers}` | `EvidenteFlowService` / `EvidenteOtpFlowService` | `STAGE_*` en `EvidenteFlowStateStore` (post_validation → questionnaire_ready → questionnaire_generated → completed_approved/rejected) | Experian Evidente (Master + v3 OTP) |
| 5b | Identidad — CrossCore/Jumio (si `validation_type=5`) | POST `identity/crosscore/biometric/start`, `/evaluate`; webhook `/api/identity/crosscore/biometric/callback` | `JumioOnboardingService` + `CrossCoreClient` (job `ProcessCrossCoreEvaluation`) | `jumio_accounts.status`; `crosscore_evaluations.status` (pending→success/error) + `decision` | Jumio (KYX) + Experian CrossCore |
| 5c | Polling de validaciones | POST `validation-status` | `ValidationStatusService::getValidationStatus` (`:53`) | combina `tusdatos_aml` + (`ado`/`crosscore`); `all_completed` gatea el avance | — |
| 6 | Plan de pagos (extra-details, rt==4) | GET `payment-plan/credifamilia/{continue-request,loan-options,...}` | `CredifamiliaContinueRequestService` + motor de amortización | persiste `fee_number`/`selected_payment_date` en UserRequest | pre-approvals MS (parámetros financieros) |
| 7 | Firma (OTP pagaré) | POST `promissory-note/validate/verify-otp` | `ValidateOtpPromissoryNoteController::verifyOtp` (`:270`) → `LoanAuthorizationService::transitionToIntermediate` | estado intermedio "Autorizado pendiente desembolso" | Twilio (OTP) |
| 8 | Autorización + formalización | POST `promissory-note/validate/authorize` | `disburse()` (`:313`) → `LoanAuthorizationService::authorize` (`:84`) | `user_request_status_id=11` (Autorizada); si rt==4 → `formalizeExternalManagedIfApplicable` (`:194`) | — |
| 9 | Formalización SOAP (radicación) | (interno) | `CredifamiliaFormalizationService::formalize` (`:51`) → collect → merge → `CredifamiliaConsumoService::finalize` → `register()` + `submitDocument()` | `LenderTransaction` CREDIT_REGISTERED→CREDIT_COMPLETED | Credifamilia SOAP `transaccionConsumo` + `guardarDocumentoOpenKm`; pdf-mapper-service; S3 |
| 10 | Voucher + cierre + notificación | GET `payment-plan/credifamilia/voucher/{ur}`; (observer) | `VoucherService` + `UserRequestObserver::updated` (`:50`) → `EcommerceRequestService::notifyStoreForUserRequest` | estados finales {6,7,8,11} notifican al comercio | tienda/ecommerce |

> **Detalle de la autorización (spine):** `LoanAuthorizationService::authorize` (`:84`) en transacción pone status 11 (`resolveAuthorizationStatusId` siempre 11, `:463-466`), genera documentos, `createFirstRegister`; como `rt==2` (`CANCEL_OTHER_LOANS_RESPONSE_TYPE`) cancela otros préstamos pendientes (`:113-119`). Tras el commit, si `rt==4` (`EXTERNAL_MANAGED`) corre `formalizeExternalManagedIfApplicable` (`:194`). **Aquí está la tensión rt=2 vs rt=4** (ver §11/§12).

---

## 5. Evidente (verificación de identidad)

Verificación de identidad de Credifamilia contra **Experian Evidente**: `validar` (identidad) → `OTP` (initialize/generate/verify) → `cuestionario` (preguntas/verificar), con estado cifrado y persistido por `user_request_id`, replay idempotente y doble auditoría.

### 5.1 Dos generaciones de rutas (mismo controlador)
- **Orquestada (`flow.*`, líneas `api.php:99-114`)** — la que usa el wizard. Máquina de estados con persistencia y presenter.
- **Bare/proxy (`validar`/`preguntas`/`verificar`/`otp.{initialize,generate,verify}`, `api.php:116-132`)** — proxies sin estado que reemiten el upstream tal cual. Excepción: `otp/start` (`startOtp`, `:207`) SÍ orquesta vía `OtpFlowService::start` leyendo `user_request_id` del body. **Abierto:** ¿quién consume las bare? No tienen tests Feature; probablemente primera generación / debug.

### 5.2 Sub-flujo orquestado (la que importa)
1. **START** (`EvidenteFlowService::start:42`): carga `UserRequest`+user; `startFromUserRequest:69` arma `validarPayload(user):371` y llama `EvidenteClient::validar`. `assertUserHasRequiredData` exige document_number, document_type, first_name, surname, cell_phone (+ expedition_date solo si CC y `strict_cc_expedition_date`). Mapeo doc: CC→'1', CE→'4', PA→'5', PPT→'6', TI→'7', DNI→'8', PEP→'9'.
2. **validationResult** (`:443`): transportErrorResult → 'error'; `resolveBlockedValidationResult:606` (respuestaAlerta '00'→error, '02'→blocked, identidad inválida→failed; alertas válidas `['01','03','04']`); `identityIsValid:676` exige `resultadoProceso/valApellido/valNombre/(valFechaExp si CC)` + resultado en `['01','05']`.
3. Si OK: `continuationState:651` con stage `post_validation` (si OTP habilitado) o `questionnaire_ready`. `procesoEvidente` **HARDCODEADO a `'VALDCN'`** (`DEFAULT_PROCESS:32/:483`).
4. **Auto-encadenado de OTP** (`continueFromValidation:524-541`): un solo POST a `/flow/{id}/start` dispara `validar` + `initialize` + `generate`; el front recibe ya `verify_otp`.
5. **OTP** (`EvidenteOtpFlowService`): `startForUserRequest:26` exige `post_validation`; `initializePhase:391` lee `codResultadoOTP` ('4'→sigue, '99'→error→`questions`); `generatePhase:472` ('4'→`verify_otp` stage `otp_verification_pending`; '3'/'7'/'9'/'99'→ramas a questions/restart). `verifyForUserRequest:89` exige `otp_verification_pending`; `codeHashFromInput:372` hashea sha256 el OTP en claro; `resultadoValidacion` ('1'+válido→approved, '2'→rejected, '6'→expired, '8'→additional_verification_invalidated).
6. **PREGUNTAS** (`preguntasForUserRequest:116`): `canGenerateQuestionnaire` exige `questionnaire_ready`; `EvidenteClient::preguntas`; resultado '01'+id+registro → `questionnaire_generated`/`answer_questions`; '21'→restart; otros bloqueos → 'blocked'.
7. **VERIFICAR/ANSWERS** (`verificarForUserRequest:284`): exige `questionnaire_generated`; `approved = truthy(resultado) && truthy(aprobacion|aprobación)` (`:338-343`, **doble grafía con/sin tilde** — sugiere contrato variable del upstream). stage → `completed_approved`/`completed_rejected`.

### 5.3 Mapa ruta → método (controlador `EvidenteController`)
| Ruta | Método | Generación |
|---|---|---|
| POST `flow/{ur}/start` | `startFlow` (con presenter) | orquestada |
| GET/POST `flow/{ur}/questions` | `startFlowPreguntas` (JSON crudo) | orquestada |
| POST `flow/{ur}/answers` | `verifyFlowQuestionnaire` (JSON crudo) | orquestada |
| POST `flow/{ur}/otp/start` | `startFlowOtp` (JSON crudo) | orquestada |
| POST `flow/{ur}/otp/verify` | `verifyFlowOtp` (con presenter) | orquestada |
| POST `evidente/validar` | `validar` (proxy) | bare |
| POST `evidente/preguntas` | `preguntas` (proxy) | bare |
| POST `evidente/verificar` | `verificar` (proxy) | bare |
| POST `evidente/otp/initialize` | `initializeOtp` (proxy) | bare |
| POST `evidente/otp/start` | `startOtp` (semi-orquestado) | bare |
| POST `evidente/otp/generate` | `generateOtp` (proxy) | bare |
| POST `evidente/otp/verify` | `verifyOtp` (proxy) | bare |

### 5.4 Stages (`EvidenteFlowService`/`EvidenteOtpFlowService`)
`post_validation` → `questionnaire_ready` → `questionnaire_generated` → `completed_approved`/`completed_rejected`; `restart_required`; `otp_verification_pending` (definido en `EvidenteOtpFlowService.php:12`). Transiciones validadas por `EvidenteFlowStateStore::isAllowedTransition:237`; stages completados son terminales. Persistencia doble (durable `lender_integration_flows.data['evidente_flow']` + cache cifrado `Crypt::encryptString`); el durable requiere `lender_id` (Credifamilia siempre lo tiene). `forget()` está **protegido** para stages avanzados (`isProtectedFromForget:345`) pero los errores de transporte/bloqueos de `validar` SÍ hacen forget incondicional. Config en `config/services.php:171` (`flow_state_ttl_minutes=30`, `otp_enabled=true`, `strict_cc_expedition_date=true`).

---

## 6. CrossCore + Jumio (riesgo + biometría)

Onboarding biométrico Jumio → webhook → job `ProcessCrossCoreEvaluation` → Experian CrossCore (orquesta JumioVI + DataCheck) → decisión → persiste en `crosscore_evaluations`; `ValidationStatusService` lo expone al wizard.

### 6.1 Sub-flujo
1. **Enrolar** (front): `EnrollCrosscoreValidationUc` → POST `/api/onboarding/identity/crosscore/biometric/start` con `{user_request_id}` + header `x-user-id`.
2. **startBiometric** (`CrossCoreController.php:19`): `JumioOnboardingService::prepareStartData` resuelve UserRequest, **ROTA un `client_reference_id` por intento** (`'UR{id}-{ULID}'`, `:100-135/:372-394`), arma `success_url/error_url = {frontend}/self-service/{alliedHash}/{ur}/identity-validation-status?provider=crosscore`.
3. `JumioAccountService::createAccount` (`:20-98`): OAuth client_credentials (Basic), POST a `account_url` con `workflowDefinition.key=JUMIO_WORKFLOW_KEY`, credenciales COL `[ID_CARD,PASSPORT]`, `web.{successUrl,errorUrl,locale:'es'}`, `callbackUrl`. Extrae `account_id_jm/workflow_id_jm/web_href/sdk_token`. Persiste `JumioAccount` status `pending`. Responde `{action:'capture_required', web_href, sdk_token, ...}`.
4. Jumio captura documento+selfie+liveness y abre el web_href/SDK. Al completar, POST al webhook.
5. **callback** (`CrossCoreController.php:49`): valida secreto por header `X-Jumio-Callback-Secret`/`X-Callback-Secret` (`hash_equals`); `recordCallback:188-233` resuelve la cuenta y normaliza status. Si `shouldQueueEvaluation:137-144` (exige `user_request_id`+`client_reference_id`+`account_id_jm`+`workflow_id_jm`+status terminal) → `ProcessCrossCoreEvaluation::dispatch`.
6. **Job** (`ProcessCrossCoreEvaluation::handle:31-96`): lock Cache `crosscore_eval:jumio_account:{id}` 180s (idempotencia), revalida estado terminal, salta si ya hay evaluación pending/success, llama `CrossCoreClient::evaluate`.
7. **CrossCoreClient::evaluate** (`:30-133`): crea `CrossCoreEvaluation` pending, `CrossCorePayloadBuilder::build` (header/control/device/contacts/application + biometrics), token OAuth, POST con `retry(2,...,250ms)` y headers `X-User-Domain`/`X-Correlation-Id`/`X-Screenless-Kill-Null`.
8. **Interpretación**: `CrossCoreResponseInterpreter::interpret:7-27` parsea `overallResponse`. `CrossCoreDecisionMapper::map:7-19`: ACCEPT/CONTINUE/APPROVE→`continue`; REFER→`manual_review`; REJECT/STOP→`reject`; NODECISION→`technical_review`; ERROR→`technical_error`.
9. **completeEvaluation** (`:135-198`): actualiza la fila (request/response payloads **ENCRIPTADOS**), persiste `RiskCentralUserData` (`risk_central_id=9 'CrossCore'`).
10. **Imágenes**: `JumioRetrievalService::syncDocumentImages:32-66` busca `serviceName=='JumioVI'` → parts FRONT/BACK → descarga con Basic Auth → sube a S3 (`front-web/users/documents/crosscore`) → `User.front_url/back_url`. **Un fallo aquí NO rompe la evaluación** (warning).

### 6.2 Callback asíncrono y caminos convergentes
- **Asíncrono real** = webhook → job. **Síncrono fallback** = el front llama POST `/api/onboarding/identity/crosscore/evaluate` tras volver de Jumio a `identity-validation-status?provider=crosscore`. El job tiene lock+dedup para que no choquen.
- **Polling** (`ValidationStatusService::getValidationStatus`): para CrossCore lee la última `CrossCoreEvaluation`. `validated` (duro) = `decision=='ACCEPT' && response_code=='R0201'` (`:534-538`). **Self-healing peligroso:** si la última es `NODECISION`, re-ejecuta `CrossCoreClient::evaluate` SÍNCRONAMENTE dentro del request de polling (`:235-240`).
- Comando agendado `app:mark-stuck-crosscore-evaluations` (cada 5 min) marca `error` toda evaluación pending > 10 min (`crosscore_stuck_pending`).

### 6.3 IdentityValidationType (enum, `Modules/Identity/App/Enums/IdentityValidationType.php`)
`Unknown=0, None=1, AwsOcrRekognition=2, Questions=3, Ado=4, CrossCore=5, Evidente=6`. El lender define cuál usa vía `lenders.validation_type` / `primaryIdentityValidationType` (order=1 = primaria). `IdentityValidationStepResolver` mapea: 5→`crosscore_validation`, 6→`evidente_validation`. **Evidente y CrossCore son hermanos/alternativos para el mismo lender 24** (no encadenados); el front puede hacer switch-provider.

---

## 7. Motor de plan de pagos

Motor de amortización francés en PHP puro que reconstruye la *"Calculadora PV V20251009.xlsm"* de Credifamilia. Calculador **stateless** + 7 servicios/endpoints que proyectan el resultado.

### 7.1 Endpoints (`Modules/Onboarding/routes/api.php:214-234`)
| Endpoint | Controlador | Devuelve | Consumidor |
|---|---|---|---|
| POST `payment-plan/credifamilia/calculate` | `CredifamiliaPaymentPlanController::calculate:19` | `{inputs,derived,summary,payment_plan,trace}` (puro, sin DB) | tests/herramientas |
| GET `.../loan-options/{loan_request_id}/{amount}` | `CredifamiliaLoanOptionsController:18` | `{lender,interest_rate,available_amount,plans:[{term,monthly_installment}]}` | marketplace (`usePaymentPlanOptions`) |
| GET `.../continue-request/{user_request_id}` | `CredifamiliaContinueRequestController:18` | desglose 1ª cuota | `payment-plan.repository.getPaymentPlan` |
| GET `.../installment-plan/{ur}/{payment_day}` | `CredifamiliaInstallmentPlanController:18` | planes por term con fechas (`dd-mm-yyyy`); payment_day ∈ {2,16} | wizard |
| GET `.../payment-dates/{ur}` | `CredifamiliaPaymentDatesController:18` | 2 próximas fechas válidas (`dd-Mmm yyyy`); NO ejecuta el motor | wizard |
| GET `.../payment-plan-summary/{ur}` | `CredifamiliaPaymentPlanSummaryController:18` | documento resumen + plan completo | revisión |
| GET `.../voucher/{ur}` | `CredifamiliaVoucherController:18` | comprobante final (asesor + `confirmation_number`) | cierre |

### 7.2 Matemática (la espina del motor)
- **Fachada:** `CredifamiliaPaymentPlanCalculatorService::calculate:36` (array→DTO→motor→array; nunca lanza, todo Throwable → error estructurado CP050).
- **Contexto** (`CalculationContext::fromInput:93`): 12 pasos deterministas. Bono: `bondBase=requested_amount*bond_percentage`, `bondIva=bondBase*iva_rate`, `fourPerThousand=(bondBase+bondIva)*0.004`, `totalBond`=suma. `totalDisbursement` = `requested_amount+totalBond` si `'Anticipada'`, = `requested_amount` si `'Vencida'`.
- **Tasas** (`FinancialMath:19-37`): `monthlyRate (TEM)=(1+TEA)^(1/12)-1`; `dailyRate=(1+TEA)^(1/360)-1` (compuesta efectiva, **NO TEA/360**).
- **Days360 NASD (FALSO)** (`Days360Calculator`): replica el `.xlsm`; puede dar negativo por diseño.
- **Fechas** (`DateCalculator`): `firstPaymentDate` = `payment_day` del mes+1; si `Days360(desembolso, candidato) < 30` salta a mes+2 (regla mínimo 30 días).
- **Interés diario** (cuota 1 solo): `dailyInterestDays = Days360(desembolso, firstPaymentDate) − 30`; `dailyInterestAmount = totalDisbursement * dailyRate * dailyInterestDays` (sobre el desembolso total, no sobre saldo).
- **PMT** (`PmtCalculator → FinancialMath::pmt:51`): `baseInstallment = (rate*pv)/(1−(1+rate)^−nper)` (Excel PMT tipo 0). Caso rate==0 → `pv/nper`.
- **Seguro/aval por cuota**: `lifeInsurance = totalDisbursement*life_insurance_factor` (FIJO, no decrece); `installmentBondFee` = 0 si Anticipada, `totalBond/term` si Vencida.
- **Cronograma** (`ScheduleGenerator:42`): última cuota absorbe el residual del PMT (`principal=balance`, `closingBalance=0.0` exacto). `totalInstallment = baseInstallment + dailyInterest + lifeInsurance + bondFee`. Cada cuota lleva `excel_trace` (floats crudos) para conciliar contra el `.xlsm`.
- **Integridad** (`validateScheduleIntegrity:60`): count===term; último closingBalance===0.0 exacto; `|sum(principal)−totalDisbursement|≤0.01` (CP052 si falla). Todo en float crudo.
- **Redondeo asimétrico:** SOLO `payment_plan` se redondea a entero (`Money::toRoundedInt`, HALF_UP); `derived/summary/trace` quedan en float. `formula_version='CREDIFAMILIA_V1_FRENCH_TEA_DAYS360_EU'`.

### 7.3 Ruta con DB y pre-approval
Para los endpoints DB-backed: `CredifamiliaPayloadBuilder::build:33` carga `UserRequest`, hace POST a `services.pre_approvals.base_url '/v1/preapprovals/check'` (timeout 25s), extrae `transaction_data` (`guarantee_percentage→bond_percentage`, `guarantee_type→bond_type`, `annual_effective_rate/100`, `life_insurance_percentage/100`, `max_amount`), llama al calculador y proyecta.

### 7.4 Consumo desde el front
`usePaymentPlanOptions.ts` (debounce 800ms, gate `supportsDynamicPaymentPlan(24) && isPreApprovalReady`); `payment-plan.repository.ts` (HttpClient, `ApiResult`, nunca tira); `payment-plan.entity.ts` (zod `PaymentPlanOptionsResponseSchema`, state machine con `previous` para evitar parpadeo).

> **Detalle exclusivo:** la **cuota 1 ≠ resto** (lleva interés diario extra), por eso `loan-options/summary/voucher` usan la **cuota 2** (`REPRESENTATIVE_INSTALLMENT=2`) como "cuota mensual representativa". **No hay guard para term=1** (los proyectores leerían `payment_plan[1]` indefinido). Días de pago fijos {2,16}; `loan-options`/`continue-request` fuerzan `payment_day=2`.

---

## 8. Firma y formalización (Netco + PDFs)

Tras aprobar y firmar por OTP: se generan 6 PDFs vía pdf-mapper-service, se firman los 6 con Netco + el pagaré con Deceval, y al disburse (Estado 11) se unen en un PDF unificado (merge-urls, **9 documentos** incluido el plan de pagos) que se radica vía SOAP.

### 8.1 Pipeline
1. **Preview (Fase A)** — GET `promissory-note/{user_request_id}` → `PromissoryNoteController::show:65`. Si `lender_id===24` (**hardcode `:94`**) y el lender tiene `signingProvider 'netco'`, `generateCredifamiliaDocumentsWithSigning:343`: `CredifamiliaDocumentsBuilder::build` pide 6 service-docs a pdf-mapper-service (driver microservice, lenderId:24), sube a S3, `provider->prepare()` crea filas `netco_signing_documents` status `generated` (sin llamar a Netco aún). El pagaré se genera aparte (Deceval).
2. **Firma OTP** — `sendOtp`/`verifyOtp` → estado intermedio "Autorizado pendiente desembolso".
3. **Disburse (Fase C)** — POST `promissory-note/validate/authorize` → `disburse:313` → `LoanAuthorizationService::authorize:84`.
4. `DocumentSigningService::generateAllDocuments:47` → `signNetcoDocuments:102` (re-genera bytes, `SigningSession->withPdfBytes()`, `provider->sign()`) + `signPromissoryNote` (Deceval).
5. `NetcoSignerProvider::sign:194`: emite cert del deudor (sesión ADMIN, DN institucional de Credifamilia de `config/netco_signer.php`), abre sesión del deudor (password HKDF-SHA256), por cada doc `signFiles` (signatureType=3). Cada PDF firmado → S3 → fila `signed` con `netco_uid/signed_pdf_url`. `username='credifamilia_{document_number}'`.
6. De vuelta en `authorize`: tras commit, `formalizeExternalManagedIfApplicable:194` (solo si `rt==4`) → `CredifamiliaFormalizationService::formalize`.
7. **Formalización** (`CredifamiliaFormalizationService::formalize:51`): (a) `CredifamiliaLegalizationDocumentService::collect` reúne URLs firmadas en ORDEN OFICIAL y reporta obligatorios faltantes (si falta uno → `FormalizationException`, NO radica); (b) resuelve servicio vía `LenderServiceFactory::make(24)` (fail-fast); (c) `PdfMergeService::mergeUrlsToBase64` → POST pdf-mapper-service `/api/merge-urls` (PDF unificado); (d) `CredifamiliaConsumoService::finalize` → `register()` (SOAP `transaccionConsumo`) + `submitDocument()` (SOAP `guardarDocumentoOpenKm` con el PDF).
8. Éxito real SOLO si estado terminal `CREDIT_COMPLETED`; si no, loguea error best-effort (NO lanza); el crédito queda en Estado 11 con radicación posiblemente fallida.

### 8.2 Orden oficial del PDF unificado
Orden verificado contra el código vigente de `CredifamiliaLegalizationDocumentService::collect` (FORMALIZACION-PDF-CONTEXTO.md §5, **9 docs**, todos required=true): 1) consent (Formato vinculación), 2) terms_conditions (autorización datos), 3) disbursement_authorization, 4) regulation, 5) guarantee (FGA), 6) pagaré (`PromissoryNote.promissory_note_url`), 7) cédula frontal (`User.front_url`), 8) cédula reverso (`User.back_url`), **9) plan de pagos (`payment_schedule`) — va al FINAL**.
- **Fix 2026-07:** el `payment_schedule` se generaba y firmaba (§8.3) pero `collect()` NO lo incluía en la unión (faltaba en `NETCO_DOC_TYPES` y en los slots); ahora entra en la posición 9. Validado en BD: 22 filas `payment_schedule` firmadas (mismo conteo que consent/guarantee).
- (El README.md viejo listaba 5 docs — Formulario, FGA, Tratamiento de datos, Autorización de desembolso, Cédula — desactualizado.)

### 8.3 Mapping service-doc → doc_type → response-key (`CredifamiliaDocumentsBuilder`)
`vinculacion→consent`, `fondo-garantias-confe→guarantee`, `plan-de-pagos→payment_schedule`, `reglamento→regulation`, `terminos-y-condiciones→terms_conditions`, `autorizacion-desembolso→disbursement_authorization`. El pagaré NO va por aquí (Deceval).

### 8.4 Payload de vinculación / SOAP
- `OnboardingPayloadBuilder` (~90 campos para pdf-mapper-service): `LENDER_CREDIFAMILIA=24`, ~50 lookups EAV (`user_field_values`). Field IDs conocidos: 87=ingresos, 90=egresos, 29=ocupación, 70=ciiu, etc.
- SOAP `transaccionConsumo` (`TransactionRequest::build`, ~50 campos): identidad, financiera, laboral, FATCA/PEP, `codigoPagare=deceval_response_data.pagare.id`, `tipoFianza` (bond_type), tasas del preaprobado. **Muchos MOCK/hardcode** (`fechaIngreso='01/02/2018'`, `verticalComercio='salud'`, `origen='Linxe'`).
- SOAP `guardarDocumentoOpenKm` (`DocumentRequest::build`): `archivoProcesoLegalizacion`=PDF base64, `codigoSolicitud=user_request_id`, `origen='Negozia'` (fijo).
- `SoapClient.php`: WS-Security X.509 a mano (RSA-SHA256, exclusive C14N de Timestamp+Body), mTLS por cURL. NO usa `\SoapClient` nativo. Namespaces por operación distintos (`request.web.proptech.credifamilia.com` vs `dto.proptech.credifamilia.com`).

---

## 9. Consumo (SOAP) + bonificación + condiciones especiales

### 9.1 CredifamiliaConsumo (SOAP) y su relación con V2
**Clave para entender el lender 24:** hay TRES integraciones que comparten `lender_id=24` y las mismas filas `lender_allied_credentials`, pero son **etapas/productos distintos del mismo lender**, NO el "mismo producto vs distinto":
1. **Credifamilia REST/OAuth** (`app/Actions/Lenders/Credifamilia.php`) = **pre-aprobación** BNPL + redirección a Negozia (V1, existía en el viejo).
2. **CredifamiliaV2** (`app/Services/Lenders/CredifamiliaV2/{Evidente,CrossCore}`) = **KYC/identidad/buró** (Experian Evidente preguntas+OTP, CrossCore decisión, Jumio biométrico).
3. **CredifamiliaConsumo (SOAP)** (`app/Actions/Lenders/CredifamiliaConsumo/*`) = **RADICACIÓN/formalización** final del crédito ya aprobado y firmado.

CredifamiliaConsumo es **libranza privada de consumo** (`tipoProducto='Libranza'`, `detalleProducto='Libranza privada'`). **Matiz de atribución (corrección del crítico):** el propio `CredifamiliaConsumo` NO chequea `response_type` por ningún lado (grep vacío en `app/Actions/Lenders/CredifamiliaConsumo/*` y en `Modules/Onboarding/.../CredifamiliaConsumo/*`): se ejecuta incondicionalmente cuando se lo invoca. El gate `rt==4` vive ÚNICAMENTE en `LoanAuthorizationService::formalizeExternalManagedIfApplicable` (`:196`), que es quien decide invocar la radicación. `finalize()` encadena `register()` (`transaccionConsumo`, sin PDF) + `submitDocument()` (`guardarDocumentoOpenKm`, solo si `signed_pdf_base64` no es null). Idempotencia por `findExistingTransaction` (reusa REGISTERED/DUPLICATED/COMPLETED). Estados sembrados por `CredifamiliaConsumoSeeder` (sin esas filas, `resolveStatusId()` lanza). **Nota:** ese seeder siembra estados/credenciales de Consumo, **no** la fila `lenders` id=24 — no existe ningún seeder de esa fila en el repo (refuerza la pregunta abierta #1 sobre el `response_type` real). Herramientas/CLI de este subsistema: `app/Console/Commands/{SeedCredifamiliaConsumoCredentialCommand,TestCredifamiliaConsumoActionCommand,TestCredifamiliaConsumoSoapCommand}.php` y `app/Exceptions/CredifamiliaConsumoCommandException.php`.

### 9.2 Plan de pagos externally-managed (rt==4)
`PaymentDateService:58` y `ExternallyManagedPaymentScheduleService` delegan en el motor local `CredifamiliaInstallmentPlanService`: `simulate()` devuelve terms (usa la **2ª cuota** como representativa porque la 1ª es pago inicial), `confirm()` solo persiste `fee_number`.

### 9.3 Bonificación (comisiones al asesor — Sonría)
`BonificationCheck` (`app/Jobs/Lenders/Credifamilia/BonificationCheck.php`) calcularía `remaining_bonus` (8/1000, redimible ≥50000) cuando un UserRequest queda "Autorizada" + lender Credifamilia. **HOY DESACTIVADO** (`dispatch` comentado en `UserRequestObserver.php:42`). `SendBonificationReport` (`app/Jobs/Lenders/Credifamilia/SendBonificationReport.php`) envía un xlsx a michel@credifamilia.co (sin invocador hallado — ¿scheduler externo?). Al cliente se le notifica el bono vía `app/Notifications/Customer/BonusObtained.php`.

### 9.4 Condiciones especiales (reordenamiento del listado)
`SpecialConditionsController`: `existLenderCondition` **case 24 (`:59`)** = lógica real de Credifamilia (probabilidad por datacrédito: vectores de comportamiento, mora, capacidad de endeudamiento ≤0.4). **Confusión:** `existCondition` **case 24 (`:40`)** NO es Credifamilia, es `allied_id==24` → `bancolombiaConditions()`. No confundir lender 24 con allied 24.

### 9.5 ¿Mismo producto que V2?
**No exactamente — son etapas, no productos rivales.** El motor decide el lender una vez (rt=2 sellado en getLenders); luego V2 (identidad) y CredifamiliaConsumo (radicación SOAP) son fases secuenciales del mismo crédito. El producto financiero es libranza privada de consumo en ambos.

---

## 10. Sistemas externos

| Sistema | Para qué | Dónde se configura |
|---|---|---|
| Pre-approvals MS (Go, puerto 8082) | Pre-aprobación rt!=0 + parámetros financieros del plan (POST `/v1/preapprovals/check`) | `VITE_PREAPPROVALS_ENDPOINT` (front); `services.pre_approvals.base_url` (back) |
| Credifamilia REST/OAuth (BNPL) | Radicación pre-aprobación V1 (`/servicescf/consumo/radicacion`, `/estado`); mTLS + OAuth2 | `config/services.php` `credifamilia` (`CREDIFAMILIA_HOST`/`HOST_OAUTH`) |
| Credifamilia SOAP `consumoEndPoint` | Radicación final (`transaccionConsumo`) + envío PDF (`guardarDocumentoOpenKm`); mTLS + WSSE X.509 | `services.credifamilia_consumo.wsdl` (`CREDIFAMILIA_CONSUMO_WSDL`); cert/key en `lender_allied_credentials` |
| Experian Evidente (Master + v3 OTP) | Verificación identidad: validar + preguntas/cuestionario + OTP SMS | `config/services.php` `evidente` (token_url, service_base_url, …) + override `IntegrationSettingsService` |
| Experian CrossCore | Motor de orquestación/decisión de riesgo+identidad (ACCEPT/REFER/REJECT/NODECISION/ERROR) | `config/services.php` `crosscore` (tenant_id, model_code, org_code, request_type, `risk_central_id=9`, `pending_timeout_minutes=10`) |
| Jumio (KYX) | Onboarding biométrico (documento COL + selfie + liveness); webhook callback; retrieval API | `config/services.php` `jumio` (workflow_key, callback_url/secret, retrieval_*, reuse_window_minutes=15) |
| Netco (PKI / firma electrónica) | Emite cert del deudor + firma PDFs (signFiles) | `config/netco_signer.php` (base_url, admin, profile_id, DN institucional, password_derivation) |
| Deceval | Pagaré desmaterializado con OTP propio; `codigoPagare` para el SOAP | (lender `promissory_type='deceval'`) |
| TusDatos (AML) | Chequeo de listas/AML; `has_findings` detiene la solicitud | (servicio AML, parte de `validation-status`) |
| pdf-mapper-service (Go) | Genera cada PDF (template+mapper.json) y une los firmados (`/api/merge-urls`) | `PDF_MAPPER_SERVICE_HOST` / `services.pdf_mapper_service.host` (dev `localhost:8084`) |
| OpenKM (sistema documental de Credifamilia) | Backend de `guardarDocumentoOpenKm` | (lado Credifamilia; **no disponible en QA** — ver §12) |
| AWS S3 | Almacena PDFs generados/firmados e imágenes de documento | disk `s3` (visibility public) |
| Twilio / correo | OTP de firma + notificaciones de autorización | `NotificationService` |
| Tabla `settings` (DB) | Override en runtime de config de evidente/crosscore/jumio | `IntegrationSettingsService` |
| Central de riesgo (`risk_central` + `risk_central_user_data`) | Registro de consumos (Evidente='evidente - Experian'; CrossCore id=9) | seeds por nombre |
| Laravel Echo / Pusher | Confirmación por socket del modal (hoy solo Meddipay; **NO aplica a Credifamilia**) | — |

---

## 11. Delta de migración (application viejo → legacy-backend)

**Conclusión:** en el `application` viejo, Credifamilia es un flujo **V1 simple** (una sola integración REST de radicación BNPL asíncrona + polling, reordenamiento por datacrédito, bonificación Sonría). **Todo el flujo profundo V2 del legacy-backend es greenfield.**

| Pieza | OLD (application) | NEW (legacy-backend) |
|---|---|---|
| V1 REST radicación (`Credifamilia.php` register/show/authorize) | Sí (415 líneas) | **Portado casi verbatim** (diff: namespace `Modules\Risk` para ProfilingReviewController, json_encode en logs) |
| Clasificación Pre aprobado/Rechazado/En validación | Sí (`PreApprovedLenderService` rama 24) | Portado |
| `credifamiliaConditions` (datacrédito) | Sí | Portado (refactor a `data_get`) |
| Bonificación Sonría | Sí (activa) | Portado pero **desactivado** |
| `response_type` de id=24 | **Forzado a `1`** (`LenderRetrievalService.php:224`) — lender de integración rt=1, NO CreditopX | **¿2? ¿4?** — no confirmado en repo |
| Evidente (KYC) | **No existe** | **GREENFIELD** (`CredifamiliaV2/Evidente/*`, 10 servicios + controller + 9 FormRequests) |
| CrossCore + Jumio | **No existe** | **GREENFIELD** (`CredifamiliaV2/CrossCore/*`, 12 servicios + job + webhook) |
| SOAP CredifamiliaConsumo | **No existe** (solo REST) | **GREENFIELD** (`CredifamiliaConsumo/*`: SoapClient ~25KB, TransactionRequest ~20KB, DocumentRequest) |
| Motor de amortización / plan de pagos | **No existe** (el plan venía de Credifamilia) | **GREENFIELD** (`PaymentPlan/Credifamilia/*`, 25 archivos + 7 controladores) |
| Formalización / legalización PDF | **No existe** | **GREENFIELD** (`CredifamiliaFormalizationService`, `CredifamiliaLegalizationDocumentService`, `PdfMergeService`) |
| Config externa | solo `credifamilia.host/host_oauth` | + `credifamilia_consumo.wsdl`, `crosscore.*`, `jumio.*`, `evidente.*` |
| UI front | Vue `ListLenders.vue` (solo barra de polling + "cupo disponible") | wizard React con pantallas Evidente/CrossCore/plan de pagos |

Verificado por grep adversarial: el OLD NO contiene NINGUNA referencia a evidente/crosscore/jumio/CredifamiliaConsumo/AmortizationEngine/FinancialMath/Days360/formalization/legalization.

---

## 12. Gotchas / fragilidades / bugs conocidos (consolidado y deduplicado)

### Tipo de lender / response_type
1. **AMBIGÜEDAD CRÍTICA `response_type` (2 vs 4):** todo el front y la memoria dicen rt=2; pero la formalización SOAP (`EXTERNAL_MANAGED_RESPONSE_TYPE`) y el plan extra-details (`EXTRA_DETAILS_RESPONSE_TYPE`) SOLO corren si `rt==4`, y `rt==2` es `CANCEL_OTHER_LOANS`. No hay seeder de la fila `lenders` id=24 en el repo. En el OLD se forzaba `rt=1`. **El crítico DEBE verificar el `response_type` real de la fila id=24 por entorno.** El phpdoc de `formalizeExternalManagedIfApplicable` además dice "response_type 5" (stale; la constante real es 4).
2. **El case 24 legacy en `UserRequestService.php:510` (rt==1 + credencial → `Credifamilia::show()`)** probablemente es código muerto si Credifamilia nunca es rt=1 en el NEW.

### Frontend
3. **Polling exclusivo:** Credifamilia es el ÚNICO con polling (`fetch-lender-preapproval.ts:264`); el timeout cliente (~40s) es deliberadamente mayor que el `write_timeout` server (30s) para evitar transacciones duplicadas.
4. **`supportsDynamicPaymentPlan` hardcodeado a `=== 24`**; el plan dinámico solo corre con `isPreApprovalReady` (si no aprueba, no hay plan).
5. **Product key = `'creditop_x'`** (no el slug `'credifamilia'`) al MS.
6. **"Pago mínimo requerido" es solo display**, no dispara pago. No hay UI de cobro de cuota inicial en el wizard.
7. **Comentario engañoso** en `available-lenders.tsx:509`: dice que Credifamilia es "external redirect", pero el handoff KYC real pasa por `/confirmation` → `stepRouteMap`.
8. **`standBy` NO existe en frontend-monorepo** (grep vacío); el fix recordado en memoria no está. **Verificar si se revirtió o vivía en otro repo.**
9. `useLenderTransactionStatus.tsx:12` hardcodea el prefijo `/ecommerce/` en el polling, ignorando el contexto real (merchant/self-service).
10. `loan-confirmation.tsx` loader usa un User-Agent Android hardcodeado (`:79`) para forzar vista móvil.
11. Gate del botón "Gestionar": `allied.show_gestion===1 || allied_id===26` (`gestion-cell.tsx:64`).
12. `probability` obsoleta (a menudo '0%') en v2 → ignorada en el orden.
13. Cualquier rechazo en Evidente (OTP/AML/preguntas) → `request-canceled` sin reintento intra-Evidente.

### Evidente
14. **Dos generaciones de rutas** (orquestada `flow.*` vs proxies bare); solo `startFlow`/`verifyFlowOtp` pasan por el presenter.
15. **`procesoEvidente` hardcodeado a `'VALDCN'`**.
16. El presenter marca `success=true` cuando `nextAction ∈ {verify_otp, questions, completed}` AUNQUE el resultado interno sea `success=false` — el "success" del presenter NO refleja aprobación.
17. OTP rechazado fuerza `requiereCuestionario=false` → termina rejected (no cae a cuestionario).
18. Idempotencia por replay (`replayed=true`) sin re-llamar a Experian; lock optimista por stage descarta writes que degraden (`shouldSkipStaleWrite`).
19. `aprobacion`/`aprobación` se lee con doble grafía → contrato del upstream variable.
20. `?mock=` solo en local/testing; mensajes técnicos ocultos para `evidente_auth_*`/`evidente_service_*`/5xx.

### CrossCore + Jumio
21. **`requiresJumio()` se decide solo por el string `'JMBA'` en `request_type`** — cambiarlo deshabilita silenciosamente la exigencia de account/workflow IDs.
22. **`CrossCoreScenarioResolver` es un STUB** (devuelve config tal cual).
23. **`validated` duro = `ACCEPT && R0201`**: un ACCEPT con otro response_code NO valida.
24. **Self-healing peligroso:** NODECISION re-ejecuta `evaluate` SÍNCRONO en cada poll (latencia/llamadas repetidas a Experian).
25. `client_reference_id` ROTA por intento (`UR{id}-{ULID}`); tests que asuman estabilidad fallan.
26. base64 de imágenes exige `min:5500000` caracteres.
27. Payloads encriptados en DB (no consultables con SQL plano).
28. Fallo S3 al bajar imágenes NO falla la evaluación.
29. `callback_url` debe ser HTTPS público si `account_url` es `*.jumio.ai` (local con `.local`/localhost → error).
30. Secreto del callback por header `hash_equals`; sin `callback_secret` configurado → todo callback 401.
31. Comando `mark-stuck` (cada 5 min) mata pending > 10 min — una evaluación lenta legítima queda `crosscore_stuck_pending`.

### Motor de plan de pagos
32. **Unidades de tasa:** `annual_effective_rate`/`life_insurance_factor` son DECIMALES en `/calculate` (0.2817), pero el pre-approval los entrega en PORCENTAJE (`CredifamiliaPayloadBuilder` divide `/100`). Sin validación de cota superior — pasar 28.17 da plan absurdo.
33. **Redondeo asimétrico:** solo `payment_plan` redondeado; suma de cuotas ≠ `grand_total`.
34. **Cuota 1 ≠ resto** (interés diario extra) → se usa la cuota 2 representativa; **sin guard para term=1** (índice `[1]` indefinido).
35. `Money::fromFloat` rechaza negativos con `InvalidArgumentException` (capturada como CP050 genérico, pierde detalle).
36. `available_amount` tiene DOS significados: en `derived` = `total_disbursement − max_amount` (informativo); en `loan-options` OUTPUT = `max_amount` (tope del aliado).
37. **Filtro `lender_id` inconsistente:** `LoanOptions` acepta NULL/0/24; `InstallmentPlan/PaymentDates/Summary/Voucher/ContinueRequest` exigen `===24` estricto (CP010/404 si no está sellado).
38. `fee_numbers` se parsea distinto entre endpoints (`InstallmentPlan` hace `trim()`, `LoanOptions` no).
39. **DEBUG TEMPORAL en producción:** `lastNullReason` (A:/B:/C:) filtra `base_url`/status/300 chars del body del pre-approval a `details.reason` (riesgo de fuga; marcado "TEMP DEBUG").
40. `lending_product_id==='24'` comparación ESTRICTA de string — si el MS devuelve int 24 → rama no-aprobado.
41. `iva_rate=0.19`, `rate_type='Full rate'`, partner fallback `'Gaes'` HARDCODED (con @todo).

### Firma / formalización / SOAP
42. **DISCREPANCIA DE TEST (load-bearing):** `NetcoSignerProvider::sign()` envía `signatureType=3` (`:323`/`:338`) pero `NetcoSignerProviderTest.php:174` exige `=== 5`. El test debería estar rojo. (Se spawneó task para reconciliar.)
43. **`lender_id===24` HARDCODEADO** en `PromissoryNoteController::show:94` (no config).
44. **Idempotencia de la radicación DESACTIVADA** (bloque comentado en `LoanAuthorizationService.php:205-216`) — un re-disburse puede re-radicar; idempotencia recae en `CredifamiliaConsumo::findExistingTransaction`.
45. **`disbursement_authorization`:** solicitudes ANTIGUAS (generadas antes de habilitarlo a firma) no tienen ese doc firmado → reportan 'missing' y abortan la formalización. (FORMALIZACION-PDF-CONTEXTO.md está desactualizado: aún lo describe como `doc_type=null`/`required=false`.)
46. **Formalización best-effort:** NO lanza si el terminal no es `CREDIT_COMPLETED` (solo loguea) → un crédito puede quedar Estado 11 con radicación fallida silenciosamente. Un 400/Fault de aplicación es "XML válido" que no lanza.
47. **`submitDocument` se salta si `signed_pdf_base64` es null** → queda en `CREDIT_REGISTERED`, nunca `CREDIT_COMPLETED`. La descarga del PDF desde `signed_pdf_url` (S3) es un @todo no implementado.
48. **BUG DE CREDENCIALES CONFIRMADO (el crítico lo verificó, ya no es "posible"):** el runtime `CredifamiliaConsumo.php` lee `credifamilia_cert`/`credifamilia_key`/`credifamilia_password` (`:411-412`, `:426`, `:436`), mientras `SeedCredifamiliaConsumoCredentialCommand.php` escribe `credifamilia_consumo_cert`/`_key`/`_cert_password` (`:295-297`). **Las llaves que siembra el comando NUNCA se leen en runtime.** Mitigante: el comando tiene `--copy-from-rest` (`:43`, `:147-175`) que sugiere intención de compartir el cert REST; pero tal como está, sembrar las llaves `_consumo` no surte efecto. Hay que alinear las llaves antes de desplegar.
49. **FUGA DE SECRETO EN LOGS:** `makeClient():426` loguea `certPassword` en claro vía TracerService.
50. **MOCKS/HARDCODES en `transaccionConsumo`** (no pasarán validación de Credifamilia en prod): `fechaIngreso='01/02/2018'`, `verticalComercio='salud'`, `origen='Linxe'`, `codigoPais*='169'`, sin tablas DANE/CIIU; datos bancarios de desembolso COMENTADOS.
51. **BLOQUEANTE EXTERNO (QA):** `guardarDocumentoOpenKm` devuelve `SoapFault java.lang.reflect.InvocationTargetException` en QA (OpenKM no disponible) → no se valida el happy path de `submitDocument`.
52. WS-Security a mano: firma expira en 300s; desfase de reloj o cambio de canonicalización rompe la firma silenciosamente (Fault→500).
53. `username` Netco exige `document_number` numérico 5-20 dígitos (malformado → 422, no 500).
54. Password derivation usa solo 15 bytes (límite sandbox `passMaxLength=20`); para prod hay que ampliar el profile (gate T01).
55. Nombre del 2do servicio: el manual V5.3 dice `guardarDocumento` pero el WSDL real solo expone `guardarDocumentoOpenKm`.
56. `terms_and_conditions_id=18` para `hasCredifamilia` (`UserService.php:314-327`, asignado en `:325`): **NO es un placeholder arbitrario** (corrección del crítico). El comentario en `:322` dice que id=18 es la TyC REAL de Credifamilia (`TERMINOS_Y_CONDICIONES_CREDIFAMILIA_V20260518`); el "placeholders pending" del phpdoc en `:281` es genérico de la función, no de este id. Lo que sí queda por confirmar es que la fila id=18 en BD apunte al documento correcto por entorno (ver Q21).
57. `ContinueUserFlowController::confirm` tiene un **doble `catch` con el primero VACÍO** (`:112-113`) que puede tragarse errores.

### Docs del equipo
58. **DISCREPANCIA LENDER ID:** `credifamilia-vinculacion-payload-mapping.md:5` dice `lender_id=120`; todo el código usa **24**. El doc de mapping está pre-implementación/desactualizado; **24 es el real**.
59. **Referencia rota:** README/RESUMEN citan `credifamilia-consumo-campos.md` (spec por campo) que **NO existe** en la ruta indicada.
60. **RESUELTO** el orden del PDF unificado: **9 docs** (era 8; se agregó `payment_schedule`/plan de pagos en posición 9, fix 2026-07). El README viejo con 5 docs está desactualizado. Ver §8.2.
61. **CAVEAT operativo:** el `APP_KEY` para correr tests SOAP debe ser el de dev, o falla con "The MAC is invalid"; correr DENTRO del contenedor docker.
62. WSSE X.509 no está en el manual V5.3 (se descubrió leyendo el WSDL).

---

## 13. Preguntas abiertas / puntos a verificar

> Marcadas con **[CRÍTICO]** las que el crítico debe validar antes de avanzar.

1. **[CRÍTICO]** ¿Cuál es el `response_type` REAL de la fila `lenders` id=24 por entorno (local/dev/prod): 2 o 4? De ello depende si corren `resolveExtraDetails()` (plan de pagos) y la formalización SOAP. No hay seeder en el repo.
2. **[CRÍTICO]** ¿El `primaryIdentityValidationType` de Credifamilia en prod es Evidente (6) o CrossCore (5)? Ambos están implementados; el wizard enruta según `lender_identity_validation_types` order=1. Hay que consultar la fila en BD.
3. **[CRÍTICO]** ¿El cutover de migración enruta Credifamilia por el V1 portado (REST) o por el V2 (Evidente+CrossCore+SOAP+plan de pagos)? Determina cuánto del greenfield está activo en parallel-run.
4. **[CRÍTICO — CONFIRMADO]** El runtime SOAP lee `credifamilia_{cert,key,password}` pero el comando siembra `credifamilia_consumo_*`: las llaves sembradas no se leen (gotcha #48, verificado por el crítico). Decidir: ¿se comparten las llaves del cert REST (`--copy-from-rest`) o se renombran las llaves del seeder? Resolver antes de desplegar.
5. **[CRÍTICO]** ¿El valor correcto de `signatureType` Netco es 3 (código) o 5 (test)? Reconciliar provider vs test (gotcha #42).
6. ¿Qué `step_details.type` emite el backend para Credifamilia específicamente? El mapeo es genérico; el camino concreto depende de la config del lender.
7. ¿En qué condición exacta `update-user-request` devuelve para Credifamilia "url + !openNewTab" (redirect externo, branch :510) vs "showModal + url=null" (QR /continue, branch :484)? Depende del backend, no del front.
8. ¿El fix `&& !response.data.standBy` se revirtió en frontend-monorepo o nunca vivió aquí? El código actual no lo contiene (gotcha #8).
9. ¿Cuándo se setean los estados intermedios entre 3 (selección) y 11 (autorizada)? El flujo de identidad/plan de pagos no parece mover `user_request_status_id` (vive en stores/tablas CrossCore), salvo "Autorizado pendiente desembolso" tras el OTP.
10. ¿El motor de amortización V2 produce cuotas que coinciden con lo que históricamente devolvía Credifamilia? **No hay golden test numérico contra la `Calculadora PV V20251009.xlsm`** — solo tests de estructura/422. Riesgo de paridad financiera.
11. ¿Hay un caller productivo del endpoint puro `/calculate` o solo lo usan tests/herramientas internas?
12. ¿Está garantizado que Credifamilia nunca ofrece term=1? Si lo hiciera, los proyectores que leen `payment_plan[1]` fallarían (gotcha #34).
13. ¿El DEBUG TEMPORAL (`lastNullReason`) está aprobado para producción o debe removerse? (gotcha #39, riesgo de fuga).
14. ¿Quién consume las rutas Evidente bare? Sin tests Feature; probablemente debug/primera generación.
15. ¿Qué pasa con manual_review (REFER) en el wizard? `ValidationStatusService` lo cae en `review_required`/completed; ¿qué pantalla ve el cliente?
16. ¿El disparo automático de `formalize()` vía `authorize()` ya está activo en prod, o sigue dependiendo del trigger manual admin (`formalize-external-managed`)? Los docs decían que lo conectaba "otro desarrollador".
17. ¿Las cédulas (`User.front_url`/`back_url`) están siempre presentes y son URLs públicas aptas para merge-urls? Son required y su ausencia aborta la radicación.
18. ¿Llegaron ya las 10 tablas de códigos de Credifamilia (DANE/CIIU/género/etc.)? Bloqueante externo pendiente. ¿Se resolvió el `InvocationTargetException` de OpenKM en QA?
19. ¿De dónde saldrán los datos bancarios de desembolso (`tipoCuenta/numeroCuenta/entidadBancaria`) que el test marca obligatorios pero el payload tiene comentados?
20. ¿`encrypt_code` (en el schema de respuesta del MS) se consume aguas abajo (pantalla /continue / autogestión)? No se usa en el marketplace.
21. La fila `terms_and_conditions` id=18 (referida por el código como la TyC real de Credifamilia, ver gotcha #56), ¿apunta al documento correcto/vigente por entorno? El riesgo no es que el código use un placeholder (no lo es), sino que el id 18 en BD apunte a un documento desactualizado.
22. ¿Quién dispara `SendBonificationReport` y se reactivará `BonificationCheck`? (Hoy desactivado.)
23. ¿El campo `origen` difiere intencionalmente entre operaciones ('Linxe' en transaccionConsumo vs 'Negozia' en guardarDocumentoOpenKm)?
24. ¿Dónde está el spec por campo `credifamilia-consumo-campos.md` que los docs citan pero no existe?

---

*Documento generado por síntesis de 10 lecturas paralelas. Última base: reportes estructurados de los subsistemas frontend-monorepo, legacy-backend, docs del equipo y comparación con application viejo.*
