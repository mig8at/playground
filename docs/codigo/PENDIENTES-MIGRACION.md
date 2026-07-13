# PENDIENTES DE MIGRACIÓN — qué falta para apagar `application`

> **Dueño de:** la lista priorizada de lo que falta para poder **decomisar el monolito `application`**.
> Complementa [ESTADO-MIGRACION.md](./ESTADO-MIGRACION.md) (qué se reconstruyó y dónde corre hoy).
> **Fecha:** 2026-06-17 · derivado de la auditoría multi-agente con verificación adversarial.

---

## 0. El encuadre (para no perder contexto)

El trabajo restante **no es solo "escribir código"** — el núcleo (Creditop X, ecommerce/VTEX, cuota
inicial) ya está **reconstruido y validado** en legacy. Apagar `application` son **tres tipos de tarea**:

1. **CUTOVER** — rutear el 100% del tráfico a legacy (hoy es un **allowlist por comercio** `[24,209,210,211,311]`) y **decomisar** las copias paralelas que aún viven en `application`.
2. **RECONSTRUIR** — lo que todavía **no existe** en legacy: webhooks entrantes de **agregadores rt=1**, **recaudo** (`pullman_db`), **cartera/cobranza** (post-desembolso), **panel asesor/admin + SSO**.
3. **CONFIRMAR EN RUNTIME** — infra compartida (RDS/Redis/Pusher) y métricas de avance.

> **Regla de oro:** un solo trigger huérfano (un webhook, un cron, un `Auth::login`) que viva **solo** en `application` impide apagarlo. Por eso lo "parcial" (legacy + copia paralela) es tan peligroso como lo "no migrado".

---

## P0 — Bloqueantes directos del apagado

### P0.1 · Completar el cutover del CORE + decomisar las copias paralelas
- **Qué:** rutear **todos** los comercios (no solo el allowlist) a legacy para entrada ecommerce + tronco, y **eliminar/deprecar** las implementaciones paralelas vivas en `application` de: cierre CreditopX, VTEX, tronco (OTP/personal/laboral/marketplace), documentos-web, notificaciones-autogestión.
- **Por qué (negocio):** mientras `application` siga siendo el **default runtime**, el monolito no se puede apagar aunque legacy "ya pueda". Es el activo Creditop X (préstamo propio) el que debe quedar 100% en legacy.
- **Archivos:** allowlist `application/.../WoocommerceController.php:44-48`; copias paralelas a decomisar — `application/routes/customer.php:78-95` (pagaré CreditopX), `Api/VtexController.php:25-206` + `routes/api.php:149-153` (VTEX), `routes/customer.php:116-144,169` (tronco), `:79-95` (documentos web), `:146` (autogestión).
- **Verificación:** correr el harness e2e por comercio confirmando Estado 11 sin tocar `application`; ir agregando comercios al ruteo legacy y apagando su ruta en application.

### P0.2 · Rutear y cablear los **webhooks entrantes de agregadores rt=1** en legacy ⚠️
- **Qué:** dar de alta en legacy las rutas + wiring de los webhooks que **hoy solo existen en `application`**. **Las clases controller ya están copiadas en legacy pero NINGUNA ruta las bindea → código muerto.** Falta la ruta + el contrato de entrada + el cambio de estado vía Eloquent (para que dispare el `UserRequestObserver` ya migrado).
- **Por qué (negocio):** es el **rol bróker** de Creditop. rt=1 (Bancolombia/Sistecrédito/Welli/…) decide en el portal del tercero y **avisa por webhook entrante**; sin ese receptor en legacy, esos créditos nunca cierran fuera de `application`. **No es inyectable** (decide un tercero) → se prueba con **mocks de la API del proveedor** + el simulador `aggregator-result` ya existente, no con usuario sintético ([synth-lender-type-boundary]).
- **Archivos:** rutas vivas en `application/routes/api.php` — Bancolombia `20-22`, Payvalida `45`, Prami `49`, Meddipay `58`, Sistecrédito `92`, Approbe `96`, Banco de Bogotá `108`, Welli `117`. Clases ya copiadas (sin ruta) en legacy: `app/Http/Controllers/Api/{ApprobeController,BancolombiaController,PayvalidaController}.php`, `Modules/Risk/.../SistecreditoController.php`.
- **Nota:** esto **encaja con lo que ya hicimos en ecommerce** — el observer + `EcommerceNotifier` (salida a la tienda) ya está migrado; lo que falta es la **mitad entrante** (recibir la decisión del lender y setear el estado vía Eloquent). El simulador que construimos imita exactamente ese disparo. La notificación SALIENTE ya lista: `UserRequestObserver.php:50-58` con `STORE_NOTIFY_STATUSES=[6,7,8,11]` (constante en `UserRequestObserver.php:25`, **no** en `config/ecommerce.php`).

