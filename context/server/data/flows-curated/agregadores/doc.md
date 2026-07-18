# Agregadores rt=1 · flujo
> **estado:** al día con main · La familia `response_type=1` donde CreditOp SOLO origina: la API externa del lender decide el crédito y el lender gestiona la cartera. Cubre Bancolombia (68/100), Sistecrédito (9), Welli (23/141/142/166), Meddipay (39), Prami (12), Banco de Bogotá (5 credi-convenio / 133 CeroPay), Compensar, Addi + Corbeta batch.

## Qué es
Un **agregador rt=1** es un lender en el que CreditOp **muestra la opción, arma la solicitud y hace el handoff, pero NO decide, NO desembolsa, NO firma y NO lleva cobranza**. La decisión la toma la **API externa del lender** (`validate-quota` / `run_risk` / `CreateOrder` / `evaluate` / `generacionOtp` / KYC) y ese lender externo gestiona el ciclo post-desembolso. CreditOp solo **espeja** el estado por webhook, polling o el retorno del redirect. Esto lo separa tajantemente de CreditopX rt=2/3 (decide in-platform, sella cupo en `getLenders`, gestiona con crons propios) y por eso rt=1 **NO es inyectable** en pruebas sintéticas: a lo sumo se mockea el transporte HTTP.

| Pregunta | Respuesta |
|---|---|
| ¿Quién decide? | La **API externa del lender** (no CreditOp). CreditOp solo mapea la respuesta a los campos de contrato del marketplace. |
| ¿Quién pone la plata / cobra? | El **lender externo** desembolsa y gestiona cartera/mora/cuotas. CreditOp gana por originar; no lleva servicing. |
| ¿Cómo cierra? | Handoff externo (redirect / OTP in-app / celular / secuencia API multi-step) → el lender desembolsa → CreditOp sincroniza el estado por **webhook self-manager**, **polling** (`StatusCheck`) o **webhook entrante propio** (Sistecrédito). |
| ¿Simulable E2E? | **No** de punta a punta. Bancolombia = frontera dura (API propia). El resto = solo mock HTTP del transporte. Corbeta = parcial (fixtures + stub `Corbeta::query`). |

## Cómo funciona
Dos capas independientes sobre el tronco común (entrada → OTP → datos → marketplace `/lenders`):

1. **Pre-aprobación / listado** — ¿aparece "Pre aprobado" y con qué cupo? Se resuelve por **dos vías que coexisten** (strangler/parallel-run):
   - **(1a) Legacy switch por id:** `LenderRetrievalService::getLenders` delega en `PreApprovedLenderService::validatePreApproveLender`, un switch **bifurcado por `$lender->id`** (68 BNPL, 100 Consumo, [23,141,142] Welli, 9 Siste, 39 Meddipay, 12 Prami, 133 BdB…). Cada bloque consulta la API externa vía la clase `App\Actions\Lenders\*` (`new BancolombiaBnpl()->validateQuota(...)`), y **empuja** el lender a `$approvedLenders` (`probability='Pre aprobado'`, `sort=1`, `pre_approved_lender=true`) o lo **saca** con `unset()`. La decisión es 100% del proveedor externo.
   - **(1b) MS Go `pre-approvals-service`** (repo aparte, NO indexado): el front nuevo hace `POST /v1/preapprovals/check`; el MS corre un workflow genérico de 4 etapas (creds → auth → apiCall → adapt) y **notifica el resultado a legacy** vía `POST /loan-application/{id}/lender-result`, recibido por `ListLenderController::storeLenderResult` (ruta backend-to-backend sin Cognito en `Modules/Onboarding/routes/webhooks.php`), que repuebla `profiling_reviews.displayed_lenders`. En el front la pre-aprobación es **progresiva por lender** (`available-lenders.tsx` loader → `fetch-lender-preapproval.ts` → `lender-resolution.service.ts`), con ocultamiento por 3 predicados (5xx propio, fallback, variante Welli).

