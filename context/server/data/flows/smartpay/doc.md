# SmartPay · flujo
> **estado:** al día con main · **Canal** de financiación de celulares donde el equipo ES la garantía: se bloquea/desbloquea por MDM (hardware) según la mora.

<!-- SmartPay es un CANAL sobre un lender CreditopX in-platform con path='IMEI'. Lo distintivo es el device-lock; el tronco común (entrada→OTP→datos→marketplace) se da por sabido. -->

## Qué es
SmartPay **NO es un lender nuevo ni un `response_type` nuevo**: es un **CANAL** (branding + mailer propios) montado sobre un **lender CreditopX in-platform con `path='IMEI'`**. El producto financiado es un celular, y **el celular ES la garantía**: en vez de pagaré Deceval + garantía + Netco, el cliente firma un solo **"Acuerdo de bloqueo de dispositivo"** (contrato Pro Consumidor, `CreditopXConsent` tipo 3). Post-desembolso el equipo queda inscrito en un **MDM (Trustonic vía merchant-gateway)** que lo **bloquea por mora y lo desbloquea al pagar** — la cobranza es enforcement por hardware. Es de lo poco de **servicing ya migrado a `legacy-backend`**.

Todo el gating es **por nivel-lender, nunca por `response_type`**, con 3 discriminadores:
- `UserRequest::isImeiPath()` — `lender.path.name==='IMEI'`. Gatea el **ciclo de servicing** (crons/jobs de bloqueo).
- `UserRequest::isSmartPay()` — `isImeiPath() && lender.id===160` (**hardcode del 160**). Gatea la **originación distintiva** (skip-AML, contrato de bloqueo, desembolso diferido).
- `Lender::isSmartpayChannel()` — `id===config('lenders.smartpay_lender_id')` (dev **153** / prod **160**). Gatea el **branding del mailer**.

| Pregunta | Respuesta |
|---|---|
| ¿Quién decide? | **CreditOp** (in-platform, motor CreditopX rt=2 con datos locales) |
| ¿Quién pone la plata / cobra? | Modelo CreditopX; la **cobranza se ejerce por hardware** (bloqueo MDM del celular por mora) |
| ¿Cómo cierra? | Firma del contrato de bloqueo → estado intermedio → **el asesor escanea el IMEI** → `disburse` → **Estado 11** (desembolso diferido) → servicing device-lock |
| ¿Simulable E2E? | **Originación sí** (rt=2 inyectable, sin KYC real; el AML se salta); **servicing** = capa extra: mockear el MDM + sembrar el ledger `creditop_x_requests_history` |

## Cómo funciona
Dos máquinas encadenadas por el **Estado 11** que fija `disburseImeiRequest`.

**Originación (device-enroll)** — idéntica a un CreditopX rt=2 hasta `/confirmation`; luego se bifurca:
1. Onboarding CreditopX: monto → `/lenders` → seleccionar el lender SmartPay → `update-user-request` → `/confirmation` (cliente) + `/continue` (asesor, QR).
2. **`confirm()` SALTA el AML** de TusDatos si `isSmartPay()` (`ContinueUserFlowController:91`). Identidad ADO usa credenciales **por-lender** en path IMEI.
3. Metadata al front `metadata.lender_path='IMEI'` (`AddOriginationFlowType`) → el wizard corre la rama IMEI.
4. **Preview del contrato antes del IMEI**: `PromissoryNoteController::show` devuelve `device_lock_agreement` (IMEI='PENDIENTE') en vez del pagaré.
5. Firma OTP (canal SMS `service`) → `transitionToIntermediate` mueve a **"Autorizado pendiente desembolso"** y genera solo `consent`(device_lock tipo 3) + `payment_schedule` (**sin pagaré/garantía/Netco**).
6. **Handoff de 2 dispositivos**: el asesor hace polling `advisor-status` (`is_documents_signed`), elige el celular y **escanea el IMEI**.
7. `POST device/register` → `AlliedProductService::enroll` (`POST /device-locking/devices/enroll` + status, tenant `X-Lb-Tenant-Id = allied.trustonic_tenant_key`) → setea `user_request_products.imei` → avisa al cliente que vuelva.
8. Cliente hace polling `client-status` (`is_imei_enrolled`) → `POST device/{id}/disburse`.
9. **`disburseImeiRequest`**: regenera el contrato con el **IMEI real**, `createFirstRegister` del ledger, `status=11` + `final_amount`, cancela otras solicitudes del cliente → side-effects (mailer smartpay + voucher + completeRequest).

**Servicing device-lock (post-11)** — 3 crons diarios leen el ledger de mora que escribe `application` y ejercen la garantía vía MDM:
- **04:00 LOCK** `LockDevicesPastDueCommand` ⇐ `status=2` (mora) `AND days_past_due>=8` AND lender IMEI AND producto con imei sin lock activo → `DeviceLockStatusJob(LOCK)` → (async) `PollDeviceLockBatchJob`.
- **05:00 UNLOCK** `UnlockDevicesPaidCommand` ⇐ `status IN [1,3]` (al día / paz y salvo) + `activeDeviceLock` → `DeviceLockStatusJob(UNLOCK)`.
- **06:00 UNROLL** `UnrollDevicesPaidCommand` ⇐ `status=3 AND principal_amount_balance=0` → `DeviceUnrollJob` → `PollDeviceReleaseBatchJob`.

El orden 04→05→06 evita carreras. **Único gate temporal = 8 días** (sin escalonamiento por tramos de mora).

