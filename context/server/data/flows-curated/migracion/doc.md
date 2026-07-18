# Migración application→legacy · referencia
> **estado:** al día con main · Nodo de referencia sobre el estado de la migración application→legacy de la originación de crédito de CreditOp.

<!-- REFERENCIA = sustrato transversal (cuelga del group Plataforma). Autosuficiente: los datos duros están acá para no abrir docs/. -->

## Qué responde
- ¿Qué está migrado a legacy-backend y qué sigue vivo en application?
- ¿Qué falta para apagar el monolito application? (backlog priorizado P0-P3)
- ¿Por qué application sigue siendo el runtime por defecto? (allowlist por-comercio [24,209,210,211,311] en WoocommerceController)
- ¿Cuál es la diferencia entre el eje 'dependencia' (0, legacy no llama a application) y el eje 'cutover' (incompleto)?
- ¿Por qué los webhooks entrantes de agregadores rt=1 bloquean el apagado? ¿qué webhook falta rutear por lender?
- ¿Qué hardcodes/deuda técnica hay que remediar? (dd() vivo en Wompi, status 11 en 13 archivos, ids/montos/PII quemados)
- ¿Cómo se prueba/testea cada mitad de la migración? (rt=2/3 inyectable vs rt=1 con mocks de proveedor)
- ¿Qué está fuera del alcance de originación pero bloquea el apagado total? (cartera post-desembolso, panel+SSO)

## Qué es
Nodo de referencia sobre el estado de la migración application→legacy de la originación de crédito de CreditOp.

## Contenido
## Migración application→legacy — síntesis autosuficiente

**Forma:** strangler fig en **parallel-run**, NO corte cerrado. `application` (monolito Laravel/Inertia, root indexado `legacy-application`) sigue **encendido y es el runtime por defecto**. `legacy-backend` (Laravel modular) ya **reconstruyó** el núcleo de originación y es **self-contained** (0 llamadas `legacy→application` en runtime), validado e2e. El wizard nuevo (`frontend-monorepo`, React/TSX) pega a legacy vía `VITE_API_URL`.

**Cutover = por-comercio (allowlist HARDCODEADO):** solo redirige a legacy si `allied_id ∈ [24, 209, 210, 211, 311]` (Corbeta + kalley; el 311 lo sumó commit `265540d4`, 2026-06-11). Fuente: `application/app/Http/Controllers/Customer/WoocommerceController.php:44-48` (→ `:183` `customer.register.cell-phone.index`). Cualquier otro comercio corre ÍNTEGRO en `application`.

### Los 2 ejes que NO hay que confundir (ambos verificados)
| Eje | Pregunta | Estado |
|---|---|---|
| **Dependencia** | ¿legacy *necesita* a application en runtime? | **NO** — 0 llamadas de código legacy→application. El acople es application→legacy. |
| **Cutover/completitud** | ¿corre 100% en legacy y se puede apagar la copia paralela? | **NO todavía** — copias paralelas vivas + ruteo por-comercio. |

Regla: *legacy ya puede; el monolito todavía está encendido.* Apagar = terminar cutover + decomisar copias paralelas + reconstruir lo que no existe (webhooks agregadores rt=1, recaudo pullman_db, cartera, panel/SSO).

