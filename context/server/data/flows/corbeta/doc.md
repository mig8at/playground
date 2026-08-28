# Corbeta (subnodo de `merchants`)

> **⚠ RE-PARENTADO el 2026-07-31: de `aggregator` a `merchants`.** Corbeta es un **GRUPO DE COMERCIOS**
> (`allieds`), no una familia de prestamistas. Vivía bajo `aggregator` por su acoplamiento a Bancolombia,
> pero eso confundía los dos ejes del marketplace. Misma regla que `motai` (comercio 158 en `merchants`)
> vs MotaiX (su lender, en `entities`). **La relación con Bancolombia no es de contención en ninguna
> dirección** (números verificados en BD el 2026-07-31): los tres retail Corbeta tienen **exactamente 2
> lenders, 68 y 100** — para ellos Bancolombia no es el principal, es el **único**; pero Bancolombia está
> habilitado en **109 de 230 comercios** (el 100 en 78), así que **no es "el lender de Corbeta"**. Se
> cruzan: acá vive el lado COMERCIO (quién vende, cómo cierra la venta en caja, la conciliación); el lado
> PRESTAMISTA vive en el nodo hermano **`bancolombia`** (bajo `aggregator`).

Corbeta **no es un lender**: es un **grupo de comercios de retail físico** (Alkosto=209, K-Tronix=210,
Alkomprar=211) con un **canal BATCH** propio. Ojo con el cuarto id del gate: **allied 24 = "Creditop"**,
la cuenta propia de la casa (tiene 21 lenders habilitados, no 2) — está en `corbeta_allieds` y en el
`switch` del código, pero **no es un retail Corbeta**; es el único `case` sin comentario en
`CodeGenerationService.php:22`. En un webhook aparece además el 311. El crédito lo resuelve Bancolombia
(rt=1) a través de dos productos — **BNPL (lender 68)** y
**Consumo / Crédito de libre inversión (lender 100)** — pero lo que hace a Corbeta un nodo propio es
su **ciclo diferido**: el cliente sale del checkout con un **PIN** (orden pre-generada en el sistema
de cajas "API Fondos" de Corbeta), va a la tienda física, factura en caja, y **CreditOp se entera
DESPUÉS por polling batch**, concilia la factura contra el PIN, mueve la solicitud a **estado 26
(Facturado)** y recién ahí confirma el consumo a Bancolombia. Es el único flujo donde la venta se
cierra fuera de la plataforma y se reconstruye por conciliación.

Dos sub-variantes conviven:
- **Corbeta ecommerce (nuevo, legacy-backend V2)**: checkout server-to-server firmado en base64 →
  crea usuario+solicitud → landing React que resuelve pre-aprobación Bancolombia BNPL.
- **Corbeta "clásico" (application)**: el wizard normal llega a estado 25, genera PIN + código de
  barras, y los crons diarios lo concilian.

---

