# SmartPay · contexto
> **estado:** al día con main · Canal in-platform sobre un lender CreditopX con `path='IMEI'`: el celular financiado ES la garantía — salta el AML, difiere el desembolso hasta escanear el IMEI, y ejerce la cobranza por hardware (bloqueo MDM).

> ⚠ **HALLAZGOS 2026-07-18/19 (detalle en el nodo findings, F-21..F-24, F-32, F-39):**
> - **⚠ ESTO CAMBIÓ EL 2026-08-19 — ver F-155, que supera a F-21.** Ya NO es cierto que la originación esté muerta fuera de producción: `isSmartPay()` pasó a resolver por entorno. Pero lo hizo con **152**, mientras la config sigue diciendo **153**, así que ahora la identidad del canal se decide en **cuatro sitios que no coinciden**: fuera de producción una entidad se queda con la originación (skip-AML, acuerdo de bloqueo, desembolso diferido) y **otra** con el branding del mailer. Ninguna de las dos es SmartPay entera — comprobado corriéndolo en local.
> - **⚠ TAMBIÉN CAMBIÓ: el canal CIERRA ENTERO EN LOCAL.** Lo de «el cierre queda en 28 y `device/disburse` muere en un null» era consecuencia del hardcode viejo —`isSmartPay()` daba falso, así que `disburse` se bifurcaba al `authorize` estándar—. Con el arreglo del 19-ago, la bifurcación es la correcta: **recorrido completo en local hasta estado 11** el 2026-08-22, con el mock del MDM. La secuencia sigue siendo `device/register` → `device/{ur}/disburse`, **sin llamar a `authorize`** — y ojo, la respuesta del `verify-otp` devuelve `next_step: "authorize"`, que en este path es la instrucción equivocada.
> - `requires_imei` **nunca se guarda**: no está en `Product::$fillable` y Eloquent lo descarta en silencio (F-24).
> - El escaneo de IMEI y el ciclo lock/unlock/release SÍ corren en local contra `mock-mdm` (:8098) — enroll verificado (F-23) y el cron de mora persistiendo `device_locks=locked` (F-39).

## Qué es
**SmartPay NO es un lender ni un `response_type` nuevos: es un CANAL** (branding + mailer propios) montado sobre un **lender CreditopX in-platform con `path='IMEI'`**. El producto financiado es un celular y **el celular ES la garantía**: en vez del pagaré Deceval + garantía + Netco de un CreditopX estándar, el cliente firma un único **"Acuerdo de bloqueo de dispositivo"** (`CreditopXConsent` tipo 3, contrato Pro Consumidor). Post-desembolso el equipo queda inscrito en un **MDM** (API `device-locking` del merchant-gateway, "Trustonic") que lo **bloquea por mora y lo desbloquea al pagar** — la cobranza es enforcement por hardware. Es de lo poco de **servicing ya migrado a `legacy-backend`** (el resto de la cartera CreditopX sigue en `application`).

Como subcontexto de **Merchants**, hereda el tronco rt=2 CreditopX del hermano **Pullman** (base sucursal → status → group_rules+datacrédito → categoría/tramo → cupo local); este nodo cubre **solo lo distintivo**: los discriminadores de canal, el skip-AML, el contrato de bloqueo, el desembolso diferido con handoff de 2 dispositivos, y los crons de servicing device-lock. La identidad/AML de fondo es dueña del nodo **KYC**; la firma/desembolso genérica, de **Formalization**.

