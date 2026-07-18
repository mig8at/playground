# Formalization · contexto
> **estado:** al día con main · Fase de CIERRE después de elegir entidad (`user_request` estado 3 → 11 "Autorizada"): plan de pagos → documentos → firma con OTP → autorización, más los efectos post-11.

## Qué es
La formalización arranca cuando el cliente **ya eligió entidad** (`user_requests.user_request_status_id = 3`, "Selección de entidad") y termina en el **Estado 11 "Autorizada"** (o en un terminal 6/7/8). Es la fase que produce **papel firmado y plata**: fija el plazo y la primera fecha de pago, calcula la amortización real, genera y firma pagaré / consentimiento / FGA / plan de pagos, y recién ahí escribe el 11 más el primer registro del ledger.

Vive casi entera en **`legacy-backend/Modules/Loans`** (el módulo más grande del repo: ~320 archivos), se consume desde el wizard React (`frontend-monorepo/apps/loan-request-wizard`) y tiene un **gemelo completo y vivo en `application`** (Inertia, rutas en español) por el parallel-run.

Frontera con los hermanos: acá va el **journey de cierre**. La familia del lender (**creditopx** rt=2/3, **aggregator** rt=1, **redirect** rt=0), la biometría (**kyc**), la categoría que fija enganche/cupo/plazo/FGA (**profiling**) y el bloqueo por hardware (**smartpay**) son nodos propios.

## Contenido

### Superficie HTTP
`Modules/Loans/App/Providers/RouteServiceProvider.php:40-53` monta **el mismo `routes/api.php` bajo DOS prefijos**: `api/loans` y `api/loans/customer`. Por eso el front mezcla ambas formas para los mismos handlers (`.../customer/requests/promissory-note/{id}` para GET y `.../requests/promissory-note/validate/verify-otp` para POST) — no son endpoints distintos.

Todo el grupo `requests` lleva 3 middlewares (`routes/api.php:48`):
- **`onlyMobileValidation`** (`RedirectIdValidationIfDesktop`): si el user-agent es desktop devuelve **403 `{qrUrl, message:'continue-link-sent'}`** y manda el link por WhatsApp. Es el forzador estructural del handoff al celular del cliente; el front lo mapea a `continue_on_mobile`.
- **`validate.authorized.status`**: 403 `CREDIT_ALREADY_DISBURSED` si el estado es 11, 403 `CREDIT_CANCELLED` si es 8.
- **`origination.flow`** (`AddOriginationFlowType`): inyecta `metadata.{origination_flow_type, lender_path, credit_type}` en toda respuesta <400. El wizard bifurca a IMEI leyendo `metadata.lender_path === 'IMEI'`.

### La cadena real (wizard React, rt=2/3)
La entrada la fabrica el backend al seleccionar entidad: para rt ∈ {2,3,4} arma `/self-service/{allied_branch.hash}/{user_request_id}/confirmation` y devuelve `standBy=true` (`Modules/Onboarding/App/Services/UserRequestService.php:453-462` y `:601-611`). Esa URL es literalmente la ruta `:flow/:partner_hash/:loan_request_id/confirmation` del wizard (`app/routes.ts:8-32`; `:flow` ∈ ecommerce|merchant|self-service).

