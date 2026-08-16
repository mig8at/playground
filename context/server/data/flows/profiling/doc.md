# Profiling · contexto
> **estado:** al día con main · El **perfilamiento rt=2** (CreditopX): con los datos del usuario (ocupación, edad, salario, continuidad, género + buró) CreditOp lo mete en una **categoría** de la entidad, y esa categoría fija **enganche, cupo, plazo, FGA y seguro**.

## Qué es
Cómo CreditOp, in-platform (rt=2/3), **perfila** al usuario y lo clasifica en una **categoría de riesgo** del lender. La categoría es el **gate DURO** del cupo CreditopX y la que **fija la economía del crédito**: enganche (`min_initial_fee`), techo de cupo (`max_amount`), plazo máx (`max_fee_number`), fondo de garantía (`FGA`) y seguro de vida (`life_percentage`). Sin una categoría con cupo > 0, el lender rt=2 **ni se ofrece** (se hace `unset` del marketplace).

En lenguaje de negocio es la **"segmentación de clientes"** (de *premium* a *malos*): a los reportados/no-bancarizados se les ofrece crédito con **mayor garantía + enganche alto (ej. 70%)** y reportes positivos a Datacrédito para recuperarlos [git 159906a MECANICA §5]. La asignación NO es una banda de score simple sino un **motor de reglas de tier + scoring SQL**. Caso Mediarte: el perfilamiento predictivo llevó la facturación de **$20M→$350M/mes, +25% conversión, 3× ticket** [git 159906a MECANICA "Caso Mediarte"].

En **rt=1 CreditOp no perfila** (la API externa del proveedor decide; ver **Bróker**); en rt=0 redirige. Perfilar es exclusivo del sombrero operador (rt=2/3).

## Antes de concluir
- ⚠ **La compuerta de capacidad de endeudamiento corre en 35 de 195 tiers (18 %)** y **no mira los
  gastos declarados por el cliente**: usa `salario − (cuota_mensual_datacrédito − deuda_ignorada)`
  (`LenderUserCategoryService.php:664`). Sólo se evalúa si el tier declara `min_debt_capacity > 0`
  **Y** `debt_capacity_amount_validation == 0` — 133 tiers declaran el mínimo pero **98 de ellos lo
  tienen inerte** por el segundo flag. Y lo que se llama «capacidad» en `calculatePaymentCapacity`
  (`:333`) es OTRA cosa: un PORCENTAJE `(ingreso−gastos)/ingreso` que alimenta el scoring, no la
  compuerta. Negocio y motor llaman «capacidad» a dos cosas distintas — ver **F-112**.