## Antes de concluir
- **⚠ [CRÍTICO] El canal está PARTIDO EN DOS fuera de producción, y por eso no se puede probar entero.** No es que falte el lender: es que los discriminadores apuntan a entidades distintas. `isSmartPay()` resuelve a **152** fuera de producción y gatea la originación (skip-AML, `device_lock_agreement`, `generateImeiPathDocuments`, `disburseImeiRequest`); `Lender::isSmartpayChannel()` lee la config, que resuelve a **153**, y gatea el branding del mailer. Las dos entidades tienen path IMEI, así que las dos parecen SmartPay — y ninguna lo es del todo. **Antes de probar el canal, comprobá contra qué id estás corriendo cada mitad** (→ **F-155**).
- ⚠ **El comentario del skip-AML dice lo contrario que el código.** Junto al guard se lee «IMEI path skips AML validation», pero el guard es `isSmartPay()`, que exige **path IMEI *y* el id**. Una entidad con path IMEI que no sea ese id **sí** corre el AML — que es exactamente lo que pasa hoy con la otra mitad del canal.
- **`response_type` ambiguo.** El `SmartPayTestSeeder` crea el lender con **rt=1**, pero negocio/memoria lo tratan como rt=2; el flujo device NO se gatea por rt. Efecto lateral: `cancelOtherClientLoansIfOneDisbursed` corre SIEMPRE en `disburseImeiRequest` (`:296`), vs solo-si-rt==2 en el `authorize` normal. El rt del lender de **prod (160) no lo fija ningún seeder**.
- **Flujo documentado ≠ cableado.** El seeder documenta rutas `validate-imei`/`associate-imei`/`agreement`, pero las reales son solo `device/register` y `device/{id}/disburse`; la **validación Luhn NO corre en legacy** (`enroll` va directo, la valida el gateway).
- **Servicing NO autónomo en legacy.** La causación de mora solo está agendada en `application`; con legacy solo, nada se bloquea. Existe una copia del comando en legacy **no agendada**.
- **Enroll destructivo.** Si el `update` del IMEI devuelve 0 filas, `AlliedProductService::enroll` **borra todos los `user_request_products`** de la solicitud y crea uno nuevo (se pierden accesorios).
- **Inconsistencias menores**: `PRO_CONSUMIDOR_NUMBER='XXX/20XX'` (placeholder, se sustituye por `request_number`); `releaseDevices` usa prefijo `/api/v1/` distinto al resto; los correos de excepción de los jobs van a destinatarios hardcodeados.
- **Tres preguntas que este nodo tenía abiertas, medidas el 2026-08-22 y ya cerradas:**
  - **El lender de producción es `response_type` 2**, con path IMEI y país 60 (RD), y el canal está **vivo** (recibió solicitudes ese mismo día). El `SmartPayTestSeeder` lo crea con rt=1, así que **el seeder no refleja producción** — no lo uses para razonar sobre el rt.
  - **En producción el canal es de RD**, no de Colombia: lo dice el país de la entidad. Y ⚠ **los ids 152 y 153 en producción son OTRAS entidades vivas y con desembolsos** (Refurbicredit y Crediemo), ninguna con path IMEI — o sea que los literales del condicional por entorno no son números libres.
  - **`user_request_device_info` no la puebla nadie:** su único escritor es `ImeiValidationService::associate`, y ese servicio **está registrado en el contenedor y tiene tests, pero no lo invoca ninguna ruta ni servicio**. En producción la tabla está vacía. El `enroll` real escribe sólo `user_request_products.imei`, tal como decía la sospecha.
- *Abierta:* ¿la divergencia de los cuatro sitios es intencional, o todos deberían leer `config('lenders.smartpay_lender_id')`? El TODO del propio código dice que la salida correcta es la config.

## Lo distintivo del canal SÍ se puede ejercitar en local (medido, no inferido)
Este nodo afirmaba lo contrario, y era cierto hasta el 2026-08-19. **Comprobado corriéndolo el 2026-08-22**, con la entidad de path IMEI que el condicional por entorno elige fuera de producción y un comercio del dump que la tiene activa en una sucursal. Cada afirmación se verificó **contra un control**: la misma llamada, con los mismos mocks y segundos de diferencia, sobre un comercio sin path IMEI.

