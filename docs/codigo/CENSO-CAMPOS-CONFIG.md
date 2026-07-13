# CENSO de campos de config — qué columnas se usan, se pisan o están muertas

> **Qué es.** Censo columna-por-columna de las **11 tablas de configuración** que definen la oferta
> (entidad/comercio/sucursal/categoría), verificado contra el código real de **application** (vivo) y
> **legacy-backend** (parallel-run), con chequeo en **frontend-monorepo** para los campos "solo display".
> Responde: ¿qué campos de la BD **deciden algo**, cuáles **se pisan** (y quién los pisa), cuáles están
> **muertos** (se guardan y nadie los lee), y qué **diverge** entre los dos backends?
>
> **Método.** 5 barridos paralelos (2026-07-11), uno por grupo de tablas, con priors del inventario
> adversarial previo (`flow/DOCUMENTATION.md §7`). NO cuenta como "uso": migraciones, factories,
> seeders, `$fillable`/`$casts`, validación de FormRequest, tests, ni repoblar el propio form admin.
> **176 columnas censadas.** Rutas: `APP` = bitbucket/application · `LEG` = github/legacy-backend ·
> `FE` = github/frontend-monorepo.
>
> **La foto:** ~**33 columnas (≈1 de cada 5) están muertas o write-only en AMBOS backends**, ~9 vivas
> pero **pisadas** por otro nivel, ~20 **divergen** entre application y legacy (deriva del strangler),
> y hay **1 bug activo** (piso de ingreso no-op). El deber-ser (dónde debería vivir cada palanca) →
> [`../mejoras/MAPA-ATRIBUTOS-POR-NIVEL.md`](../mejoras/MAPA-ATRIBUTOS-POR-NIVEL.md).

---

## 1. 🐛 BUG ACTIVO: el piso de ingreso de las categorías es un NO-OP

La columna física es **`lender_users_category_rules.monthly_income`** (así la escribe el admin), pero
**los 3 motores** leen el atributo **`$rule->min_income`**, que **no existe** (ni columna ni accessor):

- `APP app/Services/lenders/LenderUserCategoryService.php:111`
- `LEG Modules/Loans/App/Services/LenderUserCategoryService.php:416`
- `LEG Modules/Onboarding/App/Services/lenders/LenderUserCategoryService.php:78`

`$rule->min_income` → `null` → `salario >= null` pasa siempre. **El ingreso mínimo configurado en una
regla de categoría no filtra a nadie**, en ninguno de los dos backends. Fix: leer `monthly_income`
(o accessor) + test que lo pruebe. ⚠️ Antes de arreglar: puede haber categorías en prod "calibradas"
asumiendo el no-op — arreglarlo ENDURECE la asignación de categorías (impacto de negocio, validar).

---

## 2. Columnas MUERTAS o write-only (en AMBOS backends) — 33

Se guardan (o ni eso) y **ningún** código las consume para decidir, calcular ni mostrar al cliente.
Candidatas a borrar (o a cablear, si el nombre promete algo que se quiere).

