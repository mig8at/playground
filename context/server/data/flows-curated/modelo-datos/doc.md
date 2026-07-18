# Modelo de datos y config · referencia
> **estado:** al día con main · Nodo de referencia del modelo de datos y las capas de configuración de CreditOp: entidades centrales, censo de 176 columnas de config (cuáles deciden, cuáles están muertas/pisadas/divergentes), el bug min_income NO-OP, response_type=4 huérfano y el mapa atributo→nivel N0-N3, sintetizado para no abrir los docs gigantes.

<!-- REFERENCIA = sustrato transversal (cuelga del group Plataforma). Autosuficiente: los datos duros están acá para no abrir docs/. -->

## Qué responde
- ¿Qué tabla/columna guarda X dato de config (oferta, cupo, enganche, tasa, reglas, garantía)?
- ¿Cuál columna DECIDE y cuál está MUERTA / write-only / pisada / diverge entre application y legacy?
- ¿Cuáles son las entidades centrales (allieds, lenders, lenders_by_allieds, lenders_by_allied_branches, user_requests, creditop_x_*) y sus llaves?
- ¿Cuáles son las 3 capas de config que definen qué puede ofrecer un comercio?
- ¿Por qué el piso de ingreso de las categorías (min_income) no filtra a nadie? (BUG NO-OP)
- ¿Por qué response_type=4 es huérfano y qué implica?
- ¿En qué nivel (N0 entidad / N1 comercio / N2 sucursal / N3 categoría) vive cada atributo y dónde debería vivir?
- ¿Qué pisa a qué en rt=2 (categoría manda) y qué se copia en vez de heredar (reglas por sucursal)?
- ¿Dónde está sembrado un catálogo (response_types 0-3, consent_types solo id=3, payment_types 1-8) vs qué vive solo en código?

## Qué es
Nodo de referencia del modelo de datos y las capas de configuración de CreditOp: entidades centrales, censo de 176 columnas de config (cuáles deciden, cuáles están muertas/pisadas/divergentes), el bug min_income NO-OP, response_type=4 huérfano y el mapa atributo→nivel N0-N3, sintetizado para no abrir los docs gigantes.

## Contenido
## 1. Entidades centrales (tabla → llaves clave)

| Entidad | Tabla | Columnas clave |
|---|---|---|
| Comercio/aliado | `allieds` | `id, name, slug, hash, have_ctopx, country_id, status, payment_plan_id`(FK colgante) |
| Sucursal | `allied_branches` | `id, allied_id, hash`(entrada al flujo), `name, country_city_id, status, datacredito_trigger, external_id` |
| Entidad/lender | `lenders` | `id, name, slug, response_type, promissory_type_id, path_id, signing_provider_id, country_id, status, validation_type, action` |
| Solicitud | `user_requests` | `id, user_id, allied_id, allied_branch_id, lender_id, user_request_status_id`(FK), `amount, rate, fee_number` |
| Cliente | `users` | `id, cell_phone, document_number, document_type, multiple_allieds`(JSON), `age` |

⚠️ `have_ctopx` y `slug` viven en **`allieds`**, NO en `allied_branches`. Hay **dos `hash` vivos**: `allied_branches.hash` = llave de entrada al flujo; `allieds.hash` = gate de la allowlist quemada `in_array($allied->hash, $allowed_comerces)`.

## 2. Las 3 capas "qué puede ofrecer un comercio"

| Capa | Tabla(s) | Pregunta |
|---|---|---|
| 1. Catálogo | `lenders_by_allieds`(allied) · `lenders_by_allied_branches`(sucursal) | ¿qué entidades ofrece? |
| 2. CreditopX | `allieds.have_ctopx` (columna, nivel aliado) | ¿opera con CreditopX? |
| 3. Credencial | `lender_allied_credentials` (llave por `allied_id`, SIN `allied_branch_id`) | ¿tiene contrato/llaves reales? |

