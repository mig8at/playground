# legacy-backend · contexto
> **estado:** al día con main · Laravel 10 modular (nwidart) con **DOS generaciones adentro**: 7 módulos "legacy" que reconstruyeron la originación (y son el backend real del wizard nuevo) + 9 módulos V1/V2 de nueva arquitectura por capas, hoy **sin ningún consumidor** en los repos en disco.

## Qué es
Repo Laravel 10 / PHP `^8.1` (`composer.json`; el `composer.lock` instalado exige >= 8.4.1, por eso el entorno es Sail `sail-8.4/app`) modularizado con `nwidart/laravel-modules ^10.0.3`. **16 módulos**, todos activos en `modules_statuses.json`. 2.158 archivos de código indexados: 995 en `Modules/`, 594 en `app/`, 406 en `database/`, 69 en `tests/`.

Es el destino de la migración strangler desde `application`, pero leerlo como "la reescritura que todavía no corre" es **incorrecto**. Lo que muestra el código:

1. **El wizard nuevo (`frontend-monorepo`) apunta 100% acá.** `apps/loan-request-wizard/.env` → `VITE_API_URL=http://legacy-backend.inertia-develop/api`, y el front consume **87 rutas distintas** bajo `/api/onboarding` (40), `/api/loans` (29), `/api/partners` (10) e `/api/identity` (8). Ninguna de esas rutas existe en `application` (su `routes/api.php` son solo webhooks de lenders externos).
2. **El flujo clásico (Inertia de `application`) delega solo 2 tajadas vivas** por HTTP interno, y bajo allowlist por comercio.
3. **La "nueva arquitectura" (V1/V2) no tiene consumidor** en ninguno de los 3 repos: 0 llamadas a `/api/v1/*` o `/api/v2/*` desde `application` o `frontend-monorepo`. Está construida por delante de su cliente (un BFF de red privada que no vive en estos repos).

O sea: no hay un "default" global — el default depende de **qué front** entra.

## Contenido

### Las dos generaciones de módulos
El repo lleva su propia guía in-repo, `NEW_ARCHITECTURE.md` (156 KB, no indexado por ser `.md`), que aplica **solo** a los módulos V1/V2 y lo dice explícitamente ("no aplica al monolito legacy").

| Generación | Módulos | Archivos indexados | Prefijo de ruta |
|---|---|---|---|
| **Legacy** (portado de `application`) | Loans, Onboarding, Identity, Partner, System, Risk, Payments | 363 / 198 / 102 / 53 / 48 / 46 / 29 | `api/loans`, `api/onboarding`, `api/identity`, `api/partners`, `api/system`, `api/payments` |
| **Nueva arq. con API** | OnboardingV2, RiskV2, UsersV1 | 20 / 41 / 23 | `api/v2/onboarding`, `api/v2/risk`, `api/v1/users` |
| **Nueva arq. solo-servicios** | AuthV1, AlliedBranchV1, UserRequestV1, EcommerceRequestsV1, LegalV1 | 11 / 13 / 10 / 15 / 8 | — (no tienen `RouteServiceProvider`) |
| **Transversal** | CommonsV1 | 15 | — |

Dominio por módulo (verificado en sus `routes/` y servicios):
- **Onboarding** — celular/OTP, `loan-application/*` (personal-info, laboral-info, listado v1 y v2), Bancolombia (BNPL / Consumer Loan), Corbeta checkout, ecommerce-request, VTEX, backdoor, scraping Ábaco, plan de pagos Credifamilia. **108 declaraciones de ruta**: el módulo con más superficie HTTP.
- **Loans** — post-selección: cupo CreditopX, pagaré/Deceval, cuota inicial (Wompi), cronograma, documentos, device/IMEI, revolving, cambios de crédito, reporte de perfilamiento. 50 rutas + 3 admin.
- **Identity** — validación de identidad (documento, facial, NEO), TusDatos AML, ADO enroll/verify, estado de validaciones. 20 rutas.
- **Partner** — API de back-office headless (`merchants`, sucursales, zonas, usuarios corporativos, credenciales ecommerce, lenders), toda bajo `auth.cognito`. 59 rutas.
- **System** — 2 rutas (despacho de jobs ADO/AML); su valor real son los repositorios adaptadores (`OtpServiceRepository`, `MessagingServiceRepository`, `SettingRepository`).
- **Payments** — links de pago. 9 rutas.
- **Risk** — **0 rutas** (su `routes/api.php` está vacío). Ver Gotchas.

