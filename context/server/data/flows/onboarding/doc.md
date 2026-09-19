# Onboarding · contexto
> **estado:** al día con main · La fase de SOLICITUD: entrada por link de sucursal → celular/OTP → nace la `user_request` → formulario personal/laboral → disparo del listado. Contrato de ruteo por `error_code` ONB0xx, no por HTTP status.

## Qué es
Onboarding es la fase que **arma la solicitud** antes de que la consolidación (`getLenders`) decida qué se ofrece. El usuario entra por un **hash de sucursal**, registra celular, valida OTP y llena el formulario; el sujeto que resulta —la `user_request` + los datos personales/laborales + el perfil de buró (KYC)— es lo que después evalúan las reglas.

Lo que hay que entender antes de tocar nada: **esta fase está implementada TRES veces** sobre la misma base de datos.

| Generación | Dónde | Estado real (verificado) |
|---|---|---|
| **G1 · Inertia** | `application/app/Http/Controllers/Customer/*` | Viva y por defecto. Delega a G2 **paso por paso**, con allowlist y fallback local. |
| **G2 · módulo Onboarding** | `legacy-backend/Modules/Onboarding` (198 archivos: 38 controllers, 63 services, 18 repositories, 29 form-requests, 14 tests) | Viva. Es la que consume **el wizard React** y a la que G1 delega. Prefijo `api/onboarding`. |
| **G3 · nueva arquitectura** | `Modules/OnboardingV2` + `Modules/UserRequestV1` (`api/v2/onboarding`) | Registrada y activa, **sin ningún consumidor en los 3 repos**. `otp-auth/validate` está implementada; `personal-info` **YA ESTÁ VIVA** — el early-return de 501 se retiró y el guardado real corre (fechas calendario, sólo usuarios temporales, dirección y estrato a `user_field_values`, sin consultar centrales). El código OBV21000 quedó en el mapa **sin referencias**, como interruptor de apagado (`StorePersonalInfoService:39`). ⚠ El docblock del CONTROLADOR todavía dice «always responds 501» — está viejo; manda el servicio. (Corregido dos veces el 2026-08-28: primero leí el comentario del controlador y afirmé que seguía 501.) |

Y hay **dos frentes**: el Inertia de `application` y el wizard React (`frontend-monorepo/apps/loan-request-wizard`). El corte entre uno y otro NO es por repo ni por deploy: es un **allowlist en BD** que se lee en `SimulatorController::indexV2` y decide si redirige al wizard nuevo o renderiza la pantalla vieja.

## Antes de concluir

**Bugs verificados en el camino feliz** — ⚠ **los dos siguen vivos, recomprobados contra `main` el 2026-09-18.** Un bullet de bug sin fecha manda a perseguir algo que puede haberse arreglado; éstos no.
- `UserRequestController.php:1517` — el `&&` quedó **dentro** del segundo `str_contains`: `str_contains($user->document_number, 'TEMP' && $userRequest->user_request_status_id == 1)`. El needle termina siendo un bool coercionado (`"1"` o `""`), y `str_contains($s, "")` es siempre `true`. La guarda de "usuario temporal en estado 1" no valida lo que dice.
- `PersonalInfoController.php:1044` — la URL de delegación interpola `$userRequestIdSessionKey` (la **clave** `'user_request_id_v2'`) en vez de `$user_request_id` (asignado en `PersonalInfoController.php:1019` y nunca usado). La llamada a `laboral-info/{hash}/user_request_id_v2` no puede resolver → cae siempre al `catch` y al método local. La delegación de laboral-info está **rota en silencio**.

**Parallel-run: qué delega y qué no** (application → legacy, verificado uno por uno)
- `phone/register`: delegado **siempre**, sin allowlist.
- `otp-validate`: delegado **sólo** si el comercio está en el Setting `allowed_bypass_comerces`; tres caminos de fallback local (sin sesión / no allowlisted / excepción).
- `personal-info`: **nunca** se delega — `storePersonalInfoV2` es local.
- `laboral-info`: allowlisted pero roto (arriba).
- `lenders`: la delegación está **comentada**; `entidades-v2` resuelve con el `LenderRetrievalService` de `application`.