### Tabla maestra por módulo (13 filas) — 🟢 reconstruido+validado (falta cutover) · 🟡 parcial · 🔴 solo en application
| # | Módulo | Estado | legacy tiene | application todavía corre |
|---|---|:--:|---|---|
| 1 | Tronco común (entrada, OTP, personal, laboral, marketplace) | 🟡 | wizard pega a legacy | checkout+tronco de todo comercio fuera del allowlist |
| 2 | **CreditopX cierre rt=2/3** (pagaré, firma OTP, Estado 11) | 🟢 | flujo completo self-contained | copia paralela completa (canal web) |
| 3 | Validación biométrica (ADO, Tusdatos, CrossCore) | 🟡 | módulo Identity (canal API/mobile) | callbacks ADO + state-machine + fallback local |
| 4 | **Ecommerce/VTEX** (contrato base64, notificador, observer) | 🟢 | migrado y completo | `Api/VtexController` paralelo activo |
| 5 | **Agregadores rt=1 + webhooks entrantes** | 🔴 | controllers copiados **SIN ruta** (muertos) | TODOS los webhooks entrantes de proveedores |
| 6 | **Cuota inicial (Wompi)** | 🟢 | completo (polling, sin webhook) | — |
| 7 | IMEI/Motai/device-locking | 🟡 | mecánica de locking (cron/jobs/Trustonic) | captura IMEI + pago ramas IMEI (UI Vue) |
| 8 | SmartPay RD (formulario dinámico) | 🟡 | dynamic-forms + micro + Redis + backdoor | el paso IMEI del onboarding SmartPay |
| 9 | Documentos/firma (pagaré, Deceval, Netco, S3) | 🟡 | canal API/mobile completo | canal web (Inertia) paralelo completo |
| 10 | Recaudo/pagos (`pullman_db`, CreditopXPayment) | 🔴 | — | recaudo Pullman + aplicación de pagos |
| 11 | Notificaciones (Twilio/WhatsApp, autogestión) | 🟡 | `sendSelfManagement` migrado | `/enviar-mensaje-autogestion` paralelo |
| 12 | Cartera/cobranza/facturación (post-desembolso) | 🔴 | — | TODO el cron billing/collections |
| 13 | Panel asesor/admin + SSO aliados | 🔴 | — | panel Inertia/Vue + `/sso/cognito-login` |

**Veredicto:** núcleo prestamista (CreditopX) + ecommerce YA reconstruidos+validados en legacy. Lo que mantiene vivo al monolito: (a) cutover incompleto (copias paralelas + allowlist), (b) rol bróker (webhooks rt=1 sin rutear en legacy), (c) verticales post-desembolso (cartera, panel).

### Backlog priorizado (P0→P3)
- **P0.1 · Completar cutover CORE + decomisar copias paralelas.** Rutear TODOS los comercios (no solo allowlist) y eliminar en application: cierre CreditopX (`routes/customer.php:78-95`), VTEX (`Api/VtexController.php:25-206` + `routes/api.php:149-153`), tronco (`routes/customer.php:116-144,169`), documentos-web (`:79-95`), autogestión (`:146`).
- **P0.2 · Rutear+cablear webhooks entrantes agregadores rt=1 en legacy.** ⚠️ Las clases controller YA están copiadas en legacy pero **ninguna ruta las bindea = código muerto**. Cada webhook setea `user_request_status_id=11` **vía Eloquent** (update/save, NO query directa) → dispara `UserRequestObserver` → notificación saliente al comercio (esa mitad YA está migrada). No inyectable (decide un tercero); se prueba con mocks de la API del proveedor.
- **P1.1 · Identidad:** mover callback ADO (hoy vendor postea a `application/routes/customer.php:302-305`) + state-machine + fallback local (`ValidateIdentityController.php:251`) a legacy como único receptor.
- **P1.2 · Recaudo `pullman_db`:** migrar `Admin/CreditopXPaymentController.php:605+` + conexión SQL Server del partner. Legacy tiene `PullmanRepository`/`PullmanService` pero **sin callers** (stub).
- **P1.3 · Decomisar residuales:** documentos web, captura IMEI (`routes/customer.php:259`→`UserRequestController.php:1610`), SmartPay paso IMEI (commit `76007263`), notificaciones autogestión.
- **P2.1 · Cartera/post-desembolso** (Loan Servicing + Billing): OUT del alcance de originación pero bloquea el apagado TOTAL. Todo en cron `application/app/Console/Kernel.php:28-36`.
- **P2.2 · Panel asesor/admin + SSO:** el wizard nuevo hace de **bridge HACIA application** para que el asesor use el panel viejo (links "Solicitudes"/"Créditos Originados"). `SsoCognitoController.php:23-95`.
- **P3.1 · Infra compartida runtime:** application y legacy comparten nombres de env → posiblemente **misma RDS/Redis/Pusher** en prod (parallel-run = datos compartidos). Confirmar `DB_HOST`, `REDIS_HOST`, `PUSHER_*`, `SESSION_DOMAIN`/`APP_KEY`.
- **P3.2 · Instrumentar métricas** de avance por módulo (hoy contadores en 0, todo "% migrado" es cualitativo).