2. **Selección + handoff + entrega** — al elegir un lender rt=1 el front hace `POST update-user-request/:id` (estado 3 = Selección). La entrega la decide `UserRequestService` (case rt=1 con credencial → instancia `$lender->action` → `register()`/`consult()`/`validate()`); el campo `url` + flags (`openProcessModal`/`validateLenderOtp`/`showModal`/`openNewTab`) fijan el **canal**. La fuente única de `openNewTab` es `LenderTabBehaviorResolver` (`NON_NEW_TAB_LENDER_NAMES = ['Compensar','Sistecrédito','Meddipay']`).

   Canales por lender:
   - **Redirect** al sitio del lender → Sistecrédito online (`/pay/create`), Banco de Bogotá, Addi.
   - **OTP in-app** → Compensar (`generacionOtp`/`validacionOtp`), Sistecrédito POS.
   - **Handoff al celular** (link WhatsApp/SMS) → Meddipay (`url=null`, `openProcessModal=true`).
   - **Secuencia multi-step de API** → Bancolombia (provide/login/retrieveQuota/purchase/terms/**origination** o validate/authenticate/simulation/**disbursement**); NO pasa por `register()` genérico.

3. **Desembolso + sync** — lo ejecuta/aprueba el **LENDER EXTERNO**; CreditOp crea un `LenderTransaction` **espejo** (con `order_id`) y sincroniza el estado por: (a) **webhook self-manager** (`SelfManagerController::webhook` en application), (b) **polling** (`StatusCheck` job → BdB credi-convenio, Welli), o (c) **webhook entrante propio** (`SistecreditoController::webhook`). `UserRequestObserver` notifica al comercio si cae en 6/7/8/11.

4. **Corbeta** (retail físico grande, Alkosto/Alkomprar) — NO es un lender, es un **Ally/canal** sobre Bancolombia rt=1. Añade una capa de **facturación/conciliación batch** por crons: genera orden + PIN de caja (`Corbeta::register` → `setOrder`), el cliente factura en tienda, y crons diarios cruzan por PIN y **confirman al lender** (`bnplConfirmed`/`consumoConfirmed`). Vive en `application`.

## Estados y códigos
El estado global de `user_request` vive en la raíz; acá SOLO lo distintivo rt=1 (los ids se infirieron de callers/comentarios — no hay seeder confirmado, ver Preguntas abiertas):
- **3** = Selección (al elegir el lender, `update-user-request`).
- **Cierre por lender (espejo):** BdB credi-convenio `updateStatus`: Disbursed→**11** (+voucher, `updateDisbursedLender(5)`), Failed→**7**, Pending→**10**, Aborted→**8**. Sistecrédito webhook: Approved→**11** (`updateDisbursedLender(9)`), Pending/Started→**10**, Expired/Rejected→**6**, Cancelled→**8**. Self-manager: completed→'Facturado'/'Autorizada', failed→'Negada', cancelled→'No terminó proceso'.
- **26** = FACTURADO (Corbeta `UpdateOrdersFromCorbeta`).
- Estados de `LenderTransaction` (namespace propio): 'Pending' / 'Disbursed' / 'Aborted' / 'PENDIENTE DESEMBOLSO' / 'Facturado'.

## Sistemas externos
| Sistema | Para qué | Config |
|---|---|---|
| **pre-approvals-service** (MS Go :8082, repo aparte no indexado) | Orquesta pre-aprobación rt≠0 (`POST /v1/preapprovals/check`, workflow 4 etapas), cachea DynamoDB, notifica a legacy (`/lender-result`). | `VITE_PREAPPROVALS_ENDPOINT` (front) · `services.pre_approvals.base_url` (back) |
| **Bancolombia API** (bnpl / consumer-loan) | Decide (`validate-quota` / `customers/validate`), ejecuta secuencia de compra/desembolso, recibe confirmación de factura. OAuth2 client_credentials + **JWT RS256** de canal + X-Client-Certificate (**mTLS**). | `services.bancolombia.*` + privkey/cert por comercio; `config/api_bancolombia_bnpl.php`, `config/api_bancolombia_loan_requests.php` |
| **Sistecrédito API** | POS: `getCreditLimitClient`/`getCreditToken`/`create` (OTP). Online: `/pay/create` (redirect) + `GetTransactionResponse` (webhook). | `services.sistecredito.host` |
| **Welli run_risk API** | `run_risk` (decisión), `get_app/{id}` (estado/polling), `change-clinic`, `update-amount`; entrega vía `next_step_url`. | `services.welli.host` |
| **Meddipay API** | `User/Login`, `CreateOrder` (decide `creditLimit.result=APP`), `ConfirmOrder`; entrega link al celular del cliente. | `services.meddipay.host` + `.host_auth` |
| **Prami API** | `evaluate` (decide `maxApprovedAmount` desde `experianRequest` REAL), `quota-options`, `confirm-credit`. | `services.prami.host` |
| **Banco de Bogotá Enterprise API** (**mTLS**) | `/V1/Enterprise/transaction` (credi-convenio 'credi-convenio' y CeroPay 'cero-pay'), `/transaction/status` (polling), `/V2/Enterprise/KYC`. | `services.banco_de_bogota.host` + cert/key por credencial |
| **Compensar cupo rotativo API** | OAuth2 client_credentials scope `cuporotativo`; `generacionOtp`/`validacionOtp` (respuesta `SLI1000`). | `services.compensar.host` + `.host_oauth` |
| **Corbeta** (Fondos / cajas Alkosto-Alkomprar) | Genera orden+PIN (`setOrder`) y reporta facturas (`getOrder` por `EstadoOrden`) para el cruce batch. **NO es el lender.** | `application` (Ally) |
| **Experian / DataCrédito** | Perfil que Prami exige para el `experianRequest`; encriptado con `app.key`. | `VW_Risk_Central_Experian`, tabla `datacredito`, `FN_*` |

## Dónde mirar
- **Pre-aprobación + listado (legacy)** (legacy-backend): `PreApprovedLenderService.php` (switch por id, `:41` validatePreApproveLender, `:167` BNPL, `:193` Consumo), `LenderRetrievalService.php` (cascada + filtro exclusión `[12,23,141,142,166]` en `:248-252`), `ListLenderController.php` (`storeLenderResult` recibe el MS), `routes/webhooks.php` (rutas b2b sin Cognito), `PreApprovalsAction.php`/`PreApprovalsService.php` (getByLender/registerAttempt).
- **Selección + entrega** (legacy-backend): `Onboarding/.../UserRequestService.php` (decide canal por rt), `Loans/.../UserRequestService.php`, `LenderTabBehaviorResolver.php` (fuente única `openNewTab`).
- **Actions por lender** (legacy-backend `app/Actions/Lenders/`, espejo en application): `Integration.php` (base), `Bancolombia.php`+`BancolombiaBnpl.php`+`BancolombiaConsumerLoan.php`+`BancolombiaConsumerLoanOfferEvaluation.php` (secuencia multi-step, OAuth+JWT+mTLS), `Sistecredito.php`+`SistecreditoPos.php`+`SistecreditoPay.php` (dispatch POS/Pay), `Welli.php` (STATUS_MAP, next_step_url), `Meddipay.php`, `Prami.php` (experianRequest), `BancoDeBogota.php`+`BancoDeBogotaCeroPay.php` (mTLS), `Compensar.php`, `Addi.php` (stub).
- **Sync de estado** (mixto): `application/.../SelfManagerController.php` (webhook self-manager VIVO; `:87` bug guard), `Modules/Risk/.../SistecreditoController.php` (webhook entrante), `app/Jobs/Lenders/{BancoDeBogota,Welli}/StatusCheck.php` (polling), `UserRequestObserver.php` (notifica al comercio).
- **Corbeta batch** (application): `Actions/Allies/Corbeta.php` (setOrder/PIN/query), `Console/Kernel.php` (scheduler `:52-60`), `InvoiceProcessCorbeta.php`+`InvoiceProcessCorbetaBnpl.php`+`UpdateOrdersFromCorbeta.php`+`InvoiceProcessConfirm.php`+`CorbetaConciliationReportCommand.php`, `CodeGenerationService.php` (getFromCorbeta), `UserRequestsCorbetaExport.php`; espejo migración en legacy: `app/Actions/Allieds/Corbeta.php`, `CorbetaUserRequestService.php`, `CorbetaCheckoutController.php`, `IsCorbetaOnboardingService.php`.
- **Marketplace + pre-aprobación progresiva (front)** (frontend-monorepo): `available-lenders.tsx` (loader, `VITE_PREAPPROVALS_ENDPOINT`), `AvailableLenders.tsx` (hide por server-error/fallback/Welli), `fetch-lender-preapproval.ts`, `deferred-lender-resolution.adapter.ts`, `lender-resolution.service.ts`, `fallback-lender.service.ts`, `welli-shared-risk.service.ts`, `lender-approval.service.ts`, `LenderCardProcessing.tsx`, `useLenderTransactionStatus.tsx`, `lenders/{preapproval-retry,transaction-status,validate-preapproved-loan,update-amount}.tsx`.
- **Handoff Bancolombia (front)** (frontend-monorepo): `routes/bancolombia/{start,purchase-code,no-preapproved,user-request-status,cancel-checkout}.tsx`, `bancolombia/bnpl/{origination,response}.tsx`, `bancolombia/loan/{origination,loan-offer-evaluation,response}.tsx`, `bancolombia-origination/.../use-cases/{validate-preapproved,execute-bnpl-origination,get-bnpl-purchase-code}.uc.ts`, `cancel-corbeta-checkout.server.ts`.
- **Modelos / simulador** (ambos): `Lender.php`, `LenderTransaction.php`, `LenderTransactionStatus.php`, `UserRequest.php`, `LenderTransactionRepository.php`; `EcommerceSimulatorController.php` (simulador de resultado agregador, bloqueado en prod).

## Frontera de simulación / harness
**La regla:** en rt=1 la decisión la toma una API externa, no CreditOp → **no inyectable de punta a punta** con usuario sintético. No alcanza con sembrar datos locales; la respuesta viene de un HTTP externo.

Dos sub-fronteras:
- **Bancolombia rt=1 (68/100) = frontera DURA:** decide en su API propia vía `PreApprovedLenderService → BancolombiaBnpl`/`BancolombiaConsumerLoan`. E2E real requiere sandbox de Bancolombia. En no-prod hay mock: `document_number` remapeado a `1998228194` (con-cupo) / `1998228111` (sin-cupo). **No confiar en respuestas locales como señal real.**
- **Resto (Sistecrédito, Welli, Meddipay, Prami, Compensar, BdB CeroPay) = inyectable SOLO a nivel HTTP:** stubbear el transporte del endpoint del lender (VCR/wiremock). **Prami es el más costoso**: además del stub necesita datacrédito **Experian REAL sembrado** (el MS falla temprano sin `ExperianProfile`).
- **Corbeta batch = parcial:** los crons cruzan por PIN → requieren fixtures de `UserRequestAdditionalInformation` con `verification_token` + stub de `Corbeta::query`. Corren en `application`.
- **Webhooks self-manager / redirect-return = bloqueados en legacy:** las rutas viven en `application/routes/api.php`; en legacy los métodos `selfManager`/`selfManagerStatusId` de las Actions existen pero **sin ruta que los invoque**. Un harness sobre legacy no puede cerrar el ciclo rt=1 hoy para redirect-aggregators.
- **Mock local del MS:** `frontend-e2e/mock-preapprovals/server.mjs` (:8095) devuelve "Pre aprobado" determinista para avanzar el front sin depender de proveedores intermitentes; `bin/asesor <comercio> lenders --mock-pa`.

**Punto de instrumentación para el OKR de salud de MS:** el MS `pre-approvals-service` (fallos por lender en `runAuth`/`runAPICall`/`runAdapt`) + las Actions legacy `App\Actions\Lenders\*` (excepciones de las APIs externas) + el cierre de estado (webhook/polling), hoy fragmentado entre `application` y legacy.

## Datos de prueba / usuario que pasa
**No hay receta local — el valor es el NEGATIVO.** rt=1 no aprueba/rechaza por datos sembrados: decide la API externa del lender. No existe un usuario sintético que "pase" en local. Para ver un rt=1 pre-aprobado hace falta (a) que el proveedor externo responda `approved` (Welli cuando `stg.welli` está arriba), (b) el sandbox de Bancolombia con `document_number` remapeado (`1998228194`), o (c) el mock determinista (`--mock-pa`, "Pre aprobado · Cupo $25.000.000"). Prami exige además datacrédito Experian real sembrado, o rebota con `400 invalid_input: applicant.experian_profile required`. Meddipay/Welli caídos → `500 transport_error` → **card oculta** (no es bug).

## Gotchas / riesgos
- **Bug guard muerto en `SelfManagerController.php:87`:** `if ($purchaseCode->barcode_checked && ($lender->id == 68 && $lender->id == 133))` — un id no puede ser 68 **Y** 133; el guard de 'código ya utilizado' nunca dispara ahí.
- **Consumo (100) siempre se muestra sin cupo real:** el `else` de `validatePreApproveLender` lo empuja con 'Probabilidad media'/sort=2 (hay un `// ToDo` del propio código admitiendo que debería mostrar solo pre-aprobados).
- **Filtro `array_filter [12,23,141,142,166]`** (`LenderRetrievalService.php:248-252`, `// TODO: [TEMPORAL]`): saca Prami (12) + las variantes Welli (23/141/142) + lender 166 del preaprobado v1 porque **erroran por falta de datos previos** en `employment-info`. Coincide con la frontera de inyectabilidad. NO es regla de negocio.
- **`pending` en el MS no repuebla `displayed_lenders`:** solo `approved`/`rejected` disparan `notifyLenderResult`; un `pending` mantiene la MISMA fila (Replace) para no romper el polling.
- **Welli STATUS_MAP `'pendiente_desembolso' => 11`:** marca como desembolsado un crédito que aún no lo está (application lo mapea a estado 28) → puede disparar `final_amount` prematuro.
- **Cruce Corbeta por string frágil:** el cruce es por PIN (`verification_token`) con `LIKE '% barcode%'` sobre `type_data` — renombrar el barcode rompe el cruce en silencio.
- **Ventana rara del cron BNPL de Corbeta:** `InvoiceProcessCorbetaBnpl` usa `maxDate=hoy 03:30` con `setTime` (no `endOfDay`) → riesgo de perder facturas del día.
- **`CredentialScope` distinto por lender:** Bancolombia y Meddipay = **merchant** (una credencial por comercio); Sistecrédito/Welli/Prami = **branch** (por sucursal).
- **Colisiones de id:** `24` Credifamilia lender vs Creditop allied · `100` Bancolombia Consumo lender vs un allied · el `application` viejo hardcodeaba `response_type=1` para el id 24 (ambigüedad Credifamilia rt=2/4) — NO extrapolar a Bancolombia (rt=1 genuino).
- **Meddipay recheck forzado:** `ShouldCheckAgain` siempre true (nuevo `order_id` por request) → nunca cachea.

## Preguntas abiertas
- [ ] ¿Qué path gana por comercio en el front nuevo, MS Go vs `PreApprovedLenderService` legacy? (coexisten en parallel-run).
- [ ] ¿legacy-backend cierra el ciclo rt=1 hoy, o el webhook self-manager y los crons Corbeta siguen SOLO en `application` (copias muertas en legacy)?
- [ ] Mapeo exacto `id → user_request_statuses`: los ids 3/6/7/8/10/11/26 se infirieron de callers/comentarios, no de la tabla/seeder fuente.
- [ ] `EstadoOrden` de Corbeta: los crons llaman con `status=3` (facturado) pero el default del método es 2; sin doc del enum del proveedor (1/2/3/4).
- [ ] BdB CeroPay: ¿el cierre Disbursed→11 lo hace solo `selfManager` o hay un checkStatus/purchase-code que confirma antes de sellar el 11?
- [ ] `response_type` real en BD de Addi/Compensar/BdB base: confirmado por código, no leído del seeder `lenders`.

## Diferencias vs otros flujos
- **vs CreditopX rt=2/3 (creditopx / smartpay / motai):** allá **CreditOp decide** (cupo sellado en `getLenders`), firma, desembolsa, cobra (6 crons post-11, ledger); NO redirige (journey in-platform `/confirmation`); **100% inyectable**. Acá decide la API externa, hay handoff externo, y NO es inyectable.
- **vs Credifamilia rt=4:** allá CreditOp hace KYC/plan/firma in-platform y **radica por SOAP** (`transaccionConsumo`), con pre-aprobación por **polling** exclusivo (id 24). Acá CreditOp no hace KYC del crédito; el lender desembolsa en su propia secuencia.
- **Dentro del set rt=1:** Sistecrédito = único con dos canales físicos (POS OTP vs online redirect+webhook) · Welli = 4 variantes sobre una Action + polling propio, no extiende `Integration` (el MS colapsa 141/142→'23' pero **166 NO**) · Meddipay = único handoff al celular + recheck forzado · Prami = único con perfil Experian REAL · BdB credi-convenio = único con mTLS + polling; CeroPay (133) = variante 0% con KYC previo y purchase-code (sin polling) · Compensar = cupo rotativo puro por OTP (sin MS/redirect/webhook) · Addi = stub redirect puro · Bancolombia (68/100) = único multiproducto con auth de canal fuerte (JWT RS256 + mTLS) y secuencia multi-step · Corbeta = único con facturación/conciliación batch (no es lender).

## Bitácora
- **2026-07-17** — Nodo creado sintetizando el análisis maestro de agregadores (verified-deep) + las fichas por lender + el MS de pre-aprobación. 115 archivos curados (legacy 46 / application 38 / frontend 31). El MS Go `pre-approvals-service` NO está en el índice (repo aparte) → referenciado en prosa pero excluido de `files`.

## Enlaces
- Sombrero: group **Bróker**. Backbone response_type: nodo **modelo-datos**. El MS `pre-approvals-service` (repo aparte, no indexado) se describe en §Sistemas externos.
- Memorias: `modelos-canales-flujos`, `synth-lender-type-boundary`, `pre-approvals-service`, `migracion-application-a-legacy-estado`, `continuacion-credito-servicing`, `lender-listing-cascade`, `refactor-perfilamiento-lenders`
