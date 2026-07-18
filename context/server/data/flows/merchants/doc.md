# Merchants · contexto
> **estado:** al día con main · Los comercios aliados: las 3 capas de configuración (entidad → comercio → sucursal), por qué las reglas se **copian** en vez de heredarse, y los flujos de originación concretos por comercio.

## Qué es
Los **comercios/merchants** aliados (`allieds`) y sus **sucursales** (`allied_branches`). Cubre dos caras: (1) el **alta y configuración** — cómo se crean comercio y sucursal, qué configura cada nivel, y qué pasa al habilitar una entidad en una sucursal; y (2) los **flujos de originación concretos** por comercio/canal (los subcontextos). Es la contraparte de **Entities** (los prestamistas) en el marketplace: acá manda el eje "quién ofrece y dónde", no "quién presta".

El nodo se documentó **leyendo código** (no hay doc fuente). La verdad estructural es más flaca de lo que sugiere el panel: **no existe herencia viva entre niveles**. Lo que el admin llama "configurar la entidad en la sucursal" es en realidad un **snapshot que se clona** al momento de habilitar, y a partir de ahí las dos copias viven vidas separadas.

## Contenido

### 1. El modelo: 3 tablas, pero solo 2 niveles con contenido real
| Tabla | Qué es | Peso |
|---|---|---|
| `allieds` | el comercio | 41 columnas en `$fillable` (legacy) / 37 (application) |
| `allied_branches` | la sucursal / punto de venta | 12 en `$fillable`; la llave de entrada es `hash` |
| `lenders_by_allieds` | entidad **×** comercio = **toda la calculadora económica** | 28 en `$fillable` |
| `lenders_by_allied_branches` | entidad **×** sucursal = **solo membresía** | **5 columnas**: `lender_id`, `allied_branch_id`, `url_utm`, `sort`, `status` |

La asimetría es el hecho central: la sucursal **no** tiene economía propia. `lenders_by_allied_branches` solo dice *"esta entidad se ofrece acá"* + un override cosmético de UTM/orden. Toda la plata (`expense_penalties_percentage`, `administrative_costs_percentage`, `life_insurance_*`, `guarantee_fund_percentage`, `iva`, `comission_percentage`, `initial_fee_percentage`, `administrative_fixed_value`, `max_amount`, `bank_id`, `credit_note_calculation_id`, `starting_value_calculation_id`) vive a nivel **comercio**.

`SimulatorController.php:32-41` deja el patrón explícito (aunque con nombres de variable engañosos): se piden los `lender_id` **activos de la sucursal** y con esos ids se traen las filas de `lenders_by_allieds` **del comercio**. Sucursal = membresía; comercio = economía.

La tabla `allieds` nació con 16 columnas (`2023_04_20_193419_create_allieds_table.php`) y creció por acumulación de **toggles booleanos** (`initial_fee`, `self_managed`, `allow_other_payment`, `show_profiling`, `flow_type`, `new_screens`, `have_ctopx`, `show_products`, `show_authorizations`, `show_gestion`, `show_financial_data`, `hide_non_integrated_probability`, `is_available_in_app`…). La camada de jun–jul 2026 (`show_products`, `show_authorizations`, `hide_non_integrated_probability`, `show_gestion`, `show_financial_data`) es literalmente **hardcodes convirtiéndose en columnas**.

### 2. Alta: qué crea cada pantalla, y qué NO
- **Comercio** — `AlliedController::store` (`:101`). Un solo `Allied::create` con **quemados**: `allied_caterogy_id => 1`, `new_screens => true`, `quaternary_color`/`quinary_color` = `'FFFFFF'`, `hash = hash('crc32', date('Y-m-d H:i:s'))`. El país está acotado a **Colombia (47) o RD (60)** — en la pantalla (`:86`) y en la validación (`Allied/StoreRequest.php`, `Rule::in([47, 60])`).
- **Sucursal** — `AlliedAlliedBranchController::store` (`:174`). Genera `hash` (mismo crc32-del-segundo) y sube el QR a S3 apuntando a `<front_url>aliados/onboarding?allied=<slug>&hash=<hash>` (`:183`).
- **El alta NO cablea nada.** Ni el comercio ni la sucursal crean relaciones con entidades: `store` de sucursal escribe **solo** la fila de `allied_branches`. La relación entidad↔sucursal (y con ella la copia de reglas) nace únicamente en el **update**.

