# CreditopX · flujo
> **estado:** al día con main · El **tronco** de originación in-platform (rt=2/3): CreditOp lista, decide con datos locales, firma con OTP y **desembolsa hasta el Estado 11** — sin salir a ningún portal externo. SmartPay y Motai son variantes de este flujo.

<!-- CreditopX es el flujo BASE. Acá vive el tronco común (entrada→OTP→datos→marketplace) y el recorrido rt=2 punta a punta (confirm/standBy → ADO → polling+Echo → plan/firma OTP → Estado 11). SmartPay/Motai NO repiten esto: lo enlazan y solo cuentan su delta. -->

## Qué es
CreditopX **no es un lender: es una FAMILIA** de lenders in-platform (`response_type == 2`, y `== 3` para cupo rotativo) — **CrediPullman (77)**, **Creditop X (37)**, Celupresto (96), SmartPay (152/160), Motai (158)… Todos comparten el mismo motor: **CreditOp decide con reglas y datos locales** (por eso es el único flujo 100% inyectable en pruebas), **firma in-platform** (consentimiento + pagaré Deceval-o-PDF + OTP) y **llega solo al Estado 11** sin handoff a un portal de tercero. El comercio pone el capital y el riesgo; CreditOp opera y cobra comisión (ver ficha del lender).

Lo distintivo frente a los agregadores (rt=0/1/4) es el **cierre in-platform de 2 pasos** (`verify-otp` → estado intermedio "Autorizado pendiente desembolso"; luego `authorize` → **Estado 11**) precedido por una **biométrica ADO en portal externo** cuyo resultado vuelve por callback + polling + Echo. Es el **único bloque de originación ya migrado a `legacy-backend`** (el callback de ADO vive en legacy); los agregadores todavía reciben sus webhooks en `application`.

| Pregunta | Respuesta |
|---|---|
| ¿Quién decide? | **CreditOp** (in-platform, motor rt=2 con datos locales: reglas de grupo → datacrédito nuevo → categoría/cupo) |
| ¿Quién pone la plata / cobra? | **El comercio** pone capital y riesgo; **CreditOp** opera (origina, firma, desembolsa) y cobra la cartera por comisión |
| ¿Cómo cierra? | In-platform: consent + pagaré + OTP → `verify-otp` (estado intermedio) → `authorize` → **Estado 11** |
| ¿Simulable E2E? | **Sí** — es el flujo más inyectable: rt=2 decide 100% en legacy con datos locales; ADO/Tusdatos se mockean; el harness fuerza OTP y llega a 11 |

## Cómo funciona
Tronco común (compartido con TODOS los flujos) y luego la rama rt=2.

**Tronco común (entrada → marketplace):**
1. **Entrada.** Ecommerce/self-service (público, sin login, prefijo `:flow`) o **asesor/merchant** (login Cognito, header `x-cognito-identity-id`). El wizard resuelve el prefijo con `createRouteHelpers`/`ROUTE_PATHS` (`route-helpers.ts`); la auth de backend la arma `backend-auth-headers.server.ts`.
2. **Monto + teléfono** (`phone-number.tsx` → `POST /api/onboarding/phone/register`) → **OTP** (`otp-verification.tsx` → `.../otp-validate/{hash}`, ramifica por `error_code` ONB002/ONB004).
3. **Datos personales/laborales** (`loan-request-form.tsx`, `employment-info.tsx`) → escriben los `field_id` 29/87/160/161.
4. **Marketplace** (`available-lenders.tsx` → `GET .../lenders-v2/{id}` = `LenderListingController` → `LenderListingService::getLenders`). Acá se **sella rt=2**: si `LenderUserCategoryService` no devuelve categoría con `available_amount>0`, la card CreditopX ni aparece (`LenderListingService.php:458-476`). El monto solicitado se vuelve el **cupo**.
5. **Selección** (`update-user-request/{id}` = `ListLenderController` → `UserRequestService::updateUserRequest`): persiste `user_request_status_id=3` + lender, y construye la respuesta (`url`/`qrUrl`/`showModal`/`openNewTab`/`standBy`…). `getLenderSelectionNextStep` en el front despacha `continue`/`continue-with-qr`/`external-*`.

