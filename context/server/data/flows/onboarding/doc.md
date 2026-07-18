# Onboarding · contexto
> **estado:** al día con main · La fase de SOLICITUD: entrada por link de sucursal → celular/OTP → nace la `user_request` → formulario personal/laboral → disparo del listado. Contrato de ruteo por `error_code` ONB0xx, no por HTTP status.

## Qué es
Onboarding es la fase que **arma la solicitud** antes de que la consolidación (`getLenders`) decida qué se ofrece. El usuario entra por un **hash de sucursal**, registra celular, valida OTP y llena el formulario; el sujeto que resulta —la `user_request` + los datos personales/laborales + el perfil de buró (KYC)— es lo que después evalúan las reglas.

Lo que hay que entender antes de tocar nada: **esta fase está implementada TRES veces** sobre la misma base de datos.

| Generación | Dónde | Estado real (verificado) |
|---|---|---|
| **G1 · Inertia** | `application/app/Http/Controllers/Customer/*` | Viva y por defecto. Delega a G2 **paso por paso**, con allowlist y fallback local. |
| **G2 · módulo Onboarding** | `legacy-backend/Modules/Onboarding` (198 archivos: 38 controllers, 63 services, 18 repositories, 29 form-requests, 14 tests) | Viva. Es la que consume **el wizard React** y a la que G1 delega. Prefijo `api/onboarding`. |
| **G3 · nueva arquitectura** | `Modules/OnboardingV2` + `Modules/UserRequestV1` (`api/v2/onboarding`) | Registrada y activa, **sin ningún consumidor en los 3 repos**. `otp-auth/validate` está implementada; `personal-info` es un stub que responde **501 (OBV21000)**. |

Y hay **dos frentes**: el Inertia de `application` y el wizard React (`frontend-monorepo/apps/loan-request-wizard`). El corte entre uno y otro NO es por repo ni por deploy: es un **allowlist en BD** que se lee en `SimulatorController::indexV2` y decide si redirige al wizard nuevo o renderiza la pantalla vieja.

## Contenido

### 1. Las cuatro entradas
Todas resuelven una `AlliedBranch` por **`hash`** y dejan `session('allied')` + `session('allied_branch')` (el **objeto** Eloquent, no un array).

1. **QR / link público** — `GET /aliados/onboarding?hash=…` (`RegisterCellPhoneController@oldIndex`, marcada `deprecated` en `routes/customer.php:113`). Hace `Auth::logout()` + invalida sesión, escribe un `QrLog`, y bifurca por dos hardcodes: **Pash** `[218,219,221,222]` (pantalla `WelcomeUser`) y **Corbeta** (ids desde el Setting `corbeta_allieds` → redirige a `bancolombia/self-service/{hash}/solicitar` en el wizard). Si no, redirige a `registrar-celular/{hash}`.
2. **Asesor logueado** — simulador (`/simulador-v2`) → `startV2` guarda monto/producto/cuota inicial en sesión y **redirige; no crea nada**.
3. **Ecommerce** — `GET /registrar-celular-eccommerce/{hash}` con `ecommerce_request_id`, `ecommerce`, `ecommerce_data` y **`amount` en base64** en el query string.
4. **Wizard React** — `GET /{merchant|ecommerce|self-service}/{hash}/solicitar`. Los 3 prefijos son `ROUTE_PREFIXES` en `route-helpers.ts`; el mismo componente sirve dos pasos (`?step=amount` → `?step=phoneNumber`).

### 2. La bifurcación al frontend nuevo (strangler)
`SimulatorController::indexV2` lee **dos Settings** y, si el comercio matchea, redirige a `NewFrontendUrlService::init($hash)` = `{base}/merchant/{hash}/solicitar`:

- `new_frontend_allied_branches` → `value['hashes']`, lista de **hashes de sucursal**.
- `new_frontend_allieds` → mapa `{"<allied_id>": true}`, a nivel **comercio**.

El mismo par de Settings se re-evalúa en `UserRequestController::validateTempUsers` para reanudar una solicitud a medio hacer, y ahí `NewFrontendUrlService` arma el destino exacto (`personalInfo` / `employmentInfo` / `lenders` / `imei`). `NewFrontendUrlService` es la **única** pieza que conoce las rutas del wizard desde PHP.

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

### 4. Dónde nace la `user_request`
**No nace en el simulador ni al capturar el monto.** Nace al **validar el OTP** (o, en el camino Inertia, al guardar la info personal). Los tres gemelos hacen lo mismo con diferencias reales:

- **G1** `UserRequestController::createUserRequest($user)` — reusa una UR previa del mismo `user+allied+branch` en estados **[1,3,9]**, excluyendo por 3 subqueries cualquiera atada a ecommerce (`ecommerce_requests.user_request_id`, `.original_user_request_id`, `user_requests_by_ecommerce_request`). Si no hay, `updateOrCreate` con clave `{user_id, allied_id, allied_branch_id, lender_id:null}`. Luego rama ecommerce (crea nueva si el `order_key` cambió), status **9** y un `UserRequestRecord`.
- **G2** `UserRequestService::createUserRequest($user, $partnerBranchHash)` — mismo esqueleto (`handleRegularRequest` / `handleEcommerceUserRequest` / `handleEcommerceRequest` / `updateUserRequestStatus`), pero **mete `amount` dentro de la clave de match** y prioriza `request()->input('amount')` sobre `session('amount')`.
- **G3** `UserRequestV1\FindOrCreateService` — igual que G2 (`baseConditions` incluye `amount`), con los valores en constantes documentadas.

**Consecuencia de la divergencia:** en G1 dos montos distintos **reciclan** la misma UR; en G2/G3 **crean una UR nueva por monto**. Además G1 pone `original_amount = session('originalAmount') ?? 0` (sin sesión → **0**), mientras G2/G3 caen a `amount` como último recurso.

**Valores quemados al crear** (idénticos en los tres): `lender_id = null`, `credit_line_id = 1`, `fee_number = 0`, `fee_value = 0`, `rate = 0`, `user_request_status_id = 1`.

### 5. Estados de `user_requests` (nombres canónicos)
`FindOrCreateServiceConstants` documenta los tres del onboarding y el frontend confirma las etiquetas:

- **1 · "Validación OTP"** — estado inicial al crear (NO "creada").
- **3 · "Seleccionó entidad"** — lo escribe la selección de lender.
- **9 · "Formulario de perfil"** — post-OTP; es el estado con el que se llega al listado.
- **4** No desembolsada · **6** Negada · **7** No terminó proceso · **8** Cancelado · **10** Pendiente · **11 Autorizada** · **25** (guard extra que G2 agrega y G1 no).

`EDITABLE_STATUS_IDS = [1,3,9]` es la ventana de reciclado. El catálogo completo de nombres vive en la tabla `user_request_statuses` (sin enum en código); el frontend tiene 30 etiquetas mapeadas a variantes visuales en `request-status.ts`.

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

## Dónde mirar

**Entradas y bifurcación (application)**
- `application/routes/customer.php:113-137` — las 6 rutas de la fase (`aliados/onboarding` deprecated, `registrar-celular`, `registrar-celular-eccommerce`, `validar-otp`, `informacion-personal`, `informacion-laboral`) · `:169` `entidades-v2` · `:184-189` simulador v1 deprecated / v2.
- `application/app/Http/Controllers/Customer/RegisterCellPhoneController.php:24` (`oldIndex`, QR) · `:46-47` hardcode Pash · `:59-60` Setting `corbeta_allieds` · `:77` (`index`) · `:138-146` cache 30s del hash + `session(['allied_branch' => $allied_branch])` · `:179` (`store`) · `:184-194` delega a legacy · `:189-191` `terms/policies/otp_length=4` quemados · `:201-209` `CreditopXUserRequestsRecord` estado 2 · `:232-241` ecommerce base64.
- `application/app/Http/Controllers/Customer/SimulatorController.php:110` (`indexV2`) · `:121-136` **el allowlist del frontend nuevo** · `:168-178` config de montos (min/max/rate desde `credit_lines_by_lender`) · `:190-211` (`startV2`: sólo sesión + redirect).
- `application/app/Services/NewFrontendUrlService.php:68` (`init` → `/{prefix}/{hash}/solicitar`) · `:87` `personalInfo` · `:154` `employmentInfo` · `:182` `lenders` · `:218` `bancolombiaSelfService`.

**Delegación paso a paso (application → legacy)**
- `ValidateOtpController.php:99` (`validateOtpV2`) · `:104-106` fallback si no hay sucursal en sesión · `:111-116` Setting `allowed_bypass_comerces` (o `"all"`) · `:120-122` `POST otp-validate` · `:135-147` switch ONB001/002/004 · `:159-161` fallback por excepción · `:165` (`validateOtp`, la implementación local) · `:240` `createUserRequest` · `:263-268` TEMPORAL USER → estado 1, si no 9.
- `PersonalInfoController.php:265` `createUserRequest` · `:370-385` field 160 = `'no'` · `:514` (`storePersonalInfoV2`: **no delega**, sólo calcula `stratumFieldRequired`) · `:1009-1044` (`storeEmploymentInfoV2`, delegación de laboral-info) · `:1154-1180` fields 160/161.
- `ListLenderController.php:226` (`indexV2` → `getLenders` **local**) · `:251-287` la delegación a legacy está **comentada**.
- `UserRequestController.php:58` (`createUserRequest`) · `:70-86` reciclado [1,3,9] + exclusiones ecommerce · `:89-108` `updateOrCreate` · `:110` rama ecommerce · `:191` estado 9 · `:247` `UserRequestRecord` · `:356` estado 3 · `:1491` (`validateTempUsers`, el "continuar solicitud") · `:1520/:1570/:1592` destinos del wizard.

