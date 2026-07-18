# Payments · contexto
> **estado:** al día con main · La **integración de pasarela** (Wompi / Payvalida): el borde donde entra y sale la plata. Vive **partida** entre dos usos: la **cuota inicial** de formalización (enganche antes de desembolsar) y el **recaudo** de servicing (pagar el crédito ya desembolsado). Corre en `application` (vivo) con copia migrada en `legacy-backend`.

## Qué es
Es la capa "cómo hablamos con la pasarela": crear la transacción, firmar la integridad, mandar al checkout, y **enterarse del resultado**. Dos pasarelas, dos modelos de confirmación opuestos:
- **Wompi** (lender_id **52**): confirmación por **polling** (jobs `StatusCheck`, `tries=60`, `ttl=18000s`). Sirve para **AMBOS** usos — cuota inicial (`creditop_x_payment_type_id=1`) y recaudo del préstamo (pago a consumo o a cupo rotativo).
- **Payvalida**: confirmación por **webhook** entrante (`POST` a `PayvalidaController::webhook`). En el código actual conduce la **originación** al Estado **11 AUTORIZADA** (más cerca de un desembolso/aprobación que de un recaudo). No hace polling.

El mismo `PaymentGatewayTransaction` (tabla propia de Wompi) transporta los dos usos; el campo `creditop_x_payment_type_id` decide el destino (1 = cuota inicial → recorta el monto del crédito; distinto de 1 = pago → cae a la cascada de imputación de servicing).

| Pregunta | Respuesta |
|---|---|
| ¿Qué pasarelas hay? | **Wompi** (recaudo + cuota inicial, polling, lender 52) y **Payvalida** (webhook, empuja a Estado 11). Sistecrédito es integración de **lender BNPL**, no pasarela de recaudo propia (→ `agregadores`). |
| ¿Wompi cómo confirma? | **Polling**: el front/job re-consulta `GET /transactions?reference=` hasta ver `APPROVED/DECLINED/VOIDED/ERROR`. **No hay webhook de Wompi**. |
| ¿Payvalida cómo confirma? | **Webhook**: Payvalida hace `POST` con `po_id`; el controller re-consulta la orden y mapea `STATE`→`user_request_status_id`. |
| ¿Dónde vive? | **Vivo en `application`**. `legacy-backend` tiene copia (misma `Actions/Lenders/Wompi.php` con el dd, + `InitialFeePaymentService` reescrito en Modules/Loans + `Modules/Payments` para links). |
| ¿Simulable? | Sí para in-platform: sembrar `PaymentGatewayTransaction` en `APPROVED` o `dispatchSync(StatusCheck)`. El seam de aplicar el pago es de `servicing`. |

## Contenido
**Flujo Wompi — cuota inicial (formalización):**
1. **Origen del bounce (rt=2 con `initial_fee>0`):** en el wizard, al elegir un CreditopX in-platform que exige enganche, el flujo desvía al paso de cuota inicial (`useInitialFee.ts` computa `requiresInitialFee`/`minRequiredInitialFee`; `InitialFeeForm.tsx` valida `value >= minRequiredInitialFee`). Ver `available-lenders.tsx` (border con marketplace/profiling).
2. **Iniciar pago:** `WompiController::store` (app) / `InitialFeePaymentService::initiatePayment` (legacy) crea un `PaymentGatewayTransaction` PENDING, arma la **firma de integridad** (`Wompi::createSignature`, SHA256 sobre `reference+value+'COP'[+expiration]+wompi_integrity`), y redirige a `services.wompi.checkout.host?...` con `redirect-url` de vuelta a `initial_fee_payment.response`. Despacha `StatusCheck`.
3. **Polling:** `StatusCheck` (cola `high`, `tries=60`, `backoff=2**attempts`, `ttl=18000s`, `release(10)` mientras PENDING) llama `Wompi::updateStatus`, que hace `GET /transactions?reference=` con `wompi_private` y mapea el status.
4. **Al aprobar (cuota inicial):** `Wompi::updateStatus` (app `:367`) recalcula el monto del crédito: `final_amount = (original_amount − paid_amount) + costos_administrativos`, escribe `initial_fee=paid_amount`, dispara `BackgroundJobResolved` + `SendReturnInitialFeeMessage` (delay 1 min). `InitialFeePaymentController::validatePayment` crea el `CreditopXPaymentRegister` (`payment_type_id=7`, `payment_method='PSE'`). `LogReturnWompiInitialFee` marca el retorno al ecommerce.
5. **Confirmación:** `paymentConfirmation` renderiza y sella `LogReturnWompiInitialFee.returned=true`.