### 3. La habilitación: DELETE + recreate + COPIA de reglas
`AlliedAlliedBranchController::update` (`:102`) es el disparador. Por cada entidad marcada `is_active == 1`:

1. `:123` — **borra todas** las filas de `lenders_by_allied_branches` de esa sucursal.
2. `:130` — las **recrea** desde el payload (`url_utm` se guarda `NULL` si coincide con el del comercio → herencia por `COALESCE` al leer, `:77`).
3. `:142` — `LenderDatacreditoRulesController::addNewRule($lender_id, $alliedBranch)`
4. `:143` — `LenderRulesController::addNewLenderRule($lender_id, $alliedBranch)`

**`addNewRule`** (`LenderDatacreditoRulesController.php:75`) clona la regla de buró: si no existe ya una para `(lender, branch)`, busca la **plantilla genérica** (`allied_branch_id IS NULL` de ese lender) y, si tampoco hay, cae al **lender 5 (BdB)** (`:102`). Copia 6 campos (`score`, `current_dues`, `time_finance_sector`, `negative_historical_last_12_months`, `consulted_last_6_months`, `probability_levels`). Tiene una **compuerta de país** añadida después (`:80`): si el comercio no es Colombia (`Country::COLOMBIA_ID = 47`), **no crea nada**.

**`addNewLenderRule`** (`LenderRulesController.php:330`) clona las reglas duras: toma los `LenderRule` **huérfanos** (`group_rule_id IS NULL`) de esa entidad como plantilla, crea un `GroupRule` con `rule_name = 'AB' . $alliedBranch->id` y replica cada regla dentro. **No** tiene compuerta de país.

Ambos son **idempotentes** (si ya hay copia, no tocan nada) y ambos **se tragan la excepción** notificando por mail a `santiago@creditop.com` (`LenderDatacreditoRulesController.php:122`, `LenderRulesController.php:364`).

**El multiplicador:** cada par (sucursal × entidad habilitada) genera 1 `group_rules` + N `lender_rules` + 1 `lender_datacredito_rules`. Con miles de sucursales × decenas de entidades, eso es el origen de las decenas de miles de filas duplicadas (≈37.284 medidas sobre datos reales; ver memoria `reglas-copia-por-sucursal`). Como es un **snapshot único**, cambiar la plantilla después **no re-sincroniza** nada.

**Segundo disparador:** `AlliedEcommerceCredentialsController::store` (`:53`) crea una sucursal dedicada (`'Ecommerce-' . $name`, con `country_city_id => 1123` quemado en `:72`) y repite la copia (`:98-99`) — pero itera sobre `LenderAlliedCredential` (entidades con credencial de API para ese comercio), **no** sobre `LendersByAllied`.

**Backfill histórico (código muerto):** `LenderRulesController::updateRules` (`:270`) y `::updateOrCreateLenderDatacreditoRules` (`:306`) recorren **toda** `lenders_by_allied_branches` clonando reglas y terminan en `dd()`. No están ruteados en `routes/admin.php` — son scripts de migración one-shot fosilizados dentro del controller.

### 4. Canal: la credencial de ecommerce bifurca
No hay columna "canal". Lo que bifurca es la **existencia de una fila en `allied_ecommerce_credentials`** para esa sucursal:
- `AlliedBranch::isEcommerceBranch()` (`AlliedBranch.php:79`) = `alliedEcommerceCredentials()->exists()`.
- En legacy lo encapsula `IsEcommerceBranchService` (serie `ABV13xxx`), servicio **interno sin ruta HTTP**, consumido por `EcommerceRequestsV1`.
- La credencial es determinística: `bin2hex($allied->id . $branch->hash . date('Y-m-d'))` (`AlliedEcommerceCredentialsController.php:84`); `customer_key`/`customer_secret`/`headers` van cifrados (`encrypted:collection`) y ocultos en serialización.
- `ecommerce_type_id`: Vtex → 3, con `secret` → 1, resto → 2 (`:64`).

