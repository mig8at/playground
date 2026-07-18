# Entities · contexto
> **estado:** al día con main · Qué ES un prestamista **como dato**: la fila `lenders` (anémica, sin economía), las ~46 tablas satélite que la configuran y el `response_type` como clave de despacho de toda la plataforma.

## Qué es
Una **entidad** = una fila de la tabla `lenders`. Es el catálogo de prestamistas del marketplace y la contraparte de **Merchants**: la entidad presta, el comercio vende.

La fila es **anémica a propósito**: guarda identidad, branding, ruteo y flags de comportamiento — **no guarda economía**. Ni monto, ni tasa, ni cuotas, ni enganche viven ahí. Eso baja por una cascada de tablas satélite (`credit_line_by_lenders` → `lenders_by_allieds` → `lender_users_categories`…). En la unión de las migraciones de los dos repos back, **46 tablas distintas declaran una columna `lender_id`**: el "lender" real es esa constelación, no la fila.

El campo que manda es **`response_type` (rt)**: un `integer` que decide **quién decide el crédito** y, con eso, cómo se entrega al usuario y si el resultado es **inyectable/simulable localmente**. Este nodo cubre el **concepto y la configuración**; el recorrido de cada familia vive en los Subcontextos.

## Contenido

### 1 · La tabla `lenders`: qué guarda y qué no
La migración original (`create_lenders_table`, **byte-idéntica en los dos repos back**) declara **12 columnas de negocio**: `name, image, description, benefits, response_type, url, email, slug, sort, country_id, additional_data, status` (+`id`+timestamps). `response_type` nace con **`default(1)`** y el comentario inline `// url UTM => 0 / lender integration => 1 / lender form => 2`.

Sobre esa base se atornillaron **24 columnas más** por migraciones posteriores, y acá aparece el hallazgo estructural del nodo: **el set de migraciones está PARTIDO entre los dos repos, que apuntan a la MISMA base**.

| | columnas que solo migra ese repo |
|---|---|
| **application** (6) | `available_until` · `fallback_removal_min_amount` · `fallback_removal_specific_lender_ids` · `is_fallback_lender` · `promissory_type_id` · `requires_payment_schedule_signature` |
| **legacy-backend** (8) | `externally_serviced` · `intro_background_url` · `path_id` · `pdf_mapper_project_slug` · `requires_restrictive_list_check` · `show_disbursement_details` · `show_intro_screen` · `signing_provider_id` |
| **duplicadas en ambos** (10) | `action` · `allow_payment_date_selection` · `amount_to_lend` · `complementary_form` · `cutoff_type_id` · `ecommerce` · `max_rev_credit` · `originator_nit` · `validation_type` · `voucher_image_url` |

El otro repo se limita a agregar la columna a `$fillable`/`$casts` del modelo. Consecuencia concreta y verificable: `legacy-backend/…/2026_02_12_150844_add_requires_restrictive_list_check_to_lenders_table.php:15` hace `->after('is_fallback_lender')`, y **ninguna migración de legacy-backend crea `is_fallback_lender`** (la crea `application/…/2025_11_20_160156_…`). El árbol de migraciones de legacy-backend **no es autocontenido** sobre `lenders`.

**Dónde vive la economía** (nada de esto está en `lenders`):
- `credit_line_by_lenders` — piso/techo global del lender: `min_amount, max_amount, min_fee_number, max_fee_number, fee_numbers, fee_interval, rate, rate_suffix, fee_name`. Se crea **siempre** con `credit_line_id = 1` en el alta.
- `lenders_by_allieds` — **la calculadora por COMERCIO**: 28 campos `fillable` (seguros, FGA, IVA, costos administrativos fijo y %, `initial_fee_percentage`, `min/max_amount`, `comission_percentage`, `bank_id`, `user_self_management`, `hide_probability`, `enable_collection`, `url_utm`…).
- `lenders_by_allied_branches` — **por SUCURSAL solo 5 campos**: `lender_id, allied_branch_id, url_utm, sort, status`. El contraste 28 vs 5 es la anatomía real del panel (memoria `admin-anatomia-creditop`).
- `creditop_x_lender_configuration` — 2 campos, solo rt=2/3: `late_payment_interest_rate`, `installments_waived_interest`.
- `lender_users_categories` — perfilamiento/tramos (lo cubre **Profiling**; ojo: `rate` y `life_percentage` están en el `$fillable` de legacy-backend y **no** en el de application).

