# ESTADO DE LA MIGRACIÓN — `application` → `legacy-backend` (+ frontend-monorepo)

> **Dueño de:** el **estado de la migración** del dominio de originación desde el monolito `application`
> hacia `legacy-backend` + el wizard `frontend-monorepo`. *Qué se reconstruyó, dónde corre hoy, y qué
> sigue en el monolito*, por módulo, con lógica de negocio y archivos. No re-documenta el *qué/por qué*
> del negocio (eso es [CREDITOP.md](../CREDITOP.md)) ni la mecánica por flujo ([REFERENCIA-FLUJOS.md](./REFERENCIA-FLUJOS.md)).
>
> **Fecha:** 2026-06-17 · **Método:** auditoría multi-agente (3 workflows, ~88 agentes) sobre los 3 repos,
> con **verificación adversarial** del status de cada módulo. Citas `file:line` del barrido (best-effort).

---

## 0. La forma de la migración: strangler fig en **parallel-run** (no es un corte cerrado)

Lo más importante para no perder contexto: **`application` NO está apagado ni en desmonte pasivo.**

- **Legacy-backend ya RECONSTRUYÓ** el núcleo de originación (CreditopX, ecommerce/VTEX, identidad, cuota
  inicial, IMEI-locking, SmartPay forms, notificaciones, documentos). Ese código es **self-contained** (no
  llama a `application` en runtime — ver eje "dependencia" abajo) y está **validado e2e** por el harness.
- **PERO `application` mantiene copias PARALELAS, vivas y no comentadas** de casi todo, y es el **runtime por
  defecto**. Ambos repos están activos (último commit `application` 2026-06-12, `legacy` 2026-06-17).
- **El cutover es por-comercio (allowlist):** la entrada ecommerce solo redirige a legacy si el `allied_id`
  está en una lista **hardcodeada y creciente** — `application/app/Http/Controllers/Customer/WoocommerceController.php:44-48` → `[24, 209, 210, 211, 311]` (Corbeta + kalley; el `311` lo agregó el commit `265540d4`, 2026-06-11). Para **cualquier otro comercio**, el checkout y el resto del tronco corren **íntegros en `application`**.

> **Dos ejes que NO hay que confundir** (los dos verificados):
> | Eje | Pregunta | Estado |
> |-----|----------|--------|
> | **Dependencia** | ¿`legacy` *necesita* a `application` en runtime? | **NO** — 0 llamadas de código `legacy→application` (ver [FLUJO-CREDITOPX-Y-DEPS-APPLICATION.md](./FLUJO-CREDITOPX-Y-DEPS-APPLICATION.md)). El acople es `application→legacy`. |
> | **Cutover / completitud** | ¿el flujo corre **100% en legacy** y se puede **apagar** la copia de `application`? | **NO todavía** — copias paralelas vivas + ruteo por-comercio. Es lo que documenta este archivo. |
>
> Dicho simple: **legacy ya puede; `application` todavía corre.** Apagar el monolito = terminar el **cutover** + **decomisar** las copias paralelas + **reconstruir** lo que aún no existe en legacy (webhooks de agregadores, panel/SSO, cartera).

---

## 1. La esencia (recordatorio) y el alcance

Creditop = orquestador de **crédito en el punto de venta** con **dos sombreros** (ver [CREDITOP.md](../CREDITOP.md)):
**bróker** (rt=0 UTM, rt=1 Integración, rt=4 async) vs **prestamista propio Creditop X** (rt=2/3 in-platform → **Estado 11 = Autorizada**).

**Alcance de esta migración** (NEGOCIO §7): **IN** = Onboarding + Lenders Marketplace + Loan Origination/Creditop X. **OUT** (post-desembolso) = Loan Servicing, Billing & Collections, y el Perfilador (decisión de riesgo).

**La frontera dura de testeo/migración** ([synth-lender-type-boundary]): **rt=2/3 in-platform = Creditop decide y cierra** (inyectable, migrable, verificable) ⟷ **rt=1 integración = decide un tercero por API** (no inyectable; es el rol bróker; es lo que más ata al monolito).

---

## 2. Tabla maestra (estado verificado por módulo)

Estado: 🟢 **reconstruido en legacy** (código listo + validado; falta cutover/decomiso) · 🟡 **parcial** (parte en legacy, parte aún viva en application) · 🔴 **solo en application** (no reconstruido en legacy).

