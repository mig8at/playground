# Flujo de originación CreditopX (biométrica + espera) y dependencias con `application`

> **Fecha:** 2026-06-17 · **Alcance:** wizard `frontend-monorepo/apps/loan-request-wizard` + `legacy-backend` + (referencia) monolito `application`.
> **Provenance:** este doc se generó de un barrido automático multi-agente (32 agentes) sobre los tres repos, con verificación adversarial de cada sospecha de dependencia. Las citas `file:line` son del barrido (best-effort); contrastar antes de tocar código. Complementa —no reemplaza— [MAPA-FLUJOS](./MAPA-FLUJOS.md) y [REFERENCIA-FLUJOS](./REFERENCIA-FLUJOS.md).
>
> **🔄 Re-verificación 2026-07-08** (contra `develop` en disco: legacy-backend `fix/credifamilia-…`, frontend-monorepo `main` `795ba5ea`, application `main`): pase de re-verificación de citas `archivo:línea`. **Hallazgos estructurales aplicados:** (1) la **entrada por ecommerce** (checkout base64 / `erId` / `ecommerce-context.server.ts`) fue **removida** del wizard — todas sus menciones quedan **[REMOVIDO]**; (2) el **polling de validación del cliente** se unificó en `identity-validation-status.tsx` (`waiting-validation.tsx` y `validation-pending.tsx` quedaron vacíos/desregistrados) + socket `useValidationStatusSocket`, y la máquina de fases ganó una 7ª terminal `canceled`; (3) `openNewTab` se centralizó en `LenderTabBehaviorResolver`; (4) el marketplace lista por `lenders-v2`. Los números de línea de §Tronco, §CreditopX, §Agregadores, §Espera y §Mapa-backend fueron actualizados; donde un símbolo se verificó pero no su rango exacto, la cita se ancló al símbolo.

---

## 0. Veredicto: ¿el flujo de originación depende de `application`?

**Resumen honesto.** El **flujo de originación del wizard** (entrada → marketplace → CreditopX/biométrica → firma → Estado 11) corre contra **legacy-backend** (`VITE_API_URL`, default `http://legacy-backend.inertia-develop`) + proveedores externos (Cognito, Pusher/soketi, PostHog, microservicio *financial-health*, un gateway). **En ese recorrido el wizard NO llama directo al monolito `application`.** (Barrido: 113 hallazgos de red, 21 sospechas, verificadas adversarialmente — 8 refutadas como código muerto/otro-target.)

**Pero NO se puede afirmar "cero dependencias con `application`" todavía:** el barrido fue **FE-céntrico** (solo salidas HTTP/redirects del wizard) y hay planos que estructuralmente no ve.

### ✅ Limpio (plano FE → red, en el flujo de originación)
- Todas las llamadas del wizard al backend van a **legacy-backend** (`VITE_API_URL`).
- ADO (biométrica), Tusdatos, Wompi, Datacrédito: el wizard **no los llama directo** — viven detrás de legacy (legacy fabrica la URL *hosted* y el wizard redirige / escucha el resultado por WebSocket).
- **`legacy-backend` no tiene llamadas activas a `application`**: ni siquiera queda ya la referencia comentada — `INTERNAL_APPLICATION_API_URL` / `processWebhookCorbeta` **ya no existen** en todo `legacy-backend` (fueron borrados de `BancolombiaService.php`; `git log -S` los ubica hasta el commit `85b8e978`). La conclusión (0 llamadas legacy→application) queda aún más firme.
- El flag **`from_legacy`** del endpoint `confirm` (`ContinueUserFlowController.php:91`) **no lo produce ningún caller** → siempre `false` en runtime → no es dependencia.
- El acoplamiento que SÍ existe es **`application → legacy`** (`application/app/Services/Api/BaseApiClient.php:20` → `INTERNAL_LEGACY_API_URL`): es la dirección correcta para matar el monolito (legacy no necesita a `application`).

### ⚠️ La ÚNICA dependencia FE→`application` viva (y está FUERA del flujo de originación)
- **Puente SSO a aliados.** Los links del navbar que van al monolito son **"Créditos Originados"** (`app/layouts/navbar-layout.tsx:124-127`) y **"Autorizaciones"** (`:133-137`), armados con `buildAliadosSsoLink` (`:105-110`) → ruta `/aliados-sso` (`app/routes/auth/aliados-sso.tsx:27`): un **POST auto-submit firmado con HMAC** a `${ALIADOS_BASE_URL}/sso/cognito-login` (prod `aliados.creditop.com`; firma en `app/utils/aliados-sso.server.ts:7,16`). Es un **handoff de navegador al panel viejo** para *ver* créditos/autorizaciones — **no es parte de originar un crédito**, pero es una dependencia viva. (**"Solicitudes" ya NO va por SSO**: hoy es una vista interna del wizard, `/merchant/{hash}/solicitudes` → `navbar-layout.tsx:216-222` → `routes.ts:71` `request-management`.) **Al matar `application`, esos dos links necesitan nuevo destino** (o migrar esas vistas al wizard).
- **Código muerto (borrable):** en `app/utils/route-helpers.ts`, `buildLegacyUrl` (`:79`), `createLegacyRedirect` (`:84`) y `redirectToLegacy` (`:174`) — **0 callers**. `LEGACY_BASE_URL` (`:17`, = `https://aliados.creditop.com`) sí tiene **1 uso interno vivo** (base dummy en `resolvePathname`, `:118`): borrable solo reemplazando esa base.

### ❌ Lo que el barrido FE NO pudo ver (→ ver §Pendiente)
Las dependencias con `application` que importan para matar el monolito son mayormente **backend↔backend y de datos**, invisibles desde un `fetch`/`window.location` del wizard:
- ¿`application` y `legacy-backend` comparten la **misma RDS** en prod? (los docs advierten "dos bases, IDs distintos" — falta confirmar si están sincronizadas/compartidas).
- Conexión **`pullman_db`** propia de `application` (`PullmanRepository`/`PullmanService`).
- Setting **`front_url`** en legacy que **construye URLs hacia el monolito** (`$front_url . 'aliados/onboarding?allied='`) — handoff backend→aliados que no aparece en el inventario FE.
- **Webhooks entrantes** (sistecredito/payvalida/approbe), **colas/jobs** (StatusCheck por lender, cron IMEI 04:00/05:00/06:00), **Redis** (sesión SmartPay TTL 3600, rate-limit OTP), **S3/SNS/Twilio**, **cookie de sesión** (¿compartida cross-app por dominio `.creditop.com`?), **broadcaster Pusher** (¿`application` publica en el mismo `App.Models.UserRequest.*`?).

> **Veredicto final:** el **flujo de originación del wizard está limpio de `application`** salvo el **puente SSO del navbar** (navegación al panel viejo, no originación). El **2º barrido** (plano backend/datos, ya verificado abajo) confirma **0 dependencias de código legacy→application**; lo que queda es **infra compartida lateral** (RDS/Redis/Pusher — runtime) y, sobre todo, que **los webhooks de los AGREGADORES (rt=0/1) siguen en `application`** (CreditopX rt=2 ya migrado). Detalle en §Plano backend/datos.

---


## Tronco común (entrada → marketplace)

El wizard (`app/routes.ts`) monta dos bloques de rutas que comparten **los mismos componentes de paso** (`routes/loan-application-form/*` y `routes/lenders-marketplace/available-lenders.tsx`), diferenciándose solo en el prefijo, el layout y la forma de **entrar** al flujo:

- **Ecommerce / self-service:** `route(":flow", "layouts/public-layout.tsx", …)` con `:flow ∈ {ecommerce, self-service}` (validado en `app/layouts/public-layout.tsx:7-9`). Público, sin login.
- **Asesor / merchant:** `route("merchant", "layouts/default-layout.tsx", …)` (`app/routes.ts:54`). Protegido por Cognito vía `requireUserWithSession` en `app/layouts/default-layout.tsx:18`.

Ambos bloques anidan los mismos segmentos: `solicitar` → `:phone_number/otp` → `:loan_request_id/{personal-info,employment-info,lenders}`. La construcción de paths la centraliza `createRouteHelpers`/`ROUTE_PATHS` en `app/utils/route-helpers.ts:131-226`, que resuelve el prefijo (`/ecommerce` | `/self-service` | `/merchant`) según `params.flow` o, si falta, detectando el pathname (`app/utils/route-helpers.ts:142-155`).

### 0. Autenticación de backend (diferencia transversal)

El header que cada paso manda a legacy lo arma `buildBackendAuthHeaders` (`app/utils/backend-auth-headers.server.ts:5-14`): si hay usuario Cognito en sesión, inyecta `x-cognito-identity-id`; si no, devuelve `{}`. Es decir, **el mismo paso pega al mismo endpoint pero el flujo asesor va autenticado y el ecommerce/self-service va anónimo**:

```ts
// app/utils/backend-auth-headers.server.ts:6-13
const user = await getUser(request);
if (!user?.id) { return {}; }
return { "x-cognito-identity-id": user.id };
```

### 1. Entrada

> ⚠️ **Actualización 2026-07-08:** la **entrada por checkout base64 (ecommerce) fue removida del wizard** — `app/routes/ecommerce/checkout.tsx` ya no existe (dir `app/routes/ecommerce/` borrado), no hay ruta `checkout` registrada y `ecommerce-request/create|detail|by-user-request` tiene **0 ocurrencias** en el repo. El prefijo `:flow=ecommerce` **sigue vivo** (`public-layout.tsx:11` lo acepta) pero **entra directo a `solicitar`, sin `erId` ni prefill de tienda**. Todas las menciones "diferencia ecommerce" de los pasos siguientes están marcadas **[REMOVIDO]**.

**Ecommerce / self-service:** entran directo a `/:flow/:partner_hash/solicitar` (público, sin `erId` ni `ecommerceCtx`).

**Asesor (login Cognito):** `route("login", "routes/auth/login.tsx")` (`app/routes.ts:271`). El loader dispara el authenticator de Cognito: `authenticator.authenticate("cognito", request)` — `app/routes/auth/login.tsx:6`. El callback (`app/routes/auth/callback.tsx:9-23`) guarda `user` en sesión y redirige a `redirectTo || "/merchant"`.
- Al entrar a `/merchant` (sin `partner_hash`), el loader del `default-layout` resuelve el comercio del asesor y redirige a `/merchant/{hash}/solicitar`:
  - Datos de usuario: `GET {VITE_API_URL}/api/onboarding/loan-application/user` con `x-cognito-identity-id` — `app/modules/user/infrastructure/user.repository.ts:9-16`, invocado en `app/layouts/default-layout.tsx:28`.
  - Redirect a `solicitar`: `app/layouts/default-layout.tsx:65-75` (y corrección de hash en `:78-90`).
  - Setea `session.alliedCountry` (`:36`) y `session.redirectToModes` (`:109` error / `:112` éxito si `partner_modes.length>0`).

> Nota: el modo asesor tiene una **entrada alternativa dinámica** (no es el tronco `solicitar`): `/merchant/:partner_hash/modes` → `request-amount`/`request-phone`/... bajo `merchant-dynamic-layout` (`app/routes.ts:80-87`). `merchant-mode.tsx` (`app/routes/loan-application-form/merchant-mode.tsx:26`) guarda `session["merchant-mode"]` y redirige a `/merchant/{hash}/solicitar?step=phoneNumber`. Además, el loader de phone-number desvía a `request-amount` cuando `alliedCountry === 60` (`app/routes/loan-application-form/phone-number.tsx:67-69`). El detalle interno de ese sub-flujo dinámico queda **fuera del tronco común** descrito aquí.

### 2. Monto + Teléfono — `solicitar` (`routes/loan-application-form/phone-number.tsx`)

Rutas: `app/routes.ts:10` (ecommerce/self-service) y `app/routes.ts:77` (`merchant-phone-number`). Pantalla única que captura monto + teléfono.

- **Loader** (`app/routes/loan-application-form/phone-number.tsx:51-141`, envuelto en `withRouteLogging` `:143`; ahora también trae `products` y devuelve `partnerInfoPromise` en streaming):
  - Trae info del comercio: `GET {VITE_API_URL}/api/onboarding/phone/register/{partner_branch_hash}` — `modules/loan-request-wizard/loan-application-form/src/lib/infrastructure/partner-info.repository.ts:33` (vía `apiClient`); `GetPartnerInfoByHashUc` se instancia en `phone-number.tsx:58-59` y ejecuta en `:76`.
  - **[REMOVIDO] Diferencia ecommerce:** ya no queda lógica de `erId` en `phone-number.tsx`, y `app/server/services/ecommerce-context.server.ts` **no existe**.
- **Action** (`phone-number.tsx:145-231`): registra el teléfono y envía OTP:
  - Endpoint: `POST {VITE_API_URL}/api/onboarding/phone/register` — `modules/loan-request-wizard/loan-application-form/src/lib/infrastructure/phone-number.repository.ts:51` (vía `this.client.post`, dentro de `SavePhoneNumberUc`).
  - Redirige a `…/{phone_number}/otp` propagando `amount` y `productId` — `phone-number.tsx:208-219`. (Ya no existe `erId` ni `readErIdFromRequest`.)

```ts
// loan-application-form/src/lib/infrastructure/phone-number.repository.ts:51
const response = await this.client.post(`/api/onboarding/phone/register`, …);
```

### 3. OTP — `:phone_number/otp` (`routes/loan-application-form/otp-verification.tsx`)

Rutas: `app/routes.ts:11` y `app/routes.ts:88` (`merchant-otp`). Reenvío: `:phone_number/otp/resend` (`app/routes.ts:12,91`).

- **Action** (`otp-verification.tsx:83-269`): valida el código y, si ok, crea/obtiene el `user_request_id`:
  - Endpoint: `POST {VITE_API_URL}/api/onboarding/loan-application/otp-validate/{partner_hash}` — `modules/loan-request-wizard/loan-application-form/src/lib/infrastructure/phone-otp.repository.ts:21-22` (vía `this.client.post`, dentro de `VerifyPhoneOtpUc`).
  - **[REMOVIDO] Diferencia ecommerce:** el payload actual (`otp-verification.tsx:124-135` / `phone-otp.repository.ts:24-33`) **ya no manda `ecommerce_request_id`** (manda `cell_phone`, `otp_code`, `original_amount`, `amount`, `isMotaiRenting`, `partner_branch_hash`).
  - Ramificación por `error_code` (`otp-verification.tsx:148-216`): éxito → `lenders` (`:148-181`); `ONB002` → `personal-info` (`:183-199`); `ONB004` → `employment-info` (`:200-216`).