### Registro de módulos y rutas
- Bootstrap Laravel 10 clásico: `bootstrap/app.php` liga `Http\Kernel` + `Console\Kernel` + `Exceptions\Handler`. El `routes/api.php` raíz solo tiene un `ping`.
- `config/app.php:173-180` registra 8 providers de `App\Providers`. Los de módulo los auto-descubre nwidart desde cada `module.json` (`providers: [...]`), con `config/modules.php:74` apuntando a `base_path('Modules')` y `:225` al `modules_statuses.json`.
- Cada módulo con API tiene su propio `RouteServiceProvider` que aplica prefijo + middleware; los 6 solo-servicios simplemente no lo tienen.
- **24 alias de middleware** en `app/Http/Kernel.php:49-72`; dos vienen de módulos (`backdoor.api_key` de Onboarding `:69`, `origination.flow` de Loans `:72`).
- `otel` lo llevan Onboarding y todos los V1/V2. **`auth.cognito` a nivel de grupo lo aplica solo Onboarding** (`RouteServiceProvider.php:42`); Loans, Identity y Partner lo aplican por sub-grupo.

### Convenciones: legacy vs nueva arquitectura (dos contratos incompatibles)
**Legacy** — controlador gordo que hereda `ApiController` (`app/Http/Controllers/ApiController.php:7`) y responde con el trait `App\Traits\ApiResponse`: `{success: bool, message, data?, meta?}` (`:9`) o `{success:false, message, errors?}` (`:33`). **El veredicto es el HTTP status.**

**Nueva arquitectura** — cadena `Route → Controller delgado → <Op>Service::<op>Facade → <Op>Command (DTO) → <op>Orchestrator (privado) → Repository ligado por interfaz → Eloquent → objeto de dominio`. Envelope `{code, message, data?}` de `CommonsV1\App\Services\BaseService::buildResponse` (`:45`), donde **el veredicto es el `code`** y el HTTP status se deriva del mapa `getHttpCode` de cada servicio. Convención de código: `<MOD><nº api><nnn>` (`USV11000`…`USV11004`, `OBV21xxx`, `RKV21xxx`/`RKV22xxx`).
- Un método público = un servicio. El `Command` es un DTO inmutable: constructor privado + `build()` + `toArray()` para logging.
- `BaseService::runServiceMethod($errorCode, …)` (`:70`) envuelve span + `try/catch` y convierte cualquier `Throwable` en el envelope de error → **los facades no lanzan**.
- Comunicación entre módulos vía métodos privados `adapt<Op>Response`: `OnboardingV2\ValidateOtpAuthService` inyecta **11 servicios de otros módulos** (`:72`) y tiene **10 adaptadores** (`:414`–`:833`) que desenvuelven el envelope del hermano a un valor PHP plano.
- `CommonsV1` expone `BaseService`, `TracingUtils` (spans OTel, log-and-rethrow), `CacheService` (Redis, TTL por defecto 3600 s, `:27`), `SettingsService` y los utilitarios `PhoneUtils`/`RequestUtils`/`StringUtils`.
- Cada módulo nuevo trae `README.md`, `TECHNICAL_DEBT.md` y `ARCHITECTURE_EXCEPTIONS.md`; los tres con API traen `openapi.yaml`.
- `RiskV2` agrega dos capas propias sobre el patrón base: `App/Extractors/` y `App/PreProcessors/` (resolver + una implementación por buró + interfaz en `Contracts/`).

**El contraste es medible** — promedio de líneas por controlador: UsersV1 70 · OnboardingV2 67 · RiskV2 71 · Payments 74 · Identity 116 · System 120 · Partner 124 · Loans 152 · Onboarding 233 · **Risk 618**.