| # | Columna @ tabla | Detalle |
|---|---|---|
| 1 | `ecommerce` @ lenders | Ni en `$casts`/`$fillable`; todo lo que matchea es `EcommerceRequest`/session |
| 2 | `email` @ lenders | En `$fillable`, 0 lecturas; el mapper del wizard no lo consume |
| 3 | `requires_restrictive_list_check` @ lenders | 0 hits en app, legacy y front |
| 4 | `additional_data` @ lenders | WRITE-ONLY (textos monto/cuotas/tasa); el pagaré usa `numberToWords` |
| 5 | `payment_plan_id` @ allieds | FK colgante — la tabla `payment_plans` no existe |
| 6 | `payment` @ allieds | 0 lecturas |
| 7 | `preapproved_registration` @ allieds | La columna NUNCA se lee; `session('preapproved_registration')` viene de `$request->preapproved` (SimulatorController:199), no de acá |
| 8 | `show_products` @ allieds | app: ni en `$fillable`; legacy: solo model |
| 9 | `hide_non_integrated_probability` @ allieds | Solo write en store; sin ramificación |
| 10 | `order` @ allieds | Ningún `orderBy('order')` sobre allieds en ningún backend — el orden del admin es inerte |
| 11 | `nit` @ allieds | Write-only / display admin |
| 12 | `app_ecommerce_url` @ allieds | Write-only en los 3 repos *(salvedad: app móvil no escaneada)* |
| 13 | `is_available_in_app` @ allieds | Idem salvedad app móvil |
| 14 | `contact` @ allied_branches | Write-only (repuebla form) |
| 15 | `sort` @ allied_branches | Ningún `orderBy('sort')` sobre branches — inerte |
| 16 | `origination_cost_fixed` @ lenders_by_allieds | **100% huérfana**: 0 hits ni en migraciones/modelo/código de ambos repos (creada fuera de estos repos) |
| 17 | `min_product_amount` @ lenders_by_allieds | Migración 2025_10_21 la mudó desde credit_line… y quedó **sin ningún lector** |
| 18 | `min_initial_fee` @ lenders_by_allieds | ⚠️ NO confundir con la VIVA `lender_users_categories.min_initial_fee`. Esta (misma migración 2025_10_21) no la escribe el admin ni la lee nadie |
| 19 | `min_amount` @ lenders_by_allieds | Fillable que **ningún controller escribe** |
| 20 | `iva` @ lenders_by_allieds | El cálculo real quema 19% (`* (1 + 19/100)`); la línea `$lender->iva` está comentada |
| 21 | `expense_penalties_percentage` @ lenders_by_allieds | Se serializa en 5 servicios; ningún cálculo ni componente lo consume |
| 22 | `multiple_of_maximum_amount` @ lenders_by_allieds | Required+validado+persistido; la fórmula ingreso×factor **no existe** |
| 23 | `bank_id` @ lenders_by_allieds | La relación `bank()` solo se eager-loadea en admin; 0 consumo en cálculo/tesorería |
| 24 | `credit_note_calculation_id` @ lenders_by_allieds | FK **no colgante** (treasury_calculations existe) pero **inerte**: solo repuebla el select admin |
| 25 | `starting_value_calculation_id` @ lenders_by_allieds | Idem anterior |
| 26 | `fee_interval` @ credit_line_by_lenders | app: 0 refs (ni fillable); legacy: solo un seeder |
| 27 | `sort` @ credit_line_by_lenders | `creditLines` es **hasOne** (1 fila por lender) → no hay nada que ordenar; el `sort` que se escribe en LenderController es del modelo Lender |
| 28 | `status` @ credit_line_by_lenders | Idem: nunca se escribe ni filtra en la credit line |
| 29 | `rate_suffix` @ credit_line_by_lenders | Constante quemada `'N.M.'`; 0 lecturas backend; en FE solo tipos/storybook, sin render |
| 30 | `fee_name` @ credit_line_by_lenders | Constante quemada `'meses'`; idem |
| 31 | `initial_fee_percentage` @ creditop_x_conditions_by_amount_by_lender | Nunca leída — el enganche del tramo es código muerto; el real es `category.min_initial_fee` |
| 32 | `fee_value` @ creditop_x_quota_restrictions | Fillable jamás leído (`applyQuotaRestrictions` la ignora). OJO: `fee_value` de `user_requests` es otra cosa y SÍ vive |
| 33 | `monthly_income` @ lender_users_category_rules | Write-only **por el bug de §1** (la lectura apunta a `min_income` inexistente) |

---

## 3. Columnas PISADAS (viven, pero otro valor las sobrescribe)

| Columna @ tabla | Quién la pisa | Alcance |
|---|---|---|
| `url` @ lenders | `url_utm` del pivot (`lenders_by_allied(_branch)`) — la BD solo sobrevive como fallback si url_utm es null | ambos repos (`LenderRetrievalService:517`) |
| `sort` @ lenders | pivot `lenders_by_allied.sort` + re-orden por probabilidad/perfilamiento | ambos |
| `sort` @ lenders_by_allieds | re-orden por probabilidad/perfilamiento/ML | ambos |
| `initial_fee_percentage` @ lenders_by_allieds | `category.min_initial_fee` (rt=2, `LenderRetrievalService:716`); solo vive en old-screens de app | rt=2 |
| `guarantee_fund_percentage` @ lenders_by_allieds | `category.FGA` (rt=2); `RevolvingCredit.fga` (rt=3) | rt=2/3 |
| `max_fee_number` @ credit_line_by_lenders | `category.max_fee_number` (app la pisa; legacy la usa de fallback `??`) | rt=2 |
| `max_amount` @ credit_line_by_lenders | categoría / override comercio / special-granting | rt=2 |
| `rate` @ credit_line_by_lenders | **solo legacy**: `category.rate` la pisa si está seteada (`LEG Onboarding/LenderRetrievalService:764-767`) | rt=2, legacy |
| `validation_type` @ lenders | **solo legacy**: relación `lender_identity_validation_types` (primary) la relega a fallback, con `drift_detected` logueado; en app sigue siendo LA fuente (`==4` ADO) | legacy |