**Gemelos que divergen**
- `UserRequestObserver`: en `application` el `updated()` despacha `AchievementCheck` + `BonificationCheck`; en `legacy-backend` esos despachos están **comentados** y en su lugar notifica al comercio en estados finales `[6,7,8,11]`. Quién escribe la UR cambia los efectos secundarios.
- `createTemporalUser` está duplicado (`RegisterCellPhoneService` y `UserService`).
- La guarda para pasar a estado 3 es `!= 11` en G1 y `!= 11 && != 25` en G2.

**Entornos y testing**
- `OnboardingController.php:1270-1272` — en `local`/`development`, `hadPreApproveLender` se stubea con **`random_int(0,1)`**. El flujo es **no determinístico** en local: la misma corrida a veces dispara Experian y a veces la saltea. Hay un segundo stub igual en `OnboardingController.php:400`.
- `OtpService.php:443-449` — **ya NO es «1111 fijo sin leer Redis»**: primero intenta `readOtpFromRedis` y **solo si el cache no entrega** cae a **1111**, y solo en `local` (`OtpService.php:447`). En develop/prod no hay caída: se aborta (OBS-OTP-01, `OtpService.php:451-455`) en vez de persistir un espejo en `0`. Con `qa_otp_bypass_phones` (sólo `local`/`development`) el OTP son los **últimos 4 dígitos del teléfono**, y ese mismo bypass **saltea el rate limit** de personal-info.
- Rate limit de personal-info: por **número de documento**, `4/hora` por defecto, TTL 3600 s, clave `CTOP_LO_STORE_PERSONAL_INFO_RTL_CTRL::{documento}`, configurable en el Setting `personal_info_settings.rate_limit_rules`. La lectura chequea **primero la clave con typo** `store_personal_info_max_requests_per_houre` y después la correcta.

**Contrato y datos**
- ~~`normalizeOtpErrorCode` (wizard) mapea `ONB003 → expired`, `ONB006 → max_attempts` y `ONB007 → rate_limit`~~ **Corregido el 2026-08-28**: hoy mapea SÓLO códigos canónicos `OBV22xxx` (`22001 → validation_error`, `22003 → invalid_code`, `22009 → expired`, `22010 → rate_limit`); los `ONB*` viejos salieron del mapa y **el caso `max_attempts` ya no existe como etiqueta** — cae en `api_error` genérico. La confusión front-vs-catálogo que este punto describía quedó resuelta por los códigos canónicos.
- `lenders-v2` **no es SSE**: el "streaming" lo hace el loader de React Router devolviendo promesas sin `await`.
- El default `180000` de `lenders-v2` enmascara el monto real si el front no lo manda; es el mínimo de Welli reciclado como constante.
- `env('INTERNAL_LEGACY_API_URL')` se llama **crudo** (no vía `config()`) en `ValidateOtpController:120` y `PersonalInfoController:1042` — con `config:cache` en producción devuelven `null` (hay un tercer uso en `ListLenderController:259`, pero está dentro del bloque comentado). El mismo valor está expuesto correctamente como `config('services.api.legacy_host')` y así lo usan `RegisterCellPhoneController:185` y `OtpController:371`.
- `SimulatorController::startV2` define `$alliedBranch` **sólo dentro** del `if (!ecommerce && auth()->check() && user_profile_id == 4)` y lo desreferencia fuera; para cualquier perfil que no sea asesor la variable no está definida.
- Autofill hardcodeado: para los allieds `[209,210,211]` (Corbeta) sin info laboral, el orquestador de OTP escribe **ingreso 1.500.000 y "Empleado"**.
- `OnboardingService.php:129` — `Experian::creditScore($user_request)` está comentado, pero el log inmediatamente anterior sigue afirmando que corre "unconditionally". No confiar en ese trace.
- `Modules/Onboarding/tests/Unit/*FreezeTest.php` son tests de **congelamiento**: fijan rarezas actuales (ONB001/002/004/006 con HTTP 200, el ternario muerto `corbeta ? 'ONB006' : 'ONB002'`, el centinela `[]` de `createUserRequest`). Cambiar comportamiento rompe estos tests **a propósito**.

## Contenido

### 1. Las cuatro entradas
Todas resuelven una `AlliedBranch` por **`hash`** y dejan `session('allied')` + `session('allied_branch')` (el **objeto** Eloquent, no un array).