`additional_data` es un `longText` con JSON de **textos de marketing** (`amount_text, number_fee_text, rate_text, conditional_text`) que el alta serializa a mano — no es config.

### 2 · `response_type`: la clave de despacho

| rt | fila en `response_types` | Quién decide el crédito | Entrega al seleccionar | ¿Inyectable local? |
|---|---|---|---|---|
| **0** | `UTM` — **sembrada** | nadie (redirige) | `url_utm` (+ pestaña externa) | n/a |
| **1** | `Integración` — **sembrada** | **API externa** del lender | `$lender->action` → `register()`/`consult()`, o `url_utm` | ❌ |
| **2** | `Creditop X` — **sembrada** | **CreditOp**, motor local | ruta interna (`continue-user-flow` / `self-service/{hash}/{ur}/confirmation`) | ✅ |
| **3** | **NO sembrada** | CreditOp (cupo rotativo) | igual que 2 | ✅ |
| **4** | **NO sembrada** | externo, gestión Credifamilia | `self-service/…/confirmation` + `standBy=true` — **solo en legacy-backend** | ❌ |

La tabla catálogo `response_types` es mínima (`id, name, status`) y su seeder inserta **exactamente 3 filas** (0/1/2, con `NO_AUTO_VALUE_ON_ZERO` para poder forzar el id 0). El seeder es byte-idéntico en los dos repos.

**rt=3 y rt=4 existen en el código pero no en el catálogo.** El panel de alta llena su dropdown con `ResponseType::select(...)->where('status', 1)->get()` → un admin **no puede elegir 3 ni 4 desde la UI**: esas filas se setean por SQL directo.

**rt=4 no tiene constante compartida**: está redefinido como `private const` con nombre distinto en **4 archivos** (`EXTRA_DETAILS_RESPONSE_TYPE`, `EXTERNAL_MANAGED_RESPONSE_TYPE`, `EXTERNALLY_MANAGED_RESPONSE_TYPE` ×2), más decenas de literales `== 2` / `== 3` sueltos. No hay enum PHP de `response_type` en ningún repo.

**El despacho ocurre en dos lugares gemelos y divergentes** (`switch ($lender->response_type)`), después de un gate por credencial (`if (empty($credential))`):
- **legacy-backend** `UserRequestService.php:441` — `case 0/1` · `case 2/3/4` · rama con credencial `case 0` / `case 1` / `case 4`.
- **application** `UserRequestController.php:817` — `case 0/1` · `case 2/3`. **No hay `case 4`.**

Esa ausencia explica el hardcode más famoso del modelo: `application/app/Models/Lender.php:59` define `getResponseTypeAttribute()` que **devuelve 1 si `id == 24`** (Credifamilia), sin importar la BD. Es el parche que evita que Credifamilia caiga en un `switch` sin rama. El accessor **no existe** en legacy-backend, que sí tiene su `case 4`.

**El front define su propia taxonomía**: `LENDER_RESPONSE_TYPE = { STANDARD: 0, PRE_APPROVED: 1, CREDITOP_X: 2, CREDITOP_X_REVOLVING: 3 }` y el tipo `LenderResponseType = 0 | 1 | 2 | 3`. Para el rt=4 hay un parche defensivo: `PRE_APPROVAL_FLOW_RESPONSE_TYPES = new Set([2, 3, 4])` tipado como `number` justamente porque 4 no entra en la unión.

**Única fuente compartida de ruteo por rt**: `LenderTabBehaviorResolver` — `EXTERNAL_REDIRECT_RESPONSE_TYPES = [0, 1]`; solo esos dos abren pestaña externa. El resolver lo consumen a la vez el listado y la selección para que no se desincronicen.

### 3 · Los otros ejes (que NO son `response_type`)
No existe columna `product_type`. El "tipo de producto" y el comportamiento se modelan con flags sueltos:

- **`path_id`** → tabla `paths` (`name` único). La migración siembra **solo 2 filas**: `1 = default`, `2 = IMEI` ("validación IMEI y bloqueo de dispositivo", el canal SmartPay). Default `1`. El backend lo publica como metadata (`lender_path`) junto a `credit_type` (`3 → revolving`, `2 → consumer`, resto → `other`).
- **`action`** — string con el **FQCN** de la clase de integración, instanciada dinámicamente: `$lenderClass = $lender->action; … new $lenderClass();`. Hay **21 clases** en `legacy-backend/app/Actions/Lenders/` y **20** en application (legacy suma el paquete greenfield `CredifamiliaConsumo/`). El reemplazo moderno es `LenderServiceFactory::make()`, que recorre servicios tipados por `supports($lenderId)` y cae a `LegacyLenderService` (que `supports()` **todo**, siempre `true`).
- **`is_fallback_lender` + `fallback_removal_min_amount` + `fallback_removal_specific_lender_ids`** — eje nuevo (v2, aditivo): el lender se consulta recién después de los primarios y su card se oculta si un primario ya cubre el monto.
- **`externally_serviced`** — el crédito existe pero **CreditOp no gestiona su ciclo de vida**: corta pagos, cambios y crons de servicing.
- **`validation_type`** — escalar legacy de KYC, en **dual-read** contra la tabla nueva `lender_identity_validation_types`: si ambos resuelven y difieren se loguea `identity.validation_type.drift_detected`; si solo hay el escalar, `identity.validation_type.legacy_fallback_used`.
- **`country_id`** — default 1 (Colombia); **60 = República Dominicana**, que fuerza modal/QR y nunca abre pestaña.
- **`status`** — booleano `default(true)`. El borrado es **soft**: `destroy` solo hace `status = 0`.
- **SmartPay** no es un flag: es un **id resuelto por ambiente** en `config/lenders.php` (`production ? 160 : 153`), con punto único de consumo `Lender::isSmartpayChannel()`. Este config **solo existe en legacy-backend**.

### 4 · Alta y administración de una entidad
Hay **dos CRUD gemelos** sobre la misma tabla, y comparten hasta los FormRequest (`App\Http\Requests\Admin\Lender\StoreRequest`, duplicado en ambos repos):

| | **application** (vivo) | **legacy-backend** (gemelo) |
|---|---|---|
| Entrada | Inertia, `routes/admin.php:47-50` (`entidades`) | API, `Modules/Partner/routes/api.php:129` |
| Controlador | `Admin/LenderController` | `Partner/…/LenderController` → `LenderManagementService` → `LenderRepository` |
| UI | 5 pantallas Vue en `resources/js/pages/admin/lenders/` | **ninguna** — `frontend-monorepo/apps/admin/` contiene solo un `.gitignore` |

El alta hace siempre lo mismo, en transacción: sube la imagen a S3 → `Lender::create` (slug derivado de `Str::slug($name)`, sin chequeo de unicidad) → **siempre** `CreditLineByLender::create(credit_line_id: 1)` → y **solo si rt==2** crea `CreditopXLenderConfiguration`.

Asimetría real: el **`store` cubre solo rt==2**, mientras el **`update` de application borra y recrea la config para `rt == 2 || rt == 3`**. Un lender nacido rt=3 arranca **sin** `creditop_x_lender_configuration` hasta el primer guardado. El gemelo legacy tiene el bug en las dos puntas: `createLender` y `updateLender` chequean solo `== 2`.

**Cobertura del panel**: el formulario expone 23 campos y de `lenders` escribe **13 columnas** (`name, description, benefits, response_type, url, email, country_id, additional_data, slug, sort, status, complementary_form, image`) — el resto va a `credit_line_by_lenders` (8) y `creditop_x_lender_configuration` (2). Las **~23 columnas restantes** de `lenders` (`path_id, action, validation_type, amount_to_lend, cutoff_type_id, promissory_type_id, signing_provider_id, is_fallback_lender, externally_serviced, available_until, ecommerce, originator_nit, voucher_image_url, …`) **no tienen UI**: se setean por SQL directo.

**Ningún seeder crea lenders.** Los de `database/seeders/Lenders/` solo siembran satélites (estados de transacción); `CredifamiliaConsumoSeeder` documenta explícitamente que la fila del lender 24 ya debe existir.

## Subcontextos
- **CreditopX** — familia in-platform (rt=2 consumo / rt=3 rotativo): CreditOp decide con motor local, sella cupo y enganche, y cierra hasta el Estado 11. Cuelgan de él **Profiling** (categoría) y **Amount tiers** (tramos por monto).
- **Aggregator** — familia por integración/API (rt=1): la API externa decide, pone el cupo y gestiona la cartera.
- **Redirect** — familia por redirección (rt=0, UTM/referido): CreditOp deriva a la web del lender; no decide ni gestiona.