> Patrón: para **rt=2 la categoría manda** — la config de entidad/comercio es en gran parte cosmética
> (coincide con `flow/DOCUMENTATION.md §8`).

---

## 4. Divergencias application ↔ legacy (deriva del strangler)

Columnas **vivas en un solo backend** — el otro las ignora. Riesgo directo del cutover: al apagar
application se pierde comportamiento, o legacy activa cosas que hoy no corren.

**Viven SOLO en application (legacy las ignora):**
| Columna | Qué hace en app |
|---|---|
| `is_fallback_lender` + `fallback_removal_min_amount` @ lenders | Mecánica de lenders fallback en el listado (`LenderRetrievalService:273/362/372` — lee la COLUMNA, no lista quemada) |
| `max_rev_credit` @ lenders | Topa el cupo rotativo (`RevolvingLoanConfigService:93`) |
| `requires_payment_schedule_signature` @ lenders | Gate del paso de firma del plan de pagos |
| `amount_to_lend` @ lenders | Solo agregación de dashboard admin |
| `show_profiling` @ allieds | Ramifica listado (`ListLenderController:179/186`); en legacy es write-only |
| `initial_fee` / `initial_fee_percentage` @ allieds | Flags del simulador old-screens |
| `star_allied` @ allieds | Filtro del reporte diario |
| `external_id` @ allied_branches | `codigoTienda` en exports Bancolombia/Corbeta; legacy nunca la lee |
| `priority` @ category_rules | **app ordena por `priority`; legacy ordena por `lender_users_category_id`** → el "1er match que gana" **puede diferir entre motores** para el mismo lender |
| `verified_income`, `special_granting` (columna), `excluded_current_delinquencies`, `available_amount_multiplier` @ categorías/rules | Features solo-APP (migraciones 2025_12/2026_04 solo en app). Legacy además: `LEG-Onboarding` quema el gasto de vida en `0.2` ignorando `life_percentage` |
| tabla `creditop_x_lender_residual_balances` | Umbral de cierre de colillas — **sin modelo en legacy** |

**Viven SOLO en legacy (app ni las tiene en el modelo):**
| Columna | Qué hace en legacy |
|---|---|
| `pdf_mapper_project_slug` @ lenders | Rutea la generación de docs al pdf-mapper-service |
| `signing_provider_id` @ lenders | Factory de firma (Netco vs legacy) |
| `show_intro_screen` + `intro_background_url` @ lenders | Pantalla intro del wizard (FE la consume) |
| `rate` @ lender_users_categories | Pisa `creditLines->rate` (el FE la consume vía `transaction_data.data.category.rate`) — **migración solo-legacy** |
| `aws_arn` @ allieds | Estudio de crédito express (`CreditStudyService:428`); en app write-only |
| `order` @ lender_users_categories | Echo/display en el payload del cupo |

> Además: **el disparador de special-granting difiere** — app usa la columna `rules->special_granting`;
> legacy lo dispara por **existencia de filas** en las tablas multiplicador (ocupación/estrato) e
> ignora la columna. Mismo feature, gatillo distinto → puede activarse en uno y no en el otro.

---

## 5. Vivas que sorprenden (correcciones a lo que creíamos)

1. **`lenders.action` es el despachador FQCN GENERAL**, no "solo Sistecrédito": `new $lender->action`
   en SelfManagerController, PersonalInfoController, UserRequestController, CompensarController y
   PreApprovedLenderService (ambos backends). Convive con el mapa id→case; corrige `flow/MAP.md` Ap. B.
2. **`category.rate` NO es fantasma**: en legacy decide (pisa la tasa base) y el wizard la consume.
   Solo app la ignora (ni la tiene en `$fillable`). Corrige `flow/MAP.md` Ap. B y el MAPA §4.
3. **`lenders.status` y `lenders.country_id` DECIDEN** (filtro de elegibilidad; `country_id==60`
   ramifica lógica RD de tasa/notificación) — no son metadata.
4. **Hay DOS `hash` vivos con roles distintos**: `allied_branches.hash` = llave de entrada al flujo;
   `allieds.hash` = gate de allowlist `in_array($allied->hash, $allowed_comerces)` (ValidateOtp:114,
   PersonalInfo:1036) — **la allowlist es una lista quemada en código** (candidata a flag/columna).