### Matriz webhooks entrantes rt=1 (código muerto = clase copiada sin ruta que la bindee)
Patrón fix: `Route::post('<lender>/webhook','<Lender>Controller@webhook')->name('api.<lender>.webhook')` SIN `auth:sanctum` (validar por firma del proveedor); confirmar que `webhook()` setea estado vía Eloquent.
| Lender | Ruta en application | Estado en legacy | Qué falta |
|---|---|---|---|
| **Approbe** | `routes/api.php:96` | `Api/ApprobeController.php::webhook()` (setea 11, ~`:89`) | **Solo rutear** |
| **Payvalida** | `routes/api.php:45` | `Api/PayvalidaController.php::webhook()` (~`:75`) | **Solo rutear** |
| **Banco de Bogotá** | `routes/api.php:108` | `Api/BancoDeBogotaController.php::webhook()` (~`:16/21`) | **Solo rutear** |
| **Sistecrédito** | `routes/api.php:92` | `Modules/Risk/.../SistecreditoController.php::webhook()` (setea 11, `:81-85`) | Rutear en `Modules/Risk/routes/api.php` (hoy VACÍO) + registrar en RouteServiceProvider. ⚠️ `SistecreditoPay.php:49` ya llama `route('api.sistecredito.webhook')` → **error en runtime** hasta crear la ruta |
| **Welli** | `routes/api.php:117` | `Modules/Onboarding/.../WelliController.php` solo tiene `updateAmount()`, **NO `webhook()`** | Portar `webhook()` desde `application/.../Api/WelliController.php:18-132` + rutear |
| **Prami** | `routes/api.php:49` | controller no confirmado | **Crear** controller + rutear |
| **Meddipay** | `routes/api.php:58` | controller no confirmado | **Crear** controller + rutear |
| **Bancolombia** (bnpl/consumo) | `routes/api.php:21-22` | `LoanAuthorizationService.php:463-465` (resuelve siempre 11) | **Verificar** si existe ruta webhook entrante; si no, rutear |

**Notificación SALIENTE (ya migrada):** `UserRequestObserver.php:50-58`, dispara con `STORE_NOTIFY_STATUSES=[6,7,8,11]` (constante en `UserRequestObserver.php:25`, **NO** en `config/ecommerce.php`). Registrado vía `#[ObservedBy]` en `app/Models/UserRequest.php:14`.

**Retorno del USUARIO (browser) ≠ webhook del RESULTADO:** para lenders por redirect (rt=1) el browser va al portal de la entidad y CrediOp SALE del camino; la ENTIDAD debe devolver al COMERCIO (`return_url`, no a CrediOp). El `return_url` se persiste en `ecommerce_request` (`EcommerceRequestService` deserializeReturnUrl/buildReturnUrl); el redirect rt=1 ya existe: `getBancolombiaBnplRedirectUrl` (`UrlGenerationService.php:124`, invocado en `UserRequestService.php:487`). Modal puro (rt=0 self-management, ej Sistecrédito): NO hay retorno de browser, el cliente sigue por link WhatsApp out-of-band.

### Inventario hardcodes / deuda técnica (LOGICA-QUEMADA)
**⚠️ P0 VIVO — `dd($exception)` en `Wompi.php:78`** (`getMerchant()`): corta cualquier request que toque ese path **en producción**. Acción: eliminar el `dd()`, manejar vía `Integration::handleException`. (Wompi también hardcodea lender_id 52 en `:78,264,309`.)

**response_type quemado (sin constante central):** `==2` (CreditopX) en `CreditopXFlowService.php:30`, `DebtSummaryService.php:51`, `RekognitionController.php:48`; `==3` (rotativo) en **12 archivos**; `==4` (Credifamilia async) = único lender 24. Modelo a seguir: `response_type` y `have_ctopx` SÍ están bien como columna.