- **BUG `min_income` NO-OP** (vivo): la columna del tier es `monthly_income` (`migration:21`) pero `evaluateEligibility` lee `$rule->min_income` (`:416`) — atributo inexistente → `null` → `$salary >= null` es **siempre true** en PHP. El **piso de ingreso de la categoría no filtra**; arreglarlo (leer `monthly_income`) **endurece** la asignación. [MEMORY flow-reorg-y-mapa-atributos]
- **Tier laxo admite, primer tier (menor id, suele el más estricto) da la economía** — el `max_amount`/`min_initial_fee` NO salen del tier que "más fácil" pasa.
- **FAIL-CLOSED por buró ausente**: la categoría SIEMPRE exige la fila `datacredito` (`:429`); sin ella, ni un tier "pasa-todo de score" aprueba (aunque tenga todos los sub-checks sin umbral).
- **`consulted_last_6_months` se apaga si el umbral del tier ≥100** (`validateConsultedLast6Months:607`) → las consultas solo gatean donde el tier fija `<100`.
- **Categoría de USUARIO ≠ categoría de PRODUCTO**: `lender_users_categories` segmenta **usuarios**; la "categoría de lender/producto" del plan Motai v2 (crédito/arrendamiento) es **otra cosa que aún no existe** en BD (ver **Motai v2**). No confundir.
- **`scoring_policy_fallback_blocked`**: aprobar por scoring tras fallar todas las reglas de tier NO da cupo — solo `scoring_is_primary` (lender sin tiers, ej. SmartPay) usa scoring como diseño.
- **Los INSUMOS de la categoría los calcula la BD, no PHP.** El ingreso promedio y la ocupación —dos de las cuatro variables de las reglas— salen de `FN_User_Income_Average` y `FN_User_Occupation`, funciones almacenadas de MySQL invocadas con `DB::scalar` desde `ExperianProfileService.php:42` y `:46` (y su gemelo `Prami.php:378` · `:384`). El porcentaje de gasto fijo, igual: `FN_CreditopX_Profiling_Fixed_Expense_Perc` (`:102`). ⚠ Grepear el nombre del campo en el código NO llega a la fórmula: se invocan como string. Y **cambiarlas no deja rastro en ningún repo** — un perfilamiento que cambió sin deploy se explica ahí. Nodo **db-routines**.
- **Parallel-run**: la lógica corre en `application` (default) y `legacy-backend` (migración). Las líneas citadas son de **legacy** (donde el análisis fuente verificó); el gemelo application tiene la misma mecánica en otras líneas.
- **El ORDEN del listado lo decide una cadena de DOS perfiladores, y el primero está apagado por configuración.** `ProfilerMLController::mlModelV1` tiene la estrategia cableada como `new_then_legacy`: primario `NewProfilerMLService`, respaldo el modelo H2O de siempre (`makePrediction`, `->timeout(15)`). Pero `NewProfilerMLService` sale por una guarda `if ($host === '')` cuando falta `NEW_PROFILER_ML_HOST`, que en prod **no está puesta** — así que el primario falla en el 100 % de las solicitudes y la huella queda en `ML_predictions.previous_attempt`. Y el respaldo H2O también se cae: **timeoutea a los 15 s** contra `profiler.inertia-production:8000` (medido 2026-08-06: 4 timeouts en una sola solicitud, uReq 521997 — un listado lento no es «ML apagado», son 15 s de espera por intento). ⚠ Por eso `fallback_triggered: true` **no** significa «lo ordenaron las matrices»: significa que respondió el perfilador viejo, que sigue siendo un modelo (F-104).
- **`ML_predictions` tiene TRES formas porque la escriben DOS sistemas.** `legacy-backend` guarda un ARRAY (una entrada por entidad, con `perfilador`) o un OBJETO con `error` cuando ninguno respondió; `legacy-application` guarda la respuesta CRUDA de H2O (`{data,status,message}`) **sin transformar y sin `perfilador`** — por eso esas filas no pueden decir quién ordenó. Leer una sola forma hace que justo el caso que interesa se lea como «sin datos».

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

**⭐ `users_category_log`: el perfilamiento SÍ deja rastro, criterio por criterio.** Es la respuesta a
«¿por qué a este cliente no le salió esta entidad?» —3 de cada 5 reportes de #tech-ops— y estuvo todo el
tiempo en la BD. Una fila **por entidad evaluada**, con `category_rules_acceptance` = JSON
`{tier_id: {criterio: bool}}`. Medido en prod: **26.846 filas en 7 días, el 100 % con el JSON**.

Escritores: `Modules/Loans/App/Services/LenderUserCategoryService.php:502 logCategory` y
`Modules/Onboarding/App/Services/lenders/LenderUserCategoryService.php:30`. Lector de referencia:
`Modules/Backoffice/App/Services/ApplicationsService.php:1432 decodeAcceptance`.

⚠ **Tres reglas para leerlo, todas necesarias** (ver **F-118**): una clave **ausente** no es un criterio
que pasó sino uno que **no se evaluó** (la evaluación corta en `:425` tras los cinco criterios sin buró)
· la misma regla se escribe **`occupation`** y **`ocupations`** según cuál de los dos servicios homónimos
la escribió · y hay dos claves de **nivel raíz** que no son tiers: `blacklisted` y
`validacion_venezolanos` (F-120).

⚠ **No trae `user_request_id`**: se indexa por `(user_id, lender_id)`, igual que el buró. Para atribuir
una fila a una corrida, la heurística del backoffice —replicada en el trazador— es
`|created_at − profiling_reviews.updated_at| ≤ 120 s`. Y la cascada evalúa la misma entidad **hasta 9
veces** por solicitud (el método se llama desde tres sitios), así que hay que colapsar.

El trazador ya lo lee: la etapa `profiler` muestra, por entidad y por tier, dónde cortó y qué criterio
bloqueó (`trazador/server/fuentes.go` `GetCategorias`).