#### Matriz per-lender — webhooks entrantes (código muerto: clase sin ruta que la bindee)
Cada webhook entrante **setea `user_request_status_id=11`** vía Eloquent → dispara el `UserRequestObserver` → notificación saliente al comercio. En legacy la clase existe pero **ninguna ruta la bindea**.

| Lender | Ruta en `application` | Estado en `legacy-backend` | Qué falta |
|---|---|---|---|
| **Approbe** | `routes/api.php:96` | `app/Http/Controllers/Api/ApprobeController.php` con `webhook()` (setea 11, ~`:89`) | **Solo rutear** (POST → `ApprobeController@webhook`) |
| **Payvalida** | `routes/api.php:45` | `app/Http/Controllers/Api/PayvalidaController.php` con `webhook()` (~`:75`) | **Solo rutear** |
| **Banco de Bogotá** | `routes/api.php:108` | `app/Http/Controllers/Api/BancoDeBogotaController.php` con `webhook()` (~`:16/21`) | **Solo rutear** |
| **Sistecrédito** | `routes/api.php:92` | `Modules/Risk/App/Http/Controllers/Api/SistecreditoController.php` con `webhook()` (setea 11, `:81-85`) | **Rutear** en `Modules/Risk/routes/api.php` (hoy VACÍO) + registrar en su `RouteServiceProvider`. ⚠️ `SistecreditoPay.php:49` ya llama `route('api.sistecredito.webhook')` → **error en runtime** hasta crear la ruta. |
| **Welli** | `routes/api.php:117` | `Modules/Onboarding/App/Http/Controllers/WelliController.php` — **solo tiene `updateAmount()`, NO `webhook()`** | **Portar `webhook()`** desde `application/app/Http/Controllers/Api/WelliController.php:18-132` + rutear en `Modules/Onboarding/routes/api.php` |
| **Prami** | `routes/api.php:49` | **Controller no confirmado en legacy** | **Crear** el controller webhook + rutear |
| **Meddipay** | `routes/api.php:58` | **Controller no confirmado en legacy** | **Crear** el controller webhook + rutear |
| **Bancolombia** (bnpl/consumo) | `routes/api.php:21-22` | `LoanAuthorizationService.php:463-465` (resuelve siempre 11) | **Verificar** si existe la ruta de webhook entrante; si no, rutear |

- **Patrón (solo rutear):** `Route::post('<lender>/webhook', '<Lender>Controller@webhook')->name('api.<lender>.webhook')` sin `auth:sanctum` (el lender es externo; validar por firma/credencial del proveedor). Confirmar que `webhook()` setea el estado **vía Eloquent** (`update`/`save`, no query directa — la query directa no levanta el observer).
- **Sub-prioridad:** solo-rutear (rápido) = Approbe, Payvalida, Banco de Bogotá, Sistecrédito (+ su `RouteServiceProvider`). Portar/crear código = Welli (portar `webhook()`), Prami, Meddipay (crear controller), Bancolombia (verificar).

#### Retorno del USUARIO al comercio — es responsabilidad de la ENTIDAD (lenders por redirect)
El webhook de arriba es el camino del **RESULTADO** (entidad → CrediOp → notificación al comercio). El camino del **USUARIO** (su browser) es DISTINTO y, para lenders por **redirect**, **NO debe pasar por CrediOp**:
- Al elegir un lender que **redirige** (rt=1 Bancolombia/Meddipay…, o rt=0 con `data.url`), CrediOp manda el browser al **portal de la entidad** y **sale del camino**. Al terminar, la **ENTIDAD debe devolver el browser AL COMERCIO** (`return_url`) — no a CrediOp, no a `lender-result` (esa es una vista in-platform de CreditopX, no aplica para redirect).
- El `return_url` ya se persiste en `ecommerce_request` desde el `u` del contrato base64 (`EcommerceRequestService.php` `deserializeReturnUrl`/`buildReturnUrl`). La construcción del redirect rt=1 **ya existe en legacy**: `getBancolombiaBnplRedirectUrl` (`Modules/Partner/App/Services/UrlGenerationService.php:124`, invocada en `Modules/Onboarding/App/Services/UserRequestService.php:487`, case 1 rt=1) → **NO es parte del gap**. Lo que falta es **coordinación por entidad**: cada proveedor debe aceptar el `return_url` (o callback configurado) y redirigir ahí al usuario tras aprobar/rechazar. Acuerdo de integración con cada uno, igual que el webhook.
- **Modal puro (rt=0 self-management, p.ej. Sistecrédito):** NO hay retorno de browser — el cliente sigue por el link de WhatsApp (out-of-band) y el comercio se entera solo por el webhook. El modal in-app es el final.

---

## P1 — Transversales que bloquean aunque parezcan "listos"