**status_id (P1):** `return 11` (Autorizada) cableado en `LoanAuthorizationService.php:337` (`resolveAuthorizationStatusId()`); `status_id==11` comparado en ≥13 archivos sin constante. Tabla real: `user_request_statuses` (FK `user_requests.user_request_status_id`). Estados: 9=Formulario perfil, 10=Pendiente autorización, 11=Autorizada. ⚠️ 40/41 (CREDIT_IN_PROCESS/APPROVED) son `lender_transaction_statuses`, NO user_request_statuses.

**lender_id especiales:** 160=`smartpay_lender_id` PROD (`config/lenders.php:24`: `APP_ENV==='production'?160:153`); NO se compara al literal 160 sino vía `Lender::isSmartpayChannel()` (`Lender.php:65-67`); en local 152=SmartPay rt=2 country 1, 153=SmartPay rt=1 country 60 (160 NO existe como fila local). 24=Credifamilia rt=4 (único T&C PDF, `ENABLED_LENDERS_FOR_LEGAL=[24]`). 68/100=Bancolombia BNPL/Consumo (swap producto, 8+ lugares). 23,141,142=Welli (`WELLI_LENDER_IDS`). 5=BdB (fuerza 0% si fallan reglas). 12=Prami rt=1 (payload dinámico, NO PII quemada).

**allied_id especiales:** 94=Amoblando Pullman (ignora preaprobado, monto ≤600k no viable). 189=DENTIX/DFS. 158=Motai (renting `allied_mode=2`, cierre IMEI, filtra lenders a [158], T&C 16+17). 24/209/210/211=Corbeta (`Setting corbeta_allieds`, inyecta laboral dummy 1.5M, `error_code ONB006`). 225=UMA. branch 1083 bloquea botón "continuar". **Listas duplicadas (P1):** Corbeta [209,210,211] en 3+ sitios; Welli [23,141,142]; BdB+UMA [5,135,136,137].

**Montos quemados:** Welli mín 180.000 (`WelliService.php:36`); BNPL Bancolombia 100.000; Consumo 1.000.000; Pullman no viable ≤600.000; capacidad endeudamiento ≤40%; laboral dummy 1.500.000 (PEP y Corbeta); IVA 19/100 (P1, NO condicionado a país → RD ITBIS 18% mal); buckets score `LenderSpecialGrantingService` (Loans) `:186-201`: >770→15M / 710-770→8M / 650-709→5M / <650→3M / null→1.2M (el gemelo Onboarding usa tabla `creditop_x_quota_restrictions`).

**PII cableada:** `oscar@creditop.com` (`OnboardingService.php:650`); teléfonos de empleados (`ManualValidationService.php:18-22`, `CreditopXNotificationService.php:29` [3152623357], `TwilioController.php:830`); cédulas de prueba BancolombiaBnpl `1998228194/1998228111` (guardadas `!isProduction()` → deuda, no fallo prod).

**T&C ids (P2):** 13 default (`RegisterCellPhoneService.php:442`), 16+17 Motai, 18 Credifamilia. `city_id==1123`→siempre "BOGOTA". `creditop_x_consent_type_id`: 1 primer uso / 2 revolving / 3 device_lock_agreement (IMEI).

**⚠️ basenames duplicados** (citar ruta completa siempre): `LenderSpecialGrantingService` (Loans=buckets quemados vs Onboarding=tabla), `NotificationService` (Loans vs System country 60), `UserRequestService` (Loans vs Onboarding country 60). Los `.vue` con `if id==N` (ListLenders/RequestsTable/WelcomeUser) viven en **bitbucket/application** (frontend Vue legacy), NO en frontend-monorepo (React, 0 archivos .vue) ni en el `application` indexado (que es el backend legacy-application).

### Checklist "¿se puede apagar application?" (mientras 1 casilla siga abierta, sigue encendido)
Tronco+ecommerce todos los comercios a legacy · copias paralelas decomisadas · webhooks rt=1 ruteados+cableados · Identidad (callback ADO+state-machine+fallback) en legacy · recaudo pullman_db en legacy · cartera/cobranza en legacy · panel+SSO migrados/reapuntados · infra runtime confirmada.