### 5. Contexto de entrada: el hash de sucursal manda
El `hash` de la sucursal es la llave de todo el flujo.
- **Ruta del wizard:** `/merchant/{partner_hash}/solicitar`. El loader (`default-layout.tsx:74`) **fuerza** que `params.partner_hash` sea el hash de la sucursal del asesor logueado y redirige si no coincide → un asesor solo opera su propia sucursal.
- **Cookie de contexto:** `merchant_context` (httpOnly, `sameSite=lax`, dominio `.creditop.com`, 24 h) con `{merchant_id, merchant_slug, merchant_name, allied_branch_hash}` (`merchant-context-cookie.server.ts`), escrita en `default-layout.tsx:160-169`.
- **Contrato al front:** `PartnerInfoResponse = { partner, partner_branch, partner_modes, partner_branches }` (`api-responses.ts:87`). El `Partner` (`:24`) expone los toggles del comercio (`have_ctopx`, `self_managed`, `initial_fee`, `flow_type`, `new_screens`, `show_profiling`, `show_originated_credits`, `preapproved_registration`, colores, `country_id`).
- **Tema/branding:** `GET /api/loans/allied/{hash}` devuelve 6 colores (`primary`…`senary`) + logo y `lender_path` (`allied-theme.repository.ts:19`).
- **Metadatos para terceros:** `Modules/Onboarding/.../AlliedBranchController::getByHash` (`:48`) resuelve `business_name`/`store_name`/`department`/`city`/`email` para los bodies de Meddipay/Prami/Welli, consumido por el pre-approvals-service. **Nunca devuelve 4xx/5xx**: degrada a strings vacíos + `admin.ecommerce@creditop.com`.
- En la arquitectura nueva la resolución vive en `Modules/AlliedBranchV1` (`FindByHashService`, serie `ABV11xxx`) — el módulo **no tiene carpeta `routes/`**, se consume cross-módulo desde `OnboardingV2::ValidateOtpAuthService`.

### 6. Disparador de buró por sucursal (`datacredito_trigger`)
Columna JSON en `allied_branches` con default **quemado en el modelo** (`AlliedBranch.php:18-34`): `gender [M,F]`, `min_age 25`, `max_age 55`, `income_amount 2000000`, `risk_central [no,si]`, `employment_situation [Pensionado, Empleado]`. Se edita en `AlliedAlliedBranchController::updateTrigger` (`:230`), con `apply_all` que lo pisa en **todas** las sucursales del comercio de un saque. Los tres campos de formulario son EAV: `employment_situation`=29, `income_amount`=87, `risk_central`=160.
Lo consume `DatacreditoQueryByAlliedController::userViability` (`:38`), que además mete un `switch ($userRequest->allied_id)` con el caso **Pullman (94): monto ≤ 600.000 → no viable** (`:86-97`).

### 7. El comercio como llave de ramificación (hardcodes)
El `allied_id` es una condición `if` esparcida por el código. Censo reproducible (regex sobre `allied_id ==/!=/in_array` + constantes, tests excluidos):
- **application: 23 archivos.** IDs recurrentes: **94 = Pullman**, **26 = Sonría**, **24 + [209,210,211] = grupo Corbeta**, **189 = DFS**, más 250, 272, 277, 311, 67, 95, 153.
- **legacy-backend: 9 archivos.** La reducción es real, no cosmética: Corbeta pasó a `settings.corbeta_allieds` leído por `IsCorbetaOnboardingService` (`:113`), y lo que queda se agrupó en constantes con nombre (`ManualPersonalDataAllieds::MANUAL_BIRTH_ALLIED_IDS = [272]`).
- El patrón sobrevive incluso en el front: `default-layout.tsx:120` define `FALLBACK_AUTHORIZATION_ALLIED_ID = 26` como fallback de `show_authorizations`.