**Módulo Onboarding (legacy-backend, G2)**
- `Modules/Onboarding/App/Providers/RouteServiceProvider.php:41` — prefijo **`api/onboarding`**.
- `Modules/Onboarding/routes/api.php:18-24` (`phone/register` GET+POST) · `:30-34` (`otp/send|resend|resend-via-email`) · `:41-57` (`loan-application/*`: `otp-validate`, `personal-info` + `/config`, `laboral-info`, `user-request`, `lenders`, **`lenders-v2`**, `update-user-request`, `pre-approval-status`) · `:170-172` `commerce/type` · `:193-195` `dynamic-forms/create-user`.
- `Modules/Onboarding/App/Http/Controllers/OnboardingController.php:39-57` mapa ONB→HTTP · `:899` (`validateOtpCodeAndRedirect`) · `:981-1065` **el docblock que describe los 16 pasos y las rarezas congeladas** · `:1066` orquestador · `:1188` `createUserRequest` · `:1235-1256` ONB002 (temporal) · `:1270-1272` stub aleatorio de pre-aprobación · `:1290-1319` `userViability` (Experian) · `:1329-1338` autofill 209/210/211 · `:1344-1362` ONB004 · `:1365` `ONB006` con `success: true`.
- `Modules/Onboarding/App/Services/UserRequestService.php:71` (`createUserRequest`) · `:73` `findByHash` · `:111-138` (`handleRegularRequest`, `amount` en la clave) · `:144-199` rama ecommerce · `:241-252` estado 9 + `UserRequestRecord` · `:287-288` estado 3 (guard `!= 11 && != 25`).
- `Modules/Onboarding/App/Services/OnboardingService.php:107` (`storePersonalInfo`) · `:127` `Experian::creditScore` **comentado** bajo un log que dice lo contrario · `:132-168` rate limit → ONB040 · `:892` (`storeLaboralInformation`) · `:1009-1045` field 160 = `'no'` · `:1298-1306` `isTemporalUser` / `isUserValidatedWithRiskCentrals` · `:1443-1472` config del rate limit · `:1474-1483` `isForm1Completed` = [29, 87, 160].
- `Modules/Onboarding/App/Services/OtpService.php:31-35` constantes (plantilla SMS, SIDs Twilio, longitudes 4/6) · `:132` `validateOtpCode` · `:164-170` y `:392-400` QA bypass · `:432` **OTP = 1111 en `local`** · `:439-453` ONB014.
- `Modules/Onboarding/App/Services/OtpBypassService.php:25` Setting `qa_otp_bypass_phones` · `:37` sólo `local`/`development` · `:65-71` el código = últimos 4 del teléfono.
- `Modules/Onboarding/App/Services/RegisterCellPhoneService.php:40` (`getRegistrationData`: partner + `partner_modes` + branch + sucursales) · `:56` (`processCellPhoneRegistration`) · `:378-386` `createTemporalUser` · `:474-476` `isTemporaryUser`.
- `Modules/Onboarding/App/Services/CommerceService.php:127-130` — `ecommerce` vs `traditional` según `allied_ecommerce_credentials` (COM002).
- `Modules/Onboarding/App/Services/DynamicFormsService.php:35-58` constantes + mapa de campos 162-172 · `:68-77` catálogo DYFS1001-1005 · `:495-518` crea la UR reusando `UserRequestService`.
- `Modules/Onboarding/App/Http/Controllers/LenderListingController.php:17-21` — `index` y el **default 180000** (idem `ListLenderController.php:43`); el origen del número es `Modules/Onboarding/App/Services/lenders/Welli/WelliService.php:36` (`MINIMUM_AMOUNT`).