1. **QR / link público** — `GET /aliados/onboarding?hash=…` (`RegisterCellPhoneController@oldIndex`, marcada `deprecated` en `routes/customer.php:113`). Hace `Auth::logout()` + invalida sesión, escribe un `QrLog`, y bifurca por dos hardcodes: **Pash** `[218,219,221,222]` (pantalla `WelcomeUser`) y **Corbeta** (ids desde el Setting `corbeta_allieds` → redirige a `bancolombia/self-service/{hash}/solicitar` en el wizard). Si no, redirige a `registrar-celular/{hash}`.
2. **Asesor logueado** — simulador (`/simulador-v2`) → `startV2` guarda monto/producto/cuota inicial en sesión y **redirige; no crea nada**.
3. **Ecommerce** — `GET /registrar-celular-eccommerce/{hash}` con `ecommerce_request_id`, `ecommerce`, `ecommerce_data` y **`amount` en base64** en el query string.
4. **Wizard React** — `GET /{merchant|ecommerce|self-service}/{hash}/solicitar`. Los 3 prefijos son `ROUTE_PREFIXES` en `route-helpers.ts`; el mismo componente sirve dos pasos (`?step=amount` → `?step=phoneNumber`).

### 2. La bifurcación al frontend nuevo (strangler)
`SimulatorController::indexV2` lee **las dos Settings del cutover** (`new_frontend_allied_branches` /
`new_frontend_allieds` — su forma y semántica: **`architecture` §costuras**, el dueño) y, si el comercio
matchea, redirige a `NewFrontendUrlService::init($hash)` = `{base}/merchant/{hash}/solicitar`.

El mismo par se re-evalúa en `UserRequestController::validateTempUsers` para reanudar una solicitud a
medio hacer, y ahí `NewFrontendUrlService` arma el destino exacto (`personalInfo` / `employmentInfo` /
`lenders` / `imei`). `NewFrontendUrlService` es la **única** pieza que conoce las rutas del wizard
desde PHP.

### 3. El contrato real: `error_code` ONB0xx, no HTTP status
G2 responde **200** para casi todo y pone el veredicto en `data.error_code`. El mapa vive en `OnboardingController::getHttpCodeForError`:

| code | significado | HTTP |
|---|---|---|
| ONB001 | OTP_VALIDATION_FAILED | 200 |
| ONB002 | PERSONAL_INFO_REQUIRED | 200 |
| ONB003 | PERSONAL_INFO_NOT_VALIDATED | 200 |
| ONB004 | LABORAL_INFO_REQUIRED | 200 |
| ONB005 | PERSONAL_INFO_VALIDATION_FAILED | 200 |
| ONB006 | BANCOLOMBIA_ONBOARDING (**se devuelve con `success: true`**) | 200 |
| ONB021 / ONB022 / ONB023 | USER_REQUEST / USER / ALLIED_BRANCH_NOT_FOUND | 404 |
| ONB030 | INTERNAL_SERVER_ERROR | 500 |
| ONB040 | CLIENT_ERROR (incluye **rate limit superado**) | 400 |

(`ONB014_OTP_GENERATION_FAILED` es un sub-código aparte de `OtpService`: Redis no devolvió el OTP generado; se aborta sin persistir el espejo en ceros.)

**La máquina de estados del wizard** (cada paso lee `error_code` y elige el siguiente destino):

| Paso wizard | API G2 | success | ONB002 | ONB004 | ONB040 | ONB021/22/23 |
|---|---|---|---|---|---|---|
| `/{hash}/solicitar` | `POST phone/register` | → `/{tel}/otp?amount=` | — | — | — | — |
| `/{hash}/{tel}/otp` | `POST loan-application/otp-validate/{hash}` | → `/{ur}/lenders` | → `personal-info` | → `employment-info` | — | — |
| `/{hash}/{ur}/personal-info` | `POST loan-application/personal-info/{hash}/{ur}` | → `lenders` | — | → `employment-info` | → `rate-limit-exceeded` | → `/` |
| `/{hash}/{ur}/employment-info` | `POST loan-application/laboral-info/{hash}/{ur}` | → `lenders` | → `personal-info` | — | (no manejado) | → `/` |
| `/{hash}/{ur}/lenders` | `GET loan-application/lenders-v2/{ur}` | listado | — | — | — | — |

`ONB005` (o `errors` de validación) se pinta como errores de campo en el formulario. El Inertia de `application` implementa **el mismo switch** (ONB001/ONB002/ONB004) en `ValidateOtpController::validateOtpV2`.

### 3.bis «Confirmación de cupo»: el usuario elige el flujo en la 1.ª pantalla, y se firma DESPUÉS del OTP