1. **`confirmation`** → `POST /api/loans/customer/requests/confirm` (`ContinueUserFlowController::confirm:68`). El `step_details.type` enruta a validación de identidad (`aws_ / ado_ / crosscore_ / evidente_validation`) o directo a `first-payment-date` si `no_validation_required` (`loan-confirmation.tsx:218-239`). → nodo **kyc**.
2. **`first-payment-date`** → `GET .../promissory-note/{id}/select-payment-date` + `POST .../confirm-payment-date`. `PaymentScheduleService::handleSelectPaymentDate` **baja el estado a 10** y deja rastro `creditop_x_user_requests_process_statuses_id = 8` (`PaymentScheduleService.php:25-35`). Tres fuentes de fechas según rt (`PaymentDateService.php:56-64`): `getCreditopXPaymentDates` (rt=2, vía `CreditopXRequestHistoryService`), `getRevolvingCreditPaymentDates` (rt=3), `getExternallyManagedPaymentDates` (rt=4 Credifamilia). Si hay una sola opción **o** `lender.allow_payment_date_selection == 0` se autoselecciona (`:66-79`); `cutoff_type_id == 2` (quincenal) usa una vista aparte de 2 cortes (`:36-47`).
3. **`payment-schedule`** → `simulate-payment-schedule` + `confirm-payment-schedule`. **Acá se fija el plazo**: `confirm` escribe `user_requests.fee_number` (`RegularPaymentScheduleService.php:102-126`). En el listado la cuota era estimación.
4. **`additional-info`** (gate) → `GET /api/loans/customer/{id}/form-type`; si `formTypeId === null` salta a `sign-documents`, si no abre el formulario dinámico (`additional-info.tsx:36-39`) → subcontexto **dynamic-forms**.
5. **`sign-documents`** → `GET .../promissory-note/{id}` (preview de todos los PDFs, **timeout de cliente 120 s**) y al confirmar `POST .../validate/send-otp`.
6. **`otp-validation`** → `POST .../validate/verify-otp` (**timeout 180 s**); si `metadata.lender_path === 'IMEI'` va a `security-validation`, si no encadena `POST .../validate/authorize` → `loan-approved` (`otp-validation.tsx:171-204`). Los timeouts están en `promissory-note.repository.ts:135,226`.

### Motor de plan de pagos
`PaymentScheduleServiceFactory::createForRequest` prueba en orden **Revolving (rt=3) → ExternallyManaged (rt=4) → Regular**; el orden importa porque `RegularPaymentScheduleService::supports` matchea *cualquier* `response_type != 3` (comentado en el propio factory, `:22-28`).

`PaymentCalculationService::performCalculation` (`:71-132`) es la fórmula única:
- `administrativeCosts = original_amount * %admin + fijo` — sobre el monto **completo**, antes de restar el enganche.
- `guarantee = (amount + admin) * %FGA * 1.19` — **IVA 19 % hardcodeado** (`:85`).
- cuota base = **anualidad** `total * i / (1 - (1+i)^-n)`, y división simple si la tasa es 0 (`:92-94`). Tasa periódica: `rate/200` si quincenal, `rate/100` si mensual (`:90`).
- Extras mensuales: seguro de vida + garantía por millón; interés causado día a día contra `next_payment_date - 5 días` (`:298`).
- `calculateInitialAmount`: `amount = original_amount - initial_fee` (`:190-196`) → **el enganche se descuenta del capital financiado**.
- `calculateRate`: fuera de Colombia (`lender.country_id != 60`) toma `min(creditLines.rate, userRequest.rate)`; en CO usa `userRequest.rate` tal cual (`:199-204`).
- El % de FGA sale de la **categoría de perfilamiento** (`userCategory->FGA`) o del cupo rotativo, con fallback al lender (`:206-231`).
- Plazos ofrecidos: `lender.creditLines.fee_numbers` recortado por `userCategory->max_fee_number`, por `creditop_x_conditions_by_amount_by_lender` (banda más restrictiva; `mandatory_fee_number` fuerza un único plazo) y por `product.max_term` (`RegularPaymentScheduleService.php:135-181`).

`PromissoryNoteService::calculateAmounts:106` fija `final_amount = total_amount_no_fee_no_guarantee`, es decir **capital + admin, SIN el fondo de garantía** — distinto de `user_requests.amount`, que sí lo incluye porque es la base de las cuotas.

### Estados: el cierre tiene DOS saltos, no uno
- `verify-otp` → `LoanAuthorizationService::transitionToIntermediate:424` mueve a **"Autorizado pendiente desembolso"**. El id se resuelve **por nombre** (`UserRequestStatus::where('name', …)`) porque la migración lo inserta sin id fijo (`2026_02_20_110000_add_authorized_pending_disbursement_status.php:10-16`). Aplica a **todos** los flujos, no solo IMEI.
- `authorize` → `authorizeRequest:384` escribe `user_request_status_id = 11` (`resolveAuthorizationStatusId:471` es literalmente `return 11;`), `final_amount` y `request_number` (`{id}` + 6 caracteres aleatorios, `:379-382`), más una fila en `user_request_records`.