| comportamiento distintivo | cómo se comprobó | resultado |
|---|---|---|
| **salta el AML** | el `confirm` loguea «Ejecutando proceso de Tusdatos en segundo plano» sólo cuando NO salta | en el control **corrió**; en el canal **no** |
| **firma el acuerdo de bloqueo** | la previsualización de firma devuelve el documento | canal → `device_lock_agreement`; control → `consent` |
| **difiere el desembolso** | estado tras validar el OTP de firma | canal → **«Autorizado pendiente desembolso»**; el estándar va a 11 |
| **cierra por hardware** | `device/register` (mock MDM) → `device/{ur}/disburse` | equipo `ENROLLED`, **estado 11**, `final_amount` e IMEI persistido |

**El ciclo de mora también se ejercita**, sembrando a mano una fila del ledger `creditop_x_requests_history` —que en producción escribe **`application`**— y corriendo los tres comandos: bloqueo y desbloqueo funcionan y dejan **una** fila cada uno. ⚠ Pero el intento fallido **crea una fila nueva por cada intento** en vez de reintentar sobre la existente, y `failed` no cuenta como lock activo, así que el cron vuelve a elegir el producto al día siguiente, sin tope: **F-156**, con 40 equipos en producción que nunca llegaron a bloquearse. Corolario para cualquier consulta sobre `device_locks`: **contá `DISTINCT user_request_product_id`, no filas.**

⚠ **La inscripción NO crea fila en `device_locks`** — y eso es correcto, no un fallo del mock: el enum no tiene estado `enrolled` y las filas las crea el cron de mora. Si buscás la evidencia del enrolamiento ahí, no está: está en `user_request_products.imei`.

⚠ **Un comercio con la entidad asignada no alcanza**: tiene que estar **activa en una sucursal** y con categorías propias, que es la misma regla del tronco rt=2. Sin eso el listado sale vacío y parece que el canal no existe.

## Contenido

**Tres discriminadores — todo gatea por nivel-lender, nunca por `response_type`:**
- `UserRequest::isImeiPath()` — `lender.path.name==='IMEI'`. Gatea el **ciclo de servicing** (crons/jobs de bloqueo).
- `UserRequest::isSmartPay()` — `isImeiPath() && lender.id===160` (**hardcode del 160**). Gatea la **originación distintiva** (skip-AML, contrato de bloqueo, desembolso diferido).
- `Lender::isSmartpayChannel()` — `id===config('lenders.smartpay_lender_id')` = **dev 153 / prod 160**. Gatea el **branding del mailer** (`smartpay`, `noreply@tusmartpay.com`).

**Originación (device-enroll)** — idéntica a un CreditopX rt=2 hasta `/confirmation`, luego se bifurca:
1. `confirm()` **SALTA el AML** de fondo (`Tusdatos::background`) si `isSmartPay()`; la identidad ADO usa credenciales **por-lender** en path IMEI.
2. Metadata `metadata.lender_path='IMEI'` al front → el wizard corre la rama IMEI.
3. La preview de firma devuelve el **`device_lock_agreement`** (IMEI=`'PENDIENTE'`) en vez del pagaré.
4. Firma OTP por canal SMS `service` → `transitionToIntermediate` mueve el estado a **"Autorizado pendiente desembolso"** (estado intermedio nuevo) y genera **solo** `consent`(device_lock tipo 3) + `payment_schedule` (**sin pagaré, garantía ni Netco**).
5. **Handoff de 2 dispositivos**: el asesor hace polling `advisor-status` (`is_documents_signed`), elige el celular y **escanea el IMEI** → `POST device/register` → `AlliedProductService::enroll` (`POST /device-locking/devices/enroll`, tenant `X-Lb-Tenant-Id = allied.trustonic_tenant_key`) setea `user_request_products.imei`.
6. El cliente hace polling `client-status` (`is_imei_enrolled`) → `POST device/{id}/disburse` → **`disburseImeiRequest`**: regenera el contrato con el **IMEI real**, `createFirstRegister` del ledger, `user_request_status_id=11` + `final_amount`, cancela otras solicitudes del cliente → side-effects (mailer smartpay + voucher + completeRequest).