**Flujo Wompi — recaudo (servicing):**
- `WompiController::selectProduct/create/store` es el **portal público de pago** (`customer/payment/*`): el cliente busca su crédito por documento (`lookup`), elige producto (consumo `CreditopXRequestHistory` o rotativo `RevolvingCredit`), paga vía checkout. Al aprobar, `Wompi::updateStatus` **NO** es cuota inicial → delega a `CreditopXPaymentController::processPayment` (consumo) o `CreditopXRevolvingCreditPaymentController::processPayment` (cupo). **Ese `processPayment` (cascada de imputación) es de `servicing`.**

**Flujo Payvalida (webhook):**
- `Payvalida::register` crea la orden (`POST {host}/api/v3/porders`, checksum SHA512, método default `bnplbancolombia`) y devuelve la `url` de checkout.
- `PayvalidaController::webhook` (`:73`) recibe el `po_id`, re-consulta la orden, y si `user_request_status_id != 11` mapea `DATA.STATE`: `APROBADA`→**11** (+ `generateVoucher` + `updateDisbursedLender(...,8)` + `Woocommerce::process` si ecommerce), `ANULADA`→6, `VENCIDA`→7, `PENDIENTE`→10, `CANCELADA`→8. Notifica al usuario (`TransactionStatusChanged`).

**Reconciliación / red de seguridad:**
- **`legacy-backend` `ReconcileWompiTransactionsCommand`** (`app:reconcile-wompi-transactions --hours --dry-run`): NUEVO en legacy; barre `PaymentGatewayTransaction` PENDING de las últimas N horas y re-consulta Wompi (usuario pagó pero no volvió / job murió). `usleep(200ms)` entre llamadas.
- `AddInitialFeePayments` (app, `app:update-initial-fee-payments`): backfill que re-procesa transacciones `creditop_x_payment_type_id=1`.
- `PaymentLinksUpdateCommand` (`app:payment-links-update-command`): expira links vencidos (`status=0`).
- (El cron 00:02 `UpdateCreditopXNotAppliedWompiPaymentCommand`, red de seguridad del polling de recaudo, lo documenta **`servicing`**.)

**Links de pago (recaudo self-service):**
- `application`: `PaymentLink` + `UserRequestByPaymentLink`, `Customer/PaymentLinkController` + `Admin/PaymentLinkController`.
- `legacy-backend` `Modules/Payments`: módulo Laravel-Modules propio (`PaymentLinkController` CRUD admin, `CustomerPaymentLinkController` acceso público por token, `PaymentLinkService`/`CustomerPaymentService`/`PaymentLinkUrlService`). ⚠ Crea/gestiona links pero **no imputa al ledger** (eso es servicing).