El wizard puede ofrecer, en la pantalla de celular+monto, un selector de **confirmación de cupo** que
manda la solicitud al flujo `flow_id = 2` (`already-confirmed-pre-approval`) en vez del estándar. Tres
piezas, y el orden importa porque la `user_request` todavía no existe cuando el usuario elige:

1. **Se ofrece o no según el comercio.** El loader de `phone-number.tsx` pregunta
   `CheckAbleToOmitExperianUc(PreApprovalFlowRepository).execute(partner_hash)`: solo se muestra a los
   comercios a los que el backend permite omitir Experian Acierta (veredicto **RKV26000**).
   **Fail-safe: cualquier error oculta el selector** (`.unwrapOr(false)`).
2. **Se elige y se guarda en SESIÓN**, no en BD — la solicitud aún no nació. El componente es
   `amount-form.tsx` (no `phone-number.tsx`, que solo pasa el flag) y cuando se muestra es
   **obligatorio**: sin respuesta, `form.setError("confirmQuota")` frena el submit. La acción escribe
   `session.flowSignatureChoice` = `already-confirmed-pre-approval` | `standard`, y **siempre**
   sobreescribe —lo desetea si el selector no se mostró— para que una elección vieja no se filtre.
3. **Se firma al validar el OTP**, que es cuando ya hay `user_request_id`: `otp-verification.tsx` llama
   `SignFlowSignatureUc`. Es **best-effort**: si falla, no bloquea el onboarding — la solicitud
   simplemente se queda en el flujo estándar con Experian.

Consecuencias que ya están documentadas en otros nodos: en ese flujo **Experian se omite temprano**
(nodo `kyc`, hoy Stage 2 del disparador) y el listado **se recorta a `response_type == 0`, dejando
CreditopX afuera** (nodo `creditopx`, donde además se corrigió que el recorte ya no vive en el
controller).

⚠ **Y conviene saber lo raro que es antes de explicar nada con él.** Medido contra producción el
2026-09-18: de **560.589** solicitudes, **458 entraron por este flujo** —el 0,08 %— y 557.133 no
declaran flujo en absoluto. O sea que explica casos puntuales y casi nunca es la causa de un reclamo
general: si a un comercio le pasa con todos sus clientes, el flujo no es la respuesta.

### 4. Dónde nace la `user_request`
**No nace en el simulador ni al capturar el monto.** Nace al **validar el OTP** (o, en el camino Inertia, al guardar la info personal). Los tres gemelos hacen lo mismo con diferencias reales:

- **G1** `UserRequestController::createUserRequest($user)` — reusa una UR previa del mismo `user+allied+branch` en estados **[1,3,9]**, excluyendo por 3 subqueries cualquiera atada a ecommerce (`ecommerce_requests.user_request_id`, `.original_user_request_id`, `user_requests_by_ecommerce_request`). Si no hay, `updateOrCreate` con clave `{user_id, allied_id, allied_branch_id, lender_id:null}`. Luego rama ecommerce (crea nueva si el `order_key` cambió), status **9** y un `UserRequestRecord`.
- **G2** `UserRequestService::createUserRequest($user, $partnerBranchHash)` — mismo esqueleto (`handleRegularRequest` / `handleEcommerceUserRequest` / `handleEcommerceRequest` / `updateUserRequestStatus`), pero **mete `amount` dentro de la clave de match** y prioriza `request()->input('amount')` sobre `session('amount')`.
- **G3** `UserRequestV1\FindOrCreateService` — igual que G2 (`baseConditions` incluye `amount`), con los valores en constantes documentadas.

**Consecuencia de la divergencia:** en G1 dos montos distintos **reciclan** la misma UR; en G2/G3 **crean una UR nueva por monto**. Además G1 pone `original_amount = session('originalAmount') ?? 0` (sin sesión → **0**), mientras G2/G3 caen a `amount` como último recurso.

**Valores quemados al crear** (idénticos en los tres): `lender_id = null`, `credit_line_id = 1`, `fee_number = 0`, `fee_value = 0`, `rate = 0`, `user_request_status_id = 1`.

### 5. Estados que pisa el onboarding
El catálogo completo verificado vive en la raíz (**`creditop` §Estados**); los distintivos de este
tramo, confirmados en `FindOrCreateServiceConstants`:

- **1 · "Validación OTP"** — estado inicial al crear (NO "creada").
- **3 · "Seleccionó entidad"** — lo escribe la selección de lender.
- **9 · "Formulario de perfil"** — post-OTP; es el estado con el que se llega al listado.
- **25** — guard extra que G2 agrega y G1 no.