```ts
// loan-application-form/src/lib/infrastructure/phone-otp.repository.ts:21-22
const response = await this.client.post(`/api/onboarding/loan-application/otp-validate/${hash}`, …);
```

> Caveat (unknown / posible bug, no asunción): el `resendUrl` del componente OTP **sigue hardcodeado a `/self-service/`** (`otp-verification.tsx:302`) aunque la ruta se reusa para ecommerce y merchant. El registro de la ruta resend bajo merchant sí existe (`app/routes.ts:91`, `merchant-otp-resend`), pero el componente no usa `createRouteHelpers` para el resend. No verifiqué el efecto en runtime para ecommerce/merchant.

### 4. Información personal — `:loan_request_id/personal-info` (`routes/loan-application-form/loan-request-form.tsx`)

Rutas: `app/routes.ts:14` y `app/routes.ts:95` (`merchant-personal-info`).

- **Loader** (`loan-request-form.tsx:306-329`): resuelve `theme` + `personalInfoConfig` (`showStratum`/`showBirthDate`). **[REMOVIDO] Diferencia ecommerce:** ya no hay prefill de tienda ni `lockedFields` (0 ocurrencias), y `ecommerce-context.server.ts` no existe.
- **Action** (`loan-request-form.tsx:222-302`): guarda info personal:
  - Endpoint: `POST {VITE_API_URL}/api/onboarding/loan-application/personal-info/{partner_hash}/{user_request_id}` — `modules/loan-request-wizard/loan-application-form/src/lib/infrastructure/personal-info.repository.ts:41` (vía `SavePersonalInfoUc`).
  - Éxito → `lenders` (`loan-request-form.tsx:266-276`); `ONB004` → `employment-info` (vía `mapPostSaveErrorToResult`, branch en `:206`).

### 5. Información laboral — `:loan_request_id/employment-info` (`routes/loan-application-form/employment-info.tsx`)

Rutas: `app/routes.ts:15` y `app/routes.ts:98` (`merchant-employment-info`).

- **Action** (`employment-info.tsx:48-110`): guarda situación laboral + ingreso:
  - Endpoint: `POST {VITE_API_URL}/api/onboarding/loan-application/laboral-info/{partner_hash}/{user_request_id}` — `modules/loan-request-wizard/loan-application-form/src/lib/infrastructure/employment-info.repository.ts:22` (vía `SaveEmploymentInfoUc`).
  - Éxito → `lenders` (`employment-info.tsx:79-88`); `ONB002` → vuelve a `personal-info`/form (`:92-95`).

### 6. Marketplace de lenders — `:loan_request_id/lenders` (`routes/lenders-marketplace/available-lenders.tsx`)

Rutas: `app/routes.ts:16` y `app/routes.ts:101` (`merchant-lenders`). Fin del tronco común.

- **Loader** (`available-lenders.tsx:103-268`): lista opciones de financiamiento y, además, **dispara pre-aprobaciones en streaming** por cada lender `rt!=0` contra `VITE_PREAPPROVALS_ENDPOINT` (`:120-235`):
  - Endpoint: `GET {VITE_API_URL}/api/onboarding/loan-application/lenders-v2/{loanRequestId}` (timeout 60s) — `modules/loan-request-wizard/lenders-marketplace/src/lib/infrastructure/repositories/loan-options.repository.ts:25` (vía `GetLoanOptionsUc`).
  - **[REMOVIDO] Diferencia ecommerce:** hoy pasa `is_ecommerce: false` **hardcodeado** (`available-lenders.tsx:137`); no existe `getEcommerceContextByLoanRequest`.
- **Action** (`available-lenders.tsx:272-566`): al elegir lender:
  - (Opcional, merchant con `productId`) guarda producto: `SaveUserRequestProductUc` (`available-lenders.tsx:296-305`).
  - Selección: `POST {VITE_API_URL}/api/onboarding/loan-application/update-user-request/{loanRequestId}` — `loan-options.repository.ts:73-74` (vía `SelectLenderUc`, ejecutado en `available-lenders.tsx:407`).
  - A partir de aquí el flujo se **bifurca por lender/respuesta**: la decisión la centraliza `getLenderSelectionNextStep` (`available-lenders.tsx:71-101` → `continue` / `continue-with-qr` / `external-redirect` / `external-popup` / `process-modal`) y se despacha en `:443-566`; eso ya queda **fuera del tronco común**.

---

### Resumen de endpoints del tronco (legacy-backend, base `VITE_API_URL`)

| Paso | Ruta wizard (ecommerce/self-service · asesor) | Endpoint legacy |
|---|---|---|
| Entrada asesor | `login` → `/merchant` | Cognito + `GET /api/onboarding/loan-application/user` |
| Info comercio (en `solicitar`) | `…/solicitar` | `GET /api/onboarding/phone/register/{partner_hash}` |
| Teléfono | `…/solicitar` (action) | `POST /api/onboarding/phone/register` (resend: `/api/onboarding/otp/resend`) |
| OTP | `…/{phone}/otp` | `POST /api/onboarding/loan-application/otp-validate/{partner_hash}` |
| Personal | `…/{id}/personal-info` | `POST /api/onboarding/loan-application/personal-info/{partner_hash}/{id}` |
| Laboral | `…/{id}/employment-info` | `POST /api/onboarding/loan-application/laboral-info/{partner_hash}/{id}` |
| Marketplace (listar) | `…/{id}/lenders` | `GET /api/onboarding/loan-application/lenders-v2/{id}` |
| Marketplace (seleccionar) | `…/{id}/lenders` (action) | `POST /api/onboarding/loan-application/update-user-request/{id}` |

> **[REMOVIDO 2026-07-08]** Las filas *"Entrada ecommerce"* (`checkout` → `ecommerce-request/create`) y *"Rehidratación ecommerce"* (`ecommerce-request/detail|by-user-request`) se quitaron: esos endpoints/rutas ya no existen en el wizard. El prefijo `:flow=ecommerce` sigue montado (`public-layout.tsx:11`) pero entra directo a `solicitar`, sin `erId` ni prefill.

**Diferencias clave de entrada (ecommerce/self-service vs asesor):**
- Ecommerce/self-service: público (sin `x-cognito-identity-id`), entra **directo a `solicitar`** (ya no por `checkout`/`erId`); sin prefill de tienda ni `is_ecommerce` (hoy `false` hardcodeado).
- Asesor/merchant: requiere login Cognito (`default-layout.tsx:18`), todos los pasos van con `x-cognito-identity-id`; el comercio se deriva del usuario (`/api/onboarding/loan-application/user`) y puede tomar la entrada dinámica alternativa (`modes`/`request-amount`) en vez de `solicitar`.

**unknown:** el `resendUrl` hardcodeado a `/self-service/` en `otp-verification.tsx:302` — no verifiqué su comportamiento real en los modos ecommerce/merchant.

Archivos clave: `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/apps/loan-request-wizard/app/routes.ts`, `app/routes/loan-application-form/{phone-number,otp-verification,loan-request-form,employment-info,merchant-mode}.tsx`, `app/routes/lenders-marketplace/available-lenders.tsx`, `app/layouts/{public-layout,default-layout}.tsx`, `app/utils/{route-helpers.ts,backend-auth-headers.server.ts}`, y los repos en `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/modules/loan-request-wizard/{loan-application-form,lenders-marketplace}/src/lib/infrastructure/`. *(Ya no existen `app/routes/ecommerce/checkout.tsx` ni `app/server/services/ecommerce-context.server.ts`.)*

---


## CreditopX (rt=2): biométrica + firma + espera

> Trazado sobre `frontend-monorepo` (wizard React Router v7, `apps/loan-request-wizard`) y `legacy-backend` (Laravel modular). Todas las rutas del wizard cuelgan del prefijo `:flow/:partner_hash/:loan_request_id` (self-service) — ver `apps/loan-request-wizard/app/routes.ts:6-51`. El flujo asesor cuelga de `merchant/:partner_hash/:loan_request_id` — `routes.ts:54-100`. `unknown`: no encontré literal "response_type=2" / "rt=2" en el wizard; el frontend ramifica por `step_details.type` y `lender.flow`, no por el `response_type` numérico (el `response_type` se evalúa en legacy, p.ej. `ContinueUserFlowController.php:130` lo usa solo para el caso `=4` Credifamilia).

---

### 0. Punto de entrada: confirmación / standBy (tras elegir lender)

**Pantalla `confirmation`** — `apps/loan-request-wizard/app/routes/loan-confirmation.tsx`.

- `loader` trae detalles vía `GetLoanRequestDetailsUc` (instanciado en `loan-confirmation.tsx:87`) → `LoanRequestRepository.getLoanRequestDetails` → `GET ${VITE_API_URL}/api/loans/customer/requests/{loanRequestId}`. Si el backend devuelve el guard de continuación, el repo retorna `kind: "continue_on_mobile"`; también maneja `credit_already_disbursed` / `credit_cancelled`.
- El componente (`export default :273`), si recibe `kind === "continue_on_mobile"`, renderiza el HANDOFF a celular (ver §1bis): `loan-confirmation.tsx:324`.
- La pantalla normal renderiza `<LoanConfirmation amount lender region .../>` (`:366`). Hay variantes previas full-bleed: `RevolvingCreditIntro` (crédito rotativo, `:344`) y `LenderIntroduction` (si `lender.show_intro_screen`, `:347-360`).

**`action` de confirmación = ramificación de validación** (mismo archivo, después del loader):
1. Chequea Ábaco primero (`CheckAbacoRequirementUc`, instanciado en `:191`) y redirige a `abaco`/`abaco/internal-error` si aplica.
2. Llama `ConfirmLoanRequestUc` (`:215`) → `POST /api/loans/customer/requests/confirm` (body `{ user_request_id }`).
3. Ramifica por `response.payload.step_details.type`:
   - `aws_validation` → `ROUTE_PATHS.identityValidation` (cámara in-app).
   - **`ado_validation` → `ROUTE_PATHS.identityValidationInstructions`** (la rama ADO que nos interesa).
   - `no_validation_required` → `ROUTE_PATHS.firstPaymentDate`.
   - fallback → `identityValidationInstructions`.

**Backend del confirm** — `legacy-backend/Modules/Loans/routes/api.php:95` → `ContinueUserFlowController::confirm` (`Modules/Loans/App/Http/Controllers/Customer/ContinueUserFlowController.php:68-119`):
- Lanza **Tusdatos (AML) en segundo plano** salvo `from_legacy=true` o **SmartPay**: `if (!$request->input('from_legacy', false) && !$userRequest->isSmartPay())` (`:90-99`). ⚠️ La condición ya **no** compara "path IMEI" directo: usa `!isSmartPay()`, y `isSmartPay()` = `isImeiPath() && lender_id===160` (`app/Models/UserRequest.php:189`) → solo salta el AML para SmartPay, no para cualquier path IMEI. `Tusdatos::background` → `TusdatosServiceInterface::getOrCreateBackground` (`app/Actions/RiskCentrals/Tusdatos.php:24-41`).
- Construye la respuesta con `CreditopXFlowService::getNextStepData` (`ContinueUserFlowController.php:104-108`).

**El `step_details.type` se decide aquí** — `CreditopXFlowService::getNextStepData` (`Modules/Loans/App/Services/CreditopXFlowService.php:69-127`) delega en `IdentityValidationStepResolver::resolve` (`Modules/Identity/App/Services/IdentityValidationStepResolver.php:15-113`):
- `IdentityValidationType::Ado` → `step_details.type = 'ado_validation'`, `validation_flow = 'ado_platform_enrollment'`, `external_platform => true` (`IdentityValidationStepResolver.php:49-63`).
- `None` → `no_validation_required` (`:18-30`); `AwsOcrRekognition` → `aws_validation` (`:32-47`).

**standBy / WhatsApp self-management** (rama de generación de solicitud, antes del confirm) — `Modules/Onboarding/App/Services/UserRequestService.php:610` setea `$data['standBy'] = true` (init `standBy => false` en `:435`); y el GATING WhatsApp:
```php
// UserRequestService.php:649-653
if ($lenderByAllied->user_self_management && ($url != null && $url !== '')) {
    $this->notificationService->sendSelfManagement($userRequest, $url);
    $data['showModal'] = true;
    $data['modalMessage'] = 'Se ha enviado un mensaje de WhatsApp con un link para continuar el proceso.';
}
```
`NotificationService::sendSelfManagement` (`Modules/Loans/App/Services/NotificationService.php:207-244`) arma monto/aliado/lender, resuelve país (SMS para DO o `+`), y envía vía `LoanMessagingServiceRepository::sendSelfManagement` con template `'lenders_message_self_management_'.$suffix` (`LoanMessagingServiceRepository.php:215-233`). Es decir: el link de continuación llega al celular del cliente **solo si `lenderByAllied->user_self_management` es truthy**.

---

### 1. Biométrica ADO (portal EXTERNO + redirect_url)

**Pantalla `identity-validation-instructions`** — `apps/loan-request-wizard/app/routes/identity-validation-instructions.tsx`.

- `loader` (`identity-validation-instructions.tsx:15-44`) llama `EnrollAdoValidationUc` → `IdentityValidationRepository.enrollAdoValidation` → `GET ${VITE_API_URL}/api/identity/ado/enroll?user_request_id={id}` (`identity-validation/.../identity-validation.repository.ts:267`). Si `!response.success` → `requestCanceled`. Devuelve `redirectUrl = response.payload.data.redirect_url`.
- La UI muestra los tips (buena luz, sin gafas, etc.) y el botón **Continuar** hace `window.location.href = redirectUrl` (`identity-validation-instructions.tsx:56-58`), es decir **navegación de página completa al portal EXTERNO de ADO** (no iframe).

**Backend del enroll** — `Modules/Identity/routes/api.php:90` → `AdoController::enroll` (`Modules/Identity/App/Http/Controllers/Customer/AdoController.php:46-89`):
- Genera un `reference = Str::uuid()` y construye el **callback URL hacia el wizard**:
```php
// AdoController.php:54-58
$callbackUrlBase = $this->urlGenerationService->buildUrl(sprintf(
  '/self-service/%s/%s/identity-validation-status?provider=ado&risk_central_user_id=%s',
  $userRequest->alliedBranch->hash, $userRequest->id, $reference));
```
- Resuelve credenciales ADO (por lender si es IMEI path, vía `Ado::getCredentials`; si no, `config('services.ado.*')`) — `getRiskCentralUserData` (`AdoController.php:252-272`).
- Persiste `RiskCentralUserData` con `uuid=$reference`, `risk_central_id` del centro `'Ado'`, y el `request` (`AdoController.php:72-78`).
- Devuelve el `redirect_url` al host de ADO:
```php
// AdoController.php:80-82
'redirect_url' => config('services.ado.host') . '/validar-persona' . '?' . http_build_query($requestData)
```