**Rama CreditopX rt=2 (punta a punta):**
0. **Confirmación / standBy** — `loan-confirmation.tsx` → `POST /api/loans/customer/requests/confirm` (`ContinueUserFlowController::confirm`). Lanza **Tusdatos (AML) en background** salvo SmartPay (`:90-99`), y arma el paso con `CreditopXFlowService::getNextStepData` → `IdentityValidationStepResolver::resolve`. Ramifica por `step_details.type`: `ado_validation` (nuestra rama) / `aws_validation` / `no_validation_required`. El **standBy** y el WhatsApp de autogestión (`user_self_management`) se fijan al generar la solicitud en `UserRequestService`.
1. **Biométrica ADO (portal EXTERNO)** — `identity-validation-instructions.tsx` → `GET /api/identity/ado/enroll` (`AdoController::enroll`): genera `reference=uuid`, arma el **callback** `/self-service/{hash}/{ur}/identity-validation-status?...`, persiste `RiskCentralUserData` y devuelve `redirect_url` a `services.ado.host/validar-persona`. El botón hace `window.location.href` al portal ADO (no iframe). Credenciales ADO **por-lender** en path IMEI.
2. **Callback ADO** — ADO vuelve a `identity-validation-status.tsx`, que postea a `POST /api/identity/ado/enroll/callback/{id}` (`AdoController::enrollCallback`) → despacha el job `Ado\StatusCheck` (poller auto-re-despachado cada 2s; al completar, `AdoService::updateStatus` dispara el evento Echo `Ado\StatusChanged`).
3. **Espera (polling + Echo)** — `identity-validation-status.tsx` combina `ValidationPollingProvider` (poll a `POST /api/identity/validation-status`, 30s→60s, máquina de 7 fases) + socket `useValidationStatusSocket` (canal `App.Models.UserRequest.{user_id}`, evento `.ValidationStatusChanged`). Ruteo: `tusdatos_aml.has_findings`→`request-canceled`; `!ado.validated`→`retry-validation`; OK→**`first-payment-date`**.
4. **Fecha de primer pago** (`first-payment-date.tsx` → `confirm-payment-date`) → **plan de cuotas** (`payment-schedule.tsx` → `confirm-payment-schedule`) → **firma** (`sign-documents.tsx`): preview de hasta 4 PDFs (consentimiento, pagaré, fondo de garantías, contrato) → `send-otp`.
5. **Firma OTP + Estado 11** — `otp-validation.tsx` → `verify-otp` (`ValidateOtpPromissoryNoteController::verifyOtp`): valida OTP y **`transitionToIntermediate`** (→ "Autorizado pendiente desembolso"), devuelve `next_step='authorize'`. Luego `validate/authorize` → `disburse` → `LoanAuthorizationService::authorize` (`:84`): genera docs reales (Deceval/Netco o PDF), `createFirstRegister` del ledger y **`user_request_status_id=11`** (`:280/289/313`). Front → **`loan-approved.tsx`**.
6. **Espera del ASESOR** (cuando lo conduce un asesor) — `loan-continue.tsx` pollea `GET .../device/advisor-status/{id}` (`AdvisorStatusController::checkSigningStatus`): `is_documents_signed` = status == estado intermedio; `is_disbursed` = status == 11. El QR/link es el handoff al celular del cliente.

