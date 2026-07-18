# Profiling · contexto
> **estado:** al día con main · El **perfilamiento rt=2** (CreditopX): con los datos del usuario (ocupación, edad, salario, continuidad, género + buró) CreditOp lo mete en una **categoría** de la entidad, y esa categoría fija **enganche, cupo, plazo, FGA y seguro**.

## Qué es
Cómo CreditOp, in-platform (rt=2/3), **perfila** al usuario y lo clasifica en una **categoría de riesgo** del lender. La categoría es el **gate DURO** del cupo CreditopX y la que **fija la economía del crédito**: enganche (`min_initial_fee`), techo de cupo (`max_amount`), plazo máx (`max_fee_number`), fondo de garantía (`FGA`) y seguro de vida (`life_percentage`). Sin una categoría con cupo > 0, el lender rt=2 **ni se ofrece** (se hace `unset` del marketplace).

En lenguaje de negocio es la **"segmentación de clientes"** (de *premium* a *malos*): a los reportados/no-bancarizados se les ofrece crédito con **mayor garantía + enganche alto (ej. 70%)** y reportes positivos a Datacrédito para recuperarlos [git 159906a MECANICA §5]. La asignación NO es una banda de score simple sino un **motor de reglas de tier + scoring SQL**. Caso Mediarte: el perfilamiento predictivo llevó la facturación de **$20M→$350M/mes, +25% conversión, 3× ticket** [git 159906a MECANICA "Caso Mediarte"].

En **rt=1 CreditOp no perfila** (la API externa del proveedor decide; ver **Bróker**); en rt=0 redirige. Perfilar es exclusivo del sombrero operador (rt=2/3).

## Contenido

**Dos tablas (verificado en los modelos):**
- `lender_users_categories` = la **categoría** con su economía: `loan_limit`, `already_used_loan`, `FGA`, `max_amount`, `rate` (null→la del lender), `min_initial_fee`, `max_fee_number`, `life_percentage` (`LenderUsersCategory.php:14-24`).
- `lender_users_category_rules` = el **tier** (criterios de admisión): `occupation` (field 29), `min_age`/`max_age`, `monthly_income`, `gender`, `negative_reports_last_12_months`, `current_delinquencies`, `financial_history_length`, `min_score`, `employment_continuity`, `min_credit_cards`, `tc_vector_validation`, `min_available_credit_card_balance`, `min_vigent_obligations`, `consulted_last_6_months`, `min_debt_capacity` (baja categoría), `debt_capacity_amount_validation` (baja el monto) (`LenderUsersCategoryRule.php:14-35`).

**Cómo gana un tier** (`LenderUserCategoryService::getLenderUserCategory:54`):
1. Ordena los tiers por `lender_users_category_id ASC` (`:79`) y devuelve el **PRIMER tier que pasa** (`foreach`+`return`, `:105`). NO ordena por `min_score`/`priority`.
2. `evaluateEligibility:403` = **AND con early-exit**: ocupación (`:407`) → edad `users.age∈[min,max]` (`:412`) → `min_income` (`:416`) → género (`:419`) → continuidad (`:421`) → **exige `$user->datacredito`** (`:429`) → sub-checks de buró: neg12 `<=` (`:440`), moras `currentNegativeCredits<=` (`:448`), maturación `diffInMonths>=` (`:453`), score `>=` (`:459`), TC/vectores (`:464`), consultas (`:467`), capacidad (`:477`). Basta UN criterio `false` para descartar ESE tier y saltar al siguiente.
3. **FAIL-CLOSED por dato de buró ausente** (al revés de group rules): score/neg12/maturación/creditCard nulos → `false`; un sintético DEBE inyectar la fila Experian completa.
4. El tier **más laxo** admite, pero como gana el de **menor id** (que suele ser el 700/Empleado más estricto), las **condiciones económicas salen del PRIMER tier que matchee**, no del laxo.