### Qué corre dentro de `authorize()` (`LoanAuthorizationService.php:84-165`)
En **una** transacción: OTP validado (`resolveValidatedOtp`, 422 si no) → estado 11 → `documentSigningService->generateAllDocuments` → `calculateAmounts` + `createFirstRegister` (siembra el ledger `creditop_x_requests_history`) → si `response_type == 2`, **cascada de cancelación**: `cancelOtherClientLoansIfOneDisbursed` (`UserRequestRepository.php:258-279`) cancela TODAS las otras solicitudes del mismo `user_id`+`allied_id` con lender rt=2 que no estén en 11.

Fuera de la transacción (best-effort, cada uno en su try/catch): `formalizeExternalManagedIfApplicable` (rt=4) y `handlePostCommitSideEffects:476` → notificaciones (mail pagaré/FGA + SMS), `voucherService->generateVoucher`, `updateDisbursedLender` sobre `profiling_reviews`, y `completeRequest` (borra el QR temporal de S3). **En flujo IMEI el voucher y el cierre se difieren al desembolso** (`:487-508`).

En el ledger, `createFirstRegister` marca el primer registro con `status = 8` en vez de 1 cuando `lender.externally_serviced` es true, para excluirlo de la gestión diaria de cartera (`CreditopXRequestHistoryService.php:365-369`).

### Documentos y firma
`DocumentSigningService::generateAllDocuments:48` bifurca en dos caminos:
- **SmartPay/IMEI** (`:59-68`): solo `device_lock_agreement` + `payment_schedule`.
- **Default** (`:70-108`): si el lender tiene proveedor Netco → lote Netco + pagaré Deceval aparte; si no → `consent` → (`lease_agreement` si aplica) → `promissory_note` → `payment_schedule` → `guarantee`.

Dos factories **independientes**, ambas por columna de `lenders`:
- `promissory_type_id` → `PromissoryNoteSigningFactory::create`: `'deceval'` | `'ownership'|'traditional'`; cualquier otro valor lanza `UnknownPromissoryTypeException` (**fail-closed**).
- `signing_provider_id` → `DocumentSigningProviderFactory::for`: `'netco'` o `null`.

**Convención de firma electrónica**: un documento está firmado sí y solo sí su fila tiene **`otp_id` no nulo** (`promissory_notes`, `creditop_x_consents`, `guarantee_acceptances` — ver `2024_05_06_142230_create_promissory_notes_table.php:18`). El trazo que va impreso al PDF es `hash('sha256', $otp->otp)` sobre la columna **ya cifrada** (`ConsentService.php:164`).

**Netco** (hoy solo Credifamilia): tabla `netco_signing_documents` con UNIQUE `(user_request_id, document_type)` y máquina `generated → pending_sign → signed | failed` (`NetcoSigningDocument.php:13-16`). 7 tipos soportados (`NetcoSignerProvider.php:31-39`); username derivado `credifamilia_{documento}` y certificado con DN institucional de Credifamilia (`config/netco_signer.php:21-38`). El set de documentos son 6 slugs en español generados por pdf-mapper-service (`CredifamiliaDocumentsBuilder.php:33-40`: vinculacion, fondo-garantias-confe, plan-de-pagos, reglamento, terminos-y-condiciones, autorizacion-desembolso). El pagaré NO va por Netco: Credifamilia usa **Deceval** (SOAP, `DecevalSoap.php`, `DecevalPromissoryNoteService.php`).

Ambas firmas toman lock de 30 s: `netco-sign:{id}` y `deceval-sign:{id}` (`DocumentSigningService.php:120,377`); si el cache store no soporta locks el lock degrada a `null` y **se continúa igual** (`tryLock:460-473`).

Selección de plantilla (blade) por lender, con fallback: pagaré `creditopxpdf.lenders.lender_{id}` → `…default` (`PromissoryNoteService.php:456-466`); consentimiento `creditopxpdf.lenders.consents.consent_{id}` → `creditopxpdf.consent`, y `consentsecondutilization` si el rotativo ya tenía consentimiento firmado (`ConsentService.php:317-347`). El **arrendamiento** existe solo si existe la vista `creditopxpdf.lenders.arrendamientos.arrendamiento_{lenderId}` (`LeaseAgreementService.php:22,43`) — hoy hay **exactamente una**, `arrendamiento_164.blade.php`; se persiste como `creditop_x_consent_types` id 4 `lease_agreement`.