`EDITABLE_STATUS_IDS = [1,3,9]` es la ventana de reciclado. El frontend tiene 30 etiquetas mapeadas a
variantes visuales en `request-status.ts`.

### 6. El monto: tres orígenes y una precedencia
1. `session('amount')` — asesor (lo pone `startV2`).
2. Query base64 — ecommerce (`indexecommerce`).
3. Body `amount` del `otp-validate` — wizard (viaja `/solicitar` → `?amount=` → body).

En G2 **el body gana**: `request()->input('amount') ?? session('amount') ?? 0`. El listado (`lenders-v2`) acepta `?amount=` con **default `180000`** — que no es arbitrario: es el **mínimo de Welli** (`WelliService::MINIMUM_AMOUNT`), reusado como default en los dos controllers de listado.

### 7. Usuario temporal
`RegisterCellPhoneService::createTemporalUser` (y su gemelo `UserService::createTemporalUser`) crean `first_name = surname = full_name = 'TEMPORAL USER'` y `document_number = 'TEMP-<rand4>-<celular>'`. La detección diverge: G2 usa igualdad exacta sobre `full_name`; G1 usa `str_contains`. Un usuario temporal al validar OTP produce **ONB002** (falta info personal) salvo que sea onboarding Corbeta.

### 8. Qué gatea el salto a laboral-info
`OnboardingService::isForm1Completed($userId)` exige **tres** `user_field_values` con `form_id = 1`: **29** (situación laboral), **87** (ingreso) y **160**. El 160 **no es un dato**: los dos repos lo escriben con el literal `'no'` — es de facto un marcador de "el formulario 1 se envió". El detalle del esquema EAV es del subcontexto **Dynamic Forms**; acá importa sólo porque decide el ruteo.

## Subcontextos
- **KYC** — el estudio del cliente (burós): Experian/Datacrédito da el único score; TusDatos identidad+AML; Ágil Data/Mareigua ingreso; Quanto ingreso estimado. Se dispara desde `personal-info` y desde el orquestador de OTP (`userViability`).

**(2026-08-28) Re-verificación asistida de los 37 archivos derivados** (worker digirió el diff en 8
funcionalidades; las 2 que invalidaban se verificaron a mano — una cierta y corregida arriba, y una
SOBRE-afirmada por el worker: el stub de personal-info sigue 501, lo implementado está detrás de la
fachada apagada). Lo nuevo que este nodo hereda de otros: el ruteo del codeudor (nodo codeudor), la
des-motaización con TyC por comercio (nodo motai), la resolución de checkout de
Bancolombia/Corbeta y el ruteo a Cuotéalo BCP al finalizar, `onboarding_channel` propagado desde el
registro del teléfono (con `onboarding_backend = 'application'` fijado en G1), y caché de datos de
referencia + ajuste de timeouts en los loaders del wizard.

## Dónde mirar

**Entradas y bifurcación (application)**
- `application/routes/customer.php:113-137` — las 6 rutas de la fase (`aliados/onboarding` deprecated, `registrar-celular`, `registrar-celular-eccommerce`, `validar-otp`, `informacion-personal`, `informacion-laboral`) · `application/routes/customer.php:169` `entidades-v2` · `application/routes/customer.php:184-189` simulador v1 deprecated / v2.
- `application/app/Http/Controllers/Customer/RegisterCellPhoneController.php:24` (`oldIndex`, QR) · `application/app/Http/Controllers/Customer/RegisterCellPhoneController.php:46-47` hardcode Pash · `application/app/Http/Controllers/Customer/RegisterCellPhoneController.php:59-60` Setting `corbeta_allieds` · `application/app/Http/Controllers/Customer/RegisterCellPhoneController.php:77` (`index`) · `application/app/Http/Controllers/Customer/RegisterCellPhoneController.php:138-146` cache 30s del hash + `session(['allied_branch' => $allied_branch])` · `application/app/Http/Controllers/Customer/RegisterCellPhoneController.php:179` (`store`) · `application/app/Http/Controllers/Customer/RegisterCellPhoneController.php:184-194` delega a legacy · `application/app/Http/Controllers/Customer/RegisterCellPhoneController.php:189-191` `terms/policies/otp_length=4` quemados · `application/app/Http/Controllers/Customer/RegisterCellPhoneController.php:201-209` `CreditopXUserRequestsRecord` estado 2 · `application/app/Http/Controllers/Customer/RegisterCellPhoneController.php:232-241` ecommerce base64.
- `application/app/Http/Controllers/Customer/SimulatorController.php:114` (`indexV2`) · `application/app/Http/Controllers/Customer/SimulatorController.php:121-136` **el allowlist del frontend nuevo** · `application/app/Http/Controllers/Customer/SimulatorController.php:168-178` config de montos (min/max/rate desde `credit_line_by_lenders`) · `application/app/Http/Controllers/Customer/SimulatorController.php:190-211` (`startV2`: sólo sesión + redirect).
- `application/app/Services/NewFrontendUrlService.php:68` (`init` → `/{prefix}/{hash}/solicitar`) · `application/app/Services/NewFrontendUrlService.php:87` `personalInfo` · `application/app/Services/NewFrontendUrlService.php:154` `employmentInfo` · `application/app/Services/NewFrontendUrlService.php:182` `lenders` · `application/app/Services/NewFrontendUrlService.php:218` `bancolombiaSelfService`.