**Ruta scoring (sin tiers o ninguno pasó):** si el lender no tiene `cat_rules` (o ningún tier pasó), cae a un **motor SQL de scoring** (campos de usuario + capacidad de pago `calculatePaymentCapacity:333` → `getScoreByCapacity` → categoría por score total). `scoring_is_primary` (`:318`) = el lender no tiene tiers pero SÍ scoring-policy → scoring es su categorización *de diseño* (**SmartPay**), no un fallback. Guard **`scoring_policy_fallback_blocked`** (`CreditopXQuotaController.php:331/348`): si hay `cat_rules>0` y ninguno pasó, aprobar por scoring **no da cupo**.

**Qué fija la categoría — la economía:**
- **Enganche** = `category.min_initial_fee` (%). *(El `initial_fee_percentage` del tramo por monto es código muerto en rt=2 — eso vive en **Amount tiers**.)*
- **Cupo** = `calculateAvailableAmount` (`:697`): gross-up sobre el mínimo de **4 topes** —
  `available_amount = ceil( min( availableFromProfile, max_amount, loan_limit−already_used, lender.creditLines.max_amount ) / (1 − min_initial_fee/100) )`
  donde `availableFromProfile` = **PV francesa** de `(salario·(1−life_percentage) − pago_mensual_ajustado)` sobre `max_fee_number` cuotas a la `rate` del lender. La rama `debt_capacity_amount_validation==0` **omite** el término de perfil (`:737` vs `:739`). `salario` = `agildata > mareigua > EAV field 87 > 0` (`getSalary:384`); `pago_mensual_ajustado` reemplaza el dato viejo de Datacrédito por core bancario (`CreditopXDatacreditoAdjustmentService`).
- **Plazo** = `max_fee_number`; **FGA** = `FGA` %; **seguro de vida** = `life_percentage`.
- **Otorgación especial (DENTIX/DFS)** (`LenderSpecialGrantingService:37`): override por **buckets de score** (`:194-216`: >770→15M/24c, 710-770→8M/24c, 650-709→5M/18c, ≤649→3M/12c), requiere estrato + ciudad de sucursal + ocupación; se capa al `max_amount` de la categoría.

**Dónde se sella / consume:**
- **CUPO autoritativo** (endpoint): `CreditopXQuotaController::getAvailableQuota:66` → pipeline `ActiveCredit:189 → LenderRule:214 → Datacrédito → Categoría:268`.
- **LISTADO** (marketplace): `LenderRetrievalService::processRevolvingAndCreditopXLenders:675` fija `initial_fee_percentage = category.min_initial_fee` (`:756`) y el cupo mostrado `min(available_amount, loan_limit−already_used, max_amount)` (`:757`); si `available_amount < min_amount` → rechazo (`:776`). El **sello rt=2** (la card aparece iff hay categoría con cupo>0) se resuelve acá y en el listado v2 → ver **CreditopX** / **Motor de decisión**.

**Perfilamiento = reordena, no excluye** (`ProfilingRulesService:30`): capacidad de endeudamiento + continuidad + consultas bajan el **nivel de probabilidad** (`alta/media/baja/muy baja/0%`, `:16-20`) vía `adjustProbability` (`:47-53`); delega el gate datacrédito-del-listado a `RiskCentralValidationService` (`:43`, solo si el allied ∈ frequencies y hay fila Experian-Acierta). **NO excluye** — el corte DURO real es la categoría (cupo) o la API externa (rt=1).

**Orden vs las otras 3 capas (delegado a Motor de decisión):** las group rules (capa 1) y el datacrédito por-sucursal (capa 2) corren **antes**, en el listado; para **rt=2 + `have_ctopx` CLASIFICAN, no excluyen** (un CrediPullman con ingreso 1.299.999 igual se ofrece). La **categoría (capa 3) es el único gate DURO** del rt=2. Las 4 capas completas, los 2 motores de datacrédito (operadores opuestos) y la receta de sintético íntegra están en **Motor de decisión**.