### Lo NO modularizado (`app/`, 594 archivos)
La modularización **no es vertical**: los módulos no dueñan sus datos.
- **`app/Models` = 175 modelos**, y solo **1** modelo vive dentro de un módulo (`Modules/Identity/App/Models/IdentityValidationAttempt.php`). Todos los módulos hacen `use App\Models\…`.
- **`database/migrations` = 353 migraciones**, todas en la raíz. No existe ningún `Modules/*/Database/migrations`.
- `app/Actions/RiskCentrals/` — clientes de buró (Experian, Tusdatos, Agildata, Mareigua, Ado, Abaco) + sus `*Fixture`.
- `app/Actions/Lenders/` — 20 integraciones externas (Bancolombia ×4, Welli, Sistecredito ×3, Meddipay, Prami, Credifamilia, Approbe, Compensar, Payvalida, Wompi, Addi, BancoDeBogota ×2…).
- `app/Services/Lenders/CredifamiliaV2/` — 22 clases greenfield de KYC V2 (Evidente + CrossCore + Jumio); **solo existen acá**.
- `config/services.php` — registro de 37 integraciones externas (incluye `pre_approvals`, `otp_service`, `messaging_service`, `code_generation_service`).
- `app/Console/` 27 comandos · `app/Jobs/` 26 · `app/Notifications/` 22.

### Frontera con `application` (parallel-run, medido)
Dos apps Laravel sobre la **misma base de datos**. Números duros del diff:

| | idénticas | solo legacy-backend | solo application |
|---|---|---|---|
| Migraciones (por nombre de archivo) | **286** | 67 | 47 |
| Modelos | **160** | 15 | 8 |
| Comandos de consola | **12** | 14 | 15 |

- Lo exclusivo de legacy-backend son las piezas nuevas: KYC V2 (`CrossCoreEvaluation`, `EvidenteFlowStep`, `JumioAccount`), firma (`NetcoSigningDocument`, `DecevalLog`), device/MDM (`DeviceLock`, `UserRequestDeviceInfo`), modos (`AlliedMode`, `UserRequestMode`) y políticas de scoring.
- Lo exclusivo de application es **servicing/cartera**: `CreditopXLenderCollectionCharge`, `CreditopXLenderResidualBalance`, `RevolvingCreditIncentive*`, `ReminderDispatchLog`.
- **Los 12 comandos gemelos están MUERTOS en legacy-backend**: su `app/Console/Kernel.php:15-18` agenda **solo 4 tareas** (3 crons de device-lock + un watchdog de CrossCore cada 5 min), mientras application agenda ~20 (pagos CreditopX, revolving, recordatorios, Corbeta, reportes). El servicing corre en application.

**El puente HTTP** (`application` → legacy-backend, `INTERNAL_LEGACY_API_URL` en `application/config/services.php:224,228`) tiene exactamente 3 sitios, todos con la misma compuerta: `Setting` con key `allowed_bypass_comerces` → si el hash del comercio (o `"all"`) está en la lista, proxea; si no, corre el método viejo local.

| Endpoint delegado | Sitio en application | Estado |
|---|---|---|
| `POST /api/onboarding/loan-application/otp-validate/{hash}` | `ValidateOtpController.php:122` | **vivo** (allowlist `:111-116`) |
| `POST /api/onboarding/loan-application/laboral-info/{hash}/{ur}` | `PersonalInfoController.php:1044` | **vivo** (allowlist `:1022,:1036`) — pero ver Gotchas |
| `GET /api/onboarding/loan-application/lenders/{id}` | `ListLenderController.php:252-262` | **COMENTADO** (delegación del listado desactivada) |

### Tests, mocks y despliegue
- **Harness de fakes propio de este repo** (no existe en application): `config/onboarding.php:20-33` define `drivers.*` (`real`|`fake`) para otp, cache, experian, mareigua, agildata, tusdatos. `OnboardingDriverServiceProvider` sustituye bindings en `boot()` (`:40-44`) para los container-swappables (`:73-98`) e intercepta con `Http::fake()` a los proveedores KYC que llaman `Http::` estáticamente (`:110-139`). **Se niega a registrar fakes si `APP_ENV=production`** (`:141-152`). El `Makefile` expone `make mock-all` / `mock-off` / `drivers`.
- 64 tests en `tests/` (incluye `tests/Feature/E2E/`) + 76 en `Modules/*/tests/`.
- **CI = solo deploy, sin job de tests**: 7 workflows que empujan a ECR/ECS (`develop`→dev, `staging`→stg, tags→producción) + un `run-migrations.yml` manual.