| # | Módulo | Estado | Legacy tiene… | application todavía corre… |
|---|--------|:------:|---------------|----------------------------|
| 1 | **Tronco común** (entrada, OTP, personal, laboral, marketplace) | 🟡 | el wizard pega a legacy (`VITE_API_URL`) | el checkout+tronco de **todo comercio fuera del allowlist** |
| 2 | **CreditopX cierre rt=2/3** (pagaré, firma OTP, authorize, Estado 11) | 🟢 | flujo completo self-contained | **copia paralela completa** (canal web) |
| 3 | **Validación biométrica** (ADO, Tusdatos, CrossCore) | 🟡 | módulo `Identity` completo (canal API/mobile) | callbacks ADO + state-machine + **fallback local** |
| 4 | **Ecommerce / VTEX** (contrato base64, notificador, observer) | 🟢 | migrado y completo (este trabajo) | `Api/VtexController` **paralelo activo** |
| 5 | **Agregadores rt=1 + webhooks entrantes** | 🔴 | controllers **copiados pero SIN ruta** (muertos) | **todos** los webhooks entrantes de los proveedores |
| 6 | **Cuota inicial (Wompi)** | 🟢 | flujo completo (polling, sin webhook) | — (recaudo Pullman sí, ver #10) |
| 7 | **IMEI / Motai / device-locking** | 🟡 | mecánica de locking (cron/jobs/Trustonic) | **captura de IMEI** + pago con ramas IMEI (UI Vue) |
| 8 | **SmartPay RD** (formulario dinámico) | 🟡 | dynamic-forms + micro + Redis + backdoor | el **paso IMEI** del onboarding SmartPay |
| 9 | **Documentos / firma** (pagaré, Deceval, Netco, PdfMapper, S3) | 🟡 | canal **API/mobile** completo | canal **web (Inertia)** paralelo completo |
| 10 | **Recaudo / pagos** (`pullman_db`, CreditopXPayment) | 🔴 | — | recaudo Pullman + aplicación de pagos |
| 11 | **Notificaciones** (Twilio/WhatsApp, autogestión) | 🟡 | `sendSelfManagement` migrado y funcional | `/enviar-mensaje-autogestion` paralelo activo |
| 12 | **Cartera / cobranza / facturación** (post-desembolso) | 🔴 | — | **todo** el cron de billing/collections |
| 13 | **Panel asesor/admin + SSO aliados** | 🔴 | — | el panel Inertia/Vue + `/sso/cognito-login` |

**Veredicto en una línea:** el **núcleo prestamista (Creditop X) y el ecommerce ya están reconstruidos en legacy y validados**; lo que **mantiene vivo al monolito** son (a) el **cutover incompleto** (copias paralelas + allowlist por comercio), (b) el **rol bróker (agregadores rt=1)** cuyos webhooks entrantes **no se rutean en legacy**, y (c) las **verticales post-desembolso** (cartera, panel admin) que **no se han reconstruido**.

---

## 3. 🟢 Reconstruido en legacy (código listo + validado · falta cutover/decomiso)

### CreditopX — cierre in-platform rt=2/3 (núcleo del negocio)
- **Negocio:** CreditOp **opera** el crédito in-platform (el capital lo pone el comercio; CreditOp cobra comisión por recaudo — ver [CREDITOP.md §1](../CREDITOP.md)); cierra con pagaré + firma OTP → Estado 11. Ver [REFERENCIA-FLUJOS.md §3](./REFERENCIA-FLUJOS.md).
- **Legacy (self-contained):** `Modules/Loans/.../ValidateOtpPromissoryNoteController.php:330` → `LoanAuthorizationService::authorize()` fija **Estado 11** (`LoanAuthorizationService.php:448-451`); notifica al comercio vía `EcommerceRequestService::notifyStoreForUserRequest` (`EcommerceRequestService.php:470`) + `UserRequestObserver` (`app/Observers/UserRequestObserver.php:50-53`, `#[ObservedBy]` en `app/Models/UserRequest.php:14`). **Sin llamadas a application.**
- **application (copia paralela viva):** `routes/customer.php:78-95` (flujo pagaré web completo), `ValidateOtpPromissoryNoteController.php:124-133` (fija status 11), `PromissoryNoteController.php` (1020 líneas, commits recientes), `WoocommerceController.php:231` (notifica el `process_url`). **No decomisado.**

### Ecommerce / VTEX (este trabajo — contrato base64 unificado)
- **Negocio:** unificar la generación de la URL de checkout (base64) y la notificación al comercio para Woo/VTEX/self, por un punto único. Ver [vtex-migration-legacy].
- **Legacy (migrado y completo):** `Modules/Onboarding/.../VtexController.php` (adapter → `VtexService`), estrategia `Modules/Onboarding/App/Services/Ecommerce/{EcommerceNotifier,VtexNotifier,WooCommerceNotifier,SelfDevelopmentNotifier,EcommerceContractBuilder}.php`, `UserRequestObserver` (punto único), `EcommerceSimulatorController`, rutas `Modules/Onboarding/routes/webhooks.php:25-34`.
- **application (paralelo activo, sin deprecación):** `app/Http/Controllers/Api/VtexController.php:25-206` (`init()` crea el `EcommerceRequest`, `settel()` aprueba Estado 11), rutas `routes/api.php:149-153`.

### Cuota inicial vía Wompi
- **Legacy (completo, autocontenido):** `Modules/Loans/.../InitialFeePaymentController.php` + `InitialFeePaymentService.php`, rutas `Modules/Loans/routes/api.php:60-66`. **Wompi por POLLING** (`InitialFeePaymentService.php:333` `StatusCheck::dispatch` → `Actions\Lenders\Wompi::updateStatus`), **no webhook entrante** → no necesita application.

---

## 4. 🟡 Parcial (legacy tiene una parte; application sigue siendo necesario en runtime)

### Tronco común (entrada → marketplace)
- **Legacy:** el wizard nuevo (`frontend-monorepo`) pega a legacy (`VITE_API_URL`); endpoints `api/onboarding/loan-application/*` en `Modules/Onboarding`.
- **application (default runtime):** salvo allowlist, la entrada ecommerce y todo el tronco corren en application: `WoocommerceController.php:44-48` (allowlist), `:183` → `customer.register.cell-phone.index`; `routes/customer.php:116-144,169` (`registrar-celular`, `validar-otp`, `informacion-personal`, `informacion-laboral`, `formulario-perfilamiento`, `entidades-v2`), controllers tocados 2026-06-03 ("v2 fixes"). **El path migrado es minoritario (per-merchant).**

### Validación biométrica / identidad (ADO · Tusdatos AML · CrossCore)
- **Legacy:** `Modules/Identity/routes/api.php` (ADO enroll/callback, AML, document/face, validation-status) + CrossCore `Modules/Onboarding/routes/webhooks.php:10-12`. Eventos `Ado\StatusChanged` / `Tusdatos\BackgroundJobResolved` al canal `App.Models.UserRequest.{id}`.
- **application (no prescindible):** `routes/customer.php:302-305` (ADO enroll/callback — **el vendor hace callback HACIA application**), integraciones directas `app/Actions/RiskCentrals/{Ado,Tusdatos}.php`, state-machine + dispatch en `ValidateIdentityController`, y **fallback local** `ValidateIdentityController.php:251`. Solo el document/face-match se delega a legacy (`IdentityApiClient`).

### Documentos / firma legal (pagaré · Deceval · Netco · PdfMapper · S3)
- **Legacy (canal API/mobile):** `Modules/Loans/routes/api.php:69-82` (promissory-note show/verify-otp/disburse), `PromissoryNoteController.php` (Netco lender 24 `:94-120`, factory Deceval, `PdfMapperClient`, S3), `DecevalPromissoryNoteService.php:119`.
- **application (canal web Inertia, paralelo completo):** `routes/customer.php:79-95`, `PromissoryNoteController.php:298-308`.

### IMEI / Motai / device-locking
- **Legacy (mecánica de locking):** cron `app/Console/Kernel.php:15-17` (lock/unlock/unroll), comandos + jobs (`DeviceLockStatusJob`, `DeviceUnrollJob`), `DeviceLockingApiClient.php` (Trustonic), enroll/validate IMEI `Modules/Loans/.../DeviceController.php:30`, `Abaco.php`.
- **application (necesario):** captura de IMEI `routes/customer.php:259` (`registrar-imei`) → `UserRequestController.php:1610`, con UI viva (`RequestsTable.vue`), y pago con ramas IMEI.

### SmartPay RD (`country_id=60`)
- **Legacy:** `DynamicFormsService.php`, `DynamicFormsRepository.php:53-79` (micro `onboarding-forms-service`), sesión Redis `dynamic-form:` (`DynamicFormSessionService.php`), backdoor (`Modules/Onboarding/routes/api.php:150-157`).
- **application (necesario):** el **paso IMEI** del onboarding SmartPay (commit `76007263` "redirects smartpay", 2026-03-20, ruta activa).

### Notificaciones (Twilio/WhatsApp · autogestión)
- **Legacy (funcional):** `UserRequestService.php:604-605` → `NotificationService::sendSelfManagement` → `TwilioMessagingService.php:44`.
- **application (activo):** `routes/customer.php:146` `/enviar-mensaje-autogestion` → `ConfirmationController.php:80,92`.

---

## 5. 🔴 Solo en `application` (no reconstruido en legacy)

### Agregadores rt=1 — webhooks entrantes (⚠️ el bloqueo del rol bróker)
- **Negocio:** rt=1 = bróker; el tercero (Bancolombia, Sistecrédito, Welli, …) decide en su portal y **avisa por webhook entrante**. Frontera: **no inyectable** ([synth-lender-type-boundary]).
- **application (único runtime):** **todas** las rutas de webhook entrante activas en `routes/api.php` — Bancolombia bnpl/consumer-loan (`20-22`), Payvalida (`45`), Prami (`49`), Meddipay (`58`), Sistecrédito (`92`), Approbe (`96`), Banco de Bogotá (`108`), Welli (`117`).
- **Legacy:** las **clases** controller existen copiadas (`app/Http/Controllers/Api/{ApprobeController,BancolombiaController,PayvalidaController}.php`, `Modules/Risk/.../SistecreditoController.php`) **pero NINGUNA ruta las bindea → código muerto/huérfano.** Falta **rutear y cablear** estos webhooks en legacy.

### Recaudo / aplicación de pagos (`pullman_db`)
- **application:** `app/Http/Controllers/Admin/CreditopXPaymentController.php:605+` + conexión secundaria `pullman_db` (SQL Server del partner). Legacy tiene la capa `PullmanRepository`/`PullmanService` pero **sin callers** (stub). No migrado.

### Cartera / post-desembolso / cobranza / facturación (fuera de alcance origination)
- **application (todo el motor):** cron diario en `app/Console/Kernel.php:28-36` — `app:update-creditop-x-requests-command` (00:30, corte/mora/facturación), `app:update-creditop-x-apply-payment-command` (03:30), `app:update-creditop-x-revolving-credits-command` (04:00), `app:update-creditop-x-remove-outstanding-balances` (00:10), `app:reminder-creditop-x-requests-command` (09:30). Panel `routes/admin.php` `/facturacion-y-recaudo`. **Legacy: nada.** (Es el subdominio Loan Servicing + Billing, OUT del alcance de originación.)

### Panel asesor/admin + SSO aliados
- **application (Inertia/Vue):** `routes/admin.php` (206 líneas, panel admin) + **SSO** `routes/customer.php:35` `/sso/cognito-login` → `SsoCognitoController.php:23-95` (valida access_token Cognito + HMAC, `Auth::login` rol Comercial, redirige al simulador del panel). Commit `9e322698` (2025-11-17). **El wizard nuevo hace de bridge HACIA application** para que el asesor use el panel viejo (los links "Solicitudes"/"Créditos Originados").

---

## 6. Reconciliación con el doc de dependencias
[FLUJO-CREDITOPX-Y-DEPS-APPLICATION.md](./FLUJO-CREDITOPX-Y-DEPS-APPLICATION.md) concluyó "**0 dependencias de código `legacy→application`**" y "CreditopX migrado". Eso es el **eje dependencia** (legacy no *llama* a application) y **sigue siendo cierto**. Este doc agrega el **eje cutover**: aunque legacy no dependa de application, **application todavía CORRE las copias paralelas y es el default**. Ambas cosas son verdad: *legacy ya puede; el monolito todavía está encendido.*

---

## 7. Documentos relacionados
- **[PENDIENTES-MIGRACION.md](./PENDIENTES-MIGRACION.md)** — qué falta para apagar `application`, priorizado.
- **[CREDITOP.md](../CREDITOP.md)** — la esencia (dos sombreros, `response_type`, ciclo de vida).
- **[REFERENCIA-FLUJOS.md](./REFERENCIA-FLUJOS.md)** — mecanismo técnico por flujo.
- **[MAPA-FLUJOS.md](./MAPA-FLUJOS.md)** — encadenamiento FE↔BE.
- **[FLUJO-CREDITOPX-Y-DEPS-APPLICATION.md](./FLUJO-CREDITOPX-Y-DEPS-APPLICATION.md)** — biométrica/espera + eje dependencia.
- **[MODELO-DATOS.md](./MODELO-DATOS.md)** · **[LOGICA-QUEMADA.md](./LOGICA-QUEMADA.md)** — datos + hardcodes.