**Servicing device-lock (post-Estado 11)** — 3 crons diarios leen el ledger de mora `creditop_x_requests_history` (que escribe `application`) y ejercen la garantía vía MDM:
- **04:00 LOCK** ⇐ `creditop_x_requests_status_id=2` (mora) `AND days_past_due>=8` AND lender IMEI AND producto con imei sin lock activo → `DeviceLockStatusJob(LOCK)` → (async) `PollDeviceLockBatchJob`.
- **05:00 UNLOCK** ⇐ `creditop_x_requests_status_id IN [1,3]` (al día / paz y salvo) + `activeDeviceLock` → `DeviceLockStatusJob(UNLOCK)`.
- **06:00 UNROLL** ⇐ `creditop_x_requests_status_id=3 AND principal_amount_balance=0` → `DeviceUnrollJob` → `PollDeviceReleaseBatchJob`.

El orden 04→05→06 evita carreras; **único gate temporal = 8 días** (sin escalonamiento por tramos de mora).

**Estados que maneja el canal:**
- `user_request_status_id`: **"Autorizado pendiente desembolso"** (intermedio, migración `2026_02_20_110000`) → **11** (desembolsado; se llega solo tras register+disburse).
- `device_locks.status` (máquina de la garantía física, **8 constantes**): `pending`→`locked`/`failed`; `unlocked`/`unlock_failed`; `pending_release`→`released`/`release_failed`. **No hay estado `enrolled`** (la inscripción no crea fila). `activeDeviceLock` = `whereIn ['locked','unlock_failed']` — incluye `unlock_failed` a propósito (el equipo sigue físicamente bloqueado y se reintenta). El enum arrancó con 4 valores y creció por migraciones (`unlock_failed` en `2026_03_11`, los 3 de release en `2026_03_18`).
- `creditop_x_requests_history.creditop_x_requests_status_id`: **1**=al día, **2**=mora, **3**=paz y salvo.

**Ámbito:** el seeder y el default del contrato son **RD** (`country_id=60`, locale `es_DO`, moneda `DOP`); abierto si corre también en Colombia.

**(2026-08-28) Re-verificación asistida de los 21 archivos derivados** (worker → 9 funcionalidades; las
2 que invalidaban, verificadas — ciertas): `isSmartPay()` resuelve el id **por entorno** (160
producción / 152 el resto, cuarta copia del condicional; el código pide sacarlo a config), y
`releaseDevices` perdió el prefijo `/api/v1/` duplicado (la base ya lo trae) — el punto que este doc
señalaba como divergente quedó alineado. Lo agregado que importa: **los bloqueos y desbloqueos manuales
del panel ahora PERSISTEN en `device_locks`** (antes no dejaban rastro), el diferimiento por codeudor y
el espejo a merchant-api también aplican acá, y la mora se causa con el calendario de cortes
(`CutoffCalendar`).