**(2026-08-28) Deriva releída entera**: la resolución del checkout se expuso como **endpoint JSON**
(#1190 quitó la redirección — el front decide), el BNPL de ecommerce manda el **NIT con dígito de
verificación**, y el desvío del checkout hacia el wizard nuevo quedó confirmado. Además el monolito
viejo **bloquea crawlers en las consultas de preaprobado** — los bots ejecutaban consultas que se
pagan. Verificado contra `main`.

## Dónde mirar

Las secciones de abajo cuentan cada tramo en detalle; esto es el atajo: por responsabilidad, con la
línea donde decide.

- **¿Este comercio es Corbeta?** — `legacy-backend/Modules/AlliedBranchV1/App/Services/IsCorbetaOnboardingService.php:96 isCorbetaOnboardingOrchestrator`,
  que lee `settings.corbeta_allieds` (cache-aside). Es un servicio INTERNO: no tiene ruta HTTP.
- **Dónde Corbeta cambia la FORMA del flujo** — `legacy-backend/Modules/OnboardingV2/App/Services/ValidateOtpAuthService.php:317`
  resuelve el flag (⚠ `:317` lo fuerza a `false` bajo Motai renting: los dos están cruzados). Y de ahí
  cuelgan las tres consecuencias, en el mismo método: `:326` el usuario temporal **no** se enruta a
  datos personales · `:335` la info laboral **se fabrica** (`storeDefaultEmploymentInformation`) ·
  `:357` la respuesta sale con `OBV22007` en vez del `OBV22000` normal. **Éste es el archivo que
  explica por qué un comercio Corbeta no consulta buró**: el buró se dispara al guardar lo laboral, y
  acá lo laboral nunca se pide.
- **El código de compra en caja** — ver §3 (rama clásica, `application`) y §4 (checkout ecommerce,
  `legacy-backend`); son dos ramas distintas y el mismo canal.
- ⚠ **La deuda está declarada en el propio código**: `ValidateOtpAuthService.php:311-312` dice que la
  política de un comercio se filtró al orquestador general y que habría que ponerla detrás de una
  abstracción por comercio. Si vas a tocar ese método, leé ese comentario primero.

---

## 1. Configuración y gate de pertenencia

⚠ **NO existe UNA lista de «allieds Corbeta» — hay una FAMILIA de literales que DIVERGE** (verificado
2026-08-08 contra la BD local y grep en los repos; este nodo es el dueño del hecho, no cites una lista
única desde otro nodo):

| quién pregunta | lista | dónde |
|---|---|---|
| el setting (BD, dump de dev) | `[24,209,210,211]` — **y hay DOS filas con la misma key** (id 21 y 26) | `settings.corbeta_allieds` |
| el cutover/redirect ecommerce del monolito | `[…,311]` (incluye **Kalley 311**) | `application`: `Customer/WoocommerceController` · `Api/BancolombiaController` · `Api/EcommerceReplayController` |
| `User.php` (ambos repos) | `[209,210,211]` — **sin el 24** | `$corbetaAlliedIds` |
| el prefijo Bancolombia BNPL | `[24,209,210,211,218,219,222,221]` | `BancolombiaBnpl.php:387` `$aliadosConPrefijo` |

Consecuencia: «¿este allied es Corbeta?» **depende de quién pregunta** — un comercio puede entrar al
gate del setting y NO al del redirect (o al revés). Antes de afirmar pertenencia, mirá el sitio exacto.

- **`corbeta_allieds`** (tabla `settings`, code=`setting`, key=`corbeta_allieds`, array de allied_id)
  es la fuente de verdad del GATE de onboarding. Se lee en 3 sitios equivalentes:
  - legacy-backend `IsCorbetaOnboardingService::isCorbetaOnboardingOrchestrator()`
    (`legacy-backend/Modules/AlliedBranchV1/App/Services/IsCorbetaOnboardingService.php:113-116`) —
    servicio INTERNO sin ruta HTTP, envelope `ABV12xxx`, devuelve `{isCorbetaOnboarding: bool}`.
    Entrada `IsCorbetaOnboardingCommand` (solo `alliedId`,
    `.../App/Commands/IsCorbetaOnboardingCommand.php`). Lo consume
    `OnboardingV2\ValidateOtpAuthService::validateOtpAuthOrchestrator()` (adapter) — decide si el
    OTP entra al flujo Corbeta/Bancolombia.
  - legacy-backend `OnboardingService::validateCorbetaOnboarding()` (equivalente legacy portado, del
    que nace el servicio de arriba) y el bloque "Flow B Corbeta/Pash" de `storePersonalInfo()` que
    inyecta **datos laborales dummy** cuando el allied es Corbeta (salta captura real).
  - legacy-backend `merchants/PurchaseCodeService::isCorbetaAllied()` (mismo setting).
- **`services.corbeta`** (idéntico en `application/config/services.php:215-222` y
  `legacy-backend/config/services.php:303-310`): `host` (API Fondos), `nit` (=UserName+NitCliente),
  `password`, `user_id`, y los **dos convenios**: `convenio_bnpl` y `convenio_consumo`. El convenio
  se elige por un **ternario** — `lender_id==68 ? convenio_bnpl : convenio_consumo`
  (`application/app/Services/CodeGenerationService.php:51`) — ⚠ cuyo `else` captura al 100 **y a
  cualquier otro lender** que pase el gate: no hay rama de error.

---

## 2. El cliente Corbeta (Action) — API Fondos

`application/app/Actions/Allies/Corbeta.php` y su gemelo `legacy-backend/app/Actions/Allieds/Corbeta.php`
(**byte-idénticos** salvo el namespace `Allies` vs `Allieds`). Tres llamadas a la API Fondos de Corbeta:

- **`authorize()`** (`:38`): `POST /ObtenerToken/getToken` con nit/password → `{token, userId}`.
- **`register(User, valor, address, convenio)`** (`:58`): `POST /GenerarOrden/setOrder`. Genera la
  orden en cajas. Mapea `document_type`→letra (`DOCUMENT_TYPES`, `:18`), manda depto/ciudad/dirección,
  email fijo `ordenes-corbeta@creditop.com`. La respuesta trae `code`/`message`, y el **PIN viene
  embebido en el texto**: se extrae con regex `PIN\s+([a-f0-9]{20,})`
  (`CodeGenerationService::getFromCorbeta`, `application/app/Services/CodeGenerationService.php:72`).
- **`query(dateMin, dateMax, status)`** (`:131`): `POST /ConsultaOrden/getOrder` con `EstadoOrden`
  (1 solicitada / 2 / 3 facturada), rango de fechas y NitCliente. Devuelve órdenes con
  `{pin, fechaSolicitud, fechaFacturacion, noFactura, valorFacturado}`. **Dedup**: ordena por
  `fechaFacturacion` desc y deja una por `pin` (`:161-165`). El **PIN es la llave de correlación**
  entre la orden de caja y la `user_request`.

Todo se loguea en `logs` (tabla) con name `Corbeta - query` / `CORBETA - register`.

---

## 3. Generación del PIN + código de barras (rama clásica, application)

- **`CodeGenerationService::getRequestNumber()`**
  (`application/app/Services/CodeGenerationService.php:15`): switch por allied — 24/209/210/211 →
  `getFromCorbeta()` (= `register()` + extrae PIN); resto → PIN interno sha256.
- **`PurchaseCodeController::show()`** (`application/app/Http/Controllers/Customer/PurchaseCodeController.php`):
  puerta de entrada del código de barras. Gate duro (`:36`): allied ∈ [24,209,210,211] **Y**
  `user_request_status_id == 25` **Y** lender ∈ [68,100]; si no, no muestra código. Si aún no hay
  código, llama `getRequestNumber()` (obtiene PIN de Corbeta), genera imagen (ean13/ean128/qr según
  `allied.barcode_type`), la sube a S3, manda SMS con el link ("activo hasta las 8:30pm"), y persiste:
  - **`purchase_codes`** (`barcode_url`).
  - **`user_request_additional_information`** con `type_data = "<allied> barcode"` y
    `data_json.verification_token = <PIN>` (`storeAdditionalInformation`, `:158-175`). **Este
    `verification_token` es el PIN**: es lo que los crons cruzan contra `order['pin']`.
  - `validateCurrentOrder($pin)` (`:177`) hace un `query()` a Corbeta y confirma que la orden existe
    (rango ayer→mañana) → `showBarCode`.
- `application/app/Http/Controllers/Admin/PurchaseCodeController.php`: versión back-office (consulta
  el PIN de una solicitud y valida contra Corbeta).
- legacy-backend equivalente: `merchants/CodeGenerationService.php` (mismo `getFromCorbeta`) y
  `merchants/PurchaseCodeService.php` (refactor V2: `isCorbetaAllied()` por setting, mismo gate
  estado 25 + lender [68,100]).

---

## 4. Checkout ecommerce (rama nueva, legacy-backend)

`legacy-backend/Modules/Onboarding/App/Http/Controllers/CorbetaCheckoutController.php` — rutas en
`Modules/Onboarding/routes/api.php:26-28`:
- `GET  onboarding/checkout/{allied_branch_hash}` → `show()`
- `GET  onboarding/corbeta/checkout/result` → `result()`
- `POST onboarding/corbeta/checkout/cancel/{user_request_id}` → `cancelAndReturn()`

**`show()`** (`:104`) es el corazón del checkout server-to-server:
1. Exige params `o,p,t,u,ps` (order, products, token, return_url, process_endpoint), todos
   **base64 + serialize/json** (`decodeBase64Params`/`deserializeData`, `:750-788`).
2. Resuelve `allied_branch` por hash; saca billing (phone/documento/email/nombre) del `order`.
3. **Casos de prueba cableados**: teléfonos `30000000xx` mapean a códigos de error controlados
   (`controlErroresCasosPruebas`, `:913-989`; `ERROR_MESSAGES` CORB/BP/SP, `:22-59`) y un
   `testEmailsMap` por documento (`:196-204`). Solo acepta documento CC (`:232`).
4. Busca/crea `User` (conflictos → BP12700001/BP409XXX3).
5. **Crea la solicitud** vía `CorbetaUserRequestService::createUserRequestAndUpsertFields()` y
   un **`EcommerceRequest`** (`createOrUpdateEcommerceRequest`, `:712`, guarda order/products/
   return_url/process_url, `ecommerce_id` 1 ó 2), y los enlaza (`user_requests_by_ecommerce_request`).
6. Redirige al front: **`/bancolombia/self-service/{hash}/resolve-ecommerce-flow/{userRequestId}?return=...&amount=...`**
   (`redirectToResolveEcommerceFlow`, `:1250`). Los errores redirigen a paths front
   (`/bancolombia/invalid/start/demo`, `/bancolombia/bnpl/bnplError`).

**`CorbetaUserRequestService`** (`.../App/Services/CorbetaUserRequestService.php`):
- `createOrReuseUserRequestId()` (`:66`): reusa una `user_request` viva (status ∈ [1,3,9]) que no
  esté ya atada a un `ecommerce_request`; si el branch tiene credencial ecommerce, desdobla por
  `order_key`. Estados que va sellando: crea en **1**, éxito → **9**, fallo → **8**.
- `upsertRequiredUserFieldValues()` (`:173`): inyecta EAV mínimos para poder decidir —
  **field 29 = situación laboral ("Empleado")**, **field 87 = ingreso (1.500.000 default)**,
  field 160='no', field 161=6. Es el "dummy labor info" del Flow B Corbeta.

---

## 5. Landing React y cancelación (frontend)

- **`.../routes/bancolombia/ecommerce/resolve-ecommerce-flow.tsx`**: destino del redirect del checkout.
  `handleCorbetaFlow()` (`:102`) corre `ValidatePreapprovedUc` (pre-aprobación Bancolombia BNPL),
  aplica la **ventana horaria 5:00–21:30 America/Bogota** (`:129-135`) — fuera de horario en flujo
  `consumo` cancela; `no_preapproved` cancela y va a `/no-preapproved`; monto < 100000 corta.
- **`.../routes/bancolombia/ecommerce/ecommerce-loan-processing.tsx`**: procesamiento del crédito
  ecommerce; también invoca la cancelación.
- **`.../routes/bancolombia/cancel-checkout.tsx`** + **`.../server/services/cancel-corbeta-checkout.server.ts`**:
  `cancelCorbetaCheckout()` hace `POST /api/onboarding/corbeta/checkout/cancel/{userRequestId}` con
  flags `voluntary|insuficient|out_of_schedule` y `code` (default 5001). El backend
  (`cancelAndReturn`, `CorbetaCheckoutController:444`) llama `CancelRequestService::cancelRequest()`
  y confirma cancelación si el status final queda en **8**. `CancelCheckoutError` preserva el HTTP
  status (404/409/500/422) para ramificar en el front.

---

## 6. El ciclo BATCH: conciliación, estado 26 y confirmación a Bancolombia

Aquí está lo distintivo. Cadence en `application/app/Console/Kernel.php:57-65`:

| Cron | Command | Cadencia | Qué hace |
|------|---------|----------|----------|
| `app:invoice-process-corbeta` | `InvoiceProcessCorbeta` | **daily 06:05** | Consumo (lender **100**): concilia + confirma a Bancolombia |
| `app:invoice-process-corbeta-bnpl` | `InvoiceProcessCorbetaBnpl` | **daily 03:00** | BNPL (lender **68**): concilia + confirma |
| `app:update-orders-from-corbeta` | `UpdateOrdersFromCorbeta` | **cada 2 horas** | Marca **estado 26 (Facturado)** al detectar factura |
| `app:corbeta-conciliation-report-command` | `CorbetaConciliationReportCommand` | **daily 07:00** | Manda reporte de conciliación por email |

**Correlación (los 3 cron de proceso comparten patrón)**:
1. `Corbeta::query(minDate, maxDate, status=3)` trae las órdenes **facturadas** en el rango.
2. Por cada orden, busca la `user_request` por el PIN:
   `UserRequestAdditionalInformation` con `type_data like '%barcode%'` y
   `data_json->verification_token == order['pin']` (`InvoiceProcessCorbeta.php:60-63`).
3. Copia a la solicitud `purchase_amount = valorFacturado` (limpia comas) y
   `invoice_number = noFactura`.

**`UpdateOrdersFromCorbeta`** (cada 2h, `:34-99`) es el que hace avanzar la máquina de estados:
consulta órdenes de HOY, indexa por PIN (`keyBy('pin')`), y **si cambió el valor/factura** setea
`user_request_status_id = 26; // FACTURADO` (`:95`). El **estado 26 = "Facturado"** es la marca de
"el cliente ya compró en caja física" (homologado hacia el ecommerce como `PENDING PAYMENT`, ver §7).

**Confirmación a Bancolombia** (cierre del ciclo, solo en los dos `InvoiceProcess*`):
- Consumo (`InvoiceProcessCorbeta`, lender 100): arma el request con `purchase_date=fechaFacturacion`
  y `customer_validate_key` (de `LenderIntegrationFlow.data.loan_validate_key`) y llama
  **`BancolombiaConsumerLoan::consumoConfirmed()`** (`:89-90`). Éxito = `data.status == 'Recibida'`
  → `save()`. [BancolombiaConsumerLoan vive en el nodo `bancolombia`.]
- BNPL (`InvoiceProcessCorbetaBnpl`, lender 68): usa `order_id` de `latestLenderTransaction` y llama
  **`BancolombiaBnpl::bnplConfirmed()`** (`:87-88`).
- Tras confirmar, marca `purchaseCode.barcode_checked = true` (evita re-procesar el código).
- **`InvoiceProcessConfirm {user_request_id}`** (`InvoiceProcessConfirm.php`): variante MANUAL/puntual
  (recibe la UR por argumento), solo BNPL (lender 68), reintenta la confirmación `bnplConfirmed`
  usando `final_amount` en vez del valor facturado. Es la palanca de re-conciliación caso a caso.

---

## 7. Webhook de estado y reportes

- **`corbeta.webhook`** = `POST api/corbeta/get-request` →
  `UserRequestController::consultUserRequestCorbeta` (`application/routes/api.php:72-78`, middleware
  `ability:corbeta`; controller `.../Api/UserRequestController.php:103`). Es el endpoint que el
  ecommerce de Corbeta consulta para el **estado del pago**: busca por `order_key`/`user_request_id`
  (allied ∈ [209,210,211]), homologa el estado interno a un vocabulario ecommerce
  (`homologateStatus`, `:16-49`: 11/27→COMPLETED, 6/24→FAILED, 7/8/12/20→CANCELLED, **26→PENDING
  PAYMENT**, resto→PENDING PAYMENT), y responde con `recaudador='bancolombiacreditop'`, nit y
  entidad `BPL|CON`. (El otro webhook, `checkout.processWebhookCorbeta`, es un **stub** que solo
  eco-devuelve el payload.)
- **Reporte de conciliación**: `CorbetaConciliationReportCommand` → `CorbetaConciliationReportController::sendReport()`
  (lock en cache 10 min, dispara `ConciliationReportEmail` a `santiago@creditop.com`).
- **`UserRequestsCorbetaExport`** (`application/app/Exports/UserRequestsCorbetaExport.php`): export
  XLSX de solicitudes Corbeta (default allied [209,210,211]) con **tabla de comisiones hardcodeada
  por millón** — Consumo (lender 100) = comisión de la tabla partida 50/50 Corbeta/CreditOp; BNPL
  (lender 68) = 1% CreditOp + 0.5% BCOL. Columnas incluyen `valorFacturado corbeta`, número de
  factura y estado. Se sube a S3.

---

## Fronteras (qué NO duplicar acá)

- **Padre `merchants`**: alta y configuración de comercio/sucursal, `lenders_by_allieds` /
  `lenders_by_allied_branches`, la copia de reglas por sucursal, credenciales de ecommerce. Acá sólo
  vive lo **distintivo** de Corbeta: el gate `corbeta_allieds`, el PIN de caja y el ciclo batch.
- **Nodo `bancolombia`** (bajo `aggregator`, hermano-cruzado): **todo el lado prestamista** — las Actions
  (`Bancolombia`, `BancolombiaBnpl`, `BancolombiaConsumerLoan`, `…OfferEvaluation`), los 23 endpoints de
  originación, JWT RS256 + mTLS, los escenarios sandbox y el `purchase-code/generate` de legacy-backend.
  Corbeta **invoca** `BancolombiaBnpl::bnplConfirmed()` y `BancolombiaConsumerLoan::consumoConfirmed()`
  pero esas clases son de ese nodo.
- **Nodo `aggregator`**: maquinaria genérica rt=1 (`PreApprovedLenderService`, `LenderRetrievalService`,
  `Integration.php`, y las Actions de Sistecrédito, Welli, Addi, Meddipay, BancoDeBogotá).
- Todo el árbol React de `bancolombia-origination` / `lenders-marketplace` (pre-aprobación, retry,
  transaction-status, purchase-code Bancolombia) es genérico aggregator; aquí solo viven los 4
  archivos ecommerce/cancel específicos de Corbeta.
- **Post-desembolso / servicing genérico** → nodo `servicing`. Corbeta solo aporta su conciliación/
  facturación batch propia (los crons de arriba) hasta el estado 26 + confirmación a Bancolombia; lo
  que pase después de `Recibida` es del lender / servicing.
- `config/services.php`, `Modules/Onboarding/routes/api.php` y `application/routes/api.php` son
  archivos compartidos: se listan por sus **líneas Corbeta**, no como propiedad exclusiva del nodo.