El motor de PDFs se enruta por `config/documents.php` (`blade` | `microservice`, con override por lender y env `DOC_GEN_*`): hoy solo `vinculacion` es microservice por defecto y `voucher-disbursement` está flipeado para el lender 24 (`:50-78`). `DocumentGeneratorFactory` envuelve el microservicio en `FallbackDocumentGenerator` (cae a blade), salvo `vinculacion`, que por diseño devuelve 503.

### rt=4 — formalización externa (Credifamilia)
`LoanAuthorizationService::formalizeExternalManagedIfApplicable:194` corre **después** del commit, en su propia transacción, solo si `response_type == 4`. Delega en `CredifamiliaFormalizationService::formalize`: reúne 9 documentos en **orden fijo** (`CredifamiliaLegalizationDocumentService::collect:91-128`, todos `required=true`: vinculación, tratamiento de datos, autorización de desembolso, reglamento, FGA, pagaré, cédula frontal, cédula reverso, plan de pagos al final) → si falta uno **aborta sin radicar** → merge a un PDF único base64 → `finalize()` = SOAP `transaccionConsumo` + `submitDocument`. Un estado terminal distinto de COMPLETED **no lanza**: solo se loguea como `credifamilia.formalize.error` (`:119-141`).

### rt=1 / rt=0 — el cierre "de afuera"
Para agregadores el cierre lo decide la API del lender y CreditOp **espeja**: `app/Actions/Lenders/BancoDeBogota.php:233-278` mapea `Disbursed→11` (+ voucher + `updateDisbursedLender`), `Failed→7`, `Pending→10`, `Aborted→8`; Sistecrédito hace lo propio (`Modules/Risk/.../SistecreditoController.php:78-105`), y Compensar/Sistecrédito con OTP del lender cierran en `Modules/Onboarding/App/Http/Controllers/ValidateOtpController.php:69-82`. La radicación misma se dispara en la selección: `lender.action` → `register($request)`, con casos especiales por id (24 Credifamilia usa `show()`; 23/141/142/166 Welli exigen el DTO `WelliRegistrationData`) — `Modules/Onboarding/App/Services/UserRequestService.php:501-571`. Detalle de la familia → nodos **aggregator** y **redirect**.

Único punto de aviso al comercio: `UserRequestObserver::updated` dispara `notifyStoreForUserRequest` cuando `user_request_status_id` cambia a **6, 7, 8 u 11**, con `ShouldHandleEventsAfterCommit` para no postear dentro de la transacción e idempotencia por `processed=1` (`:25,50-58`). `ValidateOtpPromissoryNoteController::notifyEcommerceStore:381` es una **segunda llamada explícita** en el path CreditopX (red de seguridad; el observer ya lo cubría).

### IMEI / SmartPay: el desembolso diferido
`verify-otp` deja la solicitud en el estado intermedio, y el 11 llega recién por `POST /api/loans/requests/device/{id}/disburse`: `DeviceController::disburse:82` exige un `user_request_products.imei` no nulo y **bifurca** — `disburseImeiRequest` si `isSmartPay`, `authorize()` si no (`:102-106`). `disburseImeiRequest:252` regenera el PDF firmado con el IMEI real, genera plan de pagos, siembra el ledger, escribe 11 y hace la cascada de cancelación. Dos endpoints de polling sin auth sostienen la coreografía asesor↔cliente: `device/advisor-status/{id}` y `device/client-status/{id}` (`AdvisorStatusController.php:26,71`). Detalle del bloqueo por hardware → nodo **smartpay**.

### Gemelo `application` (parallel-run)
Las mismas etapas en Inertia (`application/routes/customer.php:78-96`): `/aceptacion` · `/validar-pagare/{ur}` · `/elegir-ciclo` · `/confirmar-ciclo` · `/confirmar-cuotas` · `/pagare/{ur}/{otp}` · `/consentimiento/{ur}` · `/aval/{ur}` · `/validar-otp-pagare` · `/enviar-otp-pagare`. Diferencia estructural: **application hace TODO en un solo método** — `ValidateOtpPromissoryNoteController::validateOtp` valida el OTP, escribe el 11, genera consentimiento + pagaré + plan + FGA, manda mail/SMS y voucher, sin paso intermedio (`application/.../ValidateOtpPromissoryNoteController.php:57-228`). Al terminar redirige a `/validando-solicitud/{ur}` (`StandByController`).