## Dónde mirar
**Arranque y registro** (`legacy-backend`):
- `bootstrap/app.php` · `routes/api.php` (solo ping) · `config/app.php:173-180` (providers) · `config/modules.php:74,225` (paths + statuses)
- `app/Http/Kernel.php:49-72` (24 alias de middleware) · `app/Console/Kernel.php:15-18` (las 4 únicas tareas agendadas)
- `app/Providers/RouteServiceProvider.php` (raíz; solo `routes/api.php` + `exceptions.php`) · `app/Providers/RepositoryServiceProvider.php` (**stub vacío**)

**Contrato legacy**: `app/Http/Controllers/ApiController.php:7` · `app/Traits/ApiResponse.php:9,33` · `app/Otel/TracerService.php` · `app/Http/Middleware/ResolveCognitoUser.php` (`auth.cognito`)

**Nueva arquitectura**:
- `Modules/CommonsV1/App/Services/BaseService.php:45,70,101` (envelope + `runServiceMethod`) · `App/Utils/TracingUtils.php:37` · `App/Services/CacheService.php:27` · `App/Providers/CommonsV1ServiceProvider.php:19-31` (bindings + singletons)
- Rebanada canónica UsersV1: `App/Providers/RouteServiceProvider.php:24` → `routes/api.php:20` → `App/Http/Controllers/GetUserController.php:45` → `App/Services/GetUserService.php:52,97,148` → `App/Commands/GetUserCommand.php` → `App/Repositories/UserRepository.php`
- `Modules/OnboardingV2/routes/api.php:24,35` · `App/Providers/RouteServiceProvider.php:24` · `App/Services/ValidateOtpAuthService.php:72,153,256,414` · `App/Services/StorePersonalInfoService.php:66` (**siempre HTTP 501**)
- `Modules/RiskV2/routes/api.php:25,31` · `App/Constants/RiskCentral.php:15-20,41-48` (ids de buró + columna espejo en `user_summaries`) · `App/Extractors/RiskCentral/MareiguaExtractor.php:65` (port del legacy; se apoya en funciones SQL `FN_Mareigua_*`)
- Solo-servicios: `Modules/AuthV1/App/Http/Clients/OtpClient.php:40` · `Modules/AlliedBranchV1/App/Services/FindByHashService.php` · `Modules/UserRequestV1/App/Services/FindOrCreateService.php` · `Modules/EcommerceRequestsV1/App/Services/IsEcommerceRequestService.php` · `Modules/LegalV1/App/Services/SignAndSendTermsAndConditionsService.php`