*(rt=4 "external-managed" (Credifamilia) no tiene nodo propio: hoy vive acá y en la memoria `credifamilia-flujo-mapa`.)*

## Dónde mirar

**Modelo y tabla**
- `application/app/Models/Lender.php` — `$fillable` (:27) · **HARDCODE** `getResponseTypeAttribute` id 24 → rt 1 (:56 comentario, :59 método) · relaciones `creditLines`/`responseType`/`creditopXConfig`/`path` (:64-133).
- `legacy-backend/app/Models/Lender.php` — `$fillable` con las columnas legacy-only (:34-66) · `isSmartpayChannel()` (:75-78) · `identityValidationTypes()` (:136) · **sin** el accessor.
- `application/database/migrations/2023_04_20_202610_create_lenders_table.php:21` — `response_type` `default(1)` + comentario `url UTM => 0 / …`. Gemelo byte-idéntico: `legacy-backend/database/migrations/2023_04_20_202610_create_lenders_table.php`.
- `legacy-backend/config/lenders.php:24` — `'smartpay_lender_id' => env('APP_ENV') === 'production' ? 160 : 153`.

**Taxonomía `response_type`**
- `legacy-backend/database/seeders/ResponseTypesTableSeeder.php:24` (`0 UTM`), `:29` (`1 Integración`), `:34` (`2 Creditop X`) — no hay 3 ni 4.
- `legacy-backend/database/migrations/2024_04_25_174044_create_response_types_table.php:15` — la tabla catálogo (`id, name, status`).
- `application/app/Models/ResponseType.php` · `legacy-backend/app/Models/ResponseType.php` — idénticos, `$fillable = ['name']`.
- `legacy-backend/Modules/Onboarding/App/Services/UserRequestService.php:414` (url: excluye rt 2 y 4) · `:441` switch · `:442` `case 0/1` · `:450-452` `case 2/3/4` · `:601` `case 4` con `standBy=true`.
- `application/app/Http/Controllers/Customer/UserRequestController.php:790` (url: excluye solo rt 2) · `:817` switch · `:818` `case 0/1` · `:827` `case 2/3` (**sin `case 4`**) · `:881` `switch ($lender->id)` con `case 24` · `:968` `switch ($lender->name)`.
- `legacy-backend/Modules/Onboarding/App/Services/lenders/LenderTabBehaviorResolver.php:19` (RD=60), `:22` (nombres), `:25` (`EXTERNAL_REDIRECT_RESPONSE_TYPES = [0,1]`), `:27` `opensNewTab()`.
- `legacy-backend/Modules/Loans/App/Http/Middleware/AddOriginationFlowType.php:54` (`lender_path`) · `:59-63` (`credit_type` 3→revolving / 2→consumer / other).
- rt=4, las 4 constantes privadas: `LoanAuthorizationService.php:43` · `ContinueUserFlowController.php:20` · `PaymentDateService.php:18` · `PaymentSchedule/ExternallyManagedPaymentScheduleService.php:20`.

**Ejes de configuración**
- `legacy-backend/database/migrations/2026_02_19_200000_create_paths_table.php:20-22` — siembra `1 default` / `2 IMEI`. Enganche: `…2026_02_19_200001_add_path_id_to_lenders_table.php:13` (`foreignId('path_id')->default(1)`). Modelos: `application/app/Models/Path.php`, `legacy-backend/app/Models/Path.php` (idénticos; la migración es legacy-only).
- `application/database/migrations/2024_02_01_101511_add_action_column_to_lenders_table.php:15` — la columna `action`. Consumo: `legacy-backend/Modules/Onboarding/App/Services/lenders/LegacyLenderService.php:48` (`$lenderClass = $lender->action`), `:50` (`class_exists`), `:54` (`new $lenderClass()`), `:22` (`supports()` → siempre `true`).
- `legacy-backend/Modules/Onboarding/App/Services/lenders/LenderServiceFactory.php:38` `make()` · `:46` fallback.
- `application/database/migrations/2025_11_20_160156_add_is_fallback_lender_to_lenders_table.php:16` — columna app-only.
- `legacy-backend/database/migrations/2026_02_12_150844_add_requires_restrictive_list_check_to_lenders_table.php:15` — el `->after('is_fallback_lender')` cross-repo.
- `legacy-backend/database/migrations/2026_07_04_000000_add_externally_serviced_to_lenders_table.php:15`.
- `application/database/migrations/2025_01_28_164900_add_validation_type_to_lenders_table.php:23` + dual-read en `legacy-backend/Modules/Identity/App/Services/ValidationStatusService.php:295` (`resolveValidationType`), `:301` (lee el escalar), `:305` (drift), `:318` (fallback legacy).