## Subcontextos
- **dynamic-forms** — los formularios backend-driven (`additional-info`, `form-type`); el backend define qué campos pide el wizard y se persisten como EAV en `user_field_values`.

## Dónde mirar
- **Autorización / Estado 11** (legacy-backend): `Modules/Loans/App/Services/LoanAuthorizationService.php:84` `authorize`, `:384` `authorizeRequest`, `:424` `transitionToIntermediate`, `:471` `resolveAuthorizationStatusId` (`return 11`), `:252` `disburseImeiRequest`, `:194` formalización rt=4.
- **Endpoints de firma** (legacy-backend): `Modules/Loans/App/Http/Controllers/Customer/ValidateOtpPromissoryNoteController.php:149` sendOtp · `:270` verifyOtp · `:313` disburse · `:381` notifyEcommerceStore.
- **Documentos** (legacy-backend): `Modules/Loans/App/Services/DocumentSigningService.php:48` `generateAllDocuments`, `:59` camino IMEI, `:113` lote Netco, `:371` pagaré Deceval.
- **Amortización** (legacy-backend): `Modules/Loans/App/Services/PaymentSchedule/PaymentCalculationService.php:71-132` (`:85` IVA 19 %, `:93` anualidad, `:190` enganche).
- **Fechas de pago** (legacy-backend): `Modules/Loans/App/Services/PaymentDateService.php:56-79`; el salto a estado 10 en `Modules/Loans/App/Services/PaymentScheduleService.php:25-35`.
- **Ruteo del wizard** (frontend-monorepo): `apps/loan-request-wizard/app/routes.ts:31-63`; encadenado verify→authorize en `app/routes/otp-validation.tsx:171-204`; timeouts en `modules/loan-request-wizard/loan-origination/src/lib/infrastructure/promissory-note.repository.ts:135,226`.
- **Handoff desde la selección** (legacy-backend): `Modules/Onboarding/App/Services/UserRequestService.php:288` (estado 3), `:453-462` y `:601-611` (`standBy` + URL `/self-service/.../confirmation`), `:501-571` (radicación rt=1).
- **Aviso al comercio** (legacy-backend): `app/Observers/UserRequestObserver.php:25,50-58`.
- **Formalización Credifamilia** (legacy-backend): `app/Services/Pdf/CredifamiliaFormalizationService.php:51-152` y el orden de los 9 documentos en `app/Services/Pdf/CredifamiliaLegalizationDocumentService.php:91-128`.
- **Gemelo monolítico** (application): `app/Http/Controllers/Customer/ValidateOtpPromissoryNoteController.php:118-228`; rutas en `routes/customer.php:78-96`.