**Módulos legacy**:
- **Onboarding**: `routes/api.php:49` (listado v1) `:50` (lenders-v2) `:93-134` (rutea a controladores de la raíz) · `routes/webhooks.php:10,18,24,32` (callbacks del MS de lenders + VTEX, sin Cognito) · `App/Providers/RouteServiceProvider.php:41-44` · `App/Providers/OnboardingServiceProvider.php:24` (`loadMigrationsFrom` a un dir inexistente) · `App/Http/Controllers/OnboardingController.php:149,509,899` · `App/Http/Controllers/ListLenderController.php:98,139` · `App/Http/Controllers/LenderListingController.php:21` (monto default `180000`) · `App/Services/OnboardingService.php:36` · `App/Services/UserRequestService.php:71` · `App/Services/lenders/LenderListingService.php:20,29-30,285,298` · `App/Services/lenders/LenderRetrievalService.php:83` · `App/Services/lenders/RiskCentralValidationService.php:26,46,56` · `App/Services/lenders/PreApprovedLenderService.php` · `App/Services/lenders/LenderUserCategoryService.php:21`
- **Loans**: `routes/api.php:107` (`/lender/available-quota`) · `routes/admin.php` · `App/Providers/RouteServiceProvider.php:40,45,50` (**doble registro**) · `App/Providers/LoansServiceProvider.php` (86 bindings) · `App/Http/Controllers/Customer/CreditopXQuotaController.php:66` · `App/Services/DatacreditoRuleEvaluator.php:21,25,29,48,94` · `App/Services/LenderRuleEvaluator.php:19` · `App/Services/LenderUserCategoryService.php:54` · `App/Repositories/LenderDatacreditoRulesRepository.php:24-26` · `App/Http/Middleware/AddOriginationFlowType.php:27` · `routes/add_selected_payment_date_to_user_requests.php` (**migración traspapelada**)
- **Risk**: `routes/api.php` (**vacío**) · `App/Http/Controllers/Customer/ProfilingReviewController.php:278,358` · `App/Http/Controllers/DatacreditoQueryByAlliedController.php:38,240` · `App/Http/Controllers/Admin/ProfilingController.php` (4.767 líneas)
- **Partner**: `routes/api.php:17` · `App/Services/AlliedManagementService.php:257-258,280,763,1431-1432` · `App/Services/LenderManagementService.php:30`
- **Identity**: `routes/api.php:28,74,86` · `App/Services/ValidationStatusService.php` · `App/Services/MareiguaService.php` · `App/Services/MereiguaService.php` (**0 bytes**)
- **System / Payments**: `Modules/System/routes/api.php` · `Modules/System/App/Repositories/OtpServiceRepository.php` · `Modules/Payments/routes/api.php`

**Integraciones, mocks y datos**: `app/Actions/RiskCentrals/Experian.php:480-482,512` (variantes Acierta/Quanto + `ProductId 64`) · `app/Support/Onboarding/External/Http/HttpFakeRegistrar.php:25` · `app/Providers/OnboardingDriverServiceProvider.php:40,73,110,141` · `config/onboarding.php:20-33` · `config/services.php` · `config/lenders.php:25` · `app/Services/Lenders/CredifamiliaV2/Evidente/EvidenteFlowService.php` · `app/Http/Controllers/Api/CredifamiliaV2/EvidenteController.php` · `app/Console/Commands/UpdateCreditopXRequestsCommand.php` (gemelo no agendado) · `Modules/Identity/App/Models/IdentityValidationAttempt.php` (**el único modelo dentro de un módulo**) · `Modules/Loans/tests/Feature/CreditopXQuotaControllerTest.php:36` (el único ejercicio de `/available-quota`)

**Frontera parallel-run** (`application`): `config/services.php:224,228` · `app/Http/Controllers/Customer/ValidateOtpController.php:111,122` · `app/Http/Controllers/Customer/PersonalInfoController.php:1019,1036,1044` · `app/Http/Controllers/Customer/ListLenderController.php:252` · `app/Console/Kernel.php:19-65` (~20 tareas de servicing, contra las 4 de legacy) · `routes/api.php` (la API de application son **solo webhooks** de lenders externos)