**Nueva arquitectura (G3)**
- `Modules/OnboardingV2/App/Providers/RouteServiceProvider.php:24` — prefijo `api/v2/onboarding`.
- `Modules/OnboardingV2/routes/api.php:21-35` — `personal-info/{branch}/{ur}` y `otp-auth/validate/{branch}`; el comentario declara que **no consulta pre-aprobados ni ninguna central de riesgo**.
- `Modules/OnboardingV2/App/Services/StorePersonalInfoService.php:66` — `OBV21000 = 501 Not Implemented`.
- `Modules/UserRequestV1/App/Services/FindOrCreateService.php:117` orquestador · `:364-373` estado 9 + record · `:383-412` `baseConditions` / `baseData`.
- `Modules/UserRequestV1/App/Constants/FindOrCreateServiceConstants.php:16-31` — **los nombres canónicos de los estados 1/9 y `EDITABLE_STATUS_IDS`**.

**Wizard (frontend-monorepo)**
- `apps/loan-request-wizard/app/routes.ts:9-67` rutas públicas `:flow` · `:68-140` rutas `merchant` · `:82-88` el sub-flujo **dynamic**.
- `apps/loan-request-wizard/app/utils/route-helpers.ts:11-15` — `ROUTE_PREFIXES`.
- `.../routes/loan-application-form/phone-number.tsx:67-68` **gate `alliedCountry === 60` → flujo dynamic** · `:145` action · `:183-193` `terms/policies/otpLength:4` · `:209-215` redirect a `/otp?amount=`.
- `.../routes/loan-application-form/otp-verification.tsx:63-79` `normalizeOtpErrorCode` · `:83` action · `:148` éxito → lenders · `:183` ONB002 · `:200` ONB004 · `:233` ONB001.
- `.../routes/loan-application-form/loan-request-form.tsx:192-214` `mapPostSaveErrorToResult` · `:266` éxito · `:279-282` ONB005.
- `.../routes/loan-application-form/employment-info.tsx:48` action · `:79-87` éxito · `:92-98` ONB002 / ONB021-023.
- `.../routes/dynamic/request-amount.tsx:165-196` `transactionId` + sesión Redis del form dinámico · `:201` action.
- `.../lenders-marketplace/.../loan-options.repository.ts:15` timeout 60 s · `:26` `GET lenders-v2` · `:44-58` fallback cuando `original_amount` llega en 0.
- `.../routes/lenders-marketplace/available-lenders.tsx:148-160` — **deferred de React Router**, no SSE.
- Repositorios del wizard (todos contra `VITE_API_URL` + `/api/onboarding/...`): `phone-number.repository.ts:51` y `:82`, `phone-otp.repository.ts:21-22`, `personal-info.repository.ts:40-41`, `employment-info.repository.ts:21-22`, `partner-info.repository.ts:32-33`.

**Tablas**: `user_requests` · `user_request_statuses` · `user_request_records` (historial; lo escriben los tres gemelos, **no** el observer) · `user_field_values` (EAV) · `allied_ecommerce_credentials` (bifurca canal) · `creditop_x_user_requests_records`.

## Gotchas / riesgos

**Bugs verificados en el camino feliz**
- `UserRequestController.php:1511` — el `&&` quedó **dentro** del segundo `str_contains`: `str_contains($user->document_number, 'TEMP' && $userRequest->user_request_status_id == 1)`. El needle termina siendo un bool coercionado (`"1"` o `""`), y `str_contains($s, "")` es siempre `true`. La guarda de "usuario temporal en estado 1" no valida lo que dice.
- `PersonalInfoController.php:1044` — la URL de delegación interpola `$userRequestIdSessionKey` (la **clave** `'user_request_id_v2'`) en vez de `$user_request_id` (asignado en `:1019` y nunca usado). La llamada a `laboral-info/{hash}/user_request_id_v2` no puede resolver → cae siempre al `catch` y al método local. La delegación de laboral-info está **rota en silencio**.

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
- `OnboardingController.php:1270-1272` — en `local`/`development`, `hadPreApproveLender` se stubea con **`random_int(0,1)`**. El flujo es **no determinístico** en local: la misma corrida a veces dispara Experian y a veces la saltea. Hay un segundo stub igual en `:400`.
- `OtpService.php:432` — en `local` el OTP es **1111** fijo (no lee Redis). Con `qa_otp_bypass_phones` (sólo `local`/`development`) el OTP son los **últimos 4 dígitos del teléfono**, y ese mismo bypass **saltea el rate limit** de personal-info.
- Rate limit de personal-info: por **número de documento**, `4/hora` por defecto, TTL 3600 s, clave `CTOP_LO_STORE_PERSONAL_INFO_RTL_CTRL::{documento}`, configurable en el Setting `personal_info_settings.rate_limit_rules`. La lectura chequea **primero la clave con typo** `store_personal_info_max_requests_per_houre` y después la correcta.