### 8. El gemelo legacy: `Modules/Partner`
Puerto 1:1 del admin de comercios a legacy-backend. Rutas bajo `api/partners` (`RouteServiceProvider.php:40`), prefijo `merchants` dentro del grupo `auth.cognito` (`Modules/Partner/routes/api.php:17-18`). El módulo está **habilitado** (`modules_statuses.json`), pero:
- **El CRUD de comercios no lo consume nadie.** Los únicos endpoints `api/partners/*` que llama el frontend-monorepo son `requests`, `requests/{id}/continue`, `requests/statistics`, `dynamic-form/session/{id}`, `products/{hash}`, `user-request-product` y `user-requests/{id}/financial-data`. Ni un solo `merchants/*` ni `lenders/*`. El admin vivo sigue siendo el panel Inertia de `application`.
- **Pero el módulo no es inerte:** su `UrlGenerationService` es infraestructura viva usada por `Loans`, `Identity` y `Onboarding`. Lo muerto son sus métodos de URL de comercio (`generateQrCodeUrl` → `/register/{hash}`, `generateAlliedBranchUrl` → `/{slug}/branch/{hash}`, `generateEcommerceUrl` → `/ecommerce/{hash}`, `:27-58`): **nadie los llama**, y `AlliedManagementService` sigue armando la URL a mano (`:305`, `:782`).
- **La copia de reglas está duplicada 1:1** en `AlliedManagementService::updateAlliedBranch` (`:237` delete, `:248` create, `:257-258` copia) y `::storeEcommerceCredential` (`:1431-1433`). El fallback a BdB también (`LenderRuleRepository::findDefaultDatacreditoRule` → `lender_id 5`, `:146`), pero **sin la compuerta de país** que sí tiene application.

## Subcontextos
- **Motai** — flujo Motai (comercio 158, in-platform rt=2): 3 productos CreditopX (crédito/renting/RTO) + Ábaco (info. complementaria, ingreso gig informativo).
- **SmartPay** — canal in-platform (path IMEI): el celular como garantía, salta el AML de TusDatos, bloqueo por MDM.
- **Pullman** — flujo CrediPullman/Pullman (rt=2 in-platform "vanilla"): el caso base de la familia CreditopX (hardcode `allied_id == 94`).

## Dónde mirar
**Admin vivo — 3 capas** (`application`):
- `app/Http/Controllers/Admin/AlliedController.php:101` alta de comercio (quemados) · `:157` update (usa `collect($request)`, no `validated()`) · `:246` `changeStatus` (churn/activación) · `:86` países [47, 60].
- `app/Http/Controllers/Admin/AlliedAlliedBranchController.php:174` alta de sucursal + hash/QR · **`:102` update = el disparador** (`:123` delete, `:130` recreate, `:142-143` copia, `:77` COALESCE de `url_utm`) · `:230` `updateTrigger`.
- `app/Http/Controllers/Admin/AlliedLenderController.php:137` la calculadora por comercio · `:90` + `:127` IVA forzado a 19 si `response_type == 2` · `:102` pagaré por defecto · `:111` permisos CreditopX a perfiles [6,4] · `:249` único lugar que escribe `max_amount` · `:307` destroy (limpia sucursales, **no** reglas).
- `app/Http/Controllers/Admin/LenderRulesController.php:330` `addNewLenderRule` · `:270` / `:306` backfills muertos · `:364` notificación silenciosa.
- `app/Http/Controllers/Admin/LenderDatacreditoRulesController.php:75` `addNewRule` · `:80` compuerta Colombia · `:102` fallback lender 5 (BdB) · `:122` notificación silenciosa.
- `app/Http/Controllers/Admin/AlliedEcommerceCredentialsController.php:53` 2.º disparador (crea sucursal `Ecommerce-*`, `:72` ciudad quemada, `:84` token).
- `app/Http/Controllers/Admin/AlliedModulesController.php:65` pestaña "Módulos" = matriz `status_per_profiles`.
- `app/Http/Controllers/Admin/AlliedRulesController.php` — 237 líneas de código muerto (ver Gotchas).
- `routes/admin.php:37-66` el mapa de pantallas (`aliados`, `aliados.puntosdeventa` `:53`, `editar-disparador` `:54`, `aliados.entidades` `:61`, `aliados.modulos` `:65`, `aliados.ecommerce` `:66`) · `:145-149` reglas.
- Modelos: `app/Models/Allied.php` · `app/Models/AlliedBranch.php` (`:18` default del trigger, `:79` `isEcommerceBranch`, `:83` `hasCreditopX`) · `app/Models/LendersByAllied.php` · `app/Models/LendersByAlliedBranch.php` · `app/Models/AlliedEcommerceCredential.php` · `app/Models/Country.php:16` (`COLOMBIA_ID = 47`).
- Validación: `app/Http/Requests/Admin/Allied/StoreRequest.php` (`Rule::in([47,60])`, exige `price`) · `app/Http/Requests/Admin/AlliedBranch/UpdateRequest.php` (**no valida `lenders_selected`**).
- Consumo: `app/Services/lenders/LenderRetrievalService.php:533` (`lenders_by_allieds.max_amount` pisa el cupo de la entidad) · `:120-165` (`have_ctopx` + `no_more`) · `app/Http/Controllers/Customer/SimulatorController.php:32-41` (sucursal = membresía / comercio = economía).