## Estados y códigos
- **Estado 11** = desembolsado/autorizado in-platform, el sello del flujo (catálogo `user_request_statuses` vive en la raíz). rt=2 y rt=3 llegan **directo** en el `authorize`.
- **Estado 3** = "Selección de entidad" (fija `UserRequestService` al elegir lender).
- **Estado intermedio "Autorizado pendiente desembolso"** = tras `verify-otp`/`transitionToIntermediate`, antes del `authorize`. Es lo que el asesor detecta como `is_documents_signed`.
- **Estado 10** = confirmación de fecha de pago (paso intermedio antes del plan/firma).
- ADO "validado" = `state_id == 2` (`ValidationStatusService.php:204`); AML cancela por `tusdatos_aml.has_findings`.
- **Namespace Echo:** canal público `App.Models.UserRequest.{user_id}` (OJO: `user_id`, NO `user_request_id`), eventos `RiskCentrals\Ado\StatusChanged`, `RiskCentrals\Tusdatos\BackgroundJobResolved` y `.ValidationStatusChanged` (consumido por `useValidationStatusSocket`).

## Sistemas externos
- **ADO** (`ado-tech.com`, `config('services.ado.host')/validar-persona`): biométrica facial; portal externo hospedado; callback de vuelta al wizard. Credenciales por-lender en path IMEI, si no `config('services.ado.*')`.
- **Tusdatos** (AML/antecedentes): lanzado en background por `confirm`; resuelve async vía job `CheckBackgroundJobStatus` (re-despacho 5s) → evento Echo. Se salta para SmartPay.
- **Pusher/soketi** (realtime): bus del canal `App.Models.UserRequest.{user_id}`; `EchoService.initialize` apunta a `wsHost/wsPort` (soketi autoalojado, no cluster pusher.com).
- **Deceval / Netco** (firma): si `promissoryType=deceval` firma por SOAP Deceval; `traditional`/`ownership` genera PDF local.
- **Wompi** (solo rama con cuota inicial, fuera del núcleo rt=2): checkout hospedado para el down-payment. Nota: las rutas front `initial-fee-payment.tsx`/`down-payment-validation.tsx` NO están en el índice actual (ver Gotchas).

