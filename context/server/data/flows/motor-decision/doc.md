# Motor de decisión · referencia
> **estado:** al día con main · Nodo de referencia del motor de decisión de crédito de CreditOp: los 3 niveles (listado/pre-aprobación externa/cupo rt=2), los 2 motores de datacrédito, la cascada getLenders que clasifica-no-excluye, group rules, el filtro de exclusión, y la receta de usuario sintético por lender con su frontera de inyectabilidad.

<!-- REFERENCIA = sustrato transversal (cuelga del group Plataforma). Autosuficiente: los datos duros están acá para no abrir docs/. -->

## Qué responde
- ¿Quién se aprueba en un lender dado y quién no?
- ¿Cómo armo un usuario sintético que pase (liste + dé cupo) en el lender L, comercio C?
- ¿Qué es inyectable por BD y qué no? (frontera rt=2/3 sí vs rt=1/4 no)
- ¿Cuál de los 2 motores de datacrédito aplica y con qué operadores?
- ¿Por qué un group rule de ingreso/edad no excluye a un rt=2 (CrediPullman)?
- ¿Por qué Welli/Prami no aparecen en el listado v1?
- ¿Qué campos y en qué tablas hay que inyectar (EAV 29/87/160, users.age, risk_central_user_data encriptado, user_summaries)?
- ¿Cuál es el gate DURO real del cupo rt=2 (categoría) vs los clasificadores?
- ¿Por qué el listado y el marketplace muestran cupos distintos (snapshot v2)?

## Qué es
Nodo de referencia del motor de decisión de crédito de CreditOp: los 3 niveles (listado/pre-aprobación externa/cupo rt=2), los 2 motores de datacrédito, la cascada getLenders que clasifica-no-excluye, group rules, el filtro de exclusión, y la receta de usuario sintético por lender con su frontera de inyectabilidad.

## Contenido
## Motor de decisión de crédito — ¿quién se aprueba? ¿cómo armo un synth que pase en el lender L?

La decisión de crédito se resuelve en **3 niveles encadenados**, cada uno con su motor y su punto de gate. La **frontera de inyectabilidad** es la clave operativa: **rt=2/rt=3 (CreditopX in-platform) se sella 100% en legacy con datos locales → inyectable por BD; rt=1 (API externa del proveedor) y rt=4 (Credifamilia SOAP) NO** son inyectables por BD (solo se mockean a nivel HTTP).

### Los 3 niveles
| Nivel | Qué decide | Motor / entrada | Inyectable |
|---|---|---|---|
| **(a) LISTADO / visibilidad** | qué lenders se ven y en qué orden | `getLenders` v1 (`LenderRetrievalService`) / v2 (`LenderListingService`, la que usa el wizard) | sí (group rules + datacrédito-por-sucursal + categoría del sello rt=2) |
| **(b) PRE-APROBACIÓN rt≠0** | aprueba/monto para integraciones | API externa del prestamista vía `PreApprovedLenderService` (v1 in-process) o MS Go pre-approvals-service (v2 progresivo en el front) | NO por BD |
| **(c) CUPO / sello rt=2** | cupo CreditopX in-platform | `CreditopXQuotaController::getAvailableQuota` → `ActiveCreditRuleEvaluator → LenderRuleEvaluator → DatacreditoRuleEvaluator → LenderUserCategoryService` | sí 100% |