## Gotchas / riesgos
- **El enganche NO es un paso del journey nuevo.** `InitialFeePaymentController` + `InitialFeePaymentService` (checkout Wompi, `staging` auto-aprueba, `:116-122`) están portados a legacy-backend y ruteados (`routes/api.php:60-67`), pero **ningún archivo del wizard React referencia `initial-fee-payment`** (grep = 0). El checkout hospedado vive solo en `application` (`/pago-cuota-inicial`). En el wizard, `initial_fee` es un campo del marketplace que se **resta del capital financiado**. El % sí lo fija la categoría de perfilamiento (`InitialFeePaymentService.php:77-78`, `category->min_initial_fee`).
- **`standBy` es campo muerto en el front nuevo**: el backend lo sigue emitiendo para rt=2/3/4, pero `grep -r standBy` sobre todo `frontend-monorepo` da **0 resultados**. El wizard entra a `/confirmation` por su propio ruteo.
- **`soft-update.tsx` es una ruta huérfana**: existe el archivo (`apps/loan-request-wizard/app/routes/lenders-marketplace/lenders/soft-update.tsx`) pero **no está registrada en `routes.ts`** → código muerto.
- **Bug real: argumento descartado en el envío de OTP.** `ValidateOtpPromissoryNoteController.php:178-183` llama `sendOtpPromissoryNote($user, $action, $phoneCode, $isImei ? 'service' : null)` con **4 argumentos** contra una firma de **3** (`OtpService.php:43`). PHP descarta el extra en silencio → la selección de canal para IMEI nunca llega al servicio.
- **`eval()` sobre datos de BD**: `GuaranteeService::shouldRequestGuarantee:214-217` construye `"$score $y $w"` desde `lender_guarantee_criteria` (variable/condition/value) y lo ejecuta con `eval`. Un valor mal cargado en la tabla es ejecución de código.
- **Idempotencia de la radicación rt=4 está comentada**: el docblock de `formalizeExternalManagedIfApplicable` promete "Idempotente: si ya existe una LenderTransaction se reutiliza", pero el bloque que la implementaba está comentado (`LoanAuthorizationService.php:205-216`) → un `authorize()` reintentado puede radicar dos veces. El mismo docblock dice `response_type 5` mientras la constante es **4** (`:43`).
- **Hardcodes de lender**: `PromissoryNoteController::show:96` (`lender_id === 24` → camino Credifamilia), `CredifamiliaDocumentsBuilder::build` (`lenderId: 24` literal), `UserRequest::isSmartPay:191` (`lender->id === 160`). Consecuencia práctica: en dev/staging SmartPay es el lender **153**, así que `isSmartPay()` da false y el flujo IMEI cae en la rama `authorize()` en vez de `disburseImeiRequest()` (`DeviceController.php:102-106`).
- **Controllers importados pero sin ruta**: `ConsentController`, `GuaranteeController` y `CustomerDocumentController` se importan en `Modules/Loans/routes/api.php:7-10` y **no tienen ninguna ruta** → los PDFs de consentimiento y FGA solo se producen como efecto colateral del preview y del `authorize`. El acuerdo de bloqueo de dispositivo también está comentado en el listado de documentos (`UserRequestDocumentService.php:53-57`).
- **Estados que se pisan**: originación (3 → 10 → intermedio → 11/6/7/8) ≠ préstamo vivo (1 al día / 2 mora / 3 paz y salvo / 4 cancelado) ≠ `creditop_x_user_requests_process_statuses` (ids 8 y 9 usados como números mágicos, sin seeder en el repo). El 11 es el puente; la cartera post-11 es otro grafo.
- **Todo el cierre es desktop-hostil por diseño**: `RedirectIdValidationIfDesktop` responde 403 antes que el controller. Cualquier prueba automatizada del cierre tiene que fingir user-agent móvil o entrar por `/self-service`.
- **Side effects best-effort**: notificaciones, voucher, `updateDisbursedLender` y la limpieza post-desembolso corren cada uno en su `try/catch` y solo loguean. Una solicitud puede quedar en 11 sin voucher ni correo, sin señal de error al usuario. `RequestCompletionService::processEcommerceRequest` es directamente un stub con la integración WooCommerce comentada (`:63-80`).
- **Timeouts asimétricos**: el front espera 120 s por el preview de documentos y 180 s por `verify-otp` — porque ahí adentro corren generación de PDFs, Netco y Deceval. Es el tramo más frágil de toda la originación.

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (nodos `LifecycleNode` + `CreditStatusNode`, `store.js` `POSTSEL_STEPS`/`creditStatus`, `fieldDocs.js` `node.lifecycle`/`psel.*`).
- **2026-07-18** — Fase de data: nodo documentado por ANALISIS DE CODIGO (no habia doc fuente) + superficie curada.

## Enlaces
- Padre: **CreditOp** (raíz). Fase previa: **onboarding**.
- Familias que cierran distinto: **creditopx** (rt=2/3, el único cierre in-platform), **aggregator** (rt=1, la API externa decide y espeja), **redirect** (rt=0, sin cierre observable), **smartpay** (IMEI, desembolso diferido).
- Insumos: **profiling** (la categoría fija enganche, plazo, FGA y seguro que consume la amortización), **kyc** (la validación de identidad que precede al plan de pagos), **ms-preapprovals** (pre-aprobación previa a la selección).
- Repos: **legacy-backend** (`Modules/Loans` = casi todo este nodo), **frontend-monorepo** (wizard + módulo `loan-origination`), **application** (gemelo Inertia del cierre).
- Subcontexto: **dynamic-forms**.
- Memorias: `[[migracion-application-a-legacy-estado]]`, `[[continuacion-credito-servicing]]` (el grafo post-11), `[[credifamilia-flujo-mapa]]` (rt=4 / Netco / Deceval), `[[modelos-canales-flujos]]` (SmartPay y agregadores), `[[frontend-e2e-split-view]]` (la topología A/B que nace del 403 desktop).