Proveedor: **ADO** (`ado-tech.com`, ver `@see https://docs.ado-tech.com/link/7#bkmrk-enroll` en `AdoController.php:44`). El segundo proveedor del pipeline es **Tusdatos (AML)**, lanzado en background por el `confirm` (§0).

---

### 1bis. HANDOFF al celular (QR + WhatsApp)

Dos mecanismos independientes:

**(a) QR / `continue_on_mobile` (guard de seguridad "continúa desde tu celular").** Cuando un loader rt=2 corre en un dispositivo no permitido, el repo retorna `continue_on_mobile` y el componente renderiza `<MobileContinuationPrompt qrCodeUrl continueUrl/>` (`modules/.../lenders-marketplace/src/components/MobileContinuationPrompt.tsx:10-49` — ilustración móvil, "Por motivos de seguridad debes continuar desde tu celular", `<img src={qrCodeUrl}>` + `continueUrl`). Se dispara en:
- `confirmation` → `loan-confirmation.tsx:262-270` (vía `continuationGuard.qrUrl` / `.continueUrl`).
- `first-payment-date` → `first-payment-date.tsx:113-116`.
- `payment-schedule` → `payment-schedule.tsx:106-109`.
- `sign-documents` → `sign-documents.tsx:125-128`.
El guard 403 se reconoce con `ContinuationGuardSchema` (p.ej. `promissory-note.repository.ts:125-131`, `identity-validation.repository.ts:456-460`).

**(b) QR del asesor en `loan-continue`.** El loader genera un QR apuntando a la URL `…/{loan_request_id}/continue` (o el `?url=` recibido): `GenerateQrUc` → `loan-continue.tsx:100-125`. Ese QR / link es lo que el asesor le muestra al cliente para que continúe en su propio teléfono. El envío del link por **WhatsApp** es el `sendSelfManagement` gateado por `user_self_management` descrito en §0.

---

### 2. Callback ADO → `identity-validation-status`

ADO, al terminar la captura en su portal, redirige al `callbackUrlBase` que arma el enroll (`AdoController.php:54-58`): `/self-service/{hash}/{ur}/identity-validation-status?provider=ado&risk_central_user_id={reference}`. O sea **ADO vuelve a `identity-validation-status.tsx`** (`routes.ts:34`).

> ⚠️ **Actualización 2026-07-08:** la ruta `waiting-validation/:risk_central_user_id` **ya no existe** — `waiting-validation.tsx` quedó **vacío (0 bytes)** y desregistrado (merge de mayo-2026), unificado en `identity-validation-status.tsx`. El texto anterior la citaba como receptora del callback.

- La pantalla, al recibir `?_Response` de ADO, lo **postea al callback en legacy**: `SubmitAdoResponseUc` → `IdentityValidationRepository.submitAdoResponse` → `POST ${VITE_API_URL}/api/identity/ado/enroll/callback/{loanRequestId}` con body `{ risk_central_user_id, response }` (`identity-validation.repository.ts:622`).

**Backend del callback** — `Modules/Identity/routes/api.php:93` → `AdoController::enrollCallback` (`Modules/Identity/App/Http/Controllers/Customer/AdoController.php:91-141`):
- Valida que el `uuid` corresponda al `user_id` del request (`:104-115`), guarda `data` (la respuesta cruda de ADO, `:117-119`), y **despacha el job de polling de estado**: `StatusCheck::dispatch($userRequest, $riskCentralUserData)` (`:122`).

**Job de polling de estado ADO** — `app/Jobs/RiskCentrals/Ado/StatusCheck.php:33-62`: llama `AdoService::checkStatus`; si `completed` → `AdoService::updateStatus(...)` y termina (`:39-42`); si no, se **re-despacha con delay de 2s** (`:61`). `AdoService::updateStatus` guarda `data` y **dispara el evento Echo** `StatusChanged` (`Modules/Identity/App/Services/AdoService.php:121-132`, dispatch en `:129`).

---

### 3. Espera / polling de validación (cliente)

> ⚠️ **Actualización 2026-07-08 — reestructurado.** Lo que este doc describía como dos pantallas (`waiting-validation.tsx` con polling HTTP y `validation-pending.tsx` con Echo) **ya no existe así**: ambos archivos quedaron **vacíos (0 bytes) y desregistrados** (merge mayo-2026). La espera del cliente se **unificó en `identity-validation-status.tsx`** (`routes.ts:34`), que combina **polling HTTP + socket** en una sola pantalla. `ValidationPending.tsx` sigue en el repo pero **sin montar** (solo storybook).

**(a) Polling HTTP (controller-based).** `identity-validation-status.tsx` monta `<ValidationPollingProvider mode="customer" .../>` (`:708-721`; `missingRecordPolicy` = `keep_polling` si el provider es AWS, si no `fatal_error`).
- El provider hace `fetch(buildValidationStatusPath(config))` en bucle. El path es **una resource route del wizard**:
```ts
// validation-polling.types.ts:87-89
return `/${config.flow}/${config.partnerHash}/${config.loanRequestId}/validation-status`;
```
- Esa resource route (`routes.ts:23` → `routes/api/validation-status.tsx`) llama `IdentityValidationRepository.checkValidationStatus` → `POST ${VITE_API_URL}/api/identity/validation-status` body `{ user_request_id }` (`identity-validation.repository.ts:666`) y agrega `validationStatusAbaco { required, completed }`.
- Intervalos/cap: `VALIDATION_POLL_INTERVAL_MS = 30s`, sube a `60s` tras 5min (`validation-polling.types.ts:4-6`; `getNextValidationPollInterval` `:130-134`). Máximos: `WAITING_VALIDATION_NON_ABACO_MAX_POLL_ATTEMPTS = 15`, `ABACO_VALIDATION_MAX_POLL_ATTEMPTS = 36`, `LOAN_CONTINUE_NON_ABACO_MAX_POLL_ATTEMPTS = 20` (`validation-polling.constants.ts:1-3`).
- **Máquina de fases — hoy son 7** (ganó `canceled`): `polling_validation | waiting_records | waiting_abaco | ready_to_route | fatal_error | timed_out | canceled` (`validation-polling.types.ts:13-20`; terminales = `ready_to_route/fatal_error/timed_out/canceled` en `TERMINAL_PHASES` `:81`). La resolución vive en `resolveValidationPollingSnapshot` (`:281-338`), descompuesta en helpers (`resolveErrorPhase`, `resolveValidationStatusPhase`, `resolveFinalValidationPhase`): `all_completed` → `ready_to_route` (o `waiting_abaco` si falta Ábaco); `not_found` → `waiting_records`; `aml_not_started` con policy `fatal_error` → `canceled`.
- Routing final: `tusdatos_aml.has_findings` → `requestCanceled`; `!ado.validated` → `retry-validation`; OK → `requestSent` (si Ábaco) o **`firstPaymentDate`**.

**(b) Socket (Echo/WebSocket).** El realtime del cliente hoy entra por `useValidationStatusSocket.ts` (`modules/.../identity-validation/src/lib/polling/`), suscrito en `identity-validation-status.tsx:503`:
```ts
echo.channel(`App.Models.UserRequest.${userId}`).listen(".ValidationStatusChanged", handleStatus)
```
(canal por `userId`, evento `.ValidationStatusChanged`.) La pantalla combina este socket con el `ValidationPollingProvider` del punto (a).

**Eventos Echo (backend).** Canal `App.Models.UserRequest.{user_id}` (OJO: `user_id`, no `user_request_id`):
- `App\Events\RiskCentrals\Ado\StatusChanged` — `broadcastOn` = `new Channel('App.Models.UserRequest.' . $this->userData->user_id)` (`app/Events/RiskCentrals/Ado/StatusChanged.php:31-37`); disparado por `AdoService::updateStatus` (`AdoService.php:129`).
- `App\Events\RiskCentrals\Tusdatos\BackgroundJobResolved` — igual sobre `riskCentralUserData->user_id` (`app/Events/RiskCentrals/Tusdatos/BackgroundJobResolved.php:29-34`). Disparado por el job `CheckBackgroundJobStatus` cuando el AML completa: `BackgroundJobResolved::dispatch($this->riskCentralUserData->fresh())` (`app/Jobs/RiskCentrals/Tusdatos/CheckBackgroundJobStatus.php:52`); el job (`handle` `:24`, `checkStatusById` `:35`) se re-despacha cada 5s mientras `!completed` (`:37-49`, dispatch `:45`).
- `unknown`: ambos canales se construyen como `Channel` público (no `PrivateChannel`); `routes/channels.php:16-18` solo autoriza `App.Models.User.{id}`, no `App.Models.UserRequest.*`.

**Payload del polling (backend)** — `ValidationStatusService::getValidationStatus` (`Modules/Identity/App/Services/ValidationStatusService.php:53-88`) devuelve `tusdatos_aml`, `ado`, `crosscore`, `all_completed`. ADO se considera validado con `state_id == 2`: `'validated' => ($result['state_id'] ?? null) == 2` (`:204`). Tusdatos expone `has_findings`/`findings_count` (`:139-148`); si AML no requerido, retorna `completed=true, skipped=true, has_findings=false` (`:100-112`).

---

### 4. `first-payment-date` (fecha de primer pago)

**`first-payment-date.tsx`** (`apps/loan-request-wizard/app/routes/first-payment-date.tsx`):
- `loader`: `GetFirstPaymentDatesUc` (`:51`) → `FirstPaymentDateRepository`. Maneja `credit_already_disbursed` → `loanApproved` (`:61`), `credit_cancelled` → `requestCanceled`. `stepper goToStep(2)` (`:188`).
- `action`: `ConfirmFirstPaymentDateUc.execute(loanRequestId, firstPaymentDate)` (`:120`) y redirige a **`paymentSchedule`**.
- Backend (`Modules/Loans/routes/api.php:71-72`): `POST .../promissory-note/{user_request_id}/confirm-payment-date` + `GET .../select-payment-date` (`PaymentScheduleController`).
- Render normal: `<PaymentDate cutoffType nextPaymentDates selectedCycle theme/>` (componente `:170`); rama `continue_on_mobile` → QR (`:214`).

---

### 5. `payment-schedule` (plan de cuotas)

**`payment-schedule.tsx`** (`apps/loan-request-wizard/app/routes/payment-schedule.tsx`):
- `loader`: `GetPaymentSchedulesUc` (`:52`) → `PaymentScheduleRepository`. Mismos guards disbursed/cancelled (`:85-94`). `goToStep(2)` (`:195`).
- `action`: `SelectPaymentScheduleUc.execute(loanRequestId, paymentSchedule)` (`:130`) → redirige a **`signDocuments`**.
- Backend (`Modules/Loans/routes/api.php:73-74`): `GET .../simulate-payment-schedule` + `POST .../confirm-payment-schedule` (`PaymentScheduleController`).
- Render: `<PaymentSchedule terms lender lifeInsurancePerMillion isRevolvingIncrement locale currency theme/>` (componente `:186`); rama `continue_on_mobile` → QR (`:221`).

---

### 6. `sign-documents` (firma pagaré) + OTP

**`sign-documents.tsx`** (`apps/loan-request-wizard/app/routes/sign-documents.tsx`):
- `loader`: `GetPromissoryNoteDocumentsUc` (`:68`) → `PromissoryNoteRepository.getPromissoryNoteDocuments` → `GET ${VITE_API_URL}/api/loans/customer/requests/promissory-note/{loanRequestId}`. Guards disbursed/cancelled/continue_on_mobile vía 403 (`continue_on_mobile` en `sign-documents.tsx:107`). `goToStep(3)` (`:212`).
- Render: `<SignDocuments documentsData theme/>` (componente `:203`). El componente `SignDocuments` (`modules/.../loan-origination/src/components/SignDocuments.tsx`) lista hasta 4 PDFs — **Consentimiento informado, Pagaré, Fondo de garantías, Contrato** —, abre diálogo, exige scroll al fondo (`hasScrolledDocumentsToBottom`) y el botón **"Firmar"** envía el `Form method="post"`.
- **`action`**: NO firma directamente; llama `SendPromissoryNoteOtpUc` (`:148`) → `POST .../promissory-note/validate/send-otp`, enmascara el celular (`maskPhoneNumber`) y redirige a **`otp-validation?cell_phone=…`**.

**`otp-validation.tsx`** (`apps/loan-request-wizard/app/routes/otp-validation.tsx`) — paso de firma con OTP:
- `action`: `resend` → `resendPromissoryNoteOtp` (`POST .../validate/resend-otp`); o `VerifyPromissoryNoteOtpUc` (`:145`) → `POST ${VITE_API_URL}/api/loans/requests/promissory-note/validate/verify-otp` body `{ user_request_id, otp }`.
- Si verifica OK:
  - Si `metadata.lender_path === "IMEI"` → `securityValidation` (`otp-validation.tsx:173`).
  - Si no → `AuthorizePromissoryNoteOtpUc` (`:178`) → `POST ${VITE_API_URL}/api/loans/requests/promissory-note/validate/authorize` body `{ user_request_id }`; si OK → **`loanApproved`** (`:203`).
- `goToStep(3)` (`:269`); bloquea salida.

**Backend OTP / firma** (`Modules/Loans/routes/api.php:77-80`):
- `verify-otp` → `ValidateOtpPromissoryNoteController::verifyOtp` (`ValidateOtpPromissoryNoteController.php:270-311`): valida OTP (`validateOtp`) y **transiciona a estado intermedio** (`transitionToIntermediate`, `:289`), devuelve `next_step => 'authorize'` (`:296`). Rechaza si ya está autorizado/estado 11 (`:278-285`; `isAlreadyAuthorized` = `statusId === 11`, `:34-37`).
- `validate/authorize` → `ValidateOtpPromissoryNoteController::disburse` (`:313-373`): `loanAuthorizationService->authorize($userRequestId, $otp_id)` (`:330`) — esto lleva a **Estado 11** y dispara la firma real (Netco/Deceval, ver excepciones `:344-362`). Tras autorizar, **notifica a la tienda ecommerce** (`notifyEcommerceStore` → `EcommerceRequestService::notifyStoreForUserRequest`, `:332-334`, `:381-389`) — el `process_url`/webhook al cierre.