## Estados y códigos
- **`PaymentGatewayTransaction`** (Wompi): `status_id`→`LenderTransactionStatus` (nombres `PENDING/APPROVED/DECLINED/VOIDED/ERROR`, filtrados por `lender_id=52`). Campos clave: `creditop_x_payment_type_id` (**1 = cuota inicial**, otro = pago), `principal_payment_type_id` (a capital/cuota), `user_request_id` (0 si es cupo rotativo), `creditop_x_revolving_credit_id`, `order_id` (= `reference` UUID que Wompi ecoa).
- **`PayvalidaTransaction`** → `PayvalidaTransactionStatus` (`PENDIENTE/APROBADA/ANULADA/VENCIDA/CANCELADA`, español); mapea a `user_request_statuses` (11/6/7/10/8).
- **`status_id` mágicos en `InitialFeePaymentController` (app):** `22` = aprobado, `21` = pending — **hardcodeados** (no vía nombre). Diverge del resto que resuelve por `LenderTransactionStatus::where('name',...)`.
- **Idempotencia (solo en app `Wompi::updateStatus`):** 3 candados antes de aplicar — `previousStatusId===status` (ya estaba APPROVED), existe `CreditopXPaymentRegister`, existe `LogReturnWompiInitialFee`. La copia de `legacy-backend` **no** tiene estos candados en su path real (tiene en cambio un `mockUpdateStatus` de staging).
- Catálogo de `user_request_statuses` (11 Autorizada, etc.) → raíz / `servicing`.

## Sistemas externos
- **Wompi** (`services.wompi.host` = API, `services.wompi.checkout.host` = widget de checkout). Credencial **por sucursal** en `LenderAlliedCredential` (`wompi_public`, `wompi_private`, `wompi_integrity`, `wompi_method`). Auth mixta: `withToken(wompi_public)` para crear, `withToken(wompi_private)` para consultar; algunos GET van **sin auth** (comentario textual en el código: *"For some strange reason, Wompi do not authenticate the user using this method."*).
- **Payvalida** (`services.payvalida.host`, `PAYVALIDA_SERVICE_CODE`, `PAYVALIDA_ENTITY_CODE`). Credencial por sucursal: `payvalida_merchant_id`, `payvalida_client_secret`, `payvalida_method`. Country `343` (Colombia), checksum SHA512.
- **PSE / bancos** los expone la pasarela; CreditOp no toca medios de pago directamente (nunca ve tarjeta).

## Dónde mirar
- **Integración Wompi** (app): `app/Actions/Lenders/Wompi.php` (`createSignature`, `register`, `getMerchant` ⚠dd, `getTransaction`, `updateStatus` = el seam), base `app/Actions/Lenders/Integration.php` (`handleException`).
- **Integración Payvalida** (app): `app/Actions/Lenders/Payvalida.php` (register/checksum), `app/Http/Controllers/Api/PayvalidaController.php` (webhook → Estado 11), `app/Http/Requests/Api/Payvalida/WebhookRequest.php`, `Notifications/Payvalida/TransactionStatusChanged.php`, `Mail/Lenders/Payvalida/UnsuccessfulTransaction.php`.
- **Polling / jobs** (app): `Jobs/Lenders/Wompi/{StatusCheck,CheckStatus,CheckForPaymentLink,SendReturnInitialFeeMessage}.php`, `Events/Lenders/Wompi/{BackgroundJobResolved,PaymentLinkReady}.php`.
- **Cuota inicial — backend** (app): `Http/Controllers/Customer/InitialFeePaymentController.php` (show/response/validatePayment/paymentConfirmation/retryPaymentValidation), `Http/Controllers/Customer/WompiController.php` (store = arma checkout + firma), `Http/Requests/Customer/WompiRequest.php`, `Models/LogReturnWompiInitialFee.php`, `Console/Commands/AddInitialFeePayments.php`.
- **Cuota inicial — migrado** (legacy-backend): `Modules/Loans/App/Http/Controllers/Customer/InitialFeePaymentController.php` (REST: show/initiate/response/validate/checkStatus/confirmation), `Modules/Loans/App/Services/InitialFeePaymentService.php` (⚠ `HACK staging auto-approve`), Requests `InitiateInitialFeePaymentRequest`/`ShowInitialFeePaymentRequest`.
- **Modelos / esquema** (app): `Models/PaymentGatewayTransaction.php`, `LenderTransaction.php`, `LenderTransactionStatus.php`, `PayvalidaTransaction.php`, `PayvalidaTransactionStatus.php`. Migraciones: `create_payment_gateway_transactions_table`, `add_payment_type_to_payment_gateway_transactions_table`, `create_log_return_wompi_initial_fee`, `create_payvalida_transaction_tables`, `create_lender_transactions_tables`, `add_initial_fee_to_user_requests_table`.
- **Links de pago** (app): `Http/Controllers/{Customer,Admin}/PaymentLinkController.php`, `Models/{PaymentLink,UserRequestByPaymentLink}.php`, `Console/Commands/PaymentLinksUpdateCommand.php`, migración `create_payment_links_table`. (migrado) `legacy-backend/Modules/Payments/*` (controllers + services + `routes/api.php` + `PaymentsServiceProvider`).
- **Front recaudo / cuota inicial** (app Inertia): `resources/js/pages/customer/payment/{wompi,products}.vue`, `resources/js/pages/customer/requestsCreditopX/{InitialFeePayment,InitialFeePaymentResponse}.vue`, `resources/js/pages/ecommerce/Checkout.vue`.
- **Front wizard** (frontend-monorepo): `lenders-marketplace/.../forms/InitialFeeForm.tsx`, `.../available-lenders/hooks/useInitialFee.ts`, `.../hooks/useLenderTransactionStatus.tsx`, `.../lib/application/get-lender-transaction-status.uc.ts` + `.../infrastructure/repositories/lender-transaction-status.repository.ts` (GET `/api/onboarding/loan-application/lenders/{ur}/{lender}/pre-approval-status`), `routes/.../available-lenders.tsx`.
- **Reconciliación** (legacy-backend): `app/Console/Commands/ReconcileWompiTransactionsCommand.php`.
- **Credenciales/config**: `application/config/services.php` + `legacy-backend/config/services.php` (bloques `wompi`, `payvalida`; ver también sistecredito/corbeta).