### La cascada getLenders (clasifica-no-excluye) — orden real
`FILTRO DURO`=excluye/oculta · `CLASIFICADOR`=solo reordena probabilidad.
1. **Base por sucursal** (DURO): solo lenders en `lenders_by_allied_branches` de la `allied_branch_id`. La cobertura comercio×lender la fija ESTA tabla, no las reglas.
2. **`no_more` rt=2** (DURO): si el user ya cerró (status 11) un rt=2 con esa allied → oculta TODOS los rt=2.
3. **status + payment_link** (DURO): `status=1`; con `payment_link_id` solo sobreviven rt=1.
4. **Group rules** (`LenderValidationService`): DURO para rt≠2; **para rt=2+`have_ctopx` NO excluye (CLASIFICA)**. El bloque viejo de datacrédito rt=2 aquí está COMENTADO.
5. **Excepción Magnocell (84)**: venezolano CE se inyecta saltándose reglas.
6. **Gate datacrédito por sucursal** (`RiskCentralValidationService`, LEGACY): DURO solo si `allied ∈ DatacreditoFrequency` Y existe Experian-Acierta `score!=null`. **En el listado NO borra: manda a `false_lenders` (fondo, "Prob muy baja") → reordena.**
7. **Clasificadores ProfilingRules** (CLASIFICADOR): capacidad/continuidad/consultas bajan niveles, nunca excluyen. (⚠️ el `>100%`→-2 es CÓDIGO MUERTO: el `>75`→-1 lo captura antes.)
8. **allied-mode** (hoy NO-OP): intersecta con `AlliedMode.config['lenders']` — pero las únicas filas (3 de Motai 158) NO tienen clave `lenders` → no filtra.
9. **Perfilamiento ML/matrices + demográfico** (CLASIFICADOR): `weighted_score`; rt 2/3 se fuerzan a "Prob alta". ML externo solo corre en producción.
10. **Special conditions**: Credifamilia (24) DURO → 0% si `totalNs<12 || !debtCapacity`.
11. **Exclusión estática + pre-aprobación externa** (solo v1): `array_filter [12,23,141,142,166]` saca **Prami(12), Welli(23/141/142)** y 166 ANTES de pre-aprobar. Los que sí pre-aprueban vía API: Sistecrédito(9), BNPL(68), Consumo(100), Credifamilia(24), Meddipay(39), BdB CeroPay(133).
12. **Cupo rt=3 + sello rt=2** (DURO): rt=3 `approved_limit<=0`→unset; rt=2 si `getLenderUserCategory` devuelve null→unset.
13. **Orden final** por grupo de probabilidad + `LendersByAllied.sort`.

**v1 vs v2**: el wizard usa **v2** (`LenderListingService extends LenderRetrievalService`, sobre-escribe `getLenders`); v2 NO hace la exclusión estática ni la pre-aprobación sincrónica — el front resuelve las integradas uno-a-uno contra el MS (`useProgressiveLenderResolution`), por eso el cupo aparece DESPUÉS del listado y una integrada puede verse "sin cupo" en la tabla y "pre-aprobada" en el marketplace. El snapshot `displayed_lenders` (`profiling_reviews`) es una FOTO de lo computado a tiempo de listado (pre-resolución).

### Los DOS motores de datacrédito (operadores OPUESTOS)
`lender_datacredito_rules` NO es trío campo/op/valor: es UNA fila con columnas-umbral fijas y operadores cableados en el evaluador. `allied_branch_id NULL`=genérica del lender; con valor=por sucursal.
| | `DatacreditoRuleEvaluator` (NUEVO, rt=2/CUPO) | `RiskCentralValidationService` (LEGACY, rt≠2/LISTADO) |
|---|---|---|
| Regla usada | genérica `allied_branch_id IS NULL` (`findGenericByLender`) | por sucursal `allied_branch_id = userRequest.allied_branch_id` |
| Score | `score >= rule.score` o (`allow_0_score && score===0`) → pasa | `score < rule.score` → quita |
| Negativos | `negativeHistoricalLast12Months > rule.neg_hist_12m (def 1)` → reject | `additional_info.negativeAccounts.total > rule.current_dues` → quita (**otra columna/métrica**) |
| Consultas | `consultedLast6Months > rule.consulted_last_6_months (def 10)` → reject | (no usa) |
| Maturación | `months < rule.time_finance_sector` → reject (`<` **estricto**) | `months <= rule.time_finance_sector` → quita (`<=` off-by-one) |
| Sin regla | **skip → pass** → gatea la CATEGORÍA | vacío → NO remueve |
| Sin dato bureau | **fail-closed**: `no_datacredito_data`/`datacredito_data_incomplete` (score real 0 SÍ pasa el guard) | usa `(int)score` directo |
| Bypass | `CE && lender 84` → passed | — |

**Asimetrías clave**: "sin regla"=pass, pero "con regla y sin datos"=reject. `score=0` en la genérica NO apaga el gate completo (solo el chequeo de score; sigue gateando neg/cons/maturación). Defaults de columna sin poblar: `score=0, current_dues=0, tfs=0, neg=1, cons=10` → deja pasar casi todo en el NUEVO motor. `allow_0_score`=0 en TODAS las 107 genéricas del dump (rama muerta hoy). **En el listado datacrédito(legacy)+group rules solo REORDENAN; el corte duro real es el cupo (rt=2 vía categoría) o la decisión externa (rt=1).**