---

### 7. `loan-approved`

**`loan-approved.tsx`** (`apps/loan-request-wizard/app/routes/loan-approved.tsx`):
- `loader`: `GetPromissoryNoteValidationUc` (`:39`) → `GET ${VITE_API_URL}/api/loans/customer/requests/promissory-note/validate/{loanRequestId}`. ⚠️ El `returnUrl` ecommerce vía `getEcommerceContextByLoanRequest` **ya no aplica** (el helper de contexto ecommerce fue removido, §Tronco).
- Render `<RequestStatus .../>` (componente `:94`): muestra monto desembolsado, soporte de crédito rotativo (`available/used/approved_limit`), y `profilePath` (consumer-hub si IMEI). Bloquea salida.

---

### 8. Espera del ASESOR (`loan-continue`)

Cuando el flujo lo conduce un asesor en el comercio, el asesor ve `merchant/:partner_hash/:loan_request_id/continue` (`routes.ts:125`) mientras el cliente hace ADO+firma en su propio teléfono.

**`loan-continue.tsx`** (`apps/loan-request-wizard/app/routes/loan-continue.tsx`) tiene DOS modos según Ábaco (`LoanContinueRoute`, `:425`):

**(a) NO-Ábaco (`NonAbacoLoanContinueRouteContent`, `:242`)** — polling al `advisor-status`. El `action` hace:
```ts
// loan-continue.tsx:162
fetch(`${apiUrl}/api/loans/requests/device/advisor-status/${userRequestId}`, { method: "GET", … })
```
- Lee `is_documents_signed` (acepta también `is_document_signed`). Mientras `!is_documents_signed` devuelve `success:true` sin redirect; cuando es `true`, redirige a **`imei`** (`ROUTE_PATHS.imei`) — parseo + redirect en `:190-217`.
- Cadencia IMEI: delay inicial `45s`, intervalo `10s`, total `10min` (`:20-24`); reintenta hasta `IMEI_MAX_POLL_ATTEMPTS`, luego permite chequeo manual "Consultar estado".
- Render `<Continue link isLoading qrUrl … />` — la pantalla con el QR (§1bis-b) para el handoff al cliente.

**(b) Ábaco (`AbacoLoanContinueRouteContent`, `:318`)** — envuelto en `ValidationPollingProvider mode="advisor" missingRecordPolicy="keep_polling" flow="merchant"` (`:438-450`). Usa el mismo polling de §3a y rutea (effect `:334-354`): `has_findings` → `requestCanceled`; ADO `validated` + Ábaco → `financialProfile`. Mensajes contextuales de espera (bloque `:356-388`).

**Backend del advisor-status** — `Modules/Loans/routes/api.php:90` → `AdvisorStatusController::checkSigningStatus` (`AdvisorStatusController.php:26-61`):
```php
'is_documents_signed' => $intermediateStatusId && $statusId === (int) $intermediateStatusId,  // :46
'is_disbursed'        => $statusId === 11,                                                      // :47
```
donde `$intermediateStatusId` = id del estado `'Autorizado pendiente desembolso'` (`:41`). Es decir, el asesor avanza cuando el cliente llega al **estado intermedio** (firmó el pagaré vía `transitionToIntermediate`, §6). Endpoint sin auth (`@unauthenticated`, `:24`) y fuera de los middlewares de origination (`api.php:87`).

---

### 9. Rama con CUOTA INICIAL (`initial-fee-payment`)

Cuando el crédito requiere cuota inicial (down payment), la rama es independiente y pasa por **Wompi**.

**`initial-fee-payment.tsx`** (`apps/loan-request-wizard/app/routes/initial-fee-payment.tsx`):
- `loader` (`:12-19`): `getInitialFeeData(loanRequestId, headers)` → backend `GET .../requests/initial-fee-payment/{user_request_id}` (`Modules/Loans/routes/api.php:62`). Devuelve `initial_fee_amount`, `total_amount`.
- `action` (`:21-38`): `initiateInitialFeePayment(...)` → backend `POST .../requests/initial-fee-payment/initiate` (`api.php:61`), obtiene `checkout_url` y hace `redirect(checkoutUrl)` al **checkout hospedado de Wompi**. Al volver, "Wompi lands on `/down-payment-validation/{txid}`" (`:36-37`, ruta `routes.ts:28`).

**Backend** — `InitialFeePaymentController` (`Modules/Loans/routes/api.php:60-67`): `initiate`, `show`, `checkStatus/{transaction_id}` (sin middlewares de origination, `:63-64`), `validate`, `{user_request_id}/confirmation`. La confirmación del pago Wompi se procesa por evento Echo `App\Events\Lenders\Wompi\BackgroundJobResolved` (clase en `app/Events/Lenders/Wompi/BackgroundJobResolved.php`, dispatch en `app/Actions/Lenders/Wompi.php`). `unknown`: no inspeccioné el cuerpo de `down-payment-validation.tsx` ni el `InitialFeePaymentController` en detalle — solo confirmé el cableado de rutas y el redirect Wompi.

---

### Resumen de orden + endpoints legacy

| # | Pantalla wizard (`apps/loan-request-wizard/app/routes/`) | Endpoint legacy clave | Resultado |
|---|---|---|---|
| 0 | `loan-confirmation.tsx` | `POST /api/loans/customer/requests/confirm` | ramifica por `step_details.type` |
| 1 | `identity-validation-instructions.tsx` | `GET /api/identity/ado/enroll?user_request_id=` | `redirect_url` → portal ADO externo |
| 2 | `identity-validation-status.tsx` (callback ADO) | `POST /api/identity/ado/enroll/callback/{id}` | despacha `Ado\StatusCheck` |
| 3 | `identity-validation-status.tsx` (polling + socket) | `POST /api/identity/validation-status` (poll) + Echo `Ado\StatusChanged`, `Tusdatos\BackgroundJobResolved` | `firstPaymentDate` / `requestCanceled` / `retry` |
| 4 | `first-payment-date.tsx` | `POST .../promissory-note/{id}/confirm-payment-date` | → `payment-schedule` |
| 5 | `payment-schedule.tsx` | `POST .../promissory-note/{id}/confirm-payment-schedule` | → `sign-documents` |
| 6 | `sign-documents.tsx` → `otp-validation.tsx` | `send-otp` → `verify-otp` → `validate/authorize` | Estado intermedio → Estado 11 |
| 7 | `loan-approved.tsx` | `GET .../promissory-note/validate/{id}` | pantalla de aprobación + `returnUrl` ecommerce |
| 8 | `loan-continue.tsx` (asesor) | `GET /api/loans/requests/device/advisor-status/{id}` | espera `is_documents_signed` → `imei` |
| 9 | `initial-fee-payment.tsx` | `POST .../requests/initial-fee-payment/initiate` (Wompi) | redirect Wompi → `down-payment-validation/{txid}` |

**Proveedores**: biométrica = **ADO** (`config('services.ado.host')/validar-persona`, `AdoController.php:81`); AML = **Tusdatos** (`Tusdatos::background`, `ContinueUserFlowController.php:94`). **Canal Echo**: `App.Models.UserRequest.{user_id}` (eventos `RiskCentrals\Ado\StatusChanged` y `RiskCentrals\Tusdatos\BackgroundJobResolved`).

**Notas / unknown**:
- No hay literal "rt=2"/"response_type=2" en el wizard; la ramificación es por `step_details.type` (`ado_validation`/`aws_validation`/`no_validation_required`) y `lender.flow`/`lender_path` (IMEI). El `response_type` numérico vive en legacy (`ContinueUserFlowController.php:133` lo usa para `=4`).
- ADO "validado" = `state_id == 2` (`ValidationStatusService.php:204`); AML cancelado = `tusdatos_aml.has_findings` (`waiting-validation.tsx:111`).
- El canal Echo usa `user_id` (no `user_request_id`), pese a llamarse `App.Models.UserRequest.*`; el componente front lo suscribe con `loanRequestId` (`ValidationPending.tsx:47`) — posible desajuste, pero no lo verifiqué a fondo (`unknown` si en práctica `user_id == loan_request_id` en algún entorno).
- No abrí `down-payment-validation.tsx` ni el cuerpo de `InitialFeePaymentController`/`security-validation.tsx`/`PromissoryNoteController::show`; solo el cableado de rutas.

---


## Agregadores (rt=0/1): redirección externa

Esta sección documenta el flujo de los lenders **agregadores** (response_type `0` = UTM y `1` = Integración) desde que el usuario selecciona el lender en el wizard hasta que sale a un portal externo. Contrasta el caso UTM puro (redirección a URL del proveedor) con el caso **integrado Bancolombia BNPL** (URL encriptada + `ProcessingView` escuchando Echo). El significado de cada `response_type` está fijado en el seeder: `0 => UTM`, `1 => Integración`, `2 => Creditop X` (`/Users/miguelochoa/Desktop/CREDITOP/github/legacy-backend/database/seeders/ResponseTypesTableSeeder.php:21-36`), y replicado en el front en `LENDER_RESPONSE_TYPE` (`/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/modules/loan-request-wizard/lenders-marketplace/src/lib/domain/constants/lender.constants.ts:37-42`, ahora incluye `CREDITOP_X_REVOLVING: 3`).

---

### 1. Disparo desde la UI: `handleLenderSelection`

Al pulsar un lender, el hook arma el payload y lo envía por `POST` (react-router `submit`) hacia la `action` de la ruta — no llama directamente al backend:

`/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/modules/loan-request-wizard/lenders-marketplace/src/components/available-lenders/hooks/useLenderSelection.ts:179-196`
```ts
const payload = {
      lender_allied_credential: lender.lender_allied_credential,
      no_pos: lender.no_pos,
      ...
      lender_id: lender.id,
      lender_name: lender.name,
      ...
      transaction_data: JSON.stringify(lender.transaction_data) ?? null,
};
return submit(payload, { method: "post" });
```

### 2. La `action` de la ruta llama al backend y ramifica según la respuesta

`/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/apps/loan-request-wizard/app/routes/lenders-marketplace/available-lenders.tsx:272-565`

La `action` server-side instancia `SelectLenderUc` y hace el `POST` a legacy:

- UseCase: `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/modules/loan-request-wizard/lenders-marketplace/src/lib/application/select-lender.uc.ts:7-13`
- Repo (fetch real): `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/modules/loan-request-wizard/lenders-marketplace/src/lib/infrastructure/repositories/loan-options.repository.ts:63-91`, que pega a:
  ```
  POST {VITE_API_URL}/api/onboarding/loan-application/update-user-request/{loanRequestId}
  ```

El **shape de la respuesta** que el front espera está en `LoanRequestResponse` (`/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/modules/loan-request-wizard/lenders-marketplace/src/lib/domain/entities/loan-option.entity.ts:238-258`): `url`, `qrUrl`, `openNewTab`, `showModal`, `modalMessage`, `openProcessModal`, `validateLenderOtp`, `isSelfManagement`.

Las ramas relevantes para agregadores, **en orden** (las ramas previas son de Creditop X / casos especiales y no aplican a rt=0/1 puro: **MOTAI** → redirect a `continue` (`available-lenders.tsx:471-476`) y **Creditop X showModal-sin-url** (`:484-494`). ⚠️ Ya **no** existen ramas `initial_fee` ni `standBy` en la action; el backend aún devuelve el flag `standBy` pero el front no ramifica por él):

1. **OTP in-house (Sistecrédito/Compensar)** — `available-lenders.tsx:479-481`:
   ```ts
   if (response.data.validateLenderOtp) {
         return routeHelpers.redirect(ROUTE_PATHS.validateLenderOtp(params.loan_request_id));
   }
   ```
   No sale a portal externo: navega **dentro del wizard** a `{loanRequestId}/validate-lender-otp` (`route-helpers.ts:192`). El wizard **se queda** (cambia de paso, no redirige fuera).

2. **Modal con link para copiar (p.ej. Addi)** — `available-lenders.tsx:497-507`: cuando `showModal && url != null`, **no** redirige; devuelve un `actionData` con `showModal/url/modalMessage/openNewTab` que el hook usa para abrir el `LenderResponseModal`.

3. **Redirección externa SIN popup (p.ej. Credifamilia)** — `available-lenders.tsx:510-512`:
   ```ts
   if (!isNil(response.data.url) && !response.data.openNewTab) {
         return routeHelpers.redirect(response.data.url);
   }
   ```
   Redirección server-side (HTTP 302) a la URL externa. `routeHelpers.redirect` para una URL absoluta devuelve `redirect(first)` directamente (`route-helpers.ts:58`). **El wizard se va**: el navegador sale del wizard hacia el portal del proveedor.

4. **Redirección externa CON intento de popup** — `available-lenders.tsx:516-523`:
   ```ts
   if (!isNil(response.data.url) && response.data.openNewTab) {
         return { tryPopup: true, url: response.data.url, lenderId, lenderName };
   }
   ```
   No redirige server-side; devuelve `tryPopup:true` y deja que el **cliente** intente `window.open` con fallback a `window.location.href` (ver §4).

5. **`openProcessModal` (p.ej. Meddipay)** — `available-lenders.tsx:527-537`: degrada a un modal con mensaje. No redirige.

### 3. Caso `tryPopup`: `window.open` + fallback a `window.location.href`

> ⚠️ **Actualización 2026-07-08:** ya **no** se abre el popup automáticamente al recibir `actionData` ni se muestra el toast "Continúa en {lender}". Ahora es en **dos pasos**: (1) el effect `tryPopup` (`useLenderSelection.ts:279-299`) marca el lender como *ready* (`setReadyLender({lenderId, lenderName, url})` + analytics `lender_ready_to_open`); (2) `openReadyLender` (`:201-232`), disparado por un **segundo clic del usuario** (`AvailableLenders.tsx:495-497`), hace `window.open(url,'_blank')` con fallback: si el popup se bloquea → `window.__EXTERNAL_NAVIGATION_IN_PROGRESS__=true; window.location.href=url`.

Comportamiento del wizard en este caso (dentro de `openReadyLender`):
- **Popup OK**: se abre `_blank` con el portal del proveedor; el wizard **se queda** abierto en la pestaña original.
- **Popup bloqueado / excepción**: `window.location.href = url` → el wizard **se va** (navegación dura a la URL externa).