**Delegación paso a paso (application → legacy)**
- `ValidateOtpController.php:99` (`validateOtpV2`) · `ValidateOtpController.php:104-106` fallback si no hay sucursal en sesión · `ValidateOtpController.php:111-116` Setting `allowed_bypass_comerces` (o `"all"`) · `ValidateOtpController.php:120-122` `POST otp-validate` · `ValidateOtpController.php:135-147` switch ONB001/002/004 · `ValidateOtpController.php:159-161` fallback por excepción · `ValidateOtpController.php:165` (`validateOtp`, la implementación local) · `ValidateOtpController.php:240` `createUserRequest` · `ValidateOtpController.php:263-268` TEMPORAL USER → estado 1, si no 9.
- `PersonalInfoController.php:265` `createUserRequest` · `PersonalInfoController.php:370-385` field 160 = `'no'` · `PersonalInfoController.php:514` (`storePersonalInfoV2`: **no delega**, sólo calcula `stratumFieldRequired`) · `PersonalInfoController.php:1009-1044` (`storeEmploymentInfoV2`, delegación de laboral-info) · `PersonalInfoController.php:1154-1180` fields 160/161.
- `ListLenderController.php:226` (`indexV2` → `getLenders` **local**) · `ListLenderController.php:251-287` la delegación a legacy está **comentada**.
- `UserRequestController.php:58` (`createUserRequest`) · `UserRequestController.php:70-86` reciclado [1,3,9] + exclusiones ecommerce · `UserRequestController.php:89-108` `updateOrCreate` · `UserRequestController.php:110` rama ecommerce · `UserRequestController.php:191` estado 9 · `UserRequestController.php:247` `UserRequestRecord` · `UserRequestController.php:356` estado 3 · `UserRequestController.php:1491` (`validateTempUsers`, el "continuar solicitud") · `:1520/:1570/:1592` destinos del wizard.