### Group rules — AND dentro, OR entre, rt=2 no excluye
Molde canónico = 6 `LenderRule` hijas por `GroupRule` (`LenderRuleManagementService:532-609`): ocupación(`field 29`,`=`), reportado(`field 160`,`=`), ingreso(`field 87`,`>=`), género(`users.gender`,`=`), edad mín(`users.age`,`>=`), edad máx(`users.age`,`<=`).
- Operadores: `=`→`in_array(valor, explode('|', value))` (OR-de-lista, ej `'M|F'`, `'no|si'`, `'Independiente|Empleado|Pensionado'`); `>=`/`<=` numérico; `!=`; **operador desconocido→false (REPRUEBA)**. `specific_table` solo soporta `age` y `gender`.
- **DENTRO de una GroupRule = AND** (una falsa la tumba). **ENTRE GroupRules del mismo lender = OR** (con que UNA pase, sobrevive — NO es "el peor gana").
- **DURO solo rt≠2; rt=2+`have_ctopx` NUNCA excluye** (se `unset` cualquier rt=2 caído). → para CrediPullman #77 los group rules de ingreso/edad **CLASIFICAN** (ingreso 1.299.999 igual se ofrece); el gate DURO real del rt=2 es la **categoría**.
- Lender fallido rt≠2 NO se borra: `array_merge(return, false)` → sigue visible "Prob muy baja" sort=4, salvo `[5,135,136,137]` (BdB/UMA) que van a "0% de probabilidad" sort=15.
- **Opt-in con matiz**: sucursal con CERO group rules → entran todos (`processFallbackLenders`). Sucursal MIXTA → lender NO referenciado por ninguna GroupRule se DROPEA (no entra a return ni a false).

### Categoría rt=2 (capa 3, el corte DURO real del cupo)
`getLenderUserCategory`: ordena tiers por `lender_users_category_id ASC` y devuelve el **PRIMER tier que pasa**. `evaluateEligibility` = AND con early-exit: ocupación(29)/edad(`users.age∈[min_age,max_age]`)/`min_income`(salary=agildata>mareigua>EAV87)/género/`employment_continuity` → luego exige `$user->datacredito` → sub-checks bureau (neg12, mora, score, maturación, TC `min_credit_cards`+`tcv`, consultas, capacidad). **FAIL-CLOSED por dato ausente** (neg12/score/maturationSince/creditCard nulo → false) → un synth DEBE inyectar la fila Experian completa. Guard `scoring_policy_fallback_blocked`: si hay `cat_rules>0` y ninguno pasó, aprobar por scoring NO da cupo. `consulted_last_6_months` se **skipea si el umbral del tier ≥100**.

### El filtro de exclusión estática [12,23,141,142,166]
`LenderRetrievalService.php:248-256` `array_filter` ANTES de `validatePreApproveLender` (:259): **Prami(12), Welli(23/141/142)** y 166 NI llegan al listado en **v1** (no es que la pre-aprobación los rechace). Temporal por falta de paridad. En v2 aparentemente pasan (pregunta abierta).

### DatacreditoFrequency — el interruptor del gate del LISTADO
Solo si `allied ∈ DatacreditoFrequency` (40 allieds) Y existe Experian-Acierta corre el gate legacy en el listado. **40 allieds**: 97,26,38,14,73,95,94,65,85,88,89,87,24,83,92,106,67,109,53,108,112,118,119,111,113,107,41,122,123,42,43,103,99,91,131,127,133,132,134,130. Fuera de la lista, el filtro de score por sucursal no corre en el listado (solo en cupo rt=2 vía genérica, o en pre-aprobación rt=1). El `frequency/every` es metadata de caché, NO umbral.

### RECETA DE SYNTH POR LENDER
**Base del synth** (`backend-mcp`): `users.age/gender/document_type` (`setSynthIdentity`), EAV `87/29/160` (`injectIncomeFields`), `user_summaries.agildata/datacredito` (`injectSummary`), fila Experian encriptada AES-256-CBC con APP_KEY (`injectDatacredito`). `datacreditoData()`=perfil limpio fijo (0 neg, 1 consulta, maturationSince 2015-01-01).