## Gotchas / riesgos
- **En Risk, los "controladores" son servicios.** `Modules/Risk/routes/api.php` no declara ni una ruta, pero sus 16 controladores (media 618 líneas) se instancian a mano desde Onboarding, Partner y `app/Actions`: `ListLenderController.php:98` hace `app(\Modules\Risk\…\ProfilingReviewController::class)->updateAsyncLender(...)`. Sus métodos no reciben `Request` ni devuelven `JsonResponse` — reciben modelos y devuelven arrays (`ProfilingReviewController.php:278,358`; `DatacreditoQueryByAlliedController.php:38`). El anti-patrón espejo también existe: **6 servicios de Onboarding heredan `ApiController`** (p.ej. `OnboardingService.php:36`) solo para usar `success()/error()`.
- **Las rutas de Loans se registran DOS VECES.** `Loans/App/Providers/RouteServiceProvider.php:40` y `:45` cargan **el mismo** `routes/api.php` con prefijos `api/loans` y `api/loans/customer` (distinto namespace default). Todo endpoint de Loans existe duplicado: `/api/loans/lender/available-quota` responde también en `/api/loans/customer/lender/available-quota`.
- **El fork de `LenderUserCategoryService` es interno, no app↔legacy.** Conviven dos: `Loans/App/Services/LenderUserCategoryService.php:54` → `getLenderUserCategory(int $user_id, int $lender_id): ?LenderUsersCategory` (742 líneas, ~20 métodos privados de scoring / capacidad de pago / vectores) y `Onboarding/App/Services/lenders/LenderUserCategoryService.php:21` → `getLenderUserCategory($user, $lender_id)` (417 líneas, sin tipos). **`LenderListingService` inyecta los DOS a la vez** (`:29` y `:30`, el de Loans aliasado `…ServiceCtopX`) y usa el de Loans para sellar la aprobación (`:298`), mientras el listado v1 (`ListLenderController`) usa el de Onboarding. En total hay **8 nombres de servicio duplicados entre módulos** (`UserService`, `UserRequestService`, `OtpService`, `OtpValidationService`, `NotificationService`, `LenderSpecialGrantingService`, …).
- **`LenderListingService extends LenderRetrievalService`** (`:20`): el listado v2 es una **subclase** del v1, no un reemplazo. Y su `stampCreditopXApproval` documenta (`:279`) que NO corre los gates de crédito activo / reglas de lender / datacrédito que sí aplica `/available-quota` → el sello del listado y el cupo pueden discrepar.
- **Los dos motores de datacrédito miden cosas distintas** (confirmado línea a línea): el nuevo `DatacreditoRuleEvaluator` busca la regla **genérica** (`LenderDatacreditoRulesRepository.php:24-26`: `lender_id` + `allied_branch_id IS NULL`), lee `principals.negativeHistoricalLast12Months` / `consultedLast6Months` y exige `meses >= time_finance_sector` (rechaza con `<` estricto, `:94`); el viejo `RiskCentralValidationService` busca la regla **por sucursal** (`:26`), compara `additional_info.negativeAccounts.total` contra `current_dues` (`:46`) y rechaza con `<=` (`:56`). **Con `meses == umbral` el viejo rechaza y el nuevo aprueba.**
- **Matiz sobre "fail-closed"**: el evaluador nuevo es fail-closed **solo ante datos incompletos** (sin score o sin `principals` → rechaza, `:48-55`). Si el lender **no tiene regla configurada, PASA** (`:29-33`, `skipped: no_datacredito_rule`). Y arranca con un bypass cableado: `document_type === 'CE' && lender->id === 84` → pasa sin evaluar (`:21-23`).
- **Bug en el puente parallel-run**: `application/app/Http/Controllers/Customer/PersonalInfoController.php` resuelve el id en `:1019` (`$user_request_id = session($userRequestIdSessionKey)`) pero en `:1044` interpola **`$userRequestIdSessionKey`** en la URL — manda el literal `"user_request_id_v2"` como `{user_request_id}` a legacy. La delegación de laboral-info viaja con un id inválido.
- **La suite `Modules` de PHPUnit no matchea nada en Linux.** `phpunit.xml` declara `./Modules/*/Tests/{Feature,Unit}` con **T mayúscula**, pero los directorios están versionados en minúscula (`Modules/{Identity,Loans,Onboarding}/tests/`). En macOS el `glob()` resuelve igual (FS case-insensitive, comprobado con `php -r`); en el contenedor `sail-8.4` (Linux) devuelve vacío → los **76 tests de módulo no corren** con `make test`. Y no hay red de seguridad en CI: los 7 workflows son solo deploy.
- **Código muerto verificado**: `Modules/Loans/routes/add_selected_payment_date_to_user_requests.php` **no es un archivo de rutas, es una migración** (`Schema::table('user_requests', …)`) traspapelada en `routes/`, con 0 referencias en el repo y fuera del `RouteServiceProvider` → nunca corre ni como ruta ni como migración. `Modules/Identity/App/Services/MereiguaService.php` es un archivo de **0 bytes** (typo de `MareiguaService`), 0 referencias — el único archivo vacío del repo. `app/Providers/RepositoryServiceProvider.php` es un stub con `register()`/`boot()` vacíos: los bindings reales viven en cada `*ServiceProvider` de módulo (Loans 86, Onboarding 43, Identity 31, RiskV2 20…).
- **`loadMigrationsFrom` apunta al vacío**: los providers legacy llaman `loadMigrationsFrom(module_path($m,'Database/migrations'))` (`OnboardingServiceProvider.php:24`) y **no existe ningún `Modules/*/Database/migrations`**. Es no-op; todo el esquema son las 353 migraciones de `database/migrations`.
- **Riesgo de esquema compartido**: 286 migraciones con nombre idéntico en ambos repos, más 67 exclusivas de legacy y 47 de application, todas sobre la misma tabla `migrations` de la misma BD. Cada app aplica su propio set.
- **Hardcodes**: `config/lenders.php:25` resuelve `smartpay_lender_id` por `env('APP_ENV')` (160 en producción, 153 en el resto) — no por BD ni por env propia. `LenderListingController.php:21` usa `amount` default `180000`.
- **Fuga de frontera módulo→raíz**: `Modules/Onboarding/routes/api.php:93-134` y `routes/webhooks.php:10` rutean a controladores de `app/Http/Controllers/Api/CredifamiliaV2/`, fuera de todo módulo.
- **La nueva arquitectura declara no tener auth por diseño** (excepción `GLOBAE001`, comentada en cada `routes/api.php` V1/V2): ningún módulo nuevo aplica `auth.cognito` y la seguridad se apoya en el borde de red. Si alguna de esas rutas se publicara por el API Gateway, quedaría abierta.