**Módulo Onboarding (legacy-backend, G2)**
- `Modules/Onboarding/App/Providers/RouteServiceProvider.php:41` — prefijo **`api/onboarding`**.
- `Modules/Onboarding/routes/api.php:18-24` (`phone/register` GET+POST) · `Modules/Onboarding/routes/api.php:30-34` (`otp/send|resend|resend-via-email`) · `Modules/Onboarding/routes/api.php:41-57` (`loan-application/*`: `otp-validate`, `personal-info` + `/config`, `laboral-info`, `user-request`, `lenders`, **`lenders-v2`**, `update-user-request`, `pre-approval-status`) · `Modules/Onboarding/routes/api.php:170-172` `commerce/type` · `Modules/Onboarding/routes/api.php:193-195` `dynamic-forms/create-user`.
- `Modules/Onboarding/App/Http/Controllers/OnboardingController.php:39-57` mapa ONB→HTTP · `Modules/Onboarding/App/Http/Controllers/OnboardingController.php:937` (`validateOtpCodeAndRedirect`) · `Modules/Onboarding/App/Http/Controllers/OnboardingController.php:1017-1098` **el docblock que describe los 16 pasos y las rarezas congeladas** · `Modules/Onboarding/App/Http/Controllers/OnboardingController.php:1099` orquestador · `Modules/Onboarding/App/Http/Controllers/OnboardingController.php:1227` `createUserRequest` · `Modules/Onboarding/App/Http/Controllers/OnboardingController.php:1262-1283` ONB002 (temporal) · `Modules/Onboarding/App/Http/Controllers/OnboardingController.php:1296-1299` stub aleatorio de pre-aprobación · `Modules/Onboarding/App/Http/Controllers/OnboardingController.php:1316-1345` `userViability` (Experian) · `Modules/Onboarding/App/Http/Controllers/OnboardingController.php:1355-1363` autofill 209/210/211 · `Modules/Onboarding/App/Http/Controllers/OnboardingController.php:1382-1400` ONB004 · `Modules/Onboarding/App/Http/Controllers/OnboardingController.php:1402` `ONB006` con `success: true`.
- `Modules/Onboarding/App/Services/UserRequestService.php:76` (`createUserRequest`) · `Modules/Onboarding/App/Services/UserRequestService.php:78` `findByHash` · `Modules/Onboarding/App/Services/UserRequestService.php:116-147` (`handleRegularRequest`, `amount` en la clave) · `Modules/Onboarding/App/Services/UserRequestService.php:149-204` rama ecommerce · `Modules/Onboarding/App/Services/UserRequestService.php:248-258` estado 9 + `UserRequestRecord` · `Modules/Onboarding/App/Services/UserRequestService.php:294-295` estado 3 (guard `!= 11 && != 25`).
- `Modules/Onboarding/App/Services/OnboardingService.php:109` (`storePersonalInfo`) · `Modules/Onboarding/App/Services/OnboardingService.php:132` `Experian::creditScore` **comentado** bajo un log que dice lo contrario · `Modules/Onboarding/App/Services/OnboardingService.php:134-173` rate limit → ONB040 · `Modules/Onboarding/App/Services/OnboardingService.php:981` (`storeLaboralInformation`) · `Modules/Onboarding/App/Services/OnboardingService.php:1097-1134` field 160 = `'no'` · `Modules/Onboarding/App/Services/OnboardingService.php:1398-1406` `isTemporalUser` / `isUserValidatedWithRiskCentrals` · `Modules/Onboarding/App/Services/OnboardingService.php:1543-1572` config del rate limit · `Modules/Onboarding/App/Services/OnboardingService.php:1574-1583` `isForm1Completed` = [29, 87, 160].
- `Modules/Onboarding/App/Services/OtpService.php:38-42` constantes (plantilla SMS, SIDs Twilio, longitudes 4/6) · `Modules/Onboarding/App/Services/OtpService.php:132` `validateOtpCode` · `Modules/Onboarding/App/Services/OtpService.php:164-170` y `Modules/Onboarding/App/Services/OtpService.php:392-400` QA bypass · `Modules/Onboarding/App/Services/OtpService.php:432` **OTP = 1111 en `local`** · `Modules/Onboarding/App/Services/OtpService.php:439-453` ONB014.
- `Modules/Onboarding/App/Services/OtpBypassService.php:25` Setting `qa_otp_bypass_phones` · `Modules/Onboarding/App/Services/OtpBypassService.php:37` sólo `local`/`development` · `Modules/Onboarding/App/Services/OtpBypassService.php:65-71` el código = últimos 4 del teléfono.
- `Modules/Onboarding/App/Services/RegisterCellPhoneService.php:57` (`getRegistrationData`: partner + `partner_modes` + branch + sucursales) · `Modules/Onboarding/App/Services/RegisterCellPhoneService.php:78` (`processCellPhoneRegistration`) · `Modules/Onboarding/App/Services/RegisterCellPhoneService.php:413-419` `createTemporalUser` · `Modules/Onboarding/App/Services/RegisterCellPhoneService.php:594-597` `isTemporaryUser`.
- `Modules/Onboarding/App/Services/CommerceService.php:127-130` — `ecommerce` vs `traditional` según `allied_ecommerce_credentials` (COM002).
- `Modules/Onboarding/App/Services/DynamicFormsService.php:35-58` constantes + mapa de campos 162-172 · `Modules/Onboarding/App/Services/DynamicFormsService.php:68-77` catálogo DYFS1001-1005 · `Modules/Onboarding/App/Services/DynamicFormsService.php:546-568` crea la UR reusando `UserRequestService`.
- `Modules/Onboarding/App/Http/Controllers/LenderListingController.php:17-21` — `index` y el **default 180000** (idem `ListLenderController.php:43`); el origen del número es `Modules/Onboarding/App/Services/lenders/Welli/WelliService.php:36` (`MINIMUM_AMOUNT`).