**Receta de oro rt=2** (inyectable 100%): `users.age∈[min_age,max_age]` del tier (col REAL, setear explícito), `users.gender` permitido (`M|F` casi siempre no filtra), EAV `29='Empleado'`(o IEP según tier), `87>=umbral` group rule, `160='no'`, `user_summaries.agildata.approximate_real_salary` ALTO (pisa al EAV 87 vía `getSalary` agildata>mareigua>EAV87, debe superar `min_income` del tier), **fila Experian encriptada** (`risk_central_user_data`, central `'Experian - Acierta'`/`'Acierta+Quanto'`) con `score ≥ max(dc-gen, min_score tier)`, `negativeHistoricalLast12Months ≤ umbral`, `consultedLast6Months ≤ umbral`, `maturationSince` viejo, vector TC válido si `min_credit_cards>0`.

**Atajos por lender**:
| Quiero aprobar | Setear mínimo |
|---|---|
| **CrediPullman #77** (rt=2, allied 94) | `age∈[18,78]` (cupo corta en 78; group rule listado deja ver ≤69), EAV 29='Empleado'/IEP, 87>=1.3M (clasifica, no filtra), 160='no', Experian score≥400 (dc-gen genérica **400** Y categoría `min_score 400`; 399 rechaza, 400 ofrece), neg≤3, mora≤1, cons≤1000 (cat14). Caveat register: NO mandar documento (evita ONB005 DUPLICATE); cierre requiere `PDF_MAPPER_FAKE=true`. |
| **Magnocréditos #84** (venezolano) | `document_type='CE'` — bypass total (`DatacreditoRuleEvaluator:21`), NI requiere Experian; categoría fija 22. |
| **Celupresto #96** | tier cat95 piso **-1** (neg≤1000 mora≤1000) → cualquier Experian presente pasa; gate real=ocupación/edad/ingreso. El más laxo del dump. |
| **DENTIX #139** | tier cat115 edad 22-100 pasa-todo de score + special granting DFS. |
| CreditopX "pasa-todo de bureau" (54/111/128/62/84/139) | bureau NO gatea; gate real=ocupación/edad/género/`min_income`. |
| **Credifamilia #24** | PARCIAL: gate local listado (`totalNs>=12` con `economicSector==1` + `valueMonthlyPayment×1000/salary<=0.4` + `currentNegativeCredits==0 && negHist12m==0`) SÍ inyectable; fixture base tiene `economicSector 3/4`→`totalNs=0`→0% por defecto. KYC V2/SOAP rt=4 NO inyectable. ⚠️ ambigüedad rt 2 vs 4. |
| **rt=1** (BNPL#68/Consumo#100/Welli#23/Meddipay#39/Prami#12/Sistecrédito#9/BdB#133) | BD NO controla la decisión; mockear API (`fakeExternalLendersForLocal`/`fakeBancolombiaForLocal`). Welli/Prami además excluidos en v1. |

### dc-gen (score genérica) + piso de categoría por CreditopX armable (dump BD local 2026-06-30)
Clusters dc-gen (banda consumo CreditopX, escala falsa baja): **400**=46,64,77,87,88,89,90,91,92,94,98,101,102,105,109-112,116,117,129,138,148,150; **0** (gate score apagado)=6,8,18,19,21,32,35,36,41,44,62,84,96,118,128,139; **500**=decenas; **710**=24 (el más alto, tfs=12). Pisos de categoría (tier más laxo): #37 CreditopX=400 (4 tiers 700/600/500/400); #77 CrediPullman=400 (cat14 edad 0-78, neg≤3, mora≤1, cons≤1000); #96 Celupresto=-1; #139 DENTIX=0 (edad 22-100); #62 Motai X=0 (pasa-todo); #84 Magnocréditos=0 (bypass CE). rt=2 SIN `cat_rules` (38,48,56,58,65,66,67,69,73,76,78,79,80,82,83,85,86,106,107,109,131,134,143,144,151,152 smartpay,158 Motai Renting) → se sellan por `lender_user_category_scoring_policy_rules` (no en el dump).

**Umbrales de ingreso por comercio** (`field 87`): default de facto **1.300.000** (3398 reglas); **0**=sin piso (2069); **1.850.000**=premium dental/estética (318); 1.000.000 (144); hasta 3.600.000 (Triumph motos). Ocupación más usada: `Independiente|Empleado|Pensionado` (6679). Reportado: `no`=filtra de verdad (3053), `no|si`=NO filtra (2525). Género casi nunca filtra (`M|F`).

### Encriptación (crítico para el synth)
En `risk_central_user_data` SOLO `data` es `encrypted:collection` (AES-256-CBC con APP_KEY); `additional_info` y `request` son PLANO. Un INSERT de JSON plano en `data` rompe el descifrado → gate fail-closed silencioso. Si el APP_KEY del `.env` no es el del entorno, el listado falla en silencio. `user->datacredito` apunta por NOMBRE (`'Experian - Acierta'`/`'Acierta+Quanto'`) + latest, NO por id fijo → inyectar solo Quanto puro deja `datacredito` null → fail-closed. Cache: filas `<1 mes` se reusan sin reconsultar.

## Dónde mirar
- **LenderRetrievalService.php (getLenders v1)** (legacy-backend): Cascada completa del listado: base sucursal, no_more rt=2, status, exclusión estática [12,23,141,142,166] (:248-256), llamada a pre-aprobación (:259), sello rt=2/cupo rt=3 (:675-898)
- **LenderListingService.php (getLenders v2)** (legacy-backend): El path que usa el wizard; extends LenderRetrievalService y sobre-escribe getLenders (recorta exclusión estática y pre-aprobación sincrónica); escribe snapshot displayed_lenders (:188)
- **LenderValidationService.php** (legacy-backend): Group rules: operadores (:104-110,:157-163), AND dentro (:297-301), OR entre GroupRules (:309-315,:375-377), rt=2+have_ctopx no excluye (:319-334,:382-384), BdB/UMA 0% (:385-389)
- **DatacreditoRuleEvaluator.php** (legacy-backend): Motor NUEVO rt=2/cupo: regla genérica, score>= (:80), neg (:85), consultas (:89), maturación < estricto (:93-96), bypass CE lender 84 (:21), fail-closed
- **RiskCentralValidationService.php** (legacy-backend): Motor LEGACY rt≠2/listado: score< quita (:42), negativeAccounts.total>current_dues (:46), maturación <= off-by-one (:56); solo reordena (:101-107)
- **CreditopXQuotaController.php (Customer)** (legacy-backend): Cupo rt=2: encadena ActiveCredit→LenderRule→Datacredito→Categoría→special granting DENTIX/DFS; guard scoring_policy_fallback_blocked (:325); endpoint POST /api/loans/lender/available-quota
- **LenderUserCategoryService.php (Loans)** (legacy-backend): Categoría capa 3 (corte DURO del cupo): tiers por id ASC, primer tier que pasa (:79,:105), evaluateEligibility AND fail-closed (:403-488), min_income salary=agildata>mareigua>EAV87
- **LenderRuleEvaluator.php** (legacy-backend): GOTCHA synth: RECHAZA si falta el field (missing_field_value_X, :46-53) en vez de skip — hay que inyectar TODOS los field_id que las lender_rules referencien
- **ProfilingRulesService.php** (legacy-backend): Clasificadores (no excluyen); condición de entrada al gate datacrédito legacy: allied∈DatacreditoFrequency + Experian-Acierta score!=null (:32-44); código muerto >100% (:90-100)
- **Experian.php (Actions/RiskCentrals)** (legacy-backend): Qué campos escribe y dónde: score plano vs data encriptado (:523,:545), additional_info plano negativeAccounts/maturationSince (:532-538), Quanto productCode==62
- **RiskCentralUserData.php + User.php (Models)** (legacy-backend): RiskCentralUserData: solo `data` es encrypted:collection (:20-33). User: datacredito() hasOne por NOMBRE 'Experian - Acierta'/'Acierta+Quanto' + latest, NO por id (:233-243)
- **AvailableLenders.tsx + useProgressiveLenderResolution.ts + loan-options.repository.ts** (frontend-monorepo): El wizard llama lenders-v2 y resuelve las integradas rt≠0 uno-a-uno contra el MS de pre-aprobaciones (por qué el cupo aparece después del listado y diverge del snapshot)

## Frontera de simulación / harness
Relevante al OKR de metodología de pruebas: la FRONTERA DE INYECTABILIDAD define qué se puede testear E2E con un synth de BD y qué requiere mock HTTP. rt=2/rt=3 (CreditopX, CrediPullman #77) se sella 100% en legacy → inyectable fabricando users(age/gender/document_type), user_field_values(EAV 29/87/160), user_summaries(agildata/datacredito) y la fila Experian encriptada en risk_central_user_data. rt=1 (Bancolombia BNPL/Consumo, Welli, Meddipay, Prami, Sistecrédito, BdB CeroPay) y rt=4 (Credifamilia SOAP) NO son inyectables por BD (la decide la API externa) → solo mock HTTP (fakeExternalLendersForLocal/fakeBancolombiaForLocal o backend-e2e HttpFakes vía ONBOARDING_DRIVER_<prov>=fake). Dos familias de inyección del harness: (A) backend-mcp synth = BD directa rule-driven (resolveLender/deriveSynthReq leen las reglas reales, laravelEncrypt del `data`); (B) backend-e2e + HttpFakes = flujo real con respuestas canned. GAPS del synth: no inyecta AML/identidad TusDatos ni Ado; datacreditoData es perfil limpio fijo (para probar EXCLUSIÓN por negativos hay que usar SeedRiskProfile); synthrules deriva el score objetivo de min_score de la categoría pero el DatacreditoRuleEvaluator igual aplica la regla genérica (si su score>min_score el synth puede reprobar el gate datacrédito). Estos harness (playground/backend-e2e, playground/backend-mcp) NO están en el índice — su superficie de producto es la lista de `files` de este nodo.

## Gotchas / riesgos
- Operadores INVERTIDOS entre los 2 motores de datacrédito: NUEVO score>= / maturación < estricto vs LEGACY score< / maturación <= off-by-one. Y usan columnas/métricas de negativos DISTINTAS (negativeHistoricalLast12Months vs additional_info.negativeAccounts.total). Inyectar pensando en uno puede no satisfacer al otro.
- score=0 en la regla genérica NO apaga el gate completo — solo el chequeo de score; sigue gateando neg/consultas/maturación.
- El group rule de ingreso/edad para rt=2+have_ctopx CLASIFICA, no excluye (ingreso 1.299.999 igual se ofrece). El corte DURO del rt=2 es la CATEGORÍA (min_score del tier).
- LenderRuleEvaluator RECHAZA si falta el field_id (missing_field_value), no hace skip — distinto de DatacreditoRuleEvaluator (sin regla = skip→pass). Inyectar TODOS los field_id de las lender_rules del lender.
- En risk_central_user_data SOLO `data` está encriptado (AES-256-CBC con APP_KEY); additional_info/request son plano. Un INSERT de JSON plano en `data` rompe el descifrado → gate fail-closed silencioso. Si el APP_KEY no es el del entorno, el listado falla en silencio.
- user->datacredito apunta por NOMBRE + latest, NO por id fijo. Inyectar solo Quanto puro deja datacredito=null → fail-closed.
- getSalary() cascada agildata>mareigua>EAV87: inyectar solo EAV87 puede ser pisado por user_summaries.agildata.approximate_real_salary.
- users.age es COLUMNA REAL (no accessor de date_of_birth) en el path de group rules y categoría; setearla explícita. Además el listado deja ver hasta la edad del group rule pero el CUPO corta por la edad de la categoría (ej CrediPullman: listado ≤69, cupo ≤78).
- La categoría es fail-closed por dato de bureau ausente (neg12/score/maturationSince/creditCard nulo → false) — al revés de los group rules (sin GroupRule dejan pasar). Un synth DEBE inyectar la fila Experian completa.
- Opt-in por sucursal MIXTA: lender NO referenciado por ninguna GroupRule en una sucursal con otras group rules se DROPEA (no entra a return ni a false). El 'entran todos sin reglas' solo vale para sucursal con CERO group rules.
- allied-mode NO filtra lenders hoy (las 3 filas de Motai no tienen clave 'lenders' → NO-OP de visibilidad; isAbacoRequired solo decide el flujo de datos Abaco).
- Tier laxo (menor min_score) ADMITE, pero gana el de menor lender_users_category_id (suele ser el 700 estricto) → max_amount/min_initial_fee salen del PRIMER match, no del laxo.
- consulted_last_6_months se skipea si el umbral del tier es >=100 (validateConsultedLast6Months) → consultas solo gatean donde cons6<100.
- El branch legacy $ctopx_lender_id==160 ($category_credipullman) está MAL NOMBRADO: 160 NO es CrediPullman en local/dev, es el smartpay_lender_id de PRODUCCIÓN (153 en no-prod). No es variante de #77.
- El >100%→-2 de ProfilingRules es CÓDIGO MUERTO (el >75→-1 lo captura antes).

## Preguntas abiertas
- [ ] Umbrales reales por lender (score/neg/consultas/tfs/ocupación/edad/min_income) viven en BD (dev/prod), NO en seeders. Volcar: SELECT lender_id, allied_branch_id, score, allow_0_score, current_dues, time_finance_sector, negative_historical_last_12_months, consulted_last_6_months FROM lender_datacredito_rules; y SELECT lender_id, lender_users_category_id, monthly_income FROM lender_users_category_rules (min_income es FILTRO DURO y no está en el dump §5).
- [ ] Mapping exacto id↔name en risk_centrals del target: 'Experian - Acierta'=?, hay >=3 nombres TusDatos; ids 2/3/4/6 hardcoded pero dependen del orden de inserción del entorno.
- [ ] ¿v2 (LenderListingService) aplica la exclusión estática [12,23,141,142,166]? Solo se vio en v1; la memoria frontend-e2e sugiere que v2 deja pasar Welli/Prami. Bajo strangler/parallel-run confirmar cuál corre por comercio.
- [ ] ¿Existen las funciones SQL FN_User_Income_Average, FN_User_Occupation, FN_Agildata_*, FN_Mareigua_* y la vista VW_Risk_Central_Experian en el target? Si no, el cálculo de salario/Prami falla aunque las columnas estén inyectadas.
- [ ] Credifamilia: ¿id 6 (addi, gate score 0) vs id 24 (rt=4, gate 710) son productos distintos o legacy duplicado? Y ¿#24 opera rt=2 (inyectable) o rt=4 (SOAP externo)?
- [ ] rt=2 sin cat_rules (smartpay 152, Bold 106, Motai Renting 158, 65/66/67…): se sellan por scoring-policy; falta volcar lender_user_category_scoring_policy_rules.
- [ ] have_ctopx: la regla 'rt=2+have_ctopx no excluye' depende de have_ctopx, pero allied 94 (CrediPullman) no aparece con have_ctopx=1 en el dump §9 (posiblemente truncado). Confirmar la señal real del path rt=2.
- [ ] ¿hasFindings de TusDatos AML bloquea el listado de TODOS los lenders o solo el flujo Credifamilia? No se localizó un consumidor central que rechace por aml()->data.
- [ ] min_credit_cards/tc_vector_validation por lender: el datacreditoData del synth siembra solo 1 TC; algún lender podría exigir >=2.

## Bitácora
- **2026-07-17** — Nodo de referencia creado bajo el group Plataforma. Superficie: 33 archivos, 33/33 resuelven. Síntesis de `ONBOARDING-DATOS-DECISION + REGLAS-POR-COMERCIO-Y-LENDER` para hacer el árbol autosuficiente (resolver tareas sin abrir docs/).

## Enlaces
- playground/docs/codigo/ONBOARDING-DATOS-DECISION-ANALISIS.md — fuente maestra: mapa datos-de-riesgo→decisión, tabla maestra de campos, receta synth por lender, cascada getLenders con archivo:línea
- playground/docs/codigo/REGLAS-POR-COMERCIO-Y-LENDER.md — fuente maestra: 4 capas de regla, dump BD real (dc-gen/dc-suc/tiers por lender, umbrales de ingreso por comercio, DatacreditoFrequency 40 allieds, exclusión estática)
- context flow creditopx (doc.md) — el flujo rt=2 in-platform que consume este motor
- context flow agregadores (doc.md) — el flujo rt=1 cuya decisión es externa (no inyectable)
- context node reglas-comercio-lender-map / datacredito-rules-per-lender / lender-listing-cascade / onboarding-decision-data-map (MEMORY) — nodos hermanos