## 🐞 Bug P0 — `dd($exception)` colgado en Wompi (CONFIRMADO, VIVO en ambos repos)
El `dd()` **existe hoy** en el `catch` de `Wompi::getMerchant()` — mata la request y vuelca el excepción crudo en producción si la API de Wompi falla al traer el merchant:
- **`application/app/Actions/Lenders/Wompi.php:79`** → `dd($exception);` (antes de `return $this->handleException($exception);`, que queda inalcanzable).
- **`legacy-backend/app/Actions/Lenders/Wompi.php:78`** → idéntico `dd($exception);`.

Contexto textual (ambos):
```php
} catch (Exception $exception) {
    dd($exception);                              // ← P0: die+dump en prod
    return $this->handleException($exception);   // ← código muerto
}
```
Es el **único `dd()`** del dominio de pagos (no hay dd en `Payvalida.php` ni en los controllers). Efecto: cualquier fallo transitorio del endpoint `/merchants/{public-key}` de Wompi rompe el flujo con un dump en vez de degradar. Fix trivial (borrar la línea) pero **no aplicado** en ninguna de las dos ramas. Nota: hay un `//dd($wompiRequest);` **comentado** en `WompiController::store:174` (inofensivo) — no confundir con el activo.

## Fronteras (qué cede este nodo)
- **→ `servicing`:** la **cascada de imputación** (`CreditopXPaymentController::processPayment`, `CreditopXRevolvingCreditPaymentController::processPayment`), el ledger `creditop_x_requests_history`, los 6 crons post-desembolso (incl. `UpdateCreditopXNotAppliedWompiPaymentCommand` 00:02 y `apply-payment`), la contabilidad de mora/interés/FGA, el recaudo **Pullman** (SQL Server, canal aparte no-pasarela) y los reportes/exports de pagos. Regla: donde `updateStatus` llama `processPayment`, ahí termino yo y empieza servicing.
- **→ `formalization`:** el **formulario** de formalización (dynamic forms, KYC, promissory note, firma), el **cronograma de cuotas** (`PaymentSchedule*`, payment-date, first-payment-date) y el **voucher/comprobante**. Yo solo cubro el **paso de pago** de la cuota inicial (crear txn, firmar, redirigir, confirmar), no el cálculo del enganche mínimo (`LenderUserCategoryService` → viene de config de categoría) ni el resto del wizard.
- **→ `aggregator`/`profiling`:** la **decisión de lender** y el ruteo del marketplace. `available-lenders.tsx` se incluye solo como **border** (es donde nace el desvío a cuota inicial); su lógica de selección/pre-aprobación es de esos nodos. **Sistecrédito** (Pay/Pos, webhook) es integración de **lender BNPL**, no pasarela de recaudo → `agregadores`.
- **→ `credifamilia`:** los `PaymentPlan/Credifamilia/*` (cálculo de plan/amortización SOAP) son suyos, no pasarela.