### 4. El modal de link (`LenderResponseModal`)

Cuando la `action` devuelve `showModal:true` con `url`, el hook abre el modal (`useLenderSelection.ts:251-276`) y el componente muestra el enlace + botón "Copiar Enlace" (no navega solo):

`/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/modules/loan-request-wizard/lenders-marketplace/src/components/modals/LenderResponseModal.tsx:22-40, 91-126`. Aquí el wizard **espera**: el usuario copia el link y continúa el proceso por fuera. El cierre ocurre en el portal del proveedor. (El componente sumó un modo `awaitingConfirmation` para Meddipay y config por lender vía `getLenderModalConfig`; sigue sin navegar solo.)

---

### 5. Lado backend: cómo se construye la respuesta (`UserRequestService::updateUserRequest`)

`/Users/miguelochoa/Desktop/CREDITOP/github/legacy-backend/Modules/Onboarding/App/Services/UserRequestService.php:270-729` (entrada vía `ListLenderController::updateUserRequest`, `/Users/miguelochoa/Desktop/CREDITOP/github/legacy-backend/Modules/Onboarding/App/Http/Controllers/ListLenderController.php:66-73`).

Primero persiste el `UserRequest` con `user_request_status_id = 3` ("Selección de entidad") y `lender_id` (`UserRequestService.php:287-296`). Inicializa el `$data` con todos los flags en falso/null (`UserRequestService.php:427-438`).

La ramificación clave es **si existe `LenderAlliedCredential`** (credencial de integración para ese lender + branch):

**A) SIN credencial (`empty($credential)`)** → comportamiento UTM puro tanto para rt=0 como rt=1 (`UserRequestService.php:440-449`):
```php
case 0:
case 1:
      $data['url'] = $url;
      $data['isSelfManagement'] = $request->self_service_onboarding ?? false;
      if ($data['isSelfManagement']) { $data['user_request_id'] = $userRequest->id; }
      break;   // ⚠ openNewTab NO se asigna acá: se resuelve al final (ver Nota)
```
La `$url` es la **URL externa con UTMs** del proveedor, tomada de `LendersByAlliedBranch.url_utm` con fallback a `LendersByAllied.url_utm` (`UserRequestService.php:403-416`). Esto alimenta las ramas 3/4 del front (redirección externa con o sin popup según `openNewTab`).

**B) CON credencial (`$credential` presente)** → diverge por `response_type`:
- **rt=0** (`UserRequestService.php:467-469`): igual que UTM — `url` externa + `openNewTab`. (UTM, sin consumir integración.)
- **rt=1 — INTEGRACIÓN** (`UserRequestService.php:470-600`): "CONSUMIR SERVICIO DE INTEGRACION". Aquí el `url` ya **no** es UTM estático, sino generado por la integración concreta:
  - **Bancolombia BNPL** (`$credential->credential->has('bancolombia_type')`, `UserRequestService.php:481-490`): construye un **código encriptado** y la URL del flujo Bancolombia:
    ```php
    $id = $userRequest->id;
    $crc = hexdec($userRequest->alliedBranch->hash);
    $combined = ($id << 32) | ($crc & 0xFFFFFFFF);
    $encrypt_code = strtoupper(base_convert($combined, 10, 36));
    $url = app(UrlGenerationService::class)->getBancolombiaBnplRedirectUrl(
          $credential->credential['bancolombia_type'], $encrypt_code);
    ```
    La URL final es `bancolombia/{type}/explicacion-de-flujo/{encrypt_code}` (`/Users/miguelochoa/Desktop/CREDITOP/github/legacy-backend/Modules/Partner/App/Services/UrlGenerationService.php:124-132`). Es una **ruta del wizard** (no un dominio del proveedor): el flujo Bancolombia se origina dentro del front Creditop.
  - **Wompi** (`UserRequestService.php:491-499`): `url = route('customer.continue-user-flow.index', ...)` + registra en Wompi.
  - **Otros** (Credifamilia id 24, Welli 23/141/142/166, default) (`UserRequestService.php:500-557`): instancia `$lender->action` y toma `url` del `transaction['url']`. Welli ya no es solo id 23: cubre las 4 variantes con el DTO `WelliRegistrationData` (`:540-551`) + sync `changeClinic`/`updateStatus` (`:559-570`).
  - Cierra rt=1 con `openProcessModal = true` y casos por nombre (`UserRequestService.php:573-598`): **Sistecrédito** → `validateLenderOtp = $credential->...->has('sistecredito_pos')` (OTP in-house, no abre tab); **Compensar** → `validateLenderOtp = true`; **Meddipay** → `url = null` + `openProcessModal` (continúa en celular del cliente).

**Overrides finales** (aplican a todas las ramas, `UserRequestService.php:642-658`):
- `country_id == 60` → fuerza `qrUrl = url` + `showModal = true` (`UserRequestService.php:643-646`).
- `user_self_management` con url no vacía → envía WhatsApp con el link + `showModal` con mensaje (`UserRequestService.php:649-653`); el wizard **espera** (el cliente sigue por WhatsApp).
- Asesor no logueado y aliado no self-managed y sin ecommerce → `openNewTab=false` + modal "Continua el proceso ... con el asesor comercial" (`UserRequestService.php:654-658`).

> **Nota (actualizado 2026-07-08):** `openNewTab` ya **no** se calcula inline en cada rama. Se resuelve **una sola vez al final** (`UserRequestService.php:661-675`) vía `LenderTabBehaviorResolver->opensNewTab(...)` (resolver **compartido con el listado**), con guarda: si `showModal` o `validateLenderOtp` → `false`. Recibe `responseType`, `isAuthenticated`, `userSelfManagement`, `alliedSelfManaged`, `isEcommerce`, `hasUrl`, `lenderName`, `countryId`.

---

### 6. Caso INTEGRADO Bancolombia BNPL: `ProcessingView` + Echo

Tras la redirección a `bancolombia/bnpl/explicacion-de-flujo/{encrypt_code}` (origen del flujo BNPL en el wizard), el flujo llega a la ruta de procesamiento que monta `ProcessingView`:

Ruta: `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/apps/loan-request-wizard/app/routes/bancolombia/bnpl/processing.tsx:38-91, 114-138`. El loader decodifica el `encrypt_code` (`BancolombiaCodeDecoder.decode`), ejecuta `ExecuteBnplOriginationUc` y obtiene `userId` (= `user_id`, ver abajo) e `isSelfManagement`. Luego renderiza `ProcessingView` con `onSuccess` → navega a `bancolombia/bnpl/response/{encrypt_code}`.

`ProcessingView` **escucha el evento Echo** y espera el cierre asíncrono:

`/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/modules/loan-request-wizard/bancolombia-origination/src/ui/components/origination/shared/processing/ProcessingView.tsx:62-68`
```ts
const channelName = `App.Models.UserRequest.${userId}`;
Echo.channel(channelName)
      .listen("Lenders\\Bancolombia\\TransactionUpdate", handleTransactionUpdate)
      .error(() => { onError(); });
```
Al recibir el evento, si `event.transaction.user_request.user_request_status_id === 11` → `onSuccess()`, si no → `onError()` (`ProcessingView.tsx:53-60`). El wizard **se queda y espera** en esta vista ("Estamos procesando la solicitud ... Esta página se actualizará automáticamente", `ProcessingView.tsx:85-103`); no sale a un dominio externo del proveedor en este sub-flujo.

**Verificación del canal (ambos lados coinciden):**
- Front suscribe a `App.Models.UserRequest.{userId}` donde `userId` = `user_id` del payload de originación (`execute-bnpl-origination.uc.ts:28` → `userId: result.payload.user_id`; schema `bnpl-api.schema.ts:99`).
- Backend emite `TransactionUpdate` con `broadcastOn` = `new Channel('App.Models.UserRequest.' . $this->transaction->userRequest->user_id)` (`/Users/miguelochoa/Desktop/CREDITOP/github/legacy-backend/app/Events/Lenders/Bancolombia/TransactionUpdate.php:30-35`). Confirmado: ambos usan **`user_id`** (no `user_request_id`), por lo que el canal calza.
- El evento se dispara cuando Bancolombia reporta `transactionState === 'approved'`: marca el `UserRequest` como "Autorizada" y hace `TransactionUpdate::dispatch($transaction)` (`/Users/miguelochoa/Desktop/CREDITOP/github/legacy-backend/app/Http/Controllers/Api/BancolombiaController.php:161-171`). El payload del broadcast es `['transaction' => $this->transaction]` (`TransactionUpdate.php:42-47`); el front lee `event.transaction.user_request.user_request_status_id` y compara contra `11`.

> unknown: el estado `11` que `ProcessingView` chequea ("Autorizada") debería corresponder al `UserRequestStatus` name `'Autorizada'` que el controller asigna (`BancolombiaController.php:166`), pero no verifiqué en BD que el id de "Autorizada" sea exactamente `11`. El `MEMORY.md` menciona "Estado 11" como sello de CrediPullman, lo que sugiere `11` como estado de aprobación; tratar la igualdad `11 == Autorizada` como **no confirmada**.

---

### 7. Resumen: ¿el wizard se va o espera? + dónde cierra realmente

| Caso (rt) | Respuesta backend | Acción front (file:line) | Wizard |
|---|---|---|---|
| UTM sin popup (rt=0/1 sin credencial / Credifamilia) | `url != null`, `openNewTab=false` | `routeHelpers.redirect(url)` — `available-lenders.tsx:510-512` | **Se va** al portal externo |
| UTM con popup | `url != null`, `openNewTab=true` | `openReadyLender`: `window.open` + fallback `window.location.href` (2º clic) — `useLenderSelection.ts:215-226` | **Queda** (popup OK) / **se va** (bloqueado) |
| Modal de link (Addi) | `showModal=true`, `url!=null` | abre `LenderResponseModal` — `useLenderSelection.ts:251-276` | **Espera** (copiar link) |
| OTP in-house (Sistecrédito/Compensar) | `validateLenderOtp=true` | redirect interno a `validate-lender-otp` — `available-lenders.tsx:479-481` | **Queda** (otro paso del wizard) |
| Integrado Bancolombia BNPL (rt=1) | `url` = ruta `bancolombia/.../{encrypt_code}` | flujo BNPL → `ProcessingView` con Echo — `processing.tsx:114-138` | **Espera** escuchando `TransactionUpdate` |

**Cierre real y retorno (ecommerce):** Para los agregadores UTM/integración (rt=0/1) que salen a portal externo, **el cierre del crédito ocurre en el portal del proveedor** (Bancolombia, Sistecrédito, etc.), fuera del wizard Creditop. El retorno al comercio se hace por el `returnUrl` del flujo ecommerce.

> unknown: **no encontré en estos dos repos** (frontend-monorepo wizard + legacy-backend `UserRequestService`) la construcción ni el uso explícito del `returnUrl`/redirección de vuelta al ecommerce tras el cierre externo — no aparece en el flujo de `updateUserRequest`. Según `MEMORY.md` (`vtex-migration-legacy`, contrato base64/webhook ecommerce), el retorno por `returnUrl` se gestiona en la capa de conector ecommerce/webhook, no en la selección de lender. Tratar el mecanismo concreto de `returnUrl` como **no verificado en este alcance**.

---

Archivos clave:
- Front hook: `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/modules/loan-request-wizard/lenders-marketplace/src/components/available-lenders/hooks/useLenderSelection.ts`
- Front action (ramificación): `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/apps/loan-request-wizard/app/routes/lenders-marketplace/available-lenders.tsx`
- Front repo (fetch): `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/modules/loan-request-wizard/lenders-marketplace/src/lib/infrastructure/repositories/loan-options.repository.ts`
- Front modal: `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/modules/loan-request-wizard/lenders-marketplace/src/components/modals/LenderResponseModal.tsx`
- Front ProcessingView (Echo): `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/modules/loan-request-wizard/bancolombia-origination/src/ui/components/origination/shared/processing/ProcessingView.tsx`
- Front ruta BNPL processing: `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/apps/loan-request-wizard/app/routes/bancolombia/bnpl/processing.tsx`
- Backend service (response): `/Users/miguelochoa/Desktop/CREDITOP/github/legacy-backend/Modules/Onboarding/App/Services/UserRequestService.php`
- Backend URL Bancolombia: `/Users/miguelochoa/Desktop/CREDITOP/github/legacy-backend/Modules/Partner/App/Services/UrlGenerationService.php`
- Backend evento/dispatch: `/Users/miguelochoa/Desktop/CREDITOP/github/legacy-backend/app/Events/Lenders/Bancolombia/TransactionUpdate.php` y `/Users/miguelochoa/Desktop/CREDITOP/github/legacy-backend/app/Http/Controllers/Api/BancolombiaController.php`

---


## Páginas de espera y realtime (polling + Echo)

El wizard usa **dos mecanismos de espera distintos** según quién espera:
- **Polling HTTP** (action de React Router que hace `fetch` al backend cada N segundos): lo usan el **asesor** (`loan-continue` → `advisor-status`, `security-validation` → `client-status`) y la espera de validaciones (`validation-status` vía `ValidationPollingProvider`, en modo `advisor` o `customer`).
- **Realtime Laravel Echo + Pusher/soketi**: hoy lo consume el **cliente** vía `useValidationStatusSocket.ts` dentro de `identity-validation-status.tsx:503` (canal `App.Models.UserRequest.{userId}`, evento `.ValidationStatusChanged`).

> ⚠️ **Actualización 2026-07-08:** el lado CLIENTE se **unificó en `identity-validation-status.tsx`** (`routes.ts:34`), que combina el polling `validation-status` + el socket. `waiting-validation.tsx` y `validation-pending.tsx` quedaron **vacíos (0 bytes) y desregistrados**; `ValidationPending.tsx` sigue en el repo pero **sin montar**. Abajo se conserva la descripción histórica de ambos con esa salvedad.

---

### (a) Páginas de polling HTTP

#### 1. `loan-continue` — polling `advisor-status` (ASESOR / merchant)

Archivo: `apps/loan-request-wizard/app/routes/loan-continue.tsx`. Registrada bajo el layout **merchant** (`route("continue", "routes/loan-continue.tsx")`, `apps/loan-request-wizard/app/routes.ts:125`), o sea es pantalla del asesor. Tiene **dos sub-implementaciones** según si Ábaco es requerido (`LoanContinueRoute`, loan-continue.tsx:425-452):