## Dónde mirar
- **Tronco común / entrada** (frontend-monorepo): `apps/loan-request-wizard/app/routes.ts`, `app/layouts/{public,default}-layout.tsx`, `app/utils/{route-helpers.ts,backend-auth-headers.server.ts}`, `app/routes/loan-application-form/{phone-number,otp-verification,loan-request-form,employment-info}.tsx`, repos `modules/.../loan-application-form/src/lib/infrastructure/*.repository.ts`.
- **Marketplace / selección** (frontend-monorepo): `app/routes/lenders-marketplace/available-lenders.tsx`, `modules/.../lenders-marketplace/src/lib/{application/select-lender.uc.ts,infrastructure/repositories/loan-options.repository.ts,domain/entities/loan-option.entity.ts,domain/constants/lender.constants.ts}`, hook `components/available-lenders/hooks/useLenderSelection.ts`, `components/{MobileContinuationPrompt.tsx,modals/LenderResponseModal.tsx}`.
- **Listado / decisión rt=2** (legacy): `Modules/Onboarding/App/Http/Controllers/LenderListingController.php`, `Modules/Onboarding/App/Services/lenders/{LenderListingService.php,LenderUserCategoryService.php,LenderSpecialGrantingService.php}`, `Modules/Loans/App/Services/{LenderUserCategoryService,LenderSpecialGrantingService,DatacreditoRuleEvaluator}.php`, KYC `Modules/Onboarding/App/Services/OnboardingService.php`.
- **Selección backend** (legacy): `Modules/Onboarding/App/Http/Controllers/ListLenderController.php` + `Modules/Onboarding/App/Services/UserRequestService.php` (`updateUserRequest`, standBy, overrides `openNewTab`/self-management), `Modules/Onboarding/routes/api.php`.
- **Confirm + paso de validación** (legacy): `Modules/Loans/App/Http/Controllers/Customer/ContinueUserFlowController.php` (`confirm`, skip-AML), `Modules/Loans/App/Services/CreditopXFlowService.php`, `Modules/Identity/App/Services/IdentityValidationStepResolver.php`, `Modules/Loans/App/Http/Middleware/AddOriginationFlowType.php`.
- **Biométrica ADO** (legacy): `Modules/Identity/App/Http/Controllers/Customer/AdoController.php` (`enroll`/`enrollCallback`), `Modules/Identity/App/Services/AdoService.php`, `Modules/Identity/routes/api.php`, job `app/Jobs/RiskCentrals/Ado/StatusCheck.php`, evento `app/Events/RiskCentrals/Ado/StatusChanged.php`.
- **AML Tusdatos** (legacy): `app/Actions/RiskCentrals/Tusdatos.php`, job `app/Jobs/RiskCentrals/Tusdatos/CheckBackgroundJobStatus.php`, evento `app/Events/RiskCentrals/Tusdatos/BackgroundJobResolved.php`.
- **Espera / polling / Echo** (frontend-monorepo): `app/routes/identity-validation-status.tsx`, `app/routes/api/validation-status.tsx`, `app/entry.client.tsx`, `modules/.../identity-validation/src/lib/polling/{validation-polling-context.tsx,validation-polling.types.ts,validation-polling.constants.ts,useValidationStatusSocket.ts,useValidationPollingController.ts}`, `.../loan-origination/src/lib/infrastructure/echo.service.ts`, `.../loan-origination/src/components/ValidationPending.tsx` (histórico, sin montar), UCs `enroll-ado-validation`/`submit-ado-response`/`check-aml-status`, `identity-validation.repository.ts`.
- **Validation status backend** (legacy): `Modules/Identity/App/Http/Controllers/Customer/ValidationStatusController.php`, `Modules/Identity/App/Services/ValidationStatusService.php`.
- **Plan + firma + Estado 11** (frontend-monorepo): `app/routes/{first-payment-date,payment-schedule,sign-documents,otp-validation,loan-approved,loan-confirmation}.tsx`, repos `modules/.../loan-origination/src/lib/infrastructure/{first-payment-date,payment-schedule,promissory-note}.repository.ts`, `.../loan-origination/src/components/SignDocuments.tsx`, `.../lenders-marketplace/src/lib/application/get-loan-request-details.uc.ts`.
- **Plan + firma + Estado 11** (legacy): `Modules/Loans/App/Http/Controllers/Customer/{PaymentScheduleController,PromissoryNoteController,ValidateOtpPromissoryNoteController,AdvisorStatusController}.php`, `Modules/Loans/App/Services/{LoanAuthorizationService,DocumentSigningService,PromissoryNoteService,NotificationService}.php`, `Modules/Loans/App/Services/PromissoryNote/{Deceval,Traditional}PromissoryNoteService.php`, `Modules/Loans/routes/api.php`.
- **Handoff QR / asesor** (frontend-monorepo): `app/routes/loan-continue.tsx`; (legacy) `AdvisorStatusController.php`, `Modules/Partner/App/Services/UrlGenerationService.php`.
- **Discriminadores / config** (legacy): `app/Models/{UserRequest,Lender}.php`, `config/services.php`, `database/seeders/ResponseTypesTableSeeder.php` (`0=UTM,1=Integración,2=Creditop X`), `routes/channels.php` (el canal `UserRequest.*` NO está registrado — funciona por ser público).
- **Dependencia application** (application): `app/Services/Api/BaseApiClient.php` (el acople correcto es application→legacy vía `INTERNAL_LEGACY_API_URL`), `app/Console/Commands/UpdateCreditopXRequestsCommand.php` + `app/Console/Kernel.php` (servicing/mora post-11 corre en application).