⚠️ El gate DURO de la oferta rt=2 = `lenders_by_allieds` + credencial, **NO** `have_ctopx` (que ramifica lógica pero engaña: CrediPullman #77 rt=2 se ofrece en allied 94 con `have_ctopx=0`).

## 3. 🐛 BUG ACTIVO — piso de ingreso de categorías es NO-OP
Columna física = **`lender_users_category_rules.monthly_income`** (así la escribe el admin), pero los **3 motores** leen `$rule->min_income` — atributo que **no existe** (ni columna ni accessor) → `null` → `salario >= null` pasa SIEMPRE. **El ingreso mínimo de una regla de categoría no filtra a nadie**, en ambos backends.
- `application/app/Services/lenders/LenderUserCategoryService.php:111`
- `legacy-backend Modules/Loans/.../LenderUserCategoryService.php:416` (verificado: `$criteria['min_income'] = $salary >= $rule->min_income;`)
- `legacy-backend Modules/Onboarding/.../LenderUserCategoryService.php:78`
⚠️ Arreglarlo ENDURECE la asignación de categorías (categorías en prod pueden estar "calibradas" asumiendo el no-op).

## 4. response_type — catálogo y el huérfano rt=4
`response_types` tiene filas **0-3**: 0=UTM · 1=Integración · 2=CreditopX · 3=Cupo Rotativo (rt=3 SÍ es fila real). **rt=4 = huérfano**: existe como valor en `lenders.response_type` (Credifamilia #24, async SOAP) pero **no tiene fila** en `response_types`. Además `Lender::getResponseTypeAttribute` (app) fuerza id 24 → rt=1 ignorando la BD (hardcode). `response_type` decide TODO el flujo.

## 5. Censo — 176 columnas (33 muertas / ~20 divergen / 9 pisadas)
### 5a. MUERTAS / write-only en AMBOS backends (33). Se guardan y nadie las decide:
- **`lenders`**: `ecommerce, email, requires_restrictive_list_check, additional_data`
- **`allieds`**: `payment_plan_id`(FK a tabla inexistente `payment_plans`), `payment, preapproved_registration, show_products, hide_non_integrated_probability, order`(sin orderBy), `nit, app_ecommerce_url*, is_available_in_app*` (*salvedad app móvil)
- **`allied_branches`**: `contact, sort`(sin orderBy)
- **`lenders_by_allieds`**: `origination_cost_fixed`(100% huérfana, 0 hits), `min_product_amount, min_initial_fee`(≠ la VIVA `lender_users_categories.min_initial_fee`), `min_amount, iva`(cálculo quema 19%), `expense_penalties_percentage, multiple_of_maximum_amount`(fórmula no existe), `bank_id, credit_note_calculation_id, starting_value_calculation_id`(FK no-colgante pero inerte)
- **`credit_line_by_lenders`**: `fee_interval, sort, status`(es hasOne 1:1), `rate_suffix`('N.M.'), `fee_name`('meses')
- **`creditop_x_conditions_by_amount_by_lender`**: `initial_fee_percentage` (el real es `category.min_initial_fee`)
- **`creditop_x_quota_restrictions`**: `fee_value` (≠ `user_requests.fee_value` que SÍ vive)
- **`lender_users_category_rules`**: `monthly_income` (write-only por el BUG §3)

### 5b. PISADAS (viven, otro nivel las sobrescribe) — patrón: en rt=2 la CATEGORÍA (N3) manda
| Columna | La pisa |
|---|---|
| `lenders.url` | `url_utm` del pivot (BD solo fallback si url_utm null) |
| `lenders.sort` / `lenders_by_allieds.sort` | pivot + re-orden ML/perfilamiento |
| `lenders_by_allieds.initial_fee_percentage` | `category.min_initial_fee` (rt=2, LenderRetrievalService:716) |
| `lenders_by_allieds.guarantee_fund_percentage` | `category.FGA` (rt=2) / `RevolvingCredit.fga` (rt=3) |
| `credit_line_by_lenders.max_fee_number` / `max_amount` | categoría (rt=2) |
| `credit_line_by_lenders.rate` | **solo legacy**: `category.rate` la pisa (LenderRetrievalService:764-767) |
| `lenders.validation_type` | **solo legacy**: relación `lender_identity_validation_types` la relega (drift_detected logueado); en app sigue siendo LA fuente (`==4` ADO) |

### 5c. DIVERGENCIAS application ↔ legacy (deriva strangler) — riesgo de cutover
- **Solo application** (legacy ignora): `is_fallback_lender`+`fallback_removal_min_amount`, `max_rev_credit`, `requires_payment_schedule_signature`, `amount_to_lend` (@lenders); `show_profiling`, `initial_fee`/`initial_fee_percentage`, `star_allied` (@allieds); `external_id` (@allied_branches); **`priority` @category_rules** (app ordena por priority, legacy por `lender_users_category_id` → el "1er match gana" difiere); `verified_income, special_granting`(col), `excluded_current_delinquencies, available_amount_multiplier` (features solo-APP); tabla `creditop_x_lender_residual_balances` (sin modelo en legacy)
- **Solo legacy** (app ni las modela): `pdf_mapper_project_slug, signing_provider_id, show_intro_screen`+`intro_background_url` (@lenders); **`rate` @lender_users_categories** (migración solo-legacy, el FE la consume vía `transaction_data.data.category.rate`); `aws_arn` @allieds; `order` @lender_users_categories
- **special_granting difiere el gatillo**: app usa la columna `rules->special_granting`; legacy dispara por existencia de filas en tablas multiplicador → puede activarse en uno y no en otro.

### 5d. Vivas que sorprenden (correcciones)
1. `lenders.action` = despachador FQCN **GENERAL** (`new $lender->action` en SelfManager/PersonalInfo/UserRequest/Compensar/PreApprovedLender), NO "solo Sistecrédito".
2. `category.rate` NO es fantasma: en **legacy decide** (pisa tasa base) + wizard la consume; solo app la ignora.
3. `lenders.status` y `country_id` DECIDEN (`country_id==60` ramifica lógica RD).
4. `complementary_form` @lenders: la columna existe pero app comentó su lectura → hardcode `lender_id==155` (ContinueUserFlowController:172); legacy sí la serializa.
5. `creditop_x_quota_restrictions.variable` matchea 3 literales exactos: `'social strata'`(con espacio), `'score'`, `'age'`; `max_term` sobrecargada (multiplicador del monto Y tope de plazo).
6. `creditLines` es **hasOne** → `credit_line_id` siempre 1 (extensión 1:1 de lenders disfrazada de 1:N).

## 6. Mapa atributo → nivel (N0-N3) + deber-ser
| Nivel | Tablas dueñas | Pregunta | Granularidad |
|---|---|---|---|
| **N0** entidad | `lenders, credit_line_by_lenders, creditop_x_lender_configuration` | identidad/tasa/plazo base | `lender_id` |
| **N1** comercio | `lenders_by_allieds, allieds, lender_allied_credentials` | acuerdo económico (comisión/costos) | `allied_id × lender_id` |
| **N2** sucursal | `lenders_by_allied_branches` (+copias de reglas) | ruteo/orden/visibilidad | `allied_branch_id × lender_id` |
| **N3** categoría | `lender_users_categories, lender_users_category_rules` | condiciones por riesgo (enganche/cupo/plazo rt=2) | `lender_id × categoría` |

**3 falencias estructurales:** (#1) reglas duras (`lender_rules` + `group_rules` + `lender_datacredito_rules`) se **COPIAN por sucursal** en vez de heredar → ~37k filas, deriva, huérfanas al desactivar; `lender_datacredito_rules` = **7.183 filas** (matriz entidad×sucursal, solo 107 con `allied_branch_id NULL`). (#2) economía partida y pisada: misma palanca en 2-3 niveles, el de arriba pisa silencioso (rt=2: N3 manda, N0/N1 cosméticos). (#3) decisiones quemadas que deberían ser columnas: Credifamilia→rt=1 (accessor), rt=4 sin catálogo, Pullman `allied_id==94`, Corbeta `[24,209,210,211]`, `country_id==60` (RD), SmartPay `config/lenders.php`, allowlist `$allowed_comerces`, DFS `allied_id==189`.

## 7. Tablas del cierre CreditopX / servicing (rt=2/3)
- `lender_users_categories` (cols: `name, loan_limit, already_used_loan, FGA, min_initial_fee, max_fee_number, max_amount, rate, requires_other_lender, order, available_amount_multiplier, life_percentage`(def 20)). Categorías reales: Premium/Recuperar mejores/Segunda oportunidad (FGA 5%→12%→20%) + Estandar/Malos/Última oportunidad/Reportados/Bancarizados/Unico/DFS_1/DFS_2.
- `promissory_notes` (⚠️ `user_request_id` sin UNIQUE ni índice), `creditop_x_consents` + `creditop_x_consent_types` (⚠️ **solo id=3 `device_lock_agreement` sembrado local**; tipos 1/2 viven en código), `creditop_x_revolving_credits` (rt=3: `approved_limit, used_limit, fga`), `creditop_x_requests_history` (ledger, driver bloqueo IMEI), `lender_guarantee_criteria` (⚠️ campos NULL rompen `authorize`).
- **Catálogos de pago (2, no mezclar)**: `creditop_x_payment_statuses` (1 Recibido/2 Reversado/3 Pendiente) vs `creditop_x_payment_types` (1 RETENIDO/2 ABONO CAPITAL/3 PAGO CUOTA/4 PAGO TOTAL/5 CONDONACIÓN INTERESES/6 DESC 5% CAPITAL/7 PAGO CUOTA INICIAL/8 REVERSADO).

## 8. Motor de riesgo / perfilador
- `lender_rules` (reglas duras generales; `group_rule_id=NULL` = base común, ~6/lender), `lender_datacredito_rules` (matriz miles/entidad), `lender_users_category_rules` (score/ocupación/edad/negativos), `profiling_reviews` (decisión: `recommended_lender, disbursed_lender, displayed_lenders, hard_rules, demog_predictions, matrix_predictions, ML_predictions`), `users_category_log` (qué regla quedó `false`).
- **2 motores datacrédito**: NUEVO `DatacreditoRuleEvaluator` (rt=2, regla genérica `allied_branch_id IS NULL`, fail-closed) vs LEGACY `RiskCentralValidationService` (rt≠2, regla por sucursal).
- `fields` (201 filas) + `user_field_values`: field_id 29=Situación laboral, 87=Ingresos, 90=Egresos, 162-172=form dinámico SmartPay.

## 9. FKs colgantes / gotchas de integridad
`allieds.payment_plan_id` → `payment_plans` **no existe**; `lenders_by_allieds.{credit_note_calculation_id, starting_value_calculation_id}` → solo `treasury_calculations` existe. SmartPay: local tiene lender `152`(rt=2)/`153`(rt=1); `160` NO existe local (= smartpay_lender_id de prod, resuelto vía `config('lenders.smartpay_lender_id')` = `env('APP_ENV')==='production' ? 160 : 153`, verificado config/lenders.php:24 + `Lender::isSmartpayChannel()` Lender.php:75-77). `40`/`41` son `lender_transaction_statuses` (CREDIT_IN_PROCESS/CREDIT_APPROVED), NO `user_request_statuses`. Naming plural BD: `lender_users_categories, users_category_log, payment_gateway_transactions`.

## Dónde mirar
- **Lender.php (ambos)** (legacy-backend / application): modelo central de entidad; accessor response_type (app fuerza id24→rt1), isSmartpayChannel(), action FQCN, casts de have_ctopx/status/country_id
- **config/lenders.php** (legacy-backend): smartpay_lender_id = prod 160 / else 153 (línea 24); único lugar donde se resuelve el id de canal SmartPay
- **LenderUserCategoryService.php (×3)** (legacy-backend (Loans:416, Onboarding:78) / application (:111)): el BUG min_income NO-OP: lee $rule->min_income (inexistente) en vez de columna monthly_income; los 3 motores de asignación de categoría
- **LenderRetrievalService.php (ambos)** (legacy-backend Onboarding / application): dónde category.min_initial_fee pisa initial_fee_percentage (:716), category.rate pisa credit_line.rate (:764-767 solo legacy), url_utm pisa lenders.url (:517), have_ctopx ramifica (:115/129)
- **LenderUsersCategory.php + LenderUsersCategoryRule.php (ambos)** (legacy-backend / application): N3 categoría: columnas que DECIDEN rt=2 (min_initial_fee/max_amount/max_fee_number/FGA/loan_limit); rule con monthly_income(muerta)/priority(solo app)/rate(solo legacy)
- **LendersByAllied.php + CreditLineByLender.php (ambos)** (legacy-backend / application): N1 calculadora (comisión/costos vivos + iva/min_amount/multiple_of_maximum_amount muertos) y N0 credit_line (hasOne 1:1, rate/max pisadas)
- **DatacreditoRuleEvaluator.php vs RiskCentralValidationService.php** (legacy-backend): los 2 motores datacrédito: NUEVO rt=2 (regla allied_branch_id NULL, fail-closed) vs LEGACY rt≠2 (regla por sucursal)
- **ResponseType.php + ResponseTypesTableSeeder.php** (legacy-backend): catálogo response_types filas 0-3; confirma que rt=4 no tiene fila (huérfano)
- **ProfilingReview.php + UsersCategoryLog.php** (legacy-backend): registro de la decisión del perfilador (hard_rules/displayed_lenders/matrix_predictions) y log de qué regla de categoría quedó false
- **migrations create_lenders_by_allieds / add_calculations_treasury / create_lender_users_category_rules** (legacy-backend): procedencia de columnas muertas (credit_note/starting_value_calculation_id, monthly_income) y del layout de la calculadora N1

## Frontera de simulación / harness
El harness E2E (playground/backend-e2e y frontend-e2e, NO indexados) NO ejercita el subdominio de perfilamiento/underwriting: fuerza el lender + siembra el perfil, así que las tablas de config (lender_rules, lender_users_category_rules, lender_datacredito_rules) se INYECTAN, no se ejercitan orgánicamente. El harness solo stubea el enroll MDM durante la originación Motai; el servicing/cartera (creditop_x_payment_*, device_locks, 3 crons IMEI 04/05/06h) queda fuera de alcance. Relevante al OKR de metodología de pruebas: para probar decisiones rt=2 hay que sembrar/inyectar en estas tablas (frontera inyectabilidad rt=2/3 SÍ vs rt=1/4 externo NO), y el bug min_income no se detecta sin un test que fije monthly_income y verifique el filtro.

## Gotchas / riesgos
- El piso de ingreso de categorías (min_income) NO filtra a nadie: bug NO-OP en los 3 motores (leen $rule->min_income inexistente; la columna física es monthly_income). Arreglarlo ENDURECE la asignación — validar impacto de negocio antes.
- have_ctopx PARECE el gate de la oferta rt=2 pero NO lo es (CrediPullman #77 rt=2 se ofrece con have_ctopx=0). El gate real = lenders_by_allieds + lender_allied_credentials. have_ctopx solo ramifica lógica.
- response_type=4 (Credifamilia #24) existe en lenders pero NO tiene fila en response_types; además app fuerza id24→rt1 por accessor quemado. rt=3 SÍ es fila real del catálogo.
- En rt=2 la CATEGORÍA (N3) pisa silenciosamente a N0/N1: initial_fee_percentage, guarantee_fund, max_amount, max_fee_number, rate. La config de entidad/comercio es en gran parte cosmética para el producto insignia.
- ~33 columnas (1 de cada 5) están muertas/write-only en AMBOS backends: quien parametriza cree que configura algo (ej. iva se guarda pero el cálculo quema 19%; multiple_of_maximum_amount validado pero sin fórmula).
- Las reglas duras (lender_rules/group_rules/lender_datacredito_rules) se COPIAN por sucursal, no se heredan: ~37k filas, lender_datacredito_rules=7.183 (solo 107 con allied_branch_id NULL). Errores de copia se tragan → sucursal habilitada SIN reglas.
- ~20 columnas DIVERGEN application↔legacy (deriva strangler): al apagar application se pierde comportamiento (is_fallback_lender, priority @category_rules, features de categoría) o legacy activa cosas nuevas. category.rate y validation_type deciden distinto por backend.
- SmartPay 160 NO existe en BD local (es id de prod); nunca comparar contra literal 160 → usar config('lenders.smartpay_lender_id') / Lender::isSmartpayChannel().
- creditLines es hasOne (1:1 disfrazado de 1:N): sus sort/status no significan nada, credit_line_id siempre 1.
- creditop_x_consent_types local solo tiene id=3 sembrado (tipos 1/2 en código) → cuidado al hacer JOIN. 40/41 son lender_transaction_statuses, NO user_request_statuses.
- priority @category_rules solo lo ordena application; legacy ordena por lender_users_category_id → el 1er-match-gana de una categoría PUEDE diferir entre motores para el mismo lender.

## Preguntas abiertas
- [ ] ¿app_ecommerce_url / is_available_in_app las consume la app móvil? (repo no escaneado; podrían no estar muertas).
- [ ] ¿Filas reales de signing_providers? (no verificado; signing_provider_id vive solo en legacy).
- [ ] Precedencia formal entre niveles no está declarada en código ni admin: hoy 'gana el último que escribe' para rt=2 (N3>N1>N0 de facto) — falta documentarla o quitar el campo de abajo.
- [ ] Al hacer cutover, ¿qué se hace con las ~20 columnas divergentes? Las 4 features solo-APP de categoría (priority/verified_income/excluded_current_delinquencies/available_amount_multiplier) + creditop_x_lender_residual_balances cambian decisiones de crédito y no existen en legacy.

## Bitácora
- **2026-07-17** — Nodo de referencia creado bajo el group Plataforma. Superficie: 53 archivos, 53/53 resuelven. Síntesis de `MODELO-DATOS + CENSO-CAMPOS-CONFIG + MAPA-ATRIBUTOS-POR-NIVEL` para hacer el árbol autosuficiente (resolver tareas sin abrir docs/).

## Enlaces
- Sustrato: group **Plataforma**. Hermanos: **motor-decision** (cómo se decide con estos datos) · **migracion** (deuda/columnas a limpiar).
- Lo consultan los flujos: **creditopx**, **agregadores**, **credifamilia**.
- Memorias: `datacredito-rules-per-lender` · `lender-listing-cascade` · `reglas-comercio-lender-map`.