**Contrato y datos**
- `normalizeOtpErrorCode` (wizard) mapea `ONB003 → expired`, `ONB006 → max_attempts` y `ONB007 → rate_limit`. En el backend `ONB003` es *personal info no validada*, `ONB006` es *onboarding Bancolombia* y **`ONB007` no existe**. Sólo afecta etiquetas de analítica, pero la tabla del front no es el catálogo del back.
- `lenders-v2` **no es SSE**: el "streaming" lo hace el loader de React Router devolviendo promesas sin `await`.
- El default `180000` de `lenders-v2` enmascara el monto real si el front no lo manda; es el mínimo de Welli reciclado como constante.
- `env('INTERNAL_LEGACY_API_URL')` se llama **crudo** (no vía `config()`) en `ValidateOtpController:120` y `PersonalInfoController:1042` — con `config:cache` en producción devuelven `null` (hay un tercer uso en `ListLenderController:259`, pero está dentro del bloque comentado). El mismo valor está expuesto correctamente como `config('services.api.legacy_host')` y así lo usan `RegisterCellPhoneController:185` y `OtpController:371`.
- `SimulatorController::startV2` define `$alliedBranch` **sólo dentro** del `if (!ecommerce && auth()->check() && user_profile_id == 4)` y lo desreferencia fuera; para cualquier perfil que no sea asesor la variable no está definida.
- Autofill hardcodeado: para los allieds `[209,210,211]` (Corbeta) sin info laboral, el orquestador de OTP escribe **ingreso 1.500.000 y "Empleado"**.
- `OnboardingService.php:127` — `Experian::creditScore($user_request)` está comentado, pero el log inmediatamente anterior sigue afirmando que corre "unconditionally". No confiar en ese trace.
- `Modules/Onboarding/tests/Unit/*FreezeTest.php` son tests de **congelamiento**: fijan rarezas actuales (ONB001/002/004/006 con HTTP 200, el ternario muerto `corbeta ? 'ONB006' : 'ONB002'`, el centinela `[]` de `createUserRequest`). Cambiar comportamiento rompe estos tests **a propósito**.

## Preguntas abiertas
- ¿Quién consume `api/v2/onboarding`? El comentario de `OnboardingV2/routes/api.php` habla de un "private-network BFF", pero **no hay ningún llamador en los 3 repos**. Falta confirmar si existe fuera del árbol o si el módulo está esperando cutover.
- El catálogo completo `user_request_statuses` (id → nombre) no está en código: los ids 1/3/4/6/7/8/9/10/11/25 salen de constantes, comentarios y guardas; 26 (citado en el doc sembrado) **no se pudo confirmar** en esta pasada.
- `initial_fee`: el simulador lee `allieds.initial_fee` / `allieds.initial_fee_percentage` y `lenders_by_allied_branches.initial_fee_percentage`, o sea que hay config **a nivel comercio y sucursal**. La afirmación del doc sembrado de que "el % lo exige la categoría rt=2, no el comercio" corresponde al cupo CreditopX y pertenece a **Profiling / CreditopX**; no se verificó acá.
- `ecommerce_requests` / `user_requests_by_ecommerce_request`: la rama ecommerce de `createUserRequest` decide por `order_key` si actualiza o crea. Falta mapear el ciclo de vida completo del `ecommerce_request` (es turf de **Merchants** / **Aggregator**).

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (nodo SolicitudNode + fieldDocs `node.solicitud`/`sol.*` + MAP.md §S3).
- **2026-07-18** — Fase de data: nodo documentado por ANALISIS DE CODIGO (no habia doc fuente) + superficie curada.

## Enlaces
- Padre: **CreditOp**. Subcontexto: **KYC**.
- Hermanos que continúan el camino: **Dynamic Forms** (esquema EAV y config del formulario), **Merchants** (comercio/sucursal/canal), **Profiling** y **CreditopX** (cupo y reglas), **MS Pre-approvals** y **Aggregator** (resolución del listado), **Formalization** (todo lo posterior al estado 3), **MotaiX** (modos de comercio e `isMotaiRenting`), **SmartPay** (rama IMEI).
- Nodos de repo: **application**, **legacy-backend**, **frontend-monorepo**.
- Memorias: `lender-listing-cascade`, `migracion-application-a-legacy-estado`, `pre-approval-omit-experian-frontend`, `frontend-e2e-asesor-commands`, `synth-credipullman-gates`.
- El `playground/docs` fue removido de main; si hace falta el material viejo, `git 159906a:docs/<ruta>`.