**rt=2 armables — piso del tier laxo** [git 159906a REGLAS §3.3]: Creditop X (37) 4 tiers piso 400 · CrediPullman (77) 3 tiers piso 400 (edad de cupo ≤78 vs 69 del group rule) · Celupresto (96) piso −1 (el más laxo del dump) · DENTIX (139) piso 0 + special granting · Magnocréditos (84) 1 tier + **bypass CE** (venezolano `document_type='CE'` salta el buró).

## Dónde mirar
- **Categoría / cupo (rt=2, legacy Loans — autoritativo)**: `Modules/Loans/App/Http/Controllers/Customer/CreditopXQuotaController.php` (`:66` cupo, `:268` categoría, `:331/348` scoring-block, `:362` special granting) · `Modules/Loans/App/Services/LenderUserCategoryService.php` (`:54` getLenderUserCategory, `:79` orden ASC, `:105` 1er tier, `:403` evaluateEligibility, `:416` **min_income (BUG)**, `:697/737/739` cupo) · `LenderSpecialGrantingService.php:37` (buckets `:194-216`) · `datacredito/CreditopXDatacreditoAdjustmentService.php` (ajuste de cuota mensual) · `LenderUserCategoryController.php`.
- **Modelo de datos**: `app/Models/LenderUsersCategory.php` (economía) · `LenderUsersCategoryRule.php` (tier) · `LenderUserCategoryScoringPolicyRule.php` · `LenderPaymentCapacityScoringPolicy.php` · repos `Modules/Loans/App/Repositories/LenderUsersCategoryRepository.php`, `LenderUsersCategoryRuleRepository.php`, `LenderUserCategoryScoringPolicyRuleRepository.php`, `LenderPaymentCapacityScoringPolicyRepository.php` · migración `database/migrations/2025_02_11_202744_create_lender_users_category_rules.php:21` (columna `monthly_income`).
- **Consumo en el listado (legacy Onboarding)**: `Modules/Onboarding/App/Services/lenders/LenderRetrievalService.php` (`:675/756/757/776`) · `ProfilingRulesService.php:30` (reorder) · `RiskCentralValidationService.php` (datacrédito-listado) · copias `LenderUserCategoryService.php`, `LenderSpecialGrantingService.php`.
- **Datacrédito-cupo (gate antes de la categoría; mecánica en Motor de decisión)**: `Modules/Loans/App/Services/DatacreditoRuleEvaluator.php` (`:19` evaluate, bypass CE&&84 `:21`, sin regla skip→pass `:25`, fail-closed `:48`).
- **Tests (spec de comportamiento)**: `Modules/Loans/tests/Unit/LenderUserCategoryServiceMatchedByRuleTest.php`, `LenderSpecialGrantingServiceTest.php`, `CreditopXDatacreditoAdjustmentServiceTest.php` · `tests/Feature/CreditopXQuotaControllerTest.php`.
- **Gemelo en parallel-run (application, motor viejo/default hoy)**: `app/Services/lenders/LenderUserCategoryService.php`, `LenderRetrievalService.php` (`:650/701/716`), `LenderSpecialGrantingService.php`, `ProfilingRulesService.php`, `app/Models/LenderUsersCategory.php`, `LenderUsersCategoryRule.php` (misma mecánica, distinto número de línea).