- **Rama NO-Ábaco** → `NonAbacoLoanContinueRouteContent` (loan-continue.tsx:242-316). Esta es la que **pollea `advisor-status`**.
- **Rama Ábaco** → `AbacoLoanContinueRouteContent` (loan-continue.tsx:318-423), que en su lugar usa `ValidationPollingProvider` en `mode="advisor"` (ver sección (a).3).

**Qué pollea (rama no-Ábaco):** el `action` hace GET al backend (loan-continue.tsx:162-168):

```ts
const response = await fetch(`${apiUrl}/api/loans/requests/device/advisor-status/${userRequestId}`, {
      method: "GET",
      headers: { Accept: "application/json", ...(userAgent ? { "User-Agent": userAgent } : {}) },
});
```

**Condición de cierre — `is_documents_signed`** (loan-continue.tsx:190-217):

```ts
const data = (await response.json()) as AdvisorStatusResponse;
const isDocumentsSigned = Boolean(data.data?.is_documents_signed ?? data.data?.is_document_signed);
if (!data.success || !isDocumentsSigned) {
      return { success: true, advisorStatus: data, ... } satisfies ActionData;   // sigue esperando
}
...
const path = routeHelpers.buildPath(ROUTE_PATHS.imei(String(params.loan_request_id)));
return { success: true, redirectTo: path, advisorStatus: data, ... } satisfies ActionData;  // cierra → IMEI
```

Nota: acepta tanto `is_documents_signed` como el alias `is_document_signed` (interface en loan-continue.tsx:56-62). Al cerrar redirige a `ROUTE_PATHS.imei(...)` = `${loanRequestId}/imei` (route-helpers.ts:238). El componente reacciona al `redirectTo` con `navigate(..., { replace: true })` (loan-continue.tsx:267-271).

**Cadencia del polling** (solo se activa si `theme.lender.flow === "IMEI"`, loan-continue.tsx:253, 273-297):
- Delay inicial: `INITIAL_IMEI_POLL_DELAY_MS = 45 * 1000` (loan-continue.tsx:20).
- Intervalo: `IMEI_POLL_INTERVAL_MS = 10 * 1000` (loan-continue.tsx:21).
- Duración total: `IMEI_TOTAL_POLL_DURATION_MS = 10 * 60 * 1000` (loan-continue.tsx:22).
- Máx intentos: `IMEI_MAX_POLL_ATTEMPTS = Math.floor((600000 - 45000) / 10000) + 1` (loan-continue.tsx:23-24).
- Al agotarse (`pollAttempt >= IMEI_MAX_POLL_ATTEMPTS`) o ante fallo se setea `hasStoppedPolling` (loan-continue.tsx:278-286) y aparece botón manual "Consultar estado" (`handleManualStatusCheck`, loan-continue.tsx:257-265, 310-312).

#### 2. `device-imei` / `security-validation` — polling `client-status` (USUARIO)

**Importante (corrección de nomenclatura):** las rutas `imei/imei.tsx` e `imei/imei-scan.tsx` (apps/loan-request-wizard/app/routes/imei/) **NO pollean** — solo registran/escanean el IMEI. El polling de **`client-status`** vive en `apps/loan-request-wizard/app/routes/security-validation.tsx`, registrada bajo el layout customer (`route("security-validation", "routes/security-validation.tsx")`, routes.ts:65). Marcada "SmartPay".

**Qué pollea:** el `action` llama `imeiRepository.getClientStatus(userRequestId, headers)` (security-validation.tsx:80), que hace GET (device-imei.repository.ts:19-26):

```ts
const url = `${apiUrl}/api/loans/requests/device/client-status/${userRequestId}`;
const response = await fetch(url, { method: "GET", headers: { Accept: "application/json", ...(headers ?? {}) } });
...
return DeviceClientStatusResponseSchema.parse(json);
```

**Condición de cierre — `data.is_disbursed`** (security-validation.tsx:82-92):

```ts
if (!deviceStatusResponse.success || !deviceStatusResponse.data.is_disbursed) {
      return { success: true, deviceStatusResponse } satisfies ActionData;   // sigue esperando
}
const path = routeHelpers.buildPath(ROUTE_PATHS.loanApproved(String(params.loan_request_id)));
return { success: true, redirectTo: path, deviceStatusResponse } satisfies ActionData;  // cierra → loan-approved
```

El shape de la respuesta (`is_disbursed`, `is_imei_enrolled`, `status_id`, `lender_path`) está en `DeviceClientStatusDataSchema` (device-imei.schema.ts:40-51).

**Cadencia** (security-validation.tsx:11-13, 137-160):
- `INITIAL_POLL_DELAY_MS = 30 * 1000`, `POLL_INTERVAL_MS = 30 * 1000`, `MAX_POLL_ATTEMPTS = 20`.
- Igual patrón que loan-continue: al agotar intentos o fallo → `hasStoppedPolling` + botón manual "Consultar estado" (security-validation.tsx:142-150, 162-174).

#### 3. `validation-status` + `ValidationPollingProvider` (modo advisor / customer)

El endpoint que se pollea es la ruta interna `validation-status` (`route("validation-status", "routes/api/validation-status.tsx")`, routes.ts:23). Su `loader` (apps/loan-request-wizard/app/routes/api/validation-status.tsx) llama `repository.checkValidationStatus(...)` (validation-status.tsx:25) y, si Ábaco aplica y `all_completed`, además consulta resultados Ábaco (validation-status.tsx:58-79); devuelve `{ validationStatus, validationStatusAbaco, errorType, errorMessage }`.

El **motor de polling cliente** es `ValidationPollingProvider` (modules/loan-request-wizard/identity-validation/src/lib/polling/validation-polling-context.tsx) consumido vía `useValidationPollingController()` (useValidationPollingController.ts:4-12). El provider hace `fetch` en bucle a la URL construida por `buildValidationStatusPath` = `/${flow}/${partnerHash}/${loanRequestId}/validation-status` (validation-polling.types.ts:87-89), arrancando en el `useEffect` con `pollValidationStatus()` (validation-polling-context.tsx:78-180).

**Intervalos** (validation-polling.types.ts:4-6, 130-134): 30 s normal (`VALIDATION_POLL_INTERVAL_MS`), 60 s extendido (`VALIDATION_EXTENDED_POLL_INTERVAL_MS`) una vez superados 5 min de elapsed (`VALIDATION_EXTENDED_INTERVAL_THRESHOLD_MS`).

**Máquina de fases** `ValidationPollingPhase` (validation-polling.types.ts:13-20): `polling_validation | waiting_records | waiting_abaco | ready_to_route | fatal_error | timed_out | canceled` (7ª fase `canceled` sumada). La lógica de transición está en `resolveValidationPollingSnapshot` (validation-polling.types.ts:281-338, descompuesta en helpers `resolveErrorPhase`/`resolveValidationStatusPhase`/`resolveFinalValidationPhase`):
- `errorType === "not_found"` → `waiting_records` si `missingRecordPolicy === "keep_polling"`, si no `fatal_error`; nueva rama `aml_not_started`→`waiting_records`/`canceled` (types:167-169, 181-189).
- `validationStatus.data.all_completed` → `waiting_abaco` si Ábaco requerido y no completado, si no `ready_to_route`; atajo AML con findings/`aml_completed`→`ready_to_route` directo (types:206-208, 225-231).
- `attemptCount >= maxAttempts` → `timed_out` (resolveFinalValidationPhase, types:274-278).
- Fases terminales: `ready_to_route`, `fatal_error`, `timed_out` (`TERMINAL_PHASES`, types:81; `isTerminalValidationPhase`, types:126-128) — detienen el bucle.

**Dos modos / dos políticas según quién espera:**

- **MODO ADVISOR** — `loan-continue.tsx` rama Ábaco (`AbacoLoanContinueRouteContent`). Provider configurado con `flow="merchant"`, `mode="advisor"`, `missingRecordPolicy="keep_polling"`, `nonAbacoMaxAttempts={LOAN_CONTINUE_NON_ABACO_MAX_POLL_ATTEMPTS}` (=20), `abacoMaxAttempts={ABACO_VALIDATION_MAX_POLL_ATTEMPTS}` (=36) (loan-continue.tsx:438-448). **Condición de cierre / ruteo** (loan-continue.tsx:334-354): cuando `phase === "ready_to_route"`, si `tusdatos_aml.has_findings` → `requestCanceled`; si `!ado.validated` → no rutea (queda en error de asesor, ver loan-continue.tsx:356-388 con `getAbacoAdvisorValidationErrorDescription`); si Ábaco requerido y `ado.validated` → `financialProfile`.

- **MODO CUSTOMER** — hoy vive en `identity-validation-status.tsx` (`routes.ts:34`; layout customer) — *⚠ antes `waiting-validation.tsx` (`waiting-validation/:risk_central_user_id`), hoy vacío/desregistrado*. Provider con `flow={params.flow}`, `mode="customer"`, `missingRecordPolicy="fatal_error"`, `nonAbacoMaxAttempts={WAITING_VALIDATION_NON_ABACO_MAX_POLL_ATTEMPTS}` (=15), `abacoMaxAttempts={ABACO_VALIDATION_MAX_POLL_ATTEMPTS}` (=36) (waiting-validation.tsx:157-167). **Condición de cierre / ruteo** (waiting-validation.tsx:106-127): al `phase === "ready_to_route"`, si `tusdatos_aml.has_findings` → `requestCanceled`; si `!ado.validated` → `retryValidation?errorMessage=...` (usa `ado.state_name`); si OK → `requestSent` (Ábaco) o `firstPaymentDate` (no-Ábaco). Fases `fatal_error`/`timed_out` → `retryValidation` (waiting-validation.tsx:129-138). Además bloquea navegación de salida (`setBlocked(true, ...)`, waiting-validation.tsx:88-94) y oculta el stepper (`handle.showStepper = false`, waiting-validation.tsx:18-20).

Constantes de máximos en validation-polling.constants.ts:1-4. `ABACO_MIN_BLOCKING_DURATION_MS = 10 * 60 * 1000` (constants.ts:4) fuerza salir de `waiting_abaco` a `ready_to_route` tras 10 min (shouldStopBlockingOnAbaco types:163-165, aplicado en resolveFinalValidationPhase types:270-272).

El campo de cierre del backend que dispara el ruteo es `data.all_completed` (validation-status-response.entity.ts:24) y luego, ya en `ready_to_route`, los flags `data.ado.validated` (entity:13) y `data.tusdatos_aml.has_findings` (entity:9).

---

### (b) Realtime: Laravel Echo + Pusher/soketi (USUARIO)

#### Inicialización del cliente Echo

Archivo: `apps/loan-request-wizard/app/entry.client.tsx`. En el arranque del cliente, si hay `VITE_PUSHER_APP_KEY`, se crea Echo y se cuelga en `window.Echo` (entry.client.tsx:35-61):

```ts
const pusherKey = window.ENV.VITE_PUSHER_APP_KEY;
...
if (pusherKey) {
      const echo = EchoService.initialize({ pusherKey, pusherCluster: pusherCluster ?? "", pusherHost, pusherPort, pusherScheme });
      if (typeof window !== "undefined") {
            (window as unknown as WindowWithEcho).Echo = echo;
      }
}
```

`EchoService.initialize` (modules/loan-request-wizard/loan-origination/src/lib/infrastructure/echo.service.ts:20-46) es singleton (`echoInstance`), expone `Pusher` en `window.Pusher` (echo.service.ts:30-32) y construye `LaravelEcho` con `broadcaster: "pusher"`, `wsHost/wsPort/wssPort`, `forceTLS` derivado de `pusherScheme === "https"`, `enabledTransports: ["ws", "wss"]` (echo.service.ts:34-43). El uso de `wsHost`/`wsPort` (no cluster pusher.com) es lo que permite apuntar a **soketi** autoalojado. También expone `getInstance()` y `disconnect()` (echo.service.ts:48-57).

#### Consumo del realtime — hoy `useValidationStatusSocket` (histórico: `ValidationPending.tsx`)

> ⚠️ **Actualización 2026-07-08:** `validation-pending.tsx` está **vacío/desregistrado** y `ValidationPending.tsx` **no se monta**. El realtime del cliente hoy es `useValidationStatusSocket.ts` (canal `App.Models.UserRequest.{userId}`, evento `.ValidationStatusChanged`) consumido por `identity-validation-status.tsx:503`. Lo de abajo describe el componente histórico (sigue en el repo, sin uso).

Ruta que lo montaba: `validation-pending.tsx` (⚠ **hoy vacío/desregistrado** — `routes.ts:31` es ahora `route("confirmation", …)`). Esta ruta es del **usuario** y NO usa polling: en su `default export` (validation-pending.tsx:22-56) renderiza `<ValidationPending loanRequestId onValidationComplete onValidationError />`, con `onValidationComplete` → `navigate(paymentSchedule)` y `onValidationError` → `navigate(requestCanceled)` (validation-pending.tsx:41-47). También bloquea salida y fija `goToStep(1)` (validation-pending.tsx:26-36).

El componente `ValidationPending` (modules/loan-request-wizard/loan-origination/src/components/ValidationPending.tsx) se suscribe en un `useEffect` idempotente (`hasInitialized` ref, ValidationPending.tsx:14-18):

**Canal** (ValidationPending.tsx:47): `App.Models.UserRequest.${loanRequestId}` (canal público; usa `Echo.channel(...)`, no `private`).

**Eventos escuchados** (ValidationPending.tsx:49-59):

```ts
const channelName = `App.Models.UserRequest.${loanRequestId}`;
Echo.channel(channelName)
      .listen("RiskCentrals\\Tusdatos\\BackgroundJobResolved", handleBackgroundJobResolved)
      .error(() => { onValidationError(); });
Echo.channel(channelName)
      .listen("RiskCentrals\\Ado\\StatusChanged", handleBackgroundJobResolved)
      .error(() => { onValidationError(); });
```

**Qué hace la UI al recibir:** ambos eventos (`RiskCentrals\Tusdatos\BackgroundJobResolved` y `RiskCentrals\Ado\StatusChanged`) disparan el mismo handler `handleBackgroundJobResolved`, que es `debounce(() => onValidationComplete(), 500)` (ValidationPending.tsx:43-45) — es decir, ante cualquiera de los dos eventos (con 500 ms de antirebote para colapsar la llegada de ambos), llama `onValidationComplete` → la ruta navega a `payment-schedule`. Si Echo no está inicializado (`throw new Error("Echo is not initialized")`, ValidationPending.tsx:39) o cualquier `.error(...)` del canal, llama `onValidationError` → navega a `request-canceled` (ValidationPending.tsx:51-52, 56-58, 64-66). En cleanup hace `Echo.leaveChannel(channelName)` (ValidationPending.tsx:61-63).