## Dónde mirar
- **Allowlist de cutover por-comercio** (application): WoocommerceController.php:44-48 → [24,209,210,211,311]; único gate que decide si un comercio va a legacy o corre íntegro en el monolito. :183 despacha al tronco viejo
- **Cierre CreditopX en legacy (Estado 11)** (legacy-backend): ValidateOtpPromissoryNoteController.php:330 → LoanAuthorizationService::authorize() fija status 11 (:448-451); self-contained, sin llamadas a application
- **Copia paralela viva del cierre en application** (application): routes/customer.php:78-95 (pagaré web), ValidateOtpPromissoryNoteController.php:124-133 (fija status 11), PromissoryNoteController.php; NO decomisado
- **Notificación saliente al comercio (ya migrada)** (legacy-backend): UserRequestObserver.php:50-58 dispara con STORE_NOTIFY_STATUSES=[6,7,8,11] (constante en :25, NO en config/ecommerce.php); registrado por #[ObservedBy] en app/Models/UserRequest.php:14
- **Webhooks entrantes rt=1 — clases muertas (sin ruta)** (legacy-backend): Api/{Approbe,Payvalida,BancoDeBogota}Controller.php + Modules/Risk/.../SistecreditoController.php + Modules/Onboarding/.../WelliController.php (solo updateAmount, falta webhook()); Modules/Risk/routes/api.php está VACÍO
- **Webhooks entrantes rt=1 — rutas vivas** (application): routes/api.php: Bancolombia 21-22, Payvalida 45, Prami 49, Meddipay 58, Sistecrédito 92, Approbe 96, Banco de Bogotá 108, Welli 117
- **P0 VIVO: dd() en producción** (legacy-backend): app/Actions/Lenders/Wompi.php:78 (getMerchant) tiene un dd($exception) vivo que corta cualquier request en prod; también hardcodea lender 52 en :78,264,309
- **Recaudo pullman_db (no migrado)** (application): Admin/CreditopXPaymentController.php:605+ + conexión secundaria pullman_db (SQL Server partner); legacy tiene PullmanRepository/PullmanService pero SIN callers (stub)
- **Cron de cartera/post-desembolso (solo application)** (application): app/Console/Kernel.php:28-36: update-creditop-x-requests 00:30, apply-payment 03:30, revolving-credits 04:00, remove-outstanding-balances 00:10, reminder 09:30
- **SSO aliados + panel admin (bridge hacia el monolito)** (application): routes/customer.php:35 /sso/cognito-login → SsoCognitoController.php:23-95 (valida token Cognito+HMAC, Auth::login); routes/admin.php (panel Inertia/Vue 206 líneas)
- **Hardcodes de ids/montos por comercio y lender** (legacy-backend): OnboardingService.php (corbeta laboral dummy 1.5M :637,643, oscar@creditop.com :650, Pullman/DFS), LenderRetrievalService.php (Sonría/158/branch 1083), config/lenders.php:24 (smartpay 160 prod/153 dev), Lender.php:65-67 (isSmartpayChannel)

## Frontera de simulación / harness
Relevante al OKR de metodología de pruebas (Loan Origination). La frontera de inyectabilidad = la frontera de testeo de la migración: rt=2/3 in-platform (CreditopX) = CrediOp decide y cierra → INYECTABLE con usuario sintético, migrable y verificable e2e (el núcleo ya validado). rt=1 integración = decide un tercero por API → NO inyectable: se prueba con MOCKS de la API del proveedor + el simulador aggregator-result, NO con usuario sintético. Es exactamente la mitad entrante (webhooks rt=1) que sigue muerta en legacy. Los harness playground/backend-e2e y frontend-e2e NO están en el índice; tocan esta superficie de producto (el UserRequestObserver, los estados 6/7/8/11, el cierre CreditopX) para validar Estado 11 sin tocar application.