**Tablas satélite (config)**
- `legacy-backend/app/Models/LendersByAllied.php:19-51` — 28 `fillable` = la calculadora por comercio. `legacy-backend/app/Models/LendersByAlliedBranch.php:14-20` — 5 campos por sucursal.
- `application/app/Models/CreditLineByLender.php:20` + `legacy-backend/database/migrations/2023_04_20_224625_create_credit_line_by_lenders_table.php:16`.
- `application/app/Models/CreditopXLenderConfiguration.php` (idéntico al de legacy) + `application/database/migrations/2024_10_17_173908_create_creditop_x_lender_configuration.php:15`.
- `application/app/Models/LenderUsersCategory.php` + `application/database/migrations/2025_02_11_205120_create_lender_users_categories_table.php:14` (detalle en **Profiling**).

**Alta / administración**
- `application/app/Http/Controllers/Admin/LenderController.php` — `:73` `create()` (dropdown `ResponseType…where('status',1)`), `:81` `update()` (**`:125` rt==2 || rt==3**), `:186` `destroy()` (soft `status=0`), `:196` `store()` → `:219` `Lender::create` → `:235` `CreditLineByLender::create` → `:248` `CreditopXLenderConfiguration` **solo rt==2**, `:263` `updateUsuryRate` (salta lender 140 y `country_id==60`, `:275`).
- `application/app/Http/Requests/Admin/Lender/StoreRequest.php:35` — `response_type` es solo `required` (sin `in:` ni `exists:`).
- `application/routes/admin.php:47-50` · pantallas `application/resources/js/pages/admin/lenders/lender-edit/LenderEdit.vue:80-83` (select de `responseTypes`), `:95` (`form.emails`), `:252` (`lender.response_type.id`) y `…/lender-create/LenderCreate.vue:80`.
- Gemelo legacy: `Modules/Partner/App/Http/Controllers/LenderController.php:152` `store` · `Modules/Partner/App/Services/LenderManagementService.php:30` `createLender` (`:67` rt default 1, `:93` rt==2), `:120` `updateLender` (`:188` rt==2), `:323` `destroyLender` (`:333` soft) · `Modules/Partner/App/Repositories/LenderRepository.php:24` `create` · `Modules/Partner/routes/api.php:129` (bloque lenders), `:147` (lender-rules).

**Front**
- `frontend-monorepo/…/lib/domain/constants/lender.constants.ts:37` `LENDER_RESPONSE_TYPE` · `:46` `MANAGED_LENDER_PATH_ID = 3` · `:49` `IMEI_LENDER_PATH_ID = 2` · `:57` `isCreditopXType` · `:68` `PRE_APPROVAL_FLOW_RESPONSE_TYPES` (incluye 4) · `:1` Credifamilia 24 · `:13` Motai [158] · `:31` `HIDE_AVAILABLE_CREDIT_TAG_LENDER_IDS = [160]`.
- `frontend-monorepo/…/lib/domain/entities/loan-option.entity.ts:11` `LenderResponseType = 0|1|2|3` · `:134` el campo en el DTO.
- `frontend-monorepo/…/lib/mappers/lender-response.mapper.ts:96` (desvío por `MANAGED_LENDER_PATH_ID`) · `:189` mapeo de `response_type`.