## Gotchas / riesgos
- **BUG `min_income` NO-OP** (vivo): la columna del tier es `monthly_income` (`migration:21`) pero `evaluateEligibility` lee `$rule->min_income` (`:416`) — atributo inexistente → `null` → `$salary >= null` es **siempre true** en PHP. El **piso de ingreso de la categoría no filtra**; arreglarlo (leer `monthly_income`) **endurece** la asignación. [MEMORY flow-reorg-y-mapa-atributos]
- **Tier laxo admite, primer tier (menor id, suele el más estricto) da la economía** — el `max_amount`/`min_initial_fee` NO salen del tier que "más fácil" pasa.
- **FAIL-CLOSED por buró ausente**: la categoría SIEMPRE exige la fila `datacredito` (`:429`); sin ella, ni un tier "pasa-todo de score" aprueba (aunque tenga todos los sub-checks sin umbral).
- **`consulted_last_6_months` se apaga si el umbral del tier ≥100** (`validateConsultedLast6Months:607`) → las consultas solo gatean donde el tier fija `<100`.
- **Categoría de USUARIO ≠ categoría de PRODUCTO**: `lender_users_categories` segmenta **usuarios**; la "categoría de lender/producto" del plan Motai v2 (crédito/arrendamiento) es **otra cosa que aún no existe** en BD (ver **Motai v2**). No confundir.
- **`scoring_policy_fallback_blocked`**: aprobar por scoring tras fallar todas las reglas de tier NO da cupo — solo `scoring_is_primary` (lender sin tiers, ej. SmartPay) usa scoring como diseño.
- **Parallel-run**: la lógica corre en `application` (default) y `legacy-backend` (migración). Las líneas citadas son de **legacy** (donde el análisis fuente verificó); el gemelo application tiene la misma mecánica en otras líneas.

## Preguntas abiertas
- [ ] `monthly_income` por tier no está volcado del dump — sin él no se boundary-testea el piso de ingreso (además hoy es NO-OP por el bug).
- [ ] rt=2 con reglas datacrédito **por sucursal** (#77 tiene 111): en el cupo el motor nuevo lee solo la **genérica** — ¿quedan inertes las por-sucursal? (needs-runtime).
- [ ] Lenders rt=2 **sin `cat_rules`** (SmartPay 152, Bold 106…): se sellan por `lender_user_category_scoring_policy_rules` — falta volcar esa tabla para armar sintéticos.

## Bitácora
- **2026-07-17** — Contexto sembrado desde el simulador `playground/flow` (PerfilamientoNode + MAP.md §S5, verificado por workflow). Superficie de código a linkar en la fase de data.
- **2026-07-17** — Fase de data: superficie de código curada + doc enriquecido desde `git 159906a:docs/codigo/REGLAS-POR-COMERCIO-Y-LENDER.md` §2.3/§3.3 y `MECANICA-CREDITO.md` §4/§5, verificado en legacy (`LenderUserCategoryService`, `CreditopXQuotaController`, modelos de categoría). Correcciones: fórmula de cupo real (4 topes + PV francesa + rama `debt_capacity_amount_validation`), columnas reales de las 2 tablas, **BUG `min_income`**, ruta scoring/`scoring_is_primary`, special granting DENTIX, y re-anclaje application→legacy. Se delegó a **Motor de decisión** las 4 capas/2 motores/synth y a **Amount tiers** las franjas por monto.

## Enlaces
- Padre/group: **CreditopX**. Hermano: **Amount tiers** (franjas por monto: recortan plazos + topean cupo; el enganche lo fija la categoría, no el tramo).
- Referencia transversal: **Motor de decisión** (las 4 capas, los 2 motores de datacrédito, la cascada getLenders clasifica-no-excluye, la receta de sintético + frontera de inyectabilidad) · **Modelo de datos** (EAV field 29/87/160, `risk_central_user_data` encriptado, `user_summaries` agildata/mareigua).
- Fuente (git; `docs/` fuera de main): `git 159906a:docs/codigo/REGLAS-POR-COMERCIO-Y-LENDER.md` §2.3/§3.3 · `git 159906a:docs/codigo/MECANICA-CREDITO.md` §4/§5.
- Memorias: `reglas-comercio-lender-map` · `datacredito-rules-per-lender` (2 motores) · `onboarding-decision-data-map` (receta sintético) · `flow-reorg-y-mapa-atributos` (BUG min_income) · `nomenclatura-negocio` (categoría=nivel/acuerdo) · `creditopx-modelo-comercio` (economía comercio/comisión).