## Frontera de simulación / harness
- **Inyectable:** sembrar un `PaymentGatewayTransaction` en `APPROVED` (o `LenderTransactionStatus` id de APPROVED para lender 52) y `dispatchSync(StatusCheck)`; para cuota inicial, `creditop_x_payment_type_id=1` recorta el monto del crédito de forma síncrona. Payvalida: simular el `POST` del webhook con un `po_id` de una `PayvalidaTransaction` sembrada.
- **Staging bypass:** `InitialFeePaymentService::processPaymentResponse` (legacy) y `InitialFeePaymentController::response` (app) **auto-aprueban** en `env=staging` (saltan el sandbox de Wompi). Ojo al probar contra staging: el pago "pasa" sin plata real.
- **Relevante al OKR:** el polling no tiene webhook de Wompi → la salud depende de jobs + crons de reconciliación; las excepciones notifican a **`laura.cabra@creditop.com` hardcodeado** (~4 sitios en `Wompi::updateStatus`) sin alerting estructurado. Punto natural para instrumentar salud de pasarela (tasa de PENDING colgados, latencia de confirmación).

## Datos de prueba / usuario que pasa
- **Cuota inicial:** `UserRequest` de un lender in-platform (rt=2) cuya categoría tenga `min_initial_fee>0`; `LenderAlliedCredential` con `wompi_public/private/integrity` de la sucursal. La txn nace PENDING; para "pagar" sin Wompi, poné `status_id` al APPROVED de lender 52 y corré `StatusCheck`/`validatePayment`.
- **Recaudo:** usuario con `CreditopXRequestHistory status=1` (consumo) o `RevolvingCredit` (cupo); buscar por documento en `customer/payment/lookup`.
- **Payvalida:** `PayvalidaTransaction` con `order_uuid` conocido + credencial `payvalida_merchant_id/client_secret`; disparar el webhook con `po_id`.

## Gotchas / riesgos
- 🐞 **`dd($exception)` vivo** en `Wompi::getMerchant` (app:79 / legacy:78) — ver sección P0.
- **Wompi NO tiene webhook** — todo es polling (`StatusCheck` + reconcile). Un job muerto = pago "colgado" hasta la reconciliación (o para siempre si la reconciliación no lo cubre; el cron 00:02 está hardcodeado a `lender_id=52`, ver servicing).
- **`status_id` hardcodeados `22`/`21`** en `InitialFeePaymentController` (app) en vez de resolver por nombre — frágil si cambian los ids de `LenderTransactionStatus`.
- **Idempotencia asimétrica app↔legacy:** los 3 candados anti-doble-cobro solo están en `application`. La copia de legacy tiene un `mockUpdateStatus` (staging) pero su path real no replica los guards → riesgo de re-imputar si se activara.
- **Wompi = lender 52 mágico** disperso (updateStatus, reconcile, cron): la pasarela se modela como un "lender" en `LenderTransactionStatus`/`LenderAlliedCredential`. Otra pasarela nueva requeriría clonar ese acoplamiento.
- **`user_request_id=0` = cupo rotativo** (sentinel, no null) en `PaymentGatewayTransaction` — ramifica todo el `updateStatus`/`WompiController`.
- **Auth Wompi inconsistente**: crear con `wompi_public`, consultar con `wompi_private`, y algunos GET sin token (documentado como rareza de Wompi en comentarios del código).
- **Payvalida webhook empuja originación** (a Estado 11 + voucher + Woocommerce) — es más "desembolso/aprobación" que "recaudo"; cruza con el nodo de originación/agregadores. El `generateVoucher`/`updateDisbursedLender` que dispara son de esos nodos.
- **Costos administrativos** se recalculan al aprobar la cuota inicial (`administrative_costs_percentage` de `LendersByAllied`) — cambia `final_amount`/`amount` del crédito; efecto de negocio escondido en `Wompi::updateStatus`.