### P1.1 · Identidad — mover el callback del vendor + state-machine + fallback a legacy
- **Qué:** que el callback de **ADO** llegue a legacy (hoy el vendor postea a `application/routes/customer.php:302-305`), y migrar la state-machine + el **fallback local** (`ValidateIdentityController.php:251`) y las integraciones directas (`Actions/RiskCentrals/{Ado,Tusdatos}.php`). Legacy ya tiene el módulo `Identity`; falta que sea el **único** receptor.
- **Por qué:** sin esto, la validación biométrica del flujo real sigue dependiendo de `application` en runtime.

### P1.2 · Recaudo / aplicación de pagos (`pullman_db`)
- **Qué:** migrar `application/.../Admin/CreditopXPaymentController.php:605+` + la conexión `pullman_db`. Legacy tiene `PullmanRepository`/`PullmanService` pero **sin callers** (stub) → cablearlo.
- **Por qué:** el recaudo contra el SQL Server del partner Pullman corre hoy solo en `application`.

### P1.3 · Decomisar canales-web/IMEI/SmartPay residuales en `application`
- **Documentos (canal web Inertia):** `application/routes/customer.php:79-95` — legacy ya tiene el canal API; decomisar el web.
- **IMEI captura:** `application/routes/customer.php:259` (`registrar-imei`) → `UserRequestController.php:1610` + UI `RequestsTable.vue`; legacy tiene la mecánica de locking, falta la captura/entrada.
- **SmartPay paso IMEI:** commit `76007263` agregó una redirección activa en `application` para el paso IMEI del onboarding SmartPay.
- **Notificaciones:** `application/routes/customer.php:146` `/enviar-mensaje-autogestion` paralelo al `sendSelfManagement` ya migrado en legacy.

---

## P2 — Verticales fuera del alcance de originación (cola larga, pero bloquean el apagado TOTAL)

### P2.1 · Cartera / post-desembolso / cobranza / facturación (Loan Servicing + Billing)
- **Qué:** subdominio entero **post-desembolso**, hoy 100% en `application`: cron `app/Console/Kernel.php:28-36` (`update-creditop-x-requests` 00:30 corte/mora/facturación, `apply-payment` 03:30, `revolving-credits` 04:00, `remove-outstanding-balances` 00:10, `reminder` 09:30) + panel `routes/admin.php` `/facturacion-y-recaudo` + `UpdateCreditopXApplyPaymentCommand → CreditopXPaymentController::applyRetainedPayments`.
- **Por qué:** **OUT del alcance de originación** (NEGOCIO §7), pero es el último gran bloque para apagar el monolito. Planear como vertical aparte.

### P2.2 · Panel asesor/admin + SSO aliados
- **Qué:** el panel Inertia/Vue (`application/routes/admin.php`, 206 líneas) y el **SSO** `routes/customer.php:35` `/sso/cognito-login` → `SsoCognitoController.php:23-95` (el wizard nuevo hace de **bridge HACIA** `application` para que el asesor use el panel viejo — links "Solicitudes"/"Créditos Originados").
- **Por qué:** mientras el panel viva en `application`, el SSO del navbar del wizard sigue mandando al monolito. Migrar las vistas (listados de solicitudes/créditos) o reemplazar el destino.

---

## P3 — Runtime / infra / gestión

### P3.1 · Confirmar la infra compartida en runtime (no por código)
Del [eje dependencia](./FLUJO-CREDITOPX-Y-DEPS-APPLICATION.md): `application` y `legacy` comparten **nombres de env** idénticos → posiblemente la **misma RDS / Redis / Pusher** en prod (solo confirmable con `.env` de prod). No bloquea el código, pero implica **datos compartidos** durante el parallel-run. Confirmar: `DB_HOST`, `REDIS_HOST`, `PUSHER_APP_KEY/HOST` + `BROADCAST_DRIVER`, `SESSION_DOMAIN`/`APP_KEY`.

### P3.2 · Instrumentar métricas de avance por módulo
La auditoría no pudo medir **cuántos archivos** siguen en `application` por módulo (contadores en 0). Sin esto, todo "% migrado" es cualitativo. Útil para convertir este doc en un tablero de avance.

---

## Checklist "¿se puede apagar `application`?"
- [ ] Tronco + ecommerce: **todos** los comercios rutean a legacy (no solo el allowlist).
- [ ] CreditopX cierre / VTEX / documentos / notificaciones: copias paralelas en `application` **decomisadas**.
- [ ] Webhooks entrantes de agregadores rt=1: **ruteados y cableados** en legacy.
- [ ] Identidad: callback ADO + state-machine + fallback en legacy (vendor postea a legacy).
- [ ] Recaudo `pullman_db` + aplicación de pagos en legacy.
- [ ] Cartera / cobranza / facturación (post-desembolso) en legacy.
- [ ] Panel asesor/admin + SSO migrados o re-apuntados.
- [ ] Infra runtime confirmada (RDS/Redis/Pusher) y plan de datos durante/post cutover.

> Mientras CUALQUIER casilla siga abierta, `application` debe seguir encendido.