## Frontera de simulación / harness
**Es el flujo más inyectable de todo el ecosistema** — la decisión rt=2 corre 100% en legacy con datos locales (categoría + reglas + datacrédito), sin API externa de decisión. Frontera:
- **Inyectable (legacy):** la decisión (categoría/cupo vía `LenderUserCategoryService` + `DatacreditoRuleEvaluator`), el sello rt=2, el cierre a Estado 11.
- **A mockear (externo):** ADO (biométrica), Tusdatos (AML), Deceval/Netco (firma), Pusher/soketi (realtime). El wizard nunca los llama directo: legacy fabrica la URL hospedada y el front redirige/escucha.
- **Backend-e2e (Go):** despacha por `response_type`; el atajo de cierre es `ForceOtpValidation` + `authorize` (equivalente a `verify-otp`→`authorize`, llega a 11 sin OTP real). Semilla de un lender rt=2 con categoría + `credit_line` o el pagaré revienta (`UnknownPromissoryTypeException`) y el marketplace lo excluye.
- **Frontend-e2e (Playwright):** el modo asesor (CreditopX rt=2) abre ventana A (QR/handoff) + ventana B (cliente en `/self-service/{hash}/{ur}/...`); ver memorias `frontend-e2e-*`. Gotcha SSR: el checkout lee `process.env.VITE_API_URL`.
- **Servicing post-11 NO está en legacy:** la causación de mora (`UpdateCreditopXRequestsCommand`) y los crons de cartera corren en **application**; corriendo legacy solo, nada avanza tras el 11.

## Datos de prueba / usuario que pasa
Usuario sintético in-platform (sin KYC real): sembrar un lender rt=2 con **categoría** (`lender_users_categories` con `available_amount>0`; si no hay categoría la card no aparece) y `credit_line`. La **regla datacrédito** del motor nuevo es genérica (`allied_branch_id IS NULL`, fail-closed): fila Experian encriptada con score que supere el umbral + sin negativos recientes (ver memoria `datacredito-rules-per-lender`). Monto solicitado ≤ cupo de la categoría. **CrediPullman (77)** tiene además gate por `users.age` (group rules). El AML se puede forzar sin hallazgos (`has_findings=false`). Con eso el flujo llega a Estado 11 vía `authorize`.

## Gotchas / riesgos
- **Canal Echo con `user_id`, no `user_request_id`.** Los eventos transmiten en `App.Models.UserRequest.{user_id}` (nombre engañoso). El componente histórico `ValidationPending.tsx` lo suscribía con `loanRequestId` — posible desajuste, hoy el consumidor vivo es `useValidationStatusSocket` en `identity-validation-status.tsx`. El canal es **público** (no está en `routes/channels.php`; funciona por eso).
- **No hay literal `rt=2` en el front.** El wizard ramifica por `step_details.type` (`ado_validation`/`aws_validation`/`no_validation_required`) y `lender.flow`/`lender_path`; el `response_type` numérico solo se evalúa en legacy (p.ej. `ContinueUserFlowController` lo usa para el `=4` de Credifamilia).
- **`waiting-validation.tsx` y `validation-pending.tsx` están vacíos (0 bytes) y desregistrados** (merge mayo-2026); la espera del cliente se unificó en `identity-validation-status.tsx`. `ValidationPending.tsx` sigue en el repo pero **sin montar** (solo storybook) — incluido acá por trazabilidad del realtime.
- **Rama cuota inicial (Wompi) fuera del índice.** `initial-fee-payment.tsx`, `down-payment-validation.tsx` y `merchant-mode.tsx` que citan las fuentes **no resuelven en el índice actual** (snapshot) → quedan fuera de `files`. La cuota inicial fue causa del rebote `/lenders→/solicitar→/continue` (ver memoria `asesor-solicitar-bounce`).
- **`from_legacy` siempre false.** El flag del `confirm` no lo produce ningún caller → no gatea nada en runtime.
- **Servicing (post-11) NO migrado.** Corre 100% en `application` (legacy tiene copias muertas). Fuera del alcance de la migración de originación pero necesario para probar el ciclo completo.
- **Hardcodes de score/estado.** `response_type == 2/3` comparado como literal en varios servicios; buckets de score quemados en `LenderSpecialGrantingService.php:186-201` (inventario en `LOGICA-QUEMADA.md`).