**Esquema** (`legacy-backend/database/migrations/`): `2023_04_20_193419_create_allieds_table.php` · `2023_07_17_161110_create_allied_branches_table.php` · `2023_07_17_171700_create_lenders_by_allied_branches_table.php` (5 columnas) · `2023_07_24_143425_create_lenders_by_allieds_table.php` · `2024_04_08_135431_create_allied_ecommerce_credentials_table.php` · `2024_07_25_101445_add_datacredito_trigger_to_allied_branches_table.php` · `2025_01_06_150922_add_limit_amounts_to_lender_by_allieds_table.php` (min+max juntos) · `2025_07_25_174150_add_external_id_to_allied_branches_table.php` · `2026_03_09_204622_create_merchant_modes_table.php` (**crea `allied_modes`, no `merchant_modes`**) · `2026_06_22_171820_add_show_authorizations_to_allieds_table.php` · `2026_06_24_120000_add_hide_probability_to_lenders_by_allieds_table.php` (solo en legacy; ver deriva).

**Legacy** (`legacy-backend`): `Modules/Partner/App/Services/AlliedManagementService.php:196` update de sucursal · `:280` store · `:763` store de comercio · `:1367` credencial ecommerce · `:239-240` y `:1384-1385` la instanciación rota. `Modules/Partner/App/Http/Controllers/LenderRulesController.php:109` · `.../LenderDatacreditoRulesController.php:57` · `Modules/Partner/App/Services/LenderRuleManagementService.php:384` · `Modules/Partner/App/Repositories/LenderRuleRepository.php:146` (BdB). `Modules/Partner/routes/api.php:17-18` + `Modules/Partner/App/Providers/RouteServiceProvider.php:40`. `Modules/Partner/App/Services/UrlGenerationService.php:27-58` (métodos muertos). `Modules/AlliedBranchV1/App/Services/{FindByHashService,IsEcommerceBranchService,IsCorbetaOnboardingService}.php` (internos, sin rutas; `IsCorbetaOnboardingService:113` lee `settings.corbeta_allieds`). `Modules/Onboarding/App/Http/Controllers/AlliedBranchController.php:48`. `Modules/Onboarding/App/Services/lenders/LenderListingService.php:350-386`. `Modules/Onboarding/App/Constants/ManualPersonalDataAllieds.php:20`. `Modules/Risk/App/Http/Controllers/DatacreditoQueryByAlliedController.php:38`. Modelos: `app/Models/Allied.php:139` (accessor `show_originated_credits`), `app/Models/AlliedMode.php`.