## Dónde mirar
Todo en `legacy-backend` salvo nota; líneas verificadas contra el código vigente.
- **Discriminadores / config**: `app/Models/UserRequest.php` (`isImeiPath:184`, `isSmartPay:189` — id 160 en `:191`), `app/Models/Lender.php` (`isSmartpayChannel:75`), `config/lenders.php:24` (`smartpay_lender_id`: prod 160 / dev 153).
- **Skip-AML + ruteo al front**: `Modules/Loans/App/Http/Controllers/Customer/ContinueUserFlowController.php` (`confirm:68`, skip AML `:91`, comentario `:90`), `Modules/Loans/App/Http/Middleware/AddOriginationFlowType.php` (`lender_path:54`, `credit_type:59`), `Modules/Identity/App/Http/Controllers/Customer/AdoController.php` (ADO por-lender en path IMEI), `Modules/Loans/App/Services/CreditopXFlowService.php` (`getNextStepData`).
- **Contrato de bloqueo + firma**: `Modules/Loans/App/Services/DeviceLockAgreementService.php` (`PRO_CONSUMIDOR_NUMBER:28` placeholder, `isSmartPay:48`, `generatePreviewPdf:57`, `regenerateSignedPdf:113`, `creditop_x_consent_type_id=3` `:104`, locale `es_DO:164`), `.../PromissoryNoteController.php` (rama IMEI `:75-82`), `.../ValidateOtpPromissoryNoteController.php` (canal `service:182`, `transitionToIntermediate:289`), `Modules/Loans/App/Services/DocumentSigningService.php` (`generateAllDocuments:48`, `generateImeiPathDocuments:59`), vista `resources/views/creditopxpdf/devicelockagreement.blade.php`.
- **Enroll + handoff + desembolso**: `.../DeviceController.php` (`registerDevice:30`, `disburse:82`, bifurca `isSmartPay` `:102` / `authorize` else `:105`), `.../AdvisorStatusController.php` (`checkSigningStatus:26`, `checkEnrollmentStatus:71`), `Modules/Partner/App/Services/AlliedProductService.php` (`enroll:28`, delete destructivo `:97`, tenant key `:44`), `Modules/Loans/App/Services/ImeiValidationService.php` (Luhn `validateFormat:11`, `associate:34`), `Modules/Loans/App/Services/LoanAuthorizationService.php` (`disburseImeiRequest:252`, `cancelOtherClientLoans:296`, `handlePostDisbursementSideEffects:317`, `transitionToIntermediate:424`), `Modules/Loans/routes/api.php:88-91` (`device/register`, `{id}/disburse`, `advisor-status`, `client-status`).
- **Servicing device-lock**: `app/Console/Kernel.php:15-17` (crons 04/05/06), `app/Console/Commands/{LockDevicesPastDueCommand.php:32-35,UnlockDevicesPaidCommand,UnrollDevicesPaidCommand}.php`, `app/Jobs/{DeviceLockStatusJob.php:23-41,DeviceUnrollJob,PollDeviceLockBatchJob,PollDeviceReleaseBatchJob}.php`, `app/Services/DeviceLockingApiClient.php` (lock `:23`, batch `:31`, unlock `:37`, release `/api/v1` `:48`), `app/Models/DeviceLock.php:13-27` (8 estados), `app/Models/UserRequestProduct.php` (`deviceLocks:53`, `activeDeviceLock:58`), `app/Models/UserRequestDeviceInfo.php`.
- **Notificaciones / MDM config**: `Modules/Loans/App/Services/NotificationService.php` (mailer smartpay `:55-57`, `sendClientImeiRegisteredNotification:128`, `sendImeiContractNotification:140`), `config/mail.php:90-101` (`noreply@tusmartpay.com`), `config/services.php:317-320` (`merchant_gateways.host`).
- **Productor de mora (cross-repo `application`)**: `app/Console/Commands/UpdateCreditopXRequestsCommand.php` agendado en `app/Console/Kernel.php:34` (00:30). Sin él, `days_past_due` no sube y nada se bloquea.
- **Front (módulo IMEI, `frontend-monorepo`)**: `apps/loan-request-wizard/app/routes/imei/*` + `app/modules/imei/*`, `modules/loan-request-wizard/loan-origination/src/components/imei/*` + `.../lib/application/disburse-device-request.uc.ts` + `.../lib/utils/imei.ts`.
- **Harness**: mock MDM `tests/mock-server/merchant-gateway.php`, `database/seeders/SmartPayTestSeeder.php`, tests device-lock (`ImeiValidationServiceTest`, `LockDevicesPastDueCommandTest`, `UnlockDevicesOnPaymentTest`, `UnrollDevicesPaidCommandTest`, `DeviceUnrollJobTest`, `PollDeviceReleaseBatchJobTest`, `DeviceLockingApiClientTest`, `DeviceLockMother`).