## Dónde mirar
- **Discriminadores / config** (legacy): `app/Models/UserRequest.php` (`isImeiPath:184`, `isSmartPay:189`), `app/Models/Lender.php` (`isSmartpayChannel:65`), `config/lenders.php` (`smartpay_lender_id`).
- **Skip-AML + ruteo al front** (legacy): `ContinueUserFlowController.php` (`confirm`, skip `:91`), `AddOriginationFlowType.php` (`lender_path`), `Modules/Identity/.../AdoController.php` (ADO por-lender).
- **Contrato de bloqueo + firma** (legacy): `DeviceLockAgreementService.php` (preview/pdf/regenerate), `PromissoryNoteController.php` (rama IMEI), `ValidateOtpPromissoryNoteController.php` (canal service, transitionToIntermediate), `DocumentSigningService.php` (`generateImeiPathDocuments`), vista `resources/views/creditopxpdf/devicelockagreement.blade.php`.
- **Enroll + handoff + desembolso** (legacy): `DeviceController.php` (`registerDevice`/`disburse`), `AdvisorStatusController.php` (polling 2 devices), `AlliedProductService.php` (`enroll`), `ImeiValidationService.php` (Luhn), `LoanAuthorizationService.php` (`disburseImeiRequest`), `Modules/Loans/routes/api.php`.
- **Servicing device-lock** (legacy): `app/Console/Kernel.php` (crons 04/05/06), los 3 `*DevicesPaidCommand`/`*PastDueCommand`, `Jobs/{DeviceLockStatusJob,DeviceUnrollJob,PollDeviceLockBatchJob,PollDeviceReleaseBatchJob}`, `Services/DeviceLockingApiClient.php`, `Models/{DeviceLock,UserRequestProduct,UserRequestDeviceInfo}.php`.
- **Front (módulo IMEI)** (frontend-monorepo): `apps/loan-request-wizard/app/modules/imei/*` (uc/repo/schema), `app/routes/imei/*` (`imei.tsx`, `imei-scan.tsx`, `imei-scan-success.tsx`, `register-imei-action.server.ts`), `modules/.../loan-origination/src/components/imei/*` (Entry/Scanner/Confirmation), `.../disburse-device-request.uc.ts`, `.../utils/imei.ts`.
- **Productor de mora** (application): `app/Console/Commands/UpdateCreditopXRequestsCommand.php` (agendado en `app/Console/Kernel.php`, 00:30).
- **Harness**: mock del MDM `legacy-backend/tests/mock-server/merchant-gateway.php` + tests device-lock (`ImeiValidationServiceTest`, `LockDevicesPastDueCommandTest`, `UnlockDevicesOnPaymentTest`, `UnrollDevicesPaidCommandTest`, `DeviceUnrollJobTest`, `PollDeviceReleaseBatchJobTest`, `DeviceLockingApiClientTest`, `DeviceLockMother`) + `SmartPayTestSeeder.php`.

## Gotchas / riesgos
- **⚠ [CRÍTICO] Divergencia dev/prod.** `isSmartPay()` hardcodea `id===160` pero en **DEV el lender SmartPay es 153** → en dev `isSmartPay()` es **false** → skip-AML, contrato de bloqueo, `generateImeiPathDocuments` y `disburseImeiRequest` **NO se activan** (aunque el mailer, que usa config, sí). Para probar la originación real en dev hay que sortear el hardcode o crear el lender con id 160.
- **`response_type` ambiguo.** El `SmartPayTestSeeder` crea el lender con **rt=1**, la memoria/negocio lo tratan como rt=2. El flujo device NO se gatea por rt, pero `cancelOtherClientLoansIfOneDisbursed` corre SIEMPRE en `disburseImeiRequest` (sin mirar rt) vs solo-si-rt==2 en el `authorize` normal. El rt del lender de **prod (160) no está fijado por ningún seeder**.
- **Flujo documentado ≠ cableado.** El seeder documenta rutas `validate-imei`/`associate-imei`/`agreement`/`enroll`, pero las reales son solo `device/register` y `device/{id}/disburse`. La **validación Luhn del IMEI NO corre en legacy** (`enroll` va directo, la valida el gateway).
- **Servicing NO es autónomo en legacy.** La causación de mora (`UpdateCreditopXRequestsCommand`) solo está agendada en `application`; corriendo legacy solo, `days_past_due` nunca sube y **nada se bloquea**. Hay una copia del comando en legacy **no agendada**.
- **Enroll destructivo.** Si el `update` del IMEI devuelve 0 filas, `AlliedProductService::enroll` **borra todos los `user_request_products`** de la solicitud y crea uno nuevo (se pierden accesorios).
- **`PRO_CONSUMIDOR_NUMBER` placeholder** `'XXX/20XX'` (número oficial sin asignar); ruta de `release` con prefijo `/api/v1/` inconsistente con el resto; correos de excepción de los jobs a destinatarios hardcodeados.
- **¿RD only?** Seeder y default del contrato son RD (`country_id=60`, `es_DO`) — abierto si corre también en Colombia.

## Bitácora
- **2026-07-17** — Nodo creado desde la raíz. Superficie curada: **71 archivos** (legacy 54 · application 2 · front 15), 71/71 resuelven en el índice. Síntesis de dos lecturas profundas (originación + servicing device-lock) verificadas contra el código de `legacy-backend`.

## Enlaces
- Análisis: `docs/codigo/SMARTPAY-FLUJO-ANALISIS.md` (verificado, con `archivo:línea`).
- Tronco común (dado por sabido): `docs/codigo/REFERENCIA-FLUJOS.md` §1 · encadenamiento FE↔BE `docs/codigo/MAPA-FLUJOS.md` · comparación por entidad `docs/lenders/README.md`.
- Memorias: `modelos-canales-flujos` (SmartPay 152/153/160, MDM) · `synth-lender-type-boundary` (frontera de inyección) · `continuacion-credito-servicing` (ledger post-11).