5. **`complementary_form` @ lenders**: la columna EXISTE pero app **comentó su lectura** y la
   reemplazó por el hardcode `lender_id==155` (`ContinueUserFlowController:172`); legacy sí la
   serializa. Desquemar = volver a leer la columna.
6. **`quota_restrictions`** evalúa su predicado contra 3 literales exactos: `'social strata'` (con
   espacio), `'score'`, `'age'` — cualquier otro valor de `variable` se ignora en silencio. Y
   `max_term` está **sobrecargada**: multiplicador del monto Y tope de plazo a la vez.
7. **`slug` ≠ `lending_product_key`**: el product key de pre-approvals es literal en código; el uso
   decisional real de `slug` es el lookup del API SelfManager (app).
8. **Tablas hermanas VIVAS** (no censadas a fondo): `creditop_x_lender_scoring` (puntos → ajusta
   monto), `_early_payment_discount` (servicing), `_payment_method` (métodos por lender),
   `_residual_balances` (solo app). No son módulos muertos.
9. **`creditLines` es hasOne** → `credit_line_id` siempre 1; la tabla es efectivamente una extensión
   1:1 de `lenders` disfrazada de 1:N (por eso sus `sort`/`status` no significan nada).

---

## 6. Qué hacer con esto (acciones, en orden de retorno)

1. **Arreglar el bug `min_income`** (§1) — 3 líneas + test, pero validar impacto de negocio antes
   (endurece la asignación de categorías).
2. **Borrar las 33 muertas** (§2) — migración de drop + limpiar `$fillable`/forms admin. Cada una es
   deuda que confunde al que parametriza (cree que configura algo).
3. **Resolver las divergencias** (§4) antes del cutover — cada fila es comportamiento que se pierde
   o se activa al apagar application. Las 4 features solo-APP de categorías (priority/verified/
   excluded/multiplier) + `residual_balances` son las más graves (cambian decisiones de crédito).
4. **Desquemar** con columnas que YA existen: `complementary_form` (§5.5), y las nuevas propuestas
   (allowlist→flag, canal SmartPay/Corbeta, product_type) → [`../mejoras/MAPA-ATRIBUTOS-POR-NIVEL.md`](../mejoras/MAPA-ATRIBUTOS-POR-NIVEL.md) §5.
5. **Declarar la precedencia** de las pisadas (§3) — o quitar el campo de abajo (si nunca gana) o
   documentar el orden en el admin para que el que configura sepa qué manda.

---

## Apéndice — veredicto resumido por tabla (176 columnas)

Leyenda: ✅ decide · 🔀 comportamiento/ruteo · 👁 display · ⬇ pisada · 💀 muerta/write-only · ⚡ divergencia app↔legacy.

**`lenders` (33):** response_type ✅(+hardcode id24→rt1 en app) · status ✅ · country_id ✅ · path_id ✅ · available_until ✅ · allow_payment_date_selection ✅ · cutoff_type_id ✅ · is_fallback_lender ✅⚡ · fallback_removal_min_amount ✅⚡ · max_rev_credit ✅⚡ · slug ✅(app lookup) · action 🔀 · promissory_type_id 🔀 · signing_provider_id 🔀⚡ · pdf_mapper_project_slug 🔀⚡ · requires_payment_schedule_signature 🔀⚡ · validation_type ✅app/⬇legacy ⚡ · url ⬇ · sort ⬇ · complementary_form 💀app(quemado 155)/👁legacy ⚡ · originator_nit 👁 · show_intro_screen 👁⚡ · intro_background_url 👁⚡ · amount_to_lend 👁⚡ · name/image/voucher_image_url/description/benefits 👁 · ecommerce 💀 · email 💀 · requires_restrictive_list_check 💀 · additional_data 💀.

**`allieds` (41):** have_ctopx ✅(ramifica, no es gate) · hash ✅(allowlist quemada) · trustonic_tenant_key ✅ · self_managed ✅ · flow_type ✅ · barcode_type ✅ · new_screens 🔀 · country_id 🔀 · status ✅ · star_allied ✅⚡ · show_profiling 🔀app/💀legacy ⚡ · initial_fee 🔀⚡ · initial_fee_percentage 🔀⚡(ni fillable en app) · aws_arn 💀app/✅legacy ⚡ · allow_other_payment 👁(front) · slug 🔀 · allied_caterogy_id 💀(quemada=1) · allied_industry_id/allied_type_id 👁admin · price 👁admin · colores ×6 👁 · banner/background/description/image/qr 👁 · payment_plan_id 💀 · payment 💀 · preapproved_registration 💀 · show_products 💀 · hide_non_integrated_probability 💀 · order 💀 · nit 💀 · app_ecommerce_url 💀* · is_available_in_app 💀* (*salvedad app móvil).