## Gotchas / riesgos
- **HARDCODE Credifamilia (id 24)** en `application/app/Models/Lender.php:59`: es un **accessor de Eloquent**, así que solo aplica a lecturas en memoria (`$lender->response_type`, ~55 sitios). Las **queries** (`Lender::where('response_type', 2)`, 12+ sitios en application) leen la **columna cruda** y lo ignoran → el mismo lender "es" rt=1 en memoria y rt=BD en el `WHERE`.
- **`response_type` default = 1**: un lender mal configurado nace como integración externa. Y `StoreRequest` no restringe el valor: cualquier entero pasa.
- **rt=3 y rt=4 no están en `response_types`** → el dropdown del panel no los ofrece; se setean por SQL. Nadie valida `response_type` contra el catálogo.
- **Comentario mentiroso en el código**: `LoanAuthorizationService.php:184` documenta la formalización externa como "(response_type 5)" cuando la constante que usa es **4** (`:43`). No existe rt=5 en ningún otro lado.
- **`path_id = 3` no existe en ninguna migración ni seeder** de los dos backs (solo se siembran 1 y 2), pero el front lo consume como `MANAGED_LENDER_PATH_ID` para desviar a gestión manual (`lender-response.mapper.ts:96`). La fila se insertó fuera de migración.
- **Columna muerta**: `requires_restrictive_list_check` (migración + `->after()` de la siguiente migración) **no tiene un solo consumidor** en application, legacy-backend ni frontend-monorepo. Tampoco está en el `$fillable`.
- **Bug del panel — el email nunca se guarda**: los dos formularios Vue bindean `form.emails` (plural) y precargan `this.lender.emails`, pero la columna, el `$fillable` y el controlador usan **`email`** (singular). El campo renderiza vacío al editar y el POST no llega a la columna.
- **Serialización que pisa el escalar**: `edit()` hace `$lender->load([... 'responseType' ...])`; Eloquent serializa esa relación en snake_case como `response_type`, **sombreando el entero**. Por eso el Vue lee `this.lender.response_type.id`. Cualquier consumidor que espere un `int` en ese payload se rompe.
- **Hardcodes por NOMBRE (string)**: `UserRequestController.php:968` hace `switch ($lender->name)` con `'Compensar' / 'Sistecrédito' / 'Meddipay'`; legacy al menos lo centralizó en `LenderTabBehaviorResolver::NON_NEW_TAB_LENDER_NAMES` — pero sigue comparando por nombre, no por id ni por flag. Renombrar un lender en el panel cambia su comportamiento de entrega.
- **Código muerto en el gemelo legacy**: `LenderRepository::getActive()` hace `Lender::where('status', 'Activo')` sobre una columna **booleana** (nunca matchea) y `getPaginated()` filtra por `$filters['type']`, columna que **no existe** en `lenders`. Ambos métodos están en la interfaz (`:20-21`) y **no los llama nadie**.
- **Alta asimétrica rt=3**: `store()` crea `creditop_x_lender_configuration` solo si rt==2; `update()` (application) lo hace para 2 **y** 3. Un lender rotativo recién creado queda sin config hasta que alguien lo edite.
- **Migraciones no autocontenidas**: el árbol de legacy-backend depende de columnas creadas por migraciones de application (y viceversa). Levantar una base desde cero con un solo repo falla.
- **El `action` es `eval` disfrazado**: un FQCN guardado en BD e instanciado con `new $lenderClass()`. Si el string apunta a una clase inexistente, el flujo devuelve `'Lender action class not found'` en vez de fallar ruidosamente.
- **`apps/admin` del frontend-monorepo está vacío** (solo `.gitignore`): la única UI de alta de entidades sigue siendo el panel Inertia de application; la API `Modules/Partner` no tiene consumidor en los repos leídos.

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (LendersConfigNode + LendersNode + MAP.md §0/§S1 + DOCUMENTATION.md §0).
- **2026-07-18** — Fase de data: nodo documentado por ANALISIS DE CODIGO (no habia doc fuente) + superficie curada.

## Enlaces
- **Hijos**: CreditopX · Aggregator · Redirect. Nietos vía CreditopX: Profiling · Amount tiers.
- **Contraparte**: Merchants (la config por comercio/sucursal vive del lado del comercio). **Raíz**: CreditOp. **Repos**: Application · Legacy-backend · Frontend-monorepo · Architecture.
- **Vecinos**: Onboarding (dónde se lista) · MS Pre-approvals (veredicto rt≠0) · KYC (`validation_type`) · Formalization (rt=4) · SmartPay y MotaiX (canales `path_id`) · Pullman.
- **Memorias**: `admin-anatomia-creditop` (jerarquía real de config) · `lender-listing-cascade` (visibilidad) · `reglas-comercio-lender-map` y `reglas-copia-por-sucursal` (capas de reglas) · `modelos-canales-flujos` (4 ejes de negocio) · `credifamilia-flujo-mapa` (rt=2 vs rt=4) · `synth-lender-type-boundary` (frontera de inyectabilidad) · `orden-lenders-ml-desactivado` · `migracion-application-a-legacy-estado` (parallel-run).
- Provenance del seed: simulador `playground/flow` (nodos "Entidades del comercio" / "Entidades disponibles", `MAP.md` §0/§S1). Fichas de negocio históricas: `git 159906a:docs/lenders/`.