## Gotchas / riesgos
- El `application` del índice es el repo backend `legacy-application` (Laravel/Inertia). El frontend Vue legacy con los `if id==N` (ListLenders.vue, RequestsTable.vue) vive en OTRO repo, bitbucket/application, que NO está en el índice. frontend-monorepo es React/TSX (0 archivos .vue) y NO contiene esa lógica quemada.
- Dos ejes distintos: 'dependencia' (legacy NO llama a application en runtime = 0) ya se cumple; 'cutover' (apagar la copia paralela) NO. Ambos son verdad a la vez: legacy ya puede, el monolito sigue encendido. No confundirlos.
- Los webhooks rt=1 son código MUERTO en legacy: las clases controller están copiadas pero NINGUNA ruta las bindea. Un solo trigger huérfano (webhook, cron, Auth::login) que viva solo en application impide apagarlo — por eso lo 'parcial' es tan peligroso como lo 'no migrado'.
- ⚠️ SistecreditoPay.php:49 ya llama route('api.sistecredito.webhook') pero esa ruta no existe en legacy → error en runtime hasta crearla en Modules/Risk/routes/api.php (que hoy está vacío) + registrar RouteServiceProvider.
- El webhook (RESULTADO: entidad→CrediOp→comercio) es DISTINTO del retorno del USUARIO (browser). Para lenders redirect rt=1 el browser NO debe volver a CrediOp ni a lender-result — la entidad devuelve al comercio vía return_url. No mezclarlos.
- Los webhooks deben setear user_request_status_id=11 vía Eloquent (update/save), NO por query directa: la query directa no levanta el UserRequestObserver y no dispara la notificación saliente.
- status_id==11 (Autorizada) NO es una constante: está en ≥13 archivos + return 11 hardcodeado en LoanAuthorizationService.php:337. 40/41 son lender_transaction_statuses, NO user_request_statuses.
- El literal 160 (SmartPay) NO existe como fila en la BD local: es el smartpay_lender_id de PROD; el código resuelve vía config('lenders.smartpay_lender_id') (160 prod / 153 dev) por Lender::isSmartpayChannel(), nunca contra el literal. Tests E2E deben usar el id que devuelva el config del entorno.
- IVA 19/100 está cableado sin condicionar a country_id → RD (ITBIS 18%) queda mal calculado.
- Basenames duplicados: LenderSpecialGrantingService (Loans=buckets de score quemados vs Onboarding=tabla creditop_x_quota_restrictions), NotificationService, UserRequestService. SIEMPRE citar la ruta de módulo completa.

## Preguntas abiertas
- [ ] ¿application y legacy comparten la MISMA RDS/Redis/Pusher en prod? Solo confirmable con el .env de prod (DB_HOST, REDIS_HOST, PUSHER_*, SESSION_DOMAIN/APP_KEY). Implica datos compartidos durante el parallel-run.
- [ ] ¿Existe ya en legacy la ruta de webhook entrante de Bancolombia (bnpl/consumo)? El doc pide verificar; LoanAuthorizationService.php:463-465 resuelve siempre 11 pero no está confirmada la ruta.
- [ ] Prami y Meddipay: el controller webhook no está confirmado en legacy — ¿hay que crearlo desde cero o existe copiado en otro módulo?
- [ ] No hay métricas de avance por módulo (contadores de la auditoría en 0): todo '% migrado' es cualitativo. Falta instrumentar cuántos archivos siguen en application por módulo.
- [ ] La fecha de la auditoría es 2026-06-17; el allowlist es 'creciente' (el 311 se agregó días antes). ¿Se agregaron más comercios al allowlist desde entonces?

## Bitácora
- **2026-07-17** — Nodo de referencia creado bajo el group Plataforma. Superficie: 58 archivos, 58/58 resuelven. Síntesis de `ESTADO-MIGRACION + PENDIENTES-MIGRACION + LOGICA-QUEMADA` para hacer el árbol autosuficiente (resolver tareas sin abrir docs/).

## Enlaces
- Sustrato: group **Plataforma**. Hermanos: **modelo-datos** · **admin-reglas**. El servicing no migrado se detalla en el flujo **continuacion-servicing**.
- Memorias: `migracion-application-a-legacy-estado`.