**`allied_branches` (12):** hash ✅ · datacredito_trigger ✅ · status ✅ · name 👁+✅(detecta 'Ecommerce') · external_id 🔀app/💀legacy ⚡ · address 🔀 · allied_zone_id 👁admin · country_city_id 👁 · qr_image/image 👁 · contact 💀 · sort 💀.

**`lenders_by_allieds` (28):** max_amount ✅ · comission_percentage ✅(negocio) · administrative_costs_percentage ✅ · administrative_fixed_value ✅ · life_insurance_percentage/fixed ✅ · guarantee_fixed_monthly_percentage ✅ · insurance_fixed_monthly_percentage ✅ · guarantee_fund_percentage ⬇(cat.FGA) · initial_fee_percentage ⬇(cat.min_initial_fee) · url_utm 🔀 · user_self_management 🔀 · confirmation_emails 🔀app/💀legacy ⚡ · enable_collection 🔀app/💀legacy ⚡ · insurance_percentage_per_million ✅app-servicing/👁legacy ⚡ · guarantee_insurance_per_million 👁app/💀legacy ⚡ · sort ⬇ · status 🔀(solo gate PRAMI; NO gatea la calculadora) · bank_id 💀 · credit_note_calculation_id 💀 · starting_value_calculation_id 💀 · min_amount 💀 · min_initial_fee 💀 · min_product_amount 💀 · origination_cost_fixed 💀 · iva 💀 · expense_penalties_percentage 💀 · multiple_of_maximum_amount 💀.

**`lenders_by_allied_branches` (3):** url_utm 🔀 · sort 🔀 · status 🔀(gates secundarios; la copia nunca lo escribe → siempre-true).

**`credit_line_by_lenders` (12):** min_amount ✅ · max_amount ✅⬇ · rate ✅⬇(legacy: cat.rate) · fee_numbers ✅ · max_fee_number ⬇ · min_fee_number 🔀app-fallback/💀legacy ⚡ · credit_line_id 👁(siempre 1, hasOne) · fee_interval 💀 · rate_suffix 💀 · fee_name 💀 · sort 💀 · status 💀.

**`creditop_x_lender_configuration` (2):** late_payment_interest_rate ✅servicing · installments_waived_interest ✅servicing-app(copia al ledger)/💀legacy ⚡.

**`creditop_x_conditions_by_amount_by_lender` (5):** min_amount ✅ · max_amount ✅ · max_fee_number ✅ · mandatory_fee_number ✅ · initial_fee_percentage 💀.

**`creditop_x_quota_restrictions` (8):** variable ✅(3 literales) · min_value ✅ · max_value ✅ · operator ✅ · max_term ✅(sobrecargada ×2) · min_quota ✅ · max_quota ✅ · fee_value 💀.

**`lender_users_categories` (12):** min_initial_fee ✅ · max_amount ✅ · max_fee_number ✅ · loan_limit ✅ · already_used_loan ✅ · FGA ✅ · life_percentage ✅app/⚡(LEG-Onb quema 0.2) · available_amount_multiplier ✅app/💀legacy ⚡ · rate 💀app/✅legacy ⚡ · requires_other_lender ✅ · order 💀app/👁legacy ⚡ · name 👁(no hay branch por string; DFS se gatea por allied 189).

**`lender_users_category_rules` (20):** priority ✅app/💀legacy ⚡ · occupation ✅(CSV `|`) · min_age/max_age ✅ · gender ✅(CSV `|`) · monthly_income 💀(BUG §1) · verified_income ✅app/💀legacy ⚡ · special_granting ✅app/⚡(legacy gatea por tablas) · excluded_current_delinquencies ✅app/💀legacy ⚡ · negative_reports_last_12_months ✅ · current_delinquencies ✅ · financial_history_length ✅ · min_score ✅ · employment_continuity ✅ · min_credit_cards ✅ · min_debt_capacity ✅ · debt_capacity_amount_validation ✅ · tc_vector_validation ✅ · consulted_last_6_months ✅ · overdue_vector_validation ✅.

---

*Censo 2026-07-11 (5 barridos + priors adversariales de flow/DOCUMENTATION.md §7). Incertidumbres
declaradas: consumo de `app_ecommerce_url`/`is_available_in_app` por la app móvil (repo no escaneado);
filas reales de `signing_providers`. Corrige a `flow/MAP.md` Apéndice B en `action` y `category.rate`.*