**Front** (`frontend-monorepo`): `apps/loan-request-wizard/app/layouts/default-layout.tsx:74` (hash del asesor obligatorio), `:120` (fallback allied 26), `:160-169` (cookie) · `apps/loan-request-wizard/app/utils/merchant-context-cookie.server.ts` · `modules/loan-request-wizard/loan-application-form/src/lib/types/api-responses.ts:24-92` · `apps/loan-request-wizard/app/modules/allied-theme/infrastructure/allied-theme.repository.ts:19`.

## Gotchas / riesgos
- **`have_ctopx` es NO-OP en el listado de legacy.** `LenderListingService.php:356` tiene `$no_more = false; // TODO quitar definitivamente`; con eso, `have_ctopx = false` deja la lista vacía y el `elseif (empty(...))` de `:377` la rellena con **todas** las entidades de la sucursal. Ambos valores del flag terminan igual. En `application` (`LenderRetrievalService.php:126`) `$no_more` **sí** se calcula (¿ya tiene un crédito rt=2 en estado 11 en ese comercio?) → **la regla "un CreditopX activo por comercio" existe en application y se perdió en legacy**.
- **`lenders_by_allied_branches.status` no filtra en el camino principal.** Ninguna de las tres ramas de `resolveLenderIdsByBranch` (legacy) ni de `LenderRetrievalService` (application) lo aplica; sí lo usan la pantalla de reglas, el chequeo de Prami y el simulador viejo. Además **ningún código escribe la columna** (el `create` no la manda y el default de la migración es `true`) → apagar una entidad en una sucursal es una operación **solo-BD**, no de panel. *(Corrige la afirmación sembrada de que era "la 1.ª compuerta dura de getLenders".)*
- **Guardar una sucursal con lista incompleta borra asociaciones… pero no reglas.** El `update` es DELETE + recreate y `AlliedBranch/UpdateRequest` **no valida `lenders_selected`**. Las `group_rules`/`lender_rules`/`lender_datacredito_rules` ya copiadas **quedan huérfanas** (nadie las borra, ni el `destroy` de `AlliedLenderController:307`).
- **Copia = snapshot único.** Cambiar la plantilla (`allied_branch_id IS NULL`) después de habilitar no re-sincroniza las copias. De ahí la deriva entre sucursales del mismo comercio.
- **Fallback silencioso a BdB (lender 5).** Una entidad sin plantilla de datacrédito hereda los umbrales de Banco de Bogotá sin ninguna marca visible (`LenderDatacreditoRulesController.php:102`, `LenderRuleRepository.php:146`).
- **Los errores de copia se tragan** (mail a `santiago@creditop.com`): una sucursal puede quedar habilitada **sin reglas** y no hay señal en UI.
- **El gemelo legacy de la copia está roto.** `AlliedManagementService.php:239-240` (y `:1384-1385`) hace `new LenderDatacreditoRulesController()` / `new LenderRulesController()` **sin argumentos**, pero ambos controllers exigen `LenderRuleManagementService` en el constructor → `ArgumentCountError`, que **no** es `\Exception` y por lo tanto **no lo atrapan** los `catch` de alrededor. Ese camino fatalea si se invoca.
- **`min_amount` es fantasma.** Está en `LendersByAllied::$fillable` en ambos repos y en la migración, pero **ningún controller lo escribe y nadie lo lee**. El `min_amount` que sí decide es el de `credit_line_by_lenders` (nivel entidad). `max_amount` sí manda: pisa el cupo de la entidad si es no-nulo (`LenderRetrievalService.php:533`), y solo lo escribe el `update` (`AlliedLenderController:249`), nunca el `store`.
- **Colisión de hash.** Comercio y sucursal usan `hash('crc32', date('Y-m-d H:i:s'))` — 8 hex derivados **solo del segundo actual**, y `allied_branches.hash` **no tiene índice único**. Dos sucursales creadas en el mismo segundo comparten la llave de entrada al flujo.
- **`AlliedController::update` no usa `validated()`** (`:185`, con la línea correcta comentada justo arriba): mass-assign desde el request crudo, contenido solo por el `->only([...])`.
- **`AlliedController::store` descarta campos validados.** `Allied/StoreRequest` exige `price` (y acepta `initial_fee`, `self_managed`), pero el `create` no los escribe: solo se pueden setear después, por update.
- **`AlliedModulesController::store` borra fuera de la transacción** (`:70-71` vs `DB::beginTransaction()` en `:77`): un fallo a mitad deja al comercio **sin ninguna** fila en `status_per_profiles`.
- **El rango de edad del disparador es un no-op.** `DatacreditoQueryByAlliedController.php:136` evalúa `age <= min_age && age >= max_age`; con el default (25/55) es imposible que dispare. El propio docblock (`:31-33`) lo documenta.
- **`allieds.country_id` tiene default `1`, pero `Country::COLOMBIA_ID = 47`.** Filas viejas o creadas fuera del panel caen en el default y **saltean** la creación de reglas de datacrédito (`addNewRule:80`). `Country` solo define la constante en `application`; legacy no la tiene.
- **`AlliedRulesController` (application) es código muerto**: 237 líneas sin ruta ni referencia; además no es de "reglas" sino métricas de efectividad de perfilamiento, con `allied_id != 24` quemado tres veces.
- **`allied_branches.external_id` es solo-lectura**: no está en `$fillable`, ningún código lo escribe, y se consume como "código de tienda" en los exports de Corbeta/Bancolombia. Se llena a mano en BD.
- **`allied_modes` no tiene seeder ni CRUD**: se crea a mano. La migración se llama `create_merchant_modes_table` pero crea `allied_modes`; el modelo `AlliedMode` solo se **lee** (`findById`) y `application` ni siquiera declara la relación.
- **Deriva de esquema por parallel-run.** Los dos repos comparten BD pero tienen sets de migraciones distintos: **5 migraciones de comercio solo en application** (`aws_arn`, `production_date`, `guarantee_insurance_per_million`, …) y **14 solo en legacy-backend** (`nit`, `trustonic_tenant_key`, `senary_color`, los 4 `show_*` de 2026, `allied_modes`, …). El caso más filoso: `application` **escribe** `lenders_by_allieds.hide_probability` (`AlliedLenderController:160`, `:238`) pero la migración que crea esa columna vive **solo en legacy-backend** (`2026_06_24_120000_add_hide_probability_to_lenders_by_allieds_table.php`) — el panel vivo depende de que el otro repo haya migrado.
- **El `__construct` de los controllers de comercio tiene una rama muerta**: `AlliedController.php:32-36` y `AlliedAlliedBranchController.php:32-36` leen `front_url_local` bajo `local_env == 1` y acto seguido lo **pisan incondicionalmente** con `front_url`. Encima difieren en la forma (`->value` vs `->value['url']`).