## Preguntas abiertas
- **¿Quién consume `/api/loans/lender/available-quota`?** El endpoint existe (`Loans/routes/api.php:107`) y tiene Feature test propio, pero **no tiene ni un llamador** en `application`, `frontend-monorepo` ni dentro de legacy-backend. Su cliente vive fuera de los repos en disco (candidato: `ms-preapprovals`). Hasta confirmarlo, la etiqueta "autoritativo" del cupo rt=2 queda sin verificar por código.
- **¿Existe el BFF de red privada** que `NEW_ARCHITECTURE.md` nombra como único consumidor de los módulos V1/V2? No está en los 3 repos indexados.
- **¿Hay ruteo a nivel de infraestructura** (API Gateway / nginx) que mande ciertos paths a legacy-backend sin pasar por el proxy HTTP de `application`? Solo verifiqué el puente aplicativo (`INTERNAL_LEGACY_API_URL`, 3 sitios) y el `VITE_API_URL` del wizard.
- **¿Cuál de los dos registros de Loans usan los clientes** (`api/loans/...` vs `api/loans/customer/...`)? El front usa el primero en las rutas que revisé, pero no audité las 29.
- No pude correr `php artisan route:list` (el `vendor/` instalado exige PHP ≥ 8.4.1 y el intérprete local es 8.2.29): los conteos de rutas son estáticos, contando declaraciones `Route::…` por archivo.

## Bitácora
- **2026-07-18** — Fase de data: nodo documentado por ANALISIS DE CODIGO (no habia doc fuente) + superficie curada.
- **2026-07-17** — Contexto sembrado desde playground/flow (MAP.md §0 tabla Repos + Apéndice C índice legacy + S1-S6, corrección S4 "legacy sí tiene cliente Experian").

## Enlaces
- Padre: **Architecture**. Hermanos: **application** (el monolito Inertia y el servicing), **frontend-monorepo** (el wizard que consume estas APIs), **ms-preapprovals** (MS Go rt=1).
- Temas que cruzan este repo: **Onboarding**, **Profiling**, **CreditopX**, **KYC**, **Formalization**, **Merchants**.
- Memorias: [[migracion-application-a-legacy-estado]] · [[refactor-perfilamiento-lenders]] · [[datacredito-rules-per-lender]] · [[lender-listing-cascade]] · [[credifamilia-flujo-mapa]] · [[reglas-copia-por-sucursal]] · [[admin-anatomia-creditop]] · [[playground-convention]].
- El doc de arquitectura in-repo `NEW_ARCHITECTURE.md` (y los `README.md` / `TECHNICAL_DEBT.md` / `ARCHITECTURE_EXCEPTIONS.md` por módulo) **no** entran en el índice de este árbol (solo indexa código) — leerlos directo en el repo. Material histórico de `playground/docs`: `git 159906a:docs/<ruta>`.