**El scoring por respuestas declaradas: qué es y de quién** (volcado de prod, 2026-08-07). Es el único
motor de CreditOp que decide **sin buró**: el cliente responde el formulario, cada respuesta suma puntos
y el total cae en una categoría. Tres tablas y **un solo dueño**:

- `lender_user_fields_scoring_policy` (30 filas) — `(field_id, value) → score`. Los campos son de
  autodeclaración: `averageMonthlyIncome` (163), `primaryOccupationType` (164), `incomeType` (166),
  `employmentOrBusinessTenure` (167), `incomeChannels` (168), `activeCredits` (169),
  `hasActiveCreditCard` (170), (172).
- `lender_payment_capacity_scoring_policy` (5 filas) — la capacidad de pago en % se convierte a puntos
  por banda: `0-10 → 20`, `11-30 → 15`, `30-50 → 15`, `50-70 → 10`, `71-100 → 5`. ⚠ **Menos capacidad
  da MÁS puntos**, y las bandas 11-30/30-50 **se solapan en el 30**.
- `lender_user_category_scoring_policy_rules` (4 filas) — el total cae en categoría:
  `140-165 → 139` · `100-139 → 140` · `50-99 → 141` · `0-49 → 142`.

⚠ **Las tres tablas son 100 % del lender 160 = SmartPay**, que es de **República Dominicana**
(`country_id 60`; sus rangos de ingreso están en RD$). No hay ningún otro lender con scoring en prod.
Dos precisiones sobre lo que decía antes este nodo: el id **en producción es 160** (el 152 es SmartPay
**fuera** de prod — está declarado así en `hardcodes-entidades`, y este árbol se mide contra prod); y
**Bold 106 no se sella por scoring**: no tiene ni tiers ni filas de scoring.

⚠ **Y entonces la «ruta scoring» no es la salida de los lenders sin tiers.** Medido en prod:
**37 lenders rt=2/3 activos no tienen ni un tier ni una fila de scoring** (23 de 100 en rt=2; **14 de 16
en rt=3**). Los de rt=3 tienen explicación —el rotativo usa otro motor entero, ver el nodo `rotativo`—;
los 23 de rt=2 **no la tienen todavía**.

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

## `profiling_reviews`: el snapshot del motor (y el esqueleto del listado)

Cada solicitud perfilada deja **una fila** con todo lo que el motor decidió. Es la respuesta a "¿qué se le mostró al cliente y con qué criterio", sin re-evaluar nada:

| columna | qué guarda |
|---|---|
| `displayed_lenders` (json) | `[{id, name, probability, weighted_score, profiling_percentage}, …]` — **lo que se renderizó**, con la clasificación ya calculada |
| `hard_rules` (json) | la evaluación de las reglas duras |
| `recommended_lender` | la entidad recomendada |
| `disbursed_lender` | la que terminó desembolsando — la escribe el **webhook** del lender (nodo **Aggregator**) |
| `datacredito_query` | si se consultó datacrédito en esta solicitud |
| `demog_predictions` · `matrix_predictions` · `ML_predictions` (json) | las tres fuentes del orden |
| `user_id` · `allied_id` · `user_request_id` | a quién y dónde |

**588 filas, las 588 con `displayed_lenders` y `hard_rules`** (dump local, 2026-08-05).

⚠ **No existe una tabla `displayed_lenders`** — y eso engaña: buscarla en `information_schema.TABLES`, no encontrarla y concluir que el listado no se persiste es un error que ya se cometió y quedó escrito como hecho en un mapa de etapas. Está como **columna**, no como tabla. Ver **F-93**.

## El perfilamiento NO se puede auditar desde el admin

Es una limitación operativa, no un bug, y explica una clase entera de escalamientos: el comercio ve un
resultado («probabilidad alta», «pre aprobado», un cupo) y **no hay pantalla que muestre qué reglas se
evaluaron ni con qué valores**. En palabras del ingeniero que atiende estos casos, sobre uno del 2026-08-05:

> «Es difícil que ellos vean las reglas a partir de lo que muestra esa pantalla, ya que por detrás se
> realizan varios cálculos para determinar un *overdue account*, no sólo si aparece en datacrédito. […] No
> hay forma de comparar con lo que aparece en pantalla tampoco.»