**Nueva arquitectura (G3)**
- `Modules/OnboardingV2/App/Providers/RouteServiceProvider.php:24` — prefijo `api/v2/onboarding`.
- `Modules/OnboardingV2/routes/api.php:21-35` — `personal-info/{branch}/{ur}` y `otp-auth/validate/{branch}`; el comentario declara que **no consulta pre-aprobados ni ninguna central de riesgo**.
- `Modules/OnboardingV2/App/Services/StorePersonalInfoService.php:212` — `OBV21000 = 501 Not Implemented`.
- `Modules/UserRequestV1/App/Services/FindOrCreateService.php:117` orquestador · `Modules/UserRequestV1/App/Services/FindOrCreateService.php:364-373` estado 9 + record · `Modules/UserRequestV1/App/Services/FindOrCreateService.php:383-412` `baseConditions` / `baseData`.
- `Modules/UserRequestV1/App/Constants/FindOrCreateServiceConstants.php:16-31` — **los nombres canónicos de los estados 1/9 y `EDITABLE_STATUS_IDS`**.

**Wizard (frontend-monorepo)**
- `apps/loan-request-wizard/app/routes.ts:9-67` rutas públicas `:flow` · `apps/loan-request-wizard/app/routes.ts:68-140` rutas `merchant` · `apps/loan-request-wizard/app/routes.ts:82-88` el sub-flujo **dynamic**.
- `apps/loan-request-wizard/app/utils/route-helpers.ts:11-15` — `ROUTE_PREFIXES`.
- `.../routes/loan-application-form/phone-number.tsx:70-71` **gate `alliedCountry === 60` → flujo dynamic** · `routes/loan-application-form/phone-number.tsx:145` action · `routes/loan-application-form/phone-number.tsx:183-193` `terms/policies/otpLength:4` · `routes/loan-application-form/phone-number.tsx:209-215` redirect a `/otp?amount=`.
- `.../routes/loan-application-form/otp-verification.tsx:71-89` `normalizeOtpErrorCode` · `routes/loan-application-form/otp-verification.tsx:83` action · `routes/loan-application-form/otp-verification.tsx:148` éxito → lenders · `routes/loan-application-form/otp-verification.tsx:183` ONB002 · `routes/loan-application-form/otp-verification.tsx:200` ONB004 · `routes/loan-application-form/otp-verification.tsx:233` ONB001.
- `.../routes/loan-application-form/loan-request-form.tsx:212-244` `mapPostSaveErrorToResult` · `routes/loan-application-form/loan-request-form.tsx:266` éxito · `routes/loan-application-form/loan-request-form.tsx:279-282` ONB005.
- `.../routes/loan-application-form/employment-info.tsx:48` action · `routes/loan-application-form/employment-info.tsx:79-87` éxito · `routes/loan-application-form/employment-info.tsx:92-98` ONB002 / ONB021-023.
- `.../routes/dynamic/request-amount.tsx:165-196` `transactionId` + sesión Redis del form dinámico · `routes/dynamic/request-amount.tsx:201` action.
- `.../lenders-marketplace/.../loan-options.repository.ts:15` timeout 60 s · `lenders-marketplace/.../loan-options.repository.ts:26` `GET lenders-v2` · `lenders-marketplace/.../loan-options.repository.ts:44-58` fallback cuando `original_amount` llega en 0.
- `.../routes/lenders-marketplace/available-lenders.tsx:134-160` — **deferred de React Router**, no SSE.
- Repositorios del wizard (todos contra `VITE_API_URL` + `/api/onboarding/...`): `phone-number.repository.ts:51` y `phone-number.repository.ts:82`, `phone-otp.repository.ts:21-22`, `personal-info.repository.ts:40-41`, `employment-info.repository.ts:21-22`, `partner-info.repository.ts:32-33`.

**Tablas**: `user_requests` · `user_request_statuses` · `user_request_records` (historial; lo escriben los tres gemelos, **no** el observer) · `user_field_values` (EAV) · `allied_ecommerce_credentials` (bifurca canal) · `creditop_x_user_requests_records`.

## Lo que NO está verificado
- `initial_fee` existe a nivel comercio Y sucursal (`allieds.*` y `lenders_by_allied_branches.*`); la regla «el % lo exige la categoría rt=2» es del cupo CreditopX (→ `profiling`) y no se verificó acá.