## Preguntas abiertas
- [ ] ¿El id de "Autorizada" es exactamente **11** en BD? (varios callers lo asumen; no leído de la tabla fuente).
- [ ] El canal Echo público no está autorizado en `routes/channels.php`: ¿en prod ambos backends (application + legacy) publican al mismo canal con el mismo `PUSHER_APP_KEY`/host? (needs-runtime).
- [ ] ¿SmartPay prod (160) tiene `response_type` fijado por algún seeder? El `SmartPayTestSeeder` crea rt=1 pero negocio lo trata como rt=2.

## Diferencias vs otros flujos
- **vs SmartPay (variante):** SmartPay ES un CreditopX rt=2 con `path='IMEI'` — reemplaza el pagaré+garantía+Netco por un único "Acuerdo de bloqueo de dispositivo", inserta el enroll de IMEI antes del desembolso y agrega servicing device-lock (MDM). Salta el AML (`isSmartPay()`). Todo lo demás es este tronco.
- **vs Motai (variante):** comercio allied 158 con 3 modos; el modo renting saltea el buró → Ábaco (ingreso gig), pero el resultado no está cableado a la decisión y el modo NO filtra lenders. Mismo motor rt=2.
- **vs Credifamilia (rt=4):** se radica al pintar el marketplace y hace polling; al seleccionar da `standBy`; **no llega a 11 en el click**. Ambigüedad rt=2 vs rt=4 en su formalización SOAP.
- **vs Agregadores (rt=0/1):** CreditOp solo origina y sale a un portal externo (redirect/popup/link) o integración (Bancolombia BNPL con `ProcessingView`+Echo); la **API externa decide y gestiona la cartera**; el Estado 11 llega async por webhook — que **sigue en `application`** (no migrado). No es inyectable E2E localmente.

## Bitácora
- **2026-07-17** — Nodo creado desde la raíz (tronco común rt=2/3). Superficie curada: **103 archivos** (frontend-monorepo 57 · legacy-backend 43 · application 3), 103/103 resuelven en el índice. Síntesis de `FLUJO-CREDITOPX-Y-DEPS-APPLICATION.md` (barrido multi-agente re-verificado) + ficha `CREDITOPX.md` + `REFERENCIA-FLUJOS.md` §1/§3. Verificado en código: `LoanAuthorizationService::authorize` → Estado 11 (`:84/280`), sello rt=2 por categoría en `LenderListingService.php:458-476`. Se excluyeron `initial-fee-payment`/`down-payment-validation`/`merchant-mode` (no resuelven en el índice) y las especializaciones IMEI/device-lock (viven en el nodo smartpay).

## Enlaces
- Análisis: `docs/codigo/FLUJO-CREDITOPX-Y-DEPS-APPLICATION.md` (verified-deep, con `archivo:línea`; incluye el veredicto de dependencias FE/backend→application).
- Ficha entidad: `docs/lenders/CREDITOPX.md`.
- Tronco + FE↔BE: `docs/codigo/REFERENCIA-FLUJOS.md` §1/§3 · `docs/codigo/MAPA-FLUJOS.md`.
- Servicing post-11: `docs/codigo/CONTINUACION-CREDITO-ANALISIS.md` · reglas de decisión: `docs/codigo/REGLAS-POR-COMERCIO-Y-LENDER.md`, `docs/codigo/ONBOARDING-DATOS-DECISION-ANALISIS.md`.
- Variantes: nodos flujo `smartpay`, `motai` (hermanos que cuelgan de este tronco).
- Memorias: `creditopx-modelo-comercio` (economía comercio/comisión) · `lender-listing-cascade` (cascada de visibilidad) · `datacredito-rules-per-lender` (2 motores) · `synth-lender-type-boundary` (frontera inyección rt=2 vs rt=1) · `continuacion-credito-servicing` (post-11) · `modelos-canales-flujos`.