El payload `ValidationEvent` (modules/loan-request-wizard/loan-origination/src/lib/domain/validation-event.entity.ts:7-14) tiene forma `{ userData?: { risk_central_id?: number }, success?, error? }`, pero el handler actual **ignora el payload** y solo reacciona a la llegada del evento.

---

### Resumen: ASESOR vs USUARIO

| Pantalla / archivo | Quién espera | Mecanismo | Endpoint / canal | Condición de cierre | Destino al cerrar |
|---|---|---|---|---|---|
| `loan-continue.tsx` no-Ábaco (`NonAbacoLoanContinueRouteContent`) | **Asesor** (merchant) | Polling action 45s→10s, máx ~57 intentos | GET `/api/loans/requests/device/advisor-status/{id}` | `data.is_documents_signed` (o alias `is_document_signed`) | `…/imei` |
| `loan-continue.tsx` Ábaco (`AbacoLoanContinueRouteContent`) | **Asesor** (merchant) | `ValidationPollingProvider` `mode="advisor"`, `keep_polling` | GET `…/validation-status` | `phase==="ready_to_route"` + `ado.validated` / `tusdatos_aml.has_findings` | `financial-profile` / `request-canceled` |
| `security-validation.tsx` (SmartPay) | **Usuario** | Polling action 30s, máx 20 | GET `/api/loans/requests/device/client-status/{id}` | `data.is_disbursed` | `loan-approved` |
| `identity-validation-status.tsx` (ex `waiting-validation.tsx`, vacío) | **Usuario** (customer) | `ValidationPollingProvider` `mode="customer"`, `fatal_error` | GET `…/validation-status` | `phase==="ready_to_route"` + `ado.validated` / `has_findings` | `first-payment-date` / `request-sent` / `retry-validation` / `request-canceled` |
| `identity-validation-status.tsx` (socket `useValidationStatusSocket`; ex `validation-pending.tsx`, vacío) | **Usuario** | **Realtime Echo/Pusher** (sin polling) | canal `App.Models.UserRequest.{id}`, eventos `Tusdatos\BackgroundJobResolved` y `Ado\StatusChanged` | llegada de cualquier evento (debounce 500ms) | `payment-schedule` (o `request-canceled` ante error de canal) |

**Distinción central:** el **asesor** confirma firma vía polling `advisor-status` (`is_documents_signed`) en `loan-continue` no-Ábaco, o vía `validation-status` en `mode="advisor"` cuando hay Ábaco. El **usuario** usa Echo/Pusher en `validation-pending` y/o polling `validation-status` en `mode="customer"` en `waiting-validation`; el polling `client-status` (`is_disbursed`) de `security-validation` también es del lado del usuario.

**Marcas `unknown`:**
- No encontré un archivo llamado literalmente `device-imei` que polle `client-status`; el consumidor real de `getClientStatus` es `security-validation.tsx` (las rutas `imei/*` solo registran/escanean IMEI, no pollean). Si el nombre "device-imei client-status" del prompt apuntaba a otra pantalla, no existe en el árbol actual (solo `security-validation.tsx`).
- El backend que emite los eventos Echo (servidor Laravel / soketi) está fuera de este repo; el shape exacto de cada evento más allá de `ValidationEvent` no es verificable desde el frontend (el handler igualmente lo ignora). Marcado `unknown` el contenido server-side.

Archivos clave (rutas absolutas):
- `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/apps/loan-request-wizard/app/routes/loan-continue.tsx`
- `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/apps/loan-request-wizard/app/routes/security-validation.tsx`
- `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/apps/loan-request-wizard/app/routes/waiting-validation.tsx`
- `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/apps/loan-request-wizard/app/routes/validation-pending.tsx`
- `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/apps/loan-request-wizard/app/routes/api/validation-status.tsx`
- `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/apps/loan-request-wizard/app/modules/imei/infrastructure/device-imei.repository.ts`
- `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/apps/loan-request-wizard/app/entry.client.tsx`
- `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/modules/loan-request-wizard/loan-origination/src/lib/infrastructure/echo.service.ts`
- `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/modules/loan-request-wizard/loan-origination/src/components/ValidationPending.tsx`
- `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/modules/loan-request-wizard/identity-validation/src/lib/polling/validation-polling-context.tsx`
- `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/modules/loan-request-wizard/identity-validation/src/lib/polling/validation-polling.types.ts`
- `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/modules/loan-request-wizard/identity-validation/src/lib/polling/validation-polling.constants.ts`
- `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/modules/loan-request-wizard/identity-validation/src/lib/domain/validation-status-response.entity.ts`
- `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo/modules/loan-request-wizard/loan-origination/src/lib/domain/validation-event.entity.ts`
- **[nuevos, lado cliente 2026-07-08]** `apps/loan-request-wizard/app/routes/identity-validation-status.tsx` (pantalla unificada polling+socket) y `modules/loan-request-wizard/identity-validation/src/lib/polling/useValidationStatusSocket.ts` (socket `.ValidationStatusChanged`).
> ⚠️ `waiting-validation.tsx` y `validation-pending.tsx` (listados arriba) están **vacíos (0 bytes)** y desregistrados; se dejan por trazabilidad histórica.

---


## Mapa backend (legacy-backend)

> Raíz: `/Users/miguelochoa/Desktop/CREDITOP/github/legacy-backend`. App Laravel modular (`Modules/{Onboarding,Loans,Identity,...}` + `app/`). Cada módulo monta sus rutas con un prefijo propio en su `RouteServiceProvider`:
> - Onboarding → `api/onboarding` (`Modules/Onboarding/App/Providers/RouteServiceProvider.php:41`)
> - Loans → `api/loans` (+ `api/loans/customer`, `api/loans/admin`) (`Modules/Loans/.../RouteServiceProvider.php:40,45,50`)
> - Identity → `api/identity` (`Modules/Identity/.../RouteServiceProvider.php:40`)

### Endpoints

**Selección de lender — MÓDULO Onboarding**
- Ruta: `Modules/Onboarding/routes/api.php:50`
  `Route::post('update-user-request/{user_request_id}', 'ListLenderController@updateUserRequest');` (prefijo `loan-application` → URL `api/onboarding/loan-application/update-user-request/{user_request_id}`).
- Controlador: `Modules/Onboarding/App/Http/Controllers/ListLenderController.php:66`
  ```php
  public function updateUserRequest(UpdateRequest $request)
  {
      $userRequestId = $request->route('user_request_id');
      $request->user_request_id = $userRequestId;
      $result = $this->userRequestService->updateUserRequest($request);
      return $this->success($result);
  }
  ```
- Delega en `Modules\Onboarding\App\Services\UserRequestService::updateUserRequest` — `Modules/Onboarding/App/Services/UserRequestService.php:270`. Nota: existen DOS `UserRequestService`; la de selección de lender es la de **Onboarding** (la de Loans, `Modules/Loans/App/Services/UserRequestService.php:318`, es otra `updateUserRequest` no usada aquí).
- Lógica clave de selección (`UserRequestService.php:272-296`): si el request no está en estado 11/25 y no hay lender previo distinto, fija `user_request_status_id = 3` ("Seleccion de entidad"), `lender_id`, montos, `fee_number`, `rate`, `initial_fee`, `corporate_user_id`; si no, hace `updateOrCreate`/`create` de una nueva `UserRequest` (rama ecommerce con `EcommerceRequest`/`order_key`, `UserRequestService.php:298-401`).

**continue-user-flow `index` / `confirm` — MÓDULO Loans**
- Rutas: `Modules/Loans/routes/api.php:94-95`
  `Route::get('/{user_request_id}', [ContinueUserFlowController::class, 'index']);`
  `Route::post('confirm', [ContinueUserFlowController::class, 'confirm']);`
  (dentro del grupo `prefix('requests')` con middleware `['onlyMobileValidation','validate.authorized.status','origination.flow']`, `Modules/Loans/routes/api.php:48` → URLs `api/loans/customer/requests/{user_request_id}` y `.../requests/confirm`).
- Controlador: `Modules/Loans/App/Http/Controllers/Customer/ContinueUserFlowController.php`
  - `index` (`:38`): `getUserRequestWithRelations(...)` + `resolveExtraDetails` (plan de pagos Credifamilia cuando `lender->response_type === 4`, `:123-158`).
  - `confirm` (`:68`): obtiene `UserRequest`, y si NO viene `from_legacy` y el lender **no** es SmartPay, lanza Tusdatos en background — `ContinueUserFlowController.php:90-99`. ⚠️ La condición ya no compara "path IMEI" directo sino `!isSmartPay()` (`isSmartPay()` = `isImeiPath() && lender_id===160`, `app/Models/UserRequest.php:189`):
    ```php
    if (!$request->input('from_legacy', false) && !$userRequest->isSmartPay()) {
        ...
        Tusdatos::background($user);
    }
    ```
    Luego arma la respuesta con `CreditopXFlowService::getNextStepData/buildValidationInfo/buildUserInfo` (`:103-110`).

**device/advisor-status & device/client-status — MÓDULO Loans**
- Rutas: `Modules/Loans/routes/api.php:90-91` (grupo `prefix('device')` que **quita** los middlewares de origination, `:87`):
  `Route::get('advisor-status/{user_request_id}', [AdvisorStatusController::class, 'checkSigningStatus']);`
  `Route::get('client-status/{user_request_id}', [AdvisorStatusController::class, 'checkEnrollmentStatus']);`
- Controlador: `Modules/Loans/App/Http/Controllers/Customer/AdvisorStatusController.php`
  - `checkSigningStatus` (`:26`): polling del asesor. `is_documents_signed` = status == "Autorizado pendiente desembolso", `is_disbursed` = status == 11 (`:43-50`).
  - `checkEnrollmentStatus` (`:71`): polling del cliente. `is_imei_enrolled` = existe `UserRequestProduct` con `imei` no nulo; `is_disbursed` = status == 11 (`:85-98`).

**promissory-note — MÓDULO Loans**
- Ruta: `Modules/Loans/routes/api.php:70`
  `Route::get('{user_request_id}', [PromissoryNoteController::class, 'show']);` (grupo `prefix('promissory-note')` dentro de `requests`).
- Controlador: `Modules/Loans/App/Http/Controllers/Customer/PromissoryNoteController.php:65` (`show`). Tres caminos: SmartPay (device-lock agreement, `:73-89`), Credifamilia lender_id 24 con/ sin Netco (`:94-120`), y flujo estándar consent + pagaré + garantía vía `PromissoryNoteService::processPromissoryNote` (`:122-163`).

**identity/ado/enroll + callback — MÓDULO Identity**
- Rutas: `Modules/Identity/routes/api.php:86-94` (grupo `prefix('ado')` con middleware `validate.authorized.status`):
  `Route::get('/', [AdoController::class, 'enroll'])->middleware('validate.risk.attempts');` (`:90`)
  `Route::post('callback/{user_request_id:int}', [AdoController::class, 'enrollCallback']);` (`:93`)
- Controlador: `Modules/Identity/App/Http/Controllers/Customer/AdoController.php`
  - `enroll` (`:46`): genera `reference` (uuid), arma `callback` self-service URL, crea `RiskCentralUserData`, y devuelve `redirect_url` a `services.ado.host . '/validar-persona'` (`:80-82`).
  - `enrollCallback` (`:91`): valida que el `RiskCentralUserData` (por uuid) pertenezca al `user_id` del request, guarda `data` con `getAdoResponse()` (`:117-119`), y **despacha el job** `StatusCheck::dispatch($userRequest, $riskCentralUserData);` (`AdoController.php:122`). Import: `use App\Jobs\RiskCentrals\Ado\StatusCheck;` (`:9`).

**validation-status — MÓDULO Identity**
- Ruta: `Modules/Identity/routes/api.php:111`
  `Route::post('validation-status', [ValidationStatusController::class, 'index']);`
- Controlador: `Modules/Identity/App/Http/Controllers/Customer/ValidationStatusController.php:25` (`index`) → `ValidationStatusServiceInterface::getValidationStatus($userRequestId)` (`:29`). Endpoint de **polling** del frontend cuando no hay WebSocket (TusDatos AML + validación de identidad por proveedor) — comentario en `:18-19`.

### Servicios

**CreditopXFlowService — MÓDULO Loans**
- `Modules/Loans/App/Services/CreditopXFlowService.php:10` (`class CreditopXFlowService`). Inyecta `IdentityValidationStepResolverInterface $stepResolver` (`:13,15-18`).
- `getNextStepData(UserRequest, array)` (`:69`): si validación manual reciente (<24h) devuelve `continue_flow`; si el lender no tiene `primaryIdentityValidationType` devuelve `error`; en otro caso delega en el resolver — `CreditopXFlowService.php:105-109`:
  ```php
  return $this->stepResolver->resolve(
      (int) $primaryValidation->identity_validation_type_id,
      (int) $userRequest->id,
      (int) $lender->id
  );
  ```
- Otros: `calculateValidationTime` (`:33`), `isManualValidationRecent` (`:53`), `buildValidationInfo` (`:112`), `buildUserInfo` (`:133`).

**IdentityValidationStepResolver — MÓDULO Identity**
- `Modules/Identity/App/Services/IdentityValidationStepResolver.php:8` (implementa `IdentityValidationStepResolverInterface`).
- `resolve(int $validationTypeId, int $userRequestId, int $lenderId): array` (`:15`): `switch` sobre `IdentityValidationType` enum → mapea a `next_step`/`step_details`: `None` → `continue_flow`/`skip` (`:18-30`), `AwsOcrRekognition` → `aws_validation` (`:32-47`), `Ado` → `ado_validation`/`ado_platform_enrollment` (`:49-63`), `CrossCore` → `crosscore_validation` (`:65-80`), `Evidente` → `evidente_validation` (`:82-98`), default → `error`/`unsupported_validation` (`:100-111`).