## Bitácora
- **2026-07-18** — Fase de data: nodo documentado por ANALISIS DE CODIGO (no habia doc fuente) + superficie curada.
- **2026-07-17** — Contexto sembrado desde playground/flow (nodos MerchantNode/ComercioNode/CanalNode/BranchStatusNode + fieldDocs `node.comercio`/`node.comercioConfig`/`node.canal`/`suc.status`) y MAP.md §S1-S2. Se conservan los subcontextos motai/smartpay/pullman.

## Enlaces
- Padre: **CreditOp** (raíz). Contraparte: **Entities**. Subcontextos: **Motai**, **SmartPay**, **Pullman**.
- Memorias: `admin-anatomia-creditop` (anatomía del panel real ↔ código), `reglas-copia-por-sucursal` (la medición de ≈37.284 copias y la cadena de disparo), `reglas-comercio-lender-map` (las 4 capas de reglas), `lender-listing-cascade` (qué filtra y qué solo clasifica), `migracion-application-a-legacy-estado` (strangler y parallel-run), `modelos-canales-flujos`.
- Simulador: playground/flow (nodos Comercio, Configurar comercio, Estado en sucursal, Canal) y `playground/flow/MAP.md` §S1-S2.
- Docs históricos removidos de main: `git 159906a:docs/codigo/HALLAZGO-*` y `git 159906a:docs/codigo/ADMIN-ALTA-OPERACION.md`.