Consecuencia medida: de los reportes de #tech-ops de 5 días, **3 son «¿por qué perfiló así?»** y los tres
terminaron en que alguien leyera los logs a mano. Dos desenlaces reales del mismo período: uno cerró en
«pasó todas las reglas **porque es una cuenta bancaria, no una deuda**» (o sea: la regla funcionó y la
lectura del comercio era la equivocada) y otro en «puede ser un error en nuestro perfilador, habría que
esperar el nuevo» (o sea: la regla estaba mal).

**Lo que SÍ queda en los logs** —y es lo que permite contestar sin abrir el código— son los ids de regla por
entidad. Medido en la uReq 520704 de prod: `Credi ASYCO → regla 8959`, `Bancolombia CPD → 8568`,
`Sistecrédito → 8564`, uno por entidad evaluada, más el veredicto (`Pre aprobado · RECOMENDADO`,
`Probabilidad alta/media/baja`). `playground/trazador` los muestra agrupados en la etapa `listado`
(«Veredicto por entidad») y en `cupo` («Evaluación de categoría», «Regla de categoría rechazada»).

⚠ Lo que **no** se responde así es *por qué* una regla dio ese resultado: para eso hay que leer su
definición en `lender_group_rules` / la tabla de la regla y los valores que consumió. El log dice **qué
regla** decidió, no **con qué cuentas**.

### El vocabulario del CÓDIGO, que es con el que hay que buscar en Loki

Arriba los eventos van por su **etiqueta del trazador** («Evaluación de categoría», «Regla de categoría
rechazada»). En los logs **no existen con ese nombre**: buscarlos así no devuelve nada, y esa capa de
traducción es la misma trampa que el nodo **KYC** documenta para las compuertas `STAGE 0…4`. El motor de
categorías declara su propio pipeline en
`Modules/Loans/App/Services/LenderUserCategoryService.php`:

| marcador | dónde | qué contesta |
|---|---|---|
| `CATEGORY_EVALUATION_START` | `:92` | arrancó la evaluación del par (usuario, entidad) |
| `CATEGORY_EVALUATION_SPECIAL_CASE` | `:68` | entró por **special granting**, no por tiers |
| `CATEGORY_EVALUATION_APPROVED` | `:131` | **cayó en categoría**, y con qué: `category_id`, `max_amount`, `available_from_lender`, `rules_evaluated`, `salary`, `continuity_months`, `datacredito_score` |
| `CATEGORY_RULE_REJECTED` | `:159` | **el tier NO matcheó**: `rule_id`, `category_id` y sobre todo **`failed_criteria`** (`:165`) — la lista exacta de criterios incumplidos (`negative_reports_last_12_months`, `overdue_accounts`, `score`) — más `criteria_details` |
| `FIELD_SCORING_COMPLETED` · `PAYMENT_CAPACITY_SCORING_COMPLETED` · `CATEGORY_RESOLUTION_BY_SCORE_COMPLETED` | `:203` · `:234` · `:267` | el camino por **scoring**, el que corre cuando ningún tier matcheó |

`CATEGORY_RULE_REJECTED` es la única respuesta directa a «¿por qué no le apareció esta entidad?» que **no**
obliga a re-evaluar las reglas a mano: dice *qué criterio* falló, no solo que falló. Es exactamente lo que
falta en la pantalla del admin (sección de arriba) y lo que los tres escalamientos de #tech-ops fueron a
buscar a mano.

⚠ Sale a nivel **`debug`** —el propio código dice «para no saturar» (`:158`)—, a diferencia de todos los
demás, que son `info`. Si el ambiente filtra `debug`, el marcador que contesta la pregunta es justo el que
no está: una ausencia acá **no** significa que la regla no se evaluó.

Los rechazos por **cupo** tienen sus propios marcadores y viven en otros servicios → ver **CreditopX**.

## Lo que NO está verificado
- `monthly_income` por tier no está volcado del dump — y hoy además es NO-OP por el bug del censo.
- ¿Las reglas datacrédito POR SUCURSAL quedan inertes en el cupo? El motor nuevo lee solo la genérica; needs-runtime.
- ¿Cómo categorizan los 23 lenders rt=2 activos sin tiers Y sin scoring (medidos en prod el 2026-08-07)? O no otorgan nunca, o hay un tercer camino que el nodo no tiene.