**AdoService — MÓDULO Identity**
- `Modules/Identity/App/Services/AdoService.php:15` (`class AdoService implements AdoServiceInterface`).
- `checkStatus(RiskCentralUserData, ?Carbon, ?UserRequest): array` (`:21`): si no hay `TransactionId` → `not_started`; si `shouldGiveUp` → `handleTimeout` (estado 17); llama `Ado::verify(...)`, mapea `IdState` vía `mapAdoState` (`:160-178`), y detecta document mismatch (state 98) cuando el documento escaneado no coincide (`:48-73`).
- `updateStatus(RiskCentralUserData, array): RiskCentralUserData` (`:121`): persiste `data` y **dispara el evento broadcast** — `AdoService.php:129`: `StatusChanged::dispatch($userDataCopy);` (import `use App\Events\RiskCentrals\Ado\StatusChanged;` en `:6`).

**NotificationService / TwilioMessagingService — MÓDULO Loans (+ app/ y System)**
- Existen dos `NotificationService` distintos:
  - **Loans**: `Modules/Loans/App/Services/NotificationService.php:15`. Maneja notificaciones del flujo de crédito: `sendAuthorizationNotifications` (`:83`), `sendSms` (`:122`), `sendClientImeiRegisteredNotification` (`:128`), `sendImeiContractNotification` (`:140`), `sendAdvisorSigningCompleteNotification` (`:186`), `sendVoucherEmail` (`:199`), `sendSelfManagement` (`:207`). Usado por `DeviceController` (`Modules/Loans/App/Http/Controllers/Customer/DeviceController.php:12,21`; p.ej. `sendClientImeiRegisteredNotification` en `:54`) y `UserDocumentService`. Escribe en `TwilioLog` (`NotificationService.php:231,261`).
  - **System** (genérico multicanal): `Modules/System/App/Services/NotificationService.php:12`. `sendEmail`/`sendSMS`/`sendWhatsApp`/`sendWebhook`/`sendGoogleChatMessage`/`sendMultiChannel` (`:25,75,105,133,167,205`); el SMS intenta SNS y cae a Twilio vía `TwilioController` (`:80-88,343`).
- `TwilioMessagingService` también está duplicado:
  - **Loans**: `Modules/Loans/App/Services/TwilioMessagingService.php:10`. `sendContinueLinkWhenDesktop` (`:19`), `sendSelfManagement` (`:44`), `sendPaymentDateConfirmation` (`:75`); resuelve driver con `resolveDriver` (`:106`). Registrado en `Modules/Loans/App/Providers/LoansServiceProvider.php`; usado por `CreditChangeController` (Customer/Consumer) y `CreditopXRequestHistoryController`.
  - **app/** (legacy raíz): `app/Services/TwilioMessagingService.php:10` (`sendContinueLinkWhenDesktop` `:19`). ⚠️ **Sin callers hoy (código muerto)**: `RedirectIdValidationIfDesktop.php:12` importa la versión del **módulo Loans** (`use Modules\Loans\App\Services\TwilioMessagingService as ServicesTwilioMessagingService`), no esta copia de `app/`.
  - unknown: el prompt cita "NotificationService/TwilioMessagingService" como pareja; no encontré una relación de dependencia directa entre ellos (el `NotificationService` de Loans no inyecta `TwilioMessagingService`; usa `PhoneService` + `Notification` + `TwilioLog`).

### Jobs

**StatusCheck (ADO) — MÓDULO app/ (raíz), consumido por Identity**
- `app/Jobs/RiskCentrals/Ado/StatusCheck.php:15` (`implements ShouldQueue`).
- Constructor: `UserRequest $userRequest`, `RiskCentralUserData $userData`, `?Carbon $created_at` (`:22-28`).
- `handle(AdoService $adoService)` (`:33`): llama `adoService->checkStatus(...)`; si `completed`, `adoService->updateStatus(...)` y retorna (`:38-42`); si no, se **re-despacha** con delay de 2s — `StatusCheck.php:61`: `static::dispatch($this->userRequest, $this->userData, $this->created_at)->delay(now()->addSeconds(2));`.
- Despachado desde `AdoController::enrollCallback` (`:122`) y `AdoController::verify` (`:176`).

**CheckBackgroundJobStatus (Tusdatos) — MÓDULO app/ (raíz), consumido por Identity**
- `app/Jobs/RiskCentrals/Tusdatos/CheckBackgroundJobStatus.php:14` (`implements ShouldQueue`).
- Constructor: `RiskCentralUserData $riskCentralUserData` (`:21-25`).
- `handle(TusdatosServiceInterface $tusdatosService)` (`:24`): `checkStatusById(...)` (`:35`); si no `completed`, re-despacha con delay 5s (`:37-49`, dispatch en `:45`); si completado, **dispara el evento** — `CheckBackgroundJobStatus.php:52`: `BackgroundJobResolved::dispatch($this->riskCentralUserData->fresh());` (import `use App\Events\RiskCentrals\Tusdatos\BackgroundJobResolved;` en `:5`).
- Despachado desde `Modules/Identity/App/Services/TusDatosService.php:515` (`->delay(now()->addSeconds(60))`) y `Modules/System/App/Http/Controllers/JobsController.php:31` (`dispatchSync`).

### Eventos broadcast + canal

**Ado\StatusChanged — MÓDULO app/ (raíz)**
- `app/Events/RiskCentrals/Ado/StatusChanged.php:12` (`class StatusChanged implements ShouldBroadcast`).
- Payload: `public RiskCentralUserData $userData` (`:19-21`).
- Canal (`broadcastOn`, `:31-36`):
  ```php
  return [
      new Channel('App.Models.UserRequest.' . $this->userData->user_id),
  ];
  ```
  Es un `Channel` **público** (no `PrivateChannel`), nombre `App.Models.UserRequest.{user_id}`.
- Disparado por `AdoService::updateStatus` (`Modules/Identity/App/Services/AdoService.php:129`).

**Tusdatos\BackgroundJobResolved — MÓDULO app/ (raíz)**
- `app/Events/RiskCentrals/Tusdatos/BackgroundJobResolved.php:12` (`implements ShouldBroadcast`).
- Payload: `public RiskCentralUserData $riskCentralUserData` (`:19-22`).
- Canal (`broadcastOn`, `:29-34`): mismo patrón público `new Channel('App.Models.UserRequest.' . $this->riskCentralUserData->user_id)`.
- `broadcastWith()` (`:41-77`): proyecta `status`/`completed` (`estado === 'finalizado'`), `has_findings`/`findings_count`/`findings` (`hallazgos`) y `has_error`/`error`/`error_message`.
- Disparado por `CheckBackgroundJobStatus` (`app/Jobs/RiskCentrals/Tusdatos/CheckBackgroundJobStatus.php:52`).

**Canal — nota importante (MÓDULO routes/)**
- Ambos eventos transmiten en el canal **público** `App.Models.UserRequest.{user_id}`, declarado inline en cada `broadcastOn()`. Este canal **NO** está registrado en `routes/channels.php` — ese archivo solo declara el canal privado por defecto `App.Models.User.{id}` (`routes/channels.php:16-18`). Al ser `Channel` público no requiere callback de autorización, por eso funciona sin estar listado. (Distinto del homónimo `app/Events/Lenders/Wompi/BackgroundJobResolved.php`, que es del flujo Wompi y NO el de Tusdatos.)

---

## Plano backend/datos — verificado (2º barrido: 31 agentes, 92 hallazgos, **0 dep código legacy→application**)

Segundo barrido sobre config + rutas + cross-calls de **ambos backends**, con verificación adversarial. Resultado: **cero dependencias de código `legacy-backend → application`**. Lo que hay es **infraestructura compartida lateral** (solo confirmable con `.env` de prod) y una **dependencia funcional de los flujos AGREGADORES** (webhooks). Por plano:

### DB — sin dependencia de código; posible **RDS compartida (runtime)**
- `config/database.php` byte-idéntico (scaffold) → **mismos nombres de env** (`DB_HOST/DATABASE/…`). Apuntan a la misma RDS **solo si los valores de `.env` de prod coinciden** (NEEDS-RUNTIME). No es "legacy llama a application"; sería **DB compartida** (acople de datos lateral, esperado en migración).
- **`pullman_db`** (SQL Server del partner): `application` lo usa **activo** (`CreditopXPaymentController.php:647` → pagos); `legacy` tiene el mismo código **sin callers** (stub). No crea dependencia hacia application.
- **Redis**: mismos nombres de env; el `prefix` sale de `APP_NAME` → si difieren, keys aisladas aun en el mismo host.

### Sesión/cookie — **LIMPIO (por config)**
- `config/session.php` **casi** idéntico (⚠ difiere 1 línea: el default del flag `secure` de la cookie en application, `:171` `env('SESSION_SECURE_COOKIE', env('APP_ENV','production') !== 'local')`; database/queue/broadcasting sí byte-idénticos): `SESSION_DRIVER=file` (disco local de cada host), `SESSION_DOMAIN` unset (cookie host-only, **no** `.creditop.com`). Nombre de cookie coincide (`creditop_session`) pero **nombre ≠ sesión compartida** sin store+dominio+`APP_KEY` comunes. Prod = NEEDS-RUNTIME; aun compartida sería lateral.

### Broadcasting/realtime — **dos publishers al mismo canal (lateral)**, NEEDS-RUNTIME
- Config byte-idéntica. **Ambos** backends publican `ShouldBroadcast` al **mismo canal público** `App.Models.UserRequest.{user_id}`. legacy: Bancolombia/Sistecredito/Wompi `TransactionUpdate`, Ado `StatusChanged`, Tusdatos `BackgroundJobResolved`. application: esos + Meddipay/Prami (exclusivos de application).
- **Ninguno consume los eventos del otro** → no es dependencia legacy→application; sería un **bus realtime compartido con dos emisores** si en prod comparten `PUSHER_APP_KEY/HOST` (en local legacy = `BROADCAST_DRIVER=log`, ni publica).

### Cola/cron — legacy autocontenido; broker compartido = runtime
- `config/queue.php` byte-idéntico. **CRON IMEI** (lock 04:00 / unlock 05:00 / unroll 06:00) **solo en legacy** (`app/Console/Kernel.php:15-17`); application no agenda eso. Los `StatusCheck` por lender son **pollers auto-re-despachados** desde las Actions de originación (no cron), en ambos.
- Sin evidencia de que legacy **encole jobs que procese el worker de application** (ni al revés). Riesgo solo si comparten **mismo Redis + mismos nombres de cola** (application usa cola `high` para risk/pago; legacy usa default) → NEEDS-RUNTIME, probablemente aislado.

### Webhooks entrantes — ⚠️ **LOS AGREGADORES SIGUEN EN `application`** (lo más relevante para matar el monolito)
Quién **recibe** el callback del tercero, por lender:
- **En `application` (NO migrado):** **Bancolombia** (`bnpl/webhook`, `consumer-loan/webhook`), **Sistecrédito** (`api/sistecredito/webhook`), **Payvalida**, **Approbe**, **Welli**, **Banco de Bogotá**, **Corbeta** (`processWebhookCorbeta`, `get-request`), **Wompi**. → **estos flujos rt=0/1 todavía dependen de que `application` esté vivo para recibir el callback.**
- **En `legacy-backend` (migrado):** **VTEX** (`/vtex/*`), **ADO** (`identity/ado/enroll/callback`), **CrossCore** biométrico (Credifamilia V2).
- **Implicación:** **CreditopX (rt=2) está migrado** (ADO callback en legacy). **Los agregadores (rt=0/1) NO** — para apagar `application` hay que migrar sus webhooks entrantes a legacy.

### Cross-calls HTTP — **0 activas legacy→application**
- legacy **no** hace llamadas HTTP activas a application (ni queda ya la referencia comentada: `INTERNAL_APPLICATION_API_URL` / `processWebhookCorbeta` fueron **borrados** de `BancolombiaService.php`; `git log -S` los ubica hasta el commit `85b8e978`).
- Sí **genera URLs hacia el monolito**: setting `front_url` (= `aliados.creditop.com`, `AlliedManagementService.php:305`, QR onboarding aliado) y `config/app.php:63` (return URLs a pasarelas). Es **generación de URL / handoff de navegador**, no llamada de runtime. El acople real es **`application → legacy`** (`BaseApiClient` → `INTERNAL_LEGACY_API_URL`), lo esperado.

### Veredicto del plano backend/datos
**No existe ninguna dependencia de código runtime `legacy-backend → application`.** Queda:
1. **Infra compartida lateral** (RDS, Redis, Pusher, `pullman_db`) — solo confirmable con `.env` de prod. No bloquea matar el monolito, pero implica **datos compartidos** durante la transición.
2. **Webhooks de agregadores (rt=0/1) aún en `application`** — **dependencia funcional real**: migrar esos webhooks entrantes a legacy antes de apagar el monolito. **CreditopX (rt=2) ya no depende de application.**
3. **`front_url`/return URLs** de legacy apuntan a `aliados.creditop.com` — revisar al migrar.

### Confirmar en runtime (no por código)
- Valores `.env` prod: ¿misma RDS (`DB_HOST`)? ¿mismo Redis (`REDIS_HOST`)? ¿mismo `PUSHER_APP_KEY/HOST` + `BROADCAST_DRIVER`? ¿`SESSION_DOMAIN`/`APP_KEY` comparten sesión?
- Hosts de `VITE_GATEWAY_URL` / `FINANCIAL_HEALTH_API_URL`.
- Tráfico real: ¿el navegador termina en `aliados.creditop.com` en algún paso?
- Mirror local ≠ prod (drivers fake).

## Para más detalle (docs del repo)

- [MAPA-FLUJOS.md](./MAPA-FLUJOS.md) — encadenamiento FE↔BE por flujo (A entrada asesor · B ecommerce · C marketplace · D CreditopX · E externos · F SmartPay).
- [REFERENCIA-FLUJOS.md](./REFERENCIA-FLUJOS.md) — mecanismo técnico por `response_type` (Estándar/Pullman/Corbeta/Cupo/Motai/SmartPay/Bancolombia/Ecommerce/Externos/Credifamilia).
- [hallazgos-backend.md](../operacion/hallazgos-backend.md) — webhooks entrantes, SNS/Twilio, `front_url`→monolito, jobs/cola.
- [LOGICA-QUEMADA.md](./LOGICA-QUEMADA.md) — dos bases, `pullman_db`.
- [MODELO-DATOS.md](./MODELO-DATOS.md) · [LOGICA-QUEMADA.md](./LOGICA-QUEMADA.md) — modelo de datos + lógica hardcodeada (incl. pantallas que viven solo en `application`).