## Preguntas abiertas
- [ ] ¿El `dd()` de `getMerchant` alguna vez se ejecuta en prod, o `getMerchant` está muerto? (¿quién llama `getMerchant`? confirmar si el path está vivo — el riesgo depende de eso.)
- [ ] ¿La reconciliación (`ReconcileWompiTransactionsCommand`) está **agendada** en algún Kernel, o es manual? (no vista en `app/Console/Kernel.php` de legacy en este pase.)
- [ ] ¿Cuál pasarela gana en el cutover? La cuota inicial está reescrita como REST en legacy (Modules/Loans) pero el `Actions/Lenders/Wompi.php` es copia literal (con dd) — ¿legacy va a compartir la misma tabla `payment_gateway_transactions` que app en parallel-run?
- [ ] ¿Payvalida sigue activa o es legado? Solo aparece `bnplbancolombia` como método default — ¿queda algún comercio usándola para recaudo, o es solo la vía Bancolombia BNPL?
- [ ] Idempotencia de legacy: ¿se va a portar los 3 candados de app antes del cutover, o el mock es el plan?

## Diferencias vs otros flujos
- **vs `servicing`:** servicing es la **contabilidad** del pago (imputación, mora, causación, cierre). Payments es solo el **transporte** (hablar con Wompi/Payvalida). El seam exacto: `Wompi::updateStatus` → `processPayment`.
- **vs `formalization`:** formalization es el **formulario + cronograma + voucher**; payments es solo el **paso de pago** de la cuota inicial dentro de ese wizard.
- **vs `agregadores`:** Sistecrédito/Bancolombia son **lenders** que deciden y gestionan cartera externa; Payvalida/Wompi son **pasarelas** que mueven plata para CreditOp. (Payvalida borrosa: su webhook toca originación.)
- **vs `credifamilia`:** el `PaymentPlan/Credifamilia` es cálculo de amortización SOAP, no pasarela.

## Bitácora
- **2026-07-18** — Nodo creado. Superficie curada: **65 archivos** (application 41 · legacy-backend 18 · frontend-monorepo 6), 65/65 resuelven (0 DROP). **Bug P0 confirmado vivo**: `dd($exception)` en `getMerchant` catch, `application/app/Actions/Lenders/Wompi.php:79` y `legacy-backend/app/Actions/Lenders/Wompi.php:78` (idéntico, no fixeado). Hallazgo: Wompi=polling (2 usos: cuota inicial + recaudo), Payvalida=webhook (empuja Estado 11); idempotencia solo en app; `ReconcileWompiTransactionsCommand` es net-new en legacy.

## Enlaces
- Dónde CORRE: **Application** (vivo) + copia en **Legacy-backend** (cuota inicial reescrita REST + Modules/Payments para links + reconcile). De dónde recibe el trigger de cuota inicial: **Formalization** / **CreditopX**. A quién le entrega el pago aprobado: **Servicing** (`processPayment`).
- Frontera de pruebas global + catálogos de estado: raíz **CreditOp**. Memorias: `asesor-solicitar-bounce` (el rebote rt=2 `initial_fee>0`→Wompi) · `continuacion-credito-servicing` (la cascada que recibe el pago) · `reglas-comercio-lender-map`.
