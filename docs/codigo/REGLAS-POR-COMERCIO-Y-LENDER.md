# Mapa de configuración de reglas — por COMERCIO (allied/sucursal) y por LENDER

> Síntesis de 4 reportes que cruzaron el **dump real de BD local** (`reglas-dump.txt`, 9 secciones) con la **semántica del motor** (`ONBOARDING-DATOS-DECISION-ANALISIS.md`) y la **verificación contra código** (`/Users/miguelochoa/Desktop/CREDITOP/github/legacy-backend`).
>
> Objetivo: total claridad de qué condiciones exige cada combinación **comercio × lender** — para testing del harness y entendimiento. Prosa en español, identificadores `verbatim`. Toda afirmación load-bearing cita **dump §N** y/o **`archivo:línea`**.
>
> Repos: `legacy-backend` = `/Users/miguelochoa/Desktop/CREDITOP/github/legacy-backend`. Dump = `…/2e2378e5-…/scratchpad/reglas-dump.txt`. Doc semántico previo = `…/playground/docs/ONBOARDING-DATOS-DECISION-ANALISIS.md`.
>
> **Verificación 2026-06-30**: los dos engines de datacrédito (`DatacreditoRuleEvaluator.php:19-100`, `RiskCentralValidationService.php:42-70`), la combinación AND/OR de group rules y la neutralización rt=2 (`LenderValidationService.php:104-110,157-163,297-301,309-334,375-389`), el orden de tiers de categoría (`LenderUserCategoryService.php:79,105`) y el no-op de allied-mode (`AlliedModeLenderFilterService.php:33-36`) fueron releídos verbatim y **se sostienen**.

---

## 1. Resumen ejecutivo

El dataset tiene **~149 lenders vivos** (dump §1, status=1) repartidos por `response_type` (rt): **rt=0** banca/cooperativas tradicionales, **rt=1** integraciones externas (Bancolombia, BdB, Welli, Sistecrédito, Meddipay…), **rt=2** CreditopX in-platform (marca-blanca por comercio), **rt=3** cupo rotativo CreditopX, **rt=4** Credifamilia (radicación SOAP). La cobertura comercio×lender NO la fijan las reglas sino la tabla `lenders_by_allied_branches` (`LenderRetrievalService.php:134-160`); las reglas solo **gatean o clasifican** sobre lo ya ofrecido.

Sobre ese universo conviven **CUATRO capas de regla**, cada una con su propio motor y su propio punto de gate:

| # | Capa | Tabla / motor | Granularidad | Rol | Gatea en |
|---|---|---|---|---|---|
| 1 | **Group rules** (ocupación/ingreso/reportado/edad/género) | `group_rules`+`lender_rules` / `LenderValidationService::validateRulesByLender` | **por sucursal** (`allied_branch_id`) | FILTRO DURO si `rt!=2`; CLASIFICADOR si `rt=2`+`have_ctopx` | LISTADO |
| 2 | **Datacrédito** (score/negativos/consultas/maturación) | `lender_datacredito_rules` / **DOS** evaluadores | **genérica** (`allied_branch_id NULL`) **o por sucursal** | FILTRO DURO en ambos motores, semántica OPUESTA | LISTADO (rt!=2, sólo si allied ∈ `DatacreditoFrequency`) **y** CUPO (rt=2, regla genérica) |
| 3 | **Categoría** (tiers ocupación/edad/ingreso/género + bureau) | `lender_users_category_rules` / `LenderUserCategoryService::getLenderUserCategory` | **por lender** (tiers ordenados) | FILTRO DURO terminal del cupo rt=2/rt=3 | CUPO rt=2/3 (y unset en listado si devuelve null) |
| 4 | **Cobertura / modos / frecuencia / exclusión** | `lenders_by_allied_branches`, `allied_modes`, `datacredito_frequencies`, array estático | sucursal / allied | FILTRO DURO (cobertura, exclusión) o INTERRUPTOR (frequency) o NO-OP hoy (modos) | LISTADO |

**La frontera de inyectabilidad** (heredada del doc previo, §1): **rt=2/rt=3 se sella 100% en legacy con datos locales → inyectable**; **rt=1 (decisión de API externa) y rt=4 (SOAP) NO** son inyectables por BD. Por eso este documento se concentra en armar **rt=2**: ahí la decisión es la **categoría** (capa 3) + la **fila Experian encriptada**, con el datacrédito genérico (capa 2) como gate secundario.

---

## 2. Cómo se combinan las reglas

### 2.1 Group rules (capa 1) — AND dentro, OR entre, y rt=2 no excluye

Verificado en `LenderValidationService.php`:

- **Molde canónico**: cada `GroupRule` creada por el panel inserta EXACTAMENTE **6 `LenderRule` hijas** (`LenderRuleManagementService.php:532-609`): ocupación (`field 29`, `=`), reportado (`field 160`, `=`), ingreso (`field 87`, `>=`), género (`users.gender`, `=`), edad mínima (`users.age`, `>=`), edad máxima (`users.age`, `<=`). Por eso el universo de §5 son justo esos 6 campos.
- **Operadores** (`:104-110`, `:157-163`): `=` → `in_array($field_value, explode('|', $value))` (lista-OR, p.ej. `'M|F'`, `'no|si'`, `'Independiente|Empleado|Pensionado'`); `>=`/`<=` numérico; `!=` desigualdad; **default → `false` (operador desconocido REPRUEBA)**. `specific_table` sólo soporta columnas `age` y `gender` (otra → `''`).
- **(a) DENTRO de una GroupRule = AND duro** (`:297-301`): `$global_result = $global_result && $response_rule['response']` sobre TODAS las hijas. Una sola condición falsa tumba el GroupRule entero.
- **(a-bis) ENTRE múltiples GroupRules del mismo lender = OR** (`:309-315` + `:375-377`): pasar UNA basta. El loop `foreach ($filteredGroupRules as $rule)` evalúa cada GroupRule por separado; si una da `true` el lender entra a `return_lenders`; el `array_filter` final saca de `false_lenders` a todo lender ya aprobado. **NO es "el peor gana"** — con que UN GroupRule pase, el lender sobrevive. (Corrige cualquier lectura de "AND global".)
- **(b) FILTRO DURO sólo para `rt!=2`; `rt=2`+`have_ctopx` NUNCA excluye** (`:319-334` y `:382-384`): un lender rt=2 fallido ni siquiera entra a `false_lenders` si `allied->have_ctopx`, y en el post-proceso cualquier rt=2 que cayó se `unset`. → Para CrediPullman (#77, rt=2) los group rules de ingreso/edad **clasifican, no excluyen**: ingreso 1.299.999 igual se ofrece (confirmado en doc previo §5). El gate DURO real del rt=2 es la **categoría** (capa 3).
- **(b-bis) "FILTRO DURO" para `rt!=2` NO borra de la lista**: `validateRulesByLender` hace `return array_merge($return_lenders, $false_lenders)` (`:403`); el fallido sigue visible marcado `'Probabilidad muy baja'` sort=4 (`:378-381`), salvo `[5,135,136,137]` (BdB / UMA Occidente-Santander-Finanzauto) que van a `'0% de probabilidad'` sort=15 (`:385-389`). La invisibilidad real llega después (pre-aprobación externa, exclusión estática).
- **(c) Opt-in por sucursal — CON MATIZ**: el doc previo (§6) dice "sin GroupRule → entran todos". Eso es cierto **sólo si la sucursal tiene CERO group rules** (dispara `processFallbackLenders`, `LenderRetrievalService.php:202-203`). En una sucursal **mixta** (group rules para algunos lenders, no para otros), el lender NO referenciado por ninguna GroupRule **se DROPEA** en `validateRulesByLender` (los foreach internos no corren, no entra ni a return ni a false). Matiz no trivial para el harness.

### 2.2 Datacrédito (capa 2) — dos motores, operadores OPUESTOS

`lender_datacredito_rules` **NO es trío campo/op/valor**: es UNA fila con columnas-umbral fijas (`score`, `allow_0_score`, `current_dues`, `time_finance_sector`, `negative_historical_last_12_months`, `consulted_last_6_months`, `probability_levels`). `allied_branch_id NULL` = **genérica** del lender; con valor = **por sucursal**. Hay DOS evaluadores con campos y operadores DISTINTOS:

| | `DatacreditoRuleEvaluator` (NUEVO, rt=2/CUPO) | `RiskCentralValidationService` (LEGACY, rt!=2/LISTADO) |
|---|---|---|
| Regla usada | **genérica** `allied_branch_id IS NULL` (`LenderDatacreditoRulesRepository.php:24-26`) | **por sucursal** `allied_branch_id = userRequest.allied_branch_id` (`RiskCentralValidationService.php:26-29`) |
| Score | `score >= rule.score` o (`allow_0_score && score===0`) → pasa (`:80`) | `score < rule.score` → **quita** (`:42`) |
| Negativos | `negativeHistoricalLast12Months > rule.negative_historical_last_12_months` → reject (`:85`) | `additional_info.negativeAccounts.total > rule.current_dues` → quita (`:46`) — **otra métrica, otra columna** |
| Consultas | `consultedLast6Months > rule.consulted_last_6_months` → reject (`:89`) | (no usa) |
| Maturación | `months < rule.time_finance_sector` → reject (`<` **estricto**, `:94`) | `months <= rule.time_finance_sector` → quita (`<=`, **off-by-one**, `:56`) |
| Sin regla | **skip → pass** (`:26-33`) → gatea la CATEGORÍA | `lenderDatacreditoRule` vacío → NO remueve (`:40`) |
| Sin dato bureau | **fail-closed**: reject `no_datacredito_data`/`datacredito_data_incomplete` (`:36,:48`) | usa `(int)score` directo |
| Bypass | `CE && lender 84` → passed (`:21`) | — |
| Invocado desde | `CreditopXQuotaController` (`:28,40`) | `ProfilingRulesService::applyProfilingAndRiskCentralRules:43`, sólo si allied ∈ `DatacreditoFrequency` Y existe Experian-Acierta `score!=null` (`ProfilingRulesService.php:32-44`) |

**Asimetría clave**: "sin regla" = pass (skip), pero "con regla y sin datos" = reject (fail-closed). Y `score=0` en la regla genérica **no apaga el gate completo** — sólo apaga el chequeo de score; sigue gateando negativos/consultas/maturación.

> **Aclaración de rol en el LISTADO (corrección C1):** lo que el motor LEGACY "quita" en el listado **NO se borra de la lista** — va a `false_lenders` y al final `array_merge`+`usort` lo manda al **fondo** ("Prob muy baja", sigue visible; `RiskCentralValidationService.php:101-107`). El ÚNICO filtro de datacrédito que **EXCLUYE de verdad** es el motor NUEVO en el **CUPO** (rt=2, vía categoría → `has_quota=false`). Además, ese gate del listado se **saltea** si el lender ya cayó por group rules (`:39`). O sea: en el listado, datacrédito (legacy) y group rules **reordenan**; el corte duro real es el cupo (rt=2) o la decisión externa (rt=1).

### 2.3 Categoría (capa 3) — tier más laxo admite, primer tier que pasa da el cupo

`getLenderUserCategory` (`LenderUserCategoryService.php`, Loans):
- Ordena los tiers por `lender_users_category_id ASC` (`:79`) y devuelve el **PRIMER tier que pasa** (`foreach`+`return`, `:105`). NO ordena por `min_score` ni `priority` (=1 en todas).
- `evaluateEligibility` arma un AND de criterios con early-exit (`:425,472,481`): ocupación (`field 29`) / edad (`users.age ∈ [min_age,max_age]`) / `min_income` (`salary>=`, salary = agildata > mareigua > EAV87) / género / `employment_continuity` → luego exige `$user->datacredito` (`:429`) → sub-checks de bureau (neg12, mora, score, maturación, TC, consultas, capacidad). Basta UN criterio en `false` para descartar ESE tier; se pasa al siguiente.
- **FAIL-CLOSED por dato ausente** (a diferencia de group rules): `neg12` ausente → false (`:440`), `score` ausente → false (`:460`), `maturationSince` null → false (`:454`), `min_credit_cards>0` sin `data['creditCard']` → false (`:567`). Por eso un sintético DEBE inyectar la fila Experian completa.
- **Consecuencia**: el tier MÁS LAXO (menor `min_score`) decide la ADMISIÓN; pero como gana el de **menor `lender_users_category_id`** (que suele ser el 700/Empleado más estricto), las **condiciones económicas** (max_amount/min_initial_fee) salen del primer tier que matchee, no del laxo.
- **Guard anti-scoring-fallback** (`CreditopXQuotaController.php:325`): si la categoría vino del fallback por scoring y el lender tiene `cat_rules>0` pero ninguno pasó, se rechaza `'scoring_policy_fallback_blocked'`. → Aprobar por scoring tras fallar todas las reglas NO da cupo.

### 2.4 Diagrama — qué gate aplica según rt

```
                 ┌─────────────────────────────────────────────┐
                 │ lenders_by_allied_branches (COBERTURA, dura) │
                 └───────────────────────┬─────────────────────┘
                                         │
                    ┌────────────────────┴───────────────────┐
                    │ GROUP RULES (sucursal): AND-en, OR-entre │
                    └────────┬───────────────────────┬────────┘
                  rt != 2    │                        │   rt == 2 + have_ctopx
            (FILTRO DURO)    │                        │   (CLASIFICA, no excluye)
                             ▼                        ▼
       ┌──────────────────────────────┐   ┌────────────────────────────────┐
       │ DATACRÉDITO LISTADO (LEGACY)  │   │   CUPO  CreditopXQuotaController │
       │ sólo si allied ∈              │   │ ActiveCredit → LenderRule →      │
       │ DatacreditoFrequency:         │   │ DATACRÉDITO genérico (NUEVO) →   │
       │ score< / neg.total> / mat<=   │   │ CATEGORÍA (tiers) → granting     │
       └──────────────┬───────────────┘   └────────────────┬───────────────┘
                      │                                     │
                 'Prob muy baja'                    has_quota=false si
                 (sigue visible)                  categoría == null → unset
```

---

## 3. VISTA POR LENDER — tabla maestra

Columnas: **dc-gen** = score de la regla datacrédito GENÉRICA (dump §2; "—" = sin fila → NUEVO motor skip→pass); **dc-suc** = rango de score por sucursal (dump §3, `min..max`); **cat** = nº de tiers (dump §1 `cat_rules`) y **piso** = `min_score` del tier más laxo (dump §4); **allieds** = comercios que lo ofrecen (dump §1). Marca ⚡ = **rt=2 armable** por categoría.

### 3.1 rt=0 — banca/cooperativas tradicionales (no inyectables por decisión, pero el listado SÍ gatea por datacrédito si el allied está en frequencies)

| id | lender | dc-gen | dc-suc (min..max) | allieds | Notas |
|---|---|---|---|---|---|
| 5 | Banco de Bogotá | 640 | **640..725** (812 br) | 122 | dc-suc VARÍA por branch; falla → `'0% de probabilidad'` sort 15 |
| 6 | Credifamilia-addi | **0** | **0..560** (1068 br) | 136 | gate de score APAGADO en genérica; mayor cobertura del dataset |
| 7 | Sufi | 630 | 630 (120 br) | 14 | uniforme |
| 8 | Bancolombia | **0** | 0 (393 br) | 79 | rt=1 en realidad (dump §1 marca rt=1) |
| 9 | Sistecrédito | 550 | **500..550** (847 br) | 115 | rt=1 |
| 11 | Su+pay | 600 | 600 (111 br) | 31 | rt=1 |
| 17 | PayJoy | 580 | 580 (38 br) | 9 | tfs=3 |
| 22 | Servicrédito | 620 | **580..620** | 9 | |
| 23 | Welli | 600 | 600 (240 br) | 54 | rt=1; **excluido** por array estático (§4.6) |
| 24 | **Credifamilia** | **710** | 710 (135 br) tfs=12 | 16 | **rt=4 SOAP**; gate MÁS ESTRICTO del dataset |
| 28 | Sufi odontología | 630 | 630 (83 br) | 1 | |
| 30 | Ban100 | 600 | 600 | 2 | |
| 39 | Meddipay | 550 | 550 (328 br) | 23 | rt=1 |
| 68 | Bancolombia CyP | 494 | 494 (997 br) | 109 | rt=1; mayor cobertura por sucursal |
| 100 | Bancolombia Consumo | — | 640 (463 br) | 78 | rt=1; sin genérica |
| 5/135/136/137 | BdB / UMA | varios | varios | 1 c/u | falla group rules → `'0% de probabilidad'` |

**Clusters de score en las genéricas** (dump §2, 107 filas): **0** (gate de score apagado) = lenders 6,8,18,19,21,32,35,36,41,44,62,84,96,118,128,139; **550** = 9,33,39; **580** = 17,31,42,43,45,49,50,51,55,59,66 (todos tfs=3, neg≤1, cons≤10); **600** = 11,23,30,63,75,99,103,104,107,108,114,120,121,130,131; **620** = 22,40; **630** = 7,28; **640** = 5; **650** = 147; **710** = 24 (el más alto, tfs=12). Banda "consumo CreditopX" (escala falsa baja): **400** = 46,64,77,87,88,89,90,91,92,94,98,101,102,105,109-112,116,117,129,138,148,150; **494** = 68,82,83; **500** = decenas (56,58,65,69,70,73,76,78,79,80,85,86,95,119,124,125,126,127,132,134,140,145,146); 106=1; 71=100.

### 3.2 rt=1 — integración externa (decisión de API; NO inyectable por BD)

Cobertura ANCHA. La capa de regla local sólo afecta el LISTADO (si allied ∈ frequencies) y la **probabilidad**. Veredicto = API: Sistecrédito `status=='Approved'`, BNPL `data.validate`, Consumo `validate=='Success'`, Welli `monto_maximo_credito>=180000`, Meddipay `result!='DEN'`, Prami `maxApprovedAmount>0`, BdB `IsViable`. **Welli (23/141/142) y Prami (12) ni llegan** al listado v1 (exclusión §4.6).

### 3.3 rt=2 / rt=3 — CreditopX armable (⚡ inyectable; piso = tier más laxo, dump §4)

Estos son **marca-blanca**: casi todos `allieds_ofrecen=1`. Gate DURO real = **categoría** (con datacrédito genérico como gate secundario si hay fila). El "piso" es el `min_score` del tier más laxo; `IEP` = Independiente|Empleado|Pensionado.

| id | lender | tiers | piso (tier laxo) | dc-gen | Notas de gate mínimo |
|---|---|---|---|---|---|
| 37 | Creditop X | 4 | **400** (cat3: IEP, neg≤3, mora≤1) | — | tiers 700/600/500/400 |
| 46 | Mediarte X | 3 | **400** (cat17, +Desempleado) | 400 | |
| 54 | Mediarte X Tunja | 1 | **0** (cat83 neg≤1000 mora≤10000) | — | pasa-todo de bureau |
| 60 | MonteX | 1 | **500** (cat110) | — | |
| 61 | Mega X | 1 | **600** (cat109) | 500 | |
| 62 | Motai X | 4 | **0** (cat47 pasa-todo) | **0** | piso efectivo 0 · ⚠️ negocio menciona un "Motai X" como el **único** producto donde CreditOp prestaba **capital propio** (ya retirado); no verificado que sea este lender 62 (aquí `rt=4`, no `rt=2`). Ver [CREDITOP.md §1](../CREDITOP.md) |
| 63 | DHI X | 2 | **600** (cat33) | 600 | |
| 64 | Rogans X | 3 | **400** (cat10) | 400 | |
| 70 | CrediFis X | 1 | **500** (cat29, NO exige TC tcv0) | 500 | |
| 75 | Tu colchón financiero | 1 | **600** (cat11) | 600 | |
| **77** | **CrediPullman** | 3 | **400** (cat14: edad **0-78**, neg≤3, mora≤1, cons≤1000) | **400** | edad cupo ≤78 (vs 69 del group rule) |
| 81 | Odonto credit | 1 | **500** (cat18, neg≤100 mora≤1) | — | |
| 84 | Magnocréditos | 1 + bypass | **0** (cat21) | **0** | `CE && 84` → categoría fija 22 |
| 87 | Compucredit | 3 | **400** (cat25) | 400 | |
| 88 | Cellshopping consumo | 3 | **400** (cat32) | 400 | |
| 90 | JP Credit (**rt=3**) | 3 | **400** (cat28) | 400 | rt=3 también usa categoría |
| 92 | Riex credit | 3 | **400** (cat46) | 400 | |
| 94 | Mediarte x 0% | 3 | **400** (cat36, +Desempleado) | 400 | |
| 95 | Audivel X | 1 | **500** (cat40) | 500 | |
| 96 | Celupresto | 5 | **-1** (cat95 neg≤1000 mora≤1000) | **0** | el MÁS laxo de todo el dump |
| 97 | Flexxi X | 3 | **400** (cat43) | — | |
| 98 | Cellshopping 0% | 3 | **400** (cat58) | 400 | |
| 99 | Otoacustic X | 1 | **600** (cat48) | 600 | |
| 101 | Dentalpay Consumo | 3 | **400** (cat55) | 400 | |
| 103 | Alpeluche Consumo | 1 | **600** (cat52) | 600 | |
| 105 | Smilebox X | 3 | **400** (cat51) | 400 | |
| 111 | Mediarte Tunja 0% | 1 | **0** (cat84 pasa-todo) | 400 | |
| 112 | Arcalú Consumo | 3 | **400** (cat69) | 400 | |
| 114 | Bioceutica X | 2 | **500** (cat74) | 600 | |
| 116 | OftaCredit | 3 | **500** (cat72) | 400 | |
| 119 | Vero credit 0% | 1 | **500** (cat76) | 500 | |
| 120 | Hilow Pay | 1 | **600** (cat75) | 600 | |
| 121 | Supermercar Consumo | 1 | **600** (cat77, edad **18-69**) | 600 | edad acotada en el cupo |
| 124 | CrediFis 0% | 1 | **500** (cat78, edad **18-69**) | 500 | |
| 125 | Medipast 0% | 1 | **500** (cat82) | 500 | |
| 126 | Clínica Jenner X | 1 | **500** (cat89) | 500 | |
| 127 | Adventure Family Tours X | 1 | **500** (cat90) | 500 | |
| 128 | Magnocréditos quincenal | 1 | **0** (cat85 pasa-todo) | **0** | |
| 129 | Cellshopping quincenal 0% | 3 | **400** (cat88) | 400 | |
| 130 | Casa Spettacolare X | 1 | **600** (cat91) | 600 | |
| 132 | BICICLETAS STRONGMAN X | 1 | **500** (cat92) | 500 | |
| 138 | CeluStore X | 3 | **400** (cat100) | 400 | |
| 139 | DENTIX FINANCIAL SERVICES | 2 | **0** (cat115, edad **22-100**, pasa-todo de score) | **0** | + special granting DFS (`CreditopXQuotaController:351-379`) |
| 145 | CREDITO RENOVA | 3 | **500** (cat106) | 500 | |
| 146 | CREDI TRACK | 3 | **500** (cat109) | 500 | |
| 148 | Rogans X 0% | 3 | **400** (cat113, NO exige TC) | 400 | |
| 150 | Credi Idioma | 1 | **500** (cat114) | 400 | |

**rt=2 SIN `cat_rules` (=0)** → no se sellan por categoría vía tiers; caen a scoring-policy o devuelven null (entonces `unset` del listado): 38 GoDentist, 48 UOF, 56 MedVilla, 58 Osani, 65 Medipast, 66 Dental Force, 67 KeepSmiling, 69 GOI CARE, 73 Pista, 76 CIED, 78 Oral credit, 79 Transplant, 80 Vero, 82 Medycare, 83 DHI Bogotá, 85 Wizz, 86 Royal, 106 Bold, 107 Asistectire, 109 Colchoexpress, 131 VITAL PREVENT, 134 CORESDENT, 143/144 Medicapilar, 151 Credicesar, 152 smartpay, 158 Motai Renting. Para armarlos hay que volcar `lender_user_category_scoring_policy_rules` (no en el dump).

### 3.4 Casos especiales por lender

- **Credifamilia DOS IDs con perfil OPUESTO** (dump §2/§3): id **6** "Credifamilia-addi" (rt=0) = genérica score **0** (gate apagado) + 1068 reglas por sucursal `0..560`; id **24** "Credifamilia" (rt=4) = genérica **710**/tfs=12 + 135 reglas TODAS 710 uniforme. ¿Productos distintos o legacy duplicado? (pregunta abierta).
- **CrediPullman #77**: tiene dc-gen=400 (dump §2:207) Y 111 reglas por sucursal score 400 (dump §3:334). En el cupo rt=2 el NUEVO motor lee SÓLO la genérica (allied_branch_id NULL); las por-sucursal quedan inertes salvo que pasara por el listado legacy. El score 400 es tan laxo que en la práctica un sintético `>=400` siempre pasa el gate datacrédito → la **categoría** es el corte efectivo. (Esto corrige la lectura de MEMORY/§5 del doc previo que decía "no hay fila para 77 → skip→pass": SÍ hay fila, pero es inocua.)
- **`cat 540`** (dump §4:509-511, tiers 79/80/81): NO mapea a ningún lender vivo de §1 → category_rules huérfanas; no afectan ningún CreditopX armable.

---

## 4. VISTA POR COMERCIO — allieds con reglas propias

Lo que VARÍA por comercio son los **group rules** (capa 1, dump §6) y la presencia en **`DatacreditoFrequency`** (capa 4, dump §8). El resto (datacrédito por lender, categoría) es por-lender, no por-comercio.

### 4.1 Variación del umbral de ingreso (`field 87`) por comercio

| Perfil | Allieds (ejemplos, dump §6) | Ingreso exigido |
|---|---|---|
| **Estricto sin escape** (sólo piso alto) | 36 Anclu, 209 Alkosto, 210 K-TRONIX, 211 Alkomprar, 40 Comunicación móvil, 83 Ferretería El Jordán, 208 Bioceutica | SÓLO `>=1.300.000` (sin variante `>=0`) |
| **Premium dental/estética** (tier 1.85M) | 26 Sonría, 85/87/88/89 Élite Dental, 97 Odonto Express, 101 Dentolaser, 117 Medicredit, 120 Ríe, 123 Dentisalud, 150 Virgilio Galvis | incluye `>=1.850.000` además de `>=0`/`>=1.300.000` |
| **Heterogéneo** (los 4 umbrales coexisten) | 24 Creditop, 47 La Tienda de Alex | `>=0`, `>=1.000.000`, `>=1.300.000`, `>=1.850.000` |
| **Laxo total** (sin piso) | 34 Prodens, 35 Nidos de Amor, 51 Brokers, 60/61/62 (COI/American School), 90 Daragro, 102/104/106/108/116/133/136/137/138 | SÓLO `>=0` (reportado `no\|si`, edad 18-68) |
| **Ultra-alto** (motos premium) | 225 Triumph | `>=1.300.000`…`>=3.600.000` (umbral más alto del dataset) |

### 4.2 Comercios clave (con su perfil completo)

| allied | nombre | group_rules | ingreso | edad | reportado | freq? | have_ctopx? | Notas |
|---|---|---|---|---|---|---|---|---|
| **94** | Amoblando Pullman (CrediPullman #77) | 868 | `>=0,>=1M,>=1.3M` | `<=68/69/74/82`, `>=18/21` | `no`/`no\|si` | **SÍ** (`every=1`) | NO en §9 | rt=2+have_ctopx → group rules CLASIFICAN; gate duro = categoría #77 (piso 400, edad cupo ≤78) |
| **24** | Creditop | 77 | los **4** umbrales | `<=68..<=100`, `>=0..>=21` | `no`/`no\|`/`no\|si`/`si\|no` | NO | NO | la sucursal más heterogénea |
| **36** | Anclu | 78 | SÓLO `>=1.3M` | `<=74`, `>=21` | SÓLO `no` | NO | NO | de los más estrictos, sin escape |
| 26 | Sonría | 1078 | `>=0,>=1.3M,>=1.85M` | varias hasta `<=85`, `>=35` | `no`/`no\|`/`no\|si` | **SÍ** (`every=1000000`) | NO | premium dental |
| 209/210/211 | Alkosto/K-TRONIX/Alkomprar | 46/48/134 | SÓLO `>=1.3M` | `<=69/74`, `>=18/21` | SÓLO `no` | NO | NO | retail grande estricto homogéneo |
| 225 | Triumph | 10 | `>=1.3M…>=3.6M` | `<=69/74`, `>=18/23` | `no`/`no\|si`/`si\|no` | NO | NO | pisos de millones |
| **99** | Colchones Soñaty | 7 | `>=0,>=1.3M` | `<=68/69`, `>=18` | `no`/`no\|si` | NO | **SÍ (§9)** | tiene have_ctopx |
| **149** | Mediarte Tunja | 5 | `>=0,>=1.3M` | `<=68/69/74`, `>=18` | NO | **SÍ (§9)** | tiene have_ctopx (lenders 54/111) |
| 270 | CeluRD Test | 8 | `>=0` (edad NULL) | NULL | NULL | NO | **SÍ (§9)** | test |
| 271 | Tuboleta | — | — | — | — | NO | **SÍ (§9)** | no aparece en §6 |
| 158 | Motai | 25 | `>=0,>=1.3M` | `<=68/69/100`, `>=18` | `no`/`no\|si` | NO | NO | único allied con `allied_modes` (§7) |

### 4.3 Sucursales sin molde poblado (NULL en §6)

Allieds con `n_group_rules>=1` pero ingreso/edad/reportado en NULL: **39,45,49,50,52,54,55,56,57,58,59,72,75,78,82,194,266,276**. Tienen group rules de OTRO tipo (no el molde canónico de 6) → no filtran por ingreso/edad/reportado. Para el harness, esas sucursales NO aplican gate de ingreso.

### 4.4 Modos por comercio (capa 4) — corrige el doc previo

Las ÚNICAS filas de `allied_modes` (dump §7) son las **3 de Motai (allied 158)**, con config `{"isAbacoRequired": false|true}`, **SIN clave `lenders`**. Verificado en `AlliedModeLenderFilterService.php:33-36`: lee `config['lenders'] ?? null`; si no es array no-vacío, **retorna la lista de lenders SIN tocar** → el modo NO filtra lenders. El flag `isAbacoRequired` se consume sólo en `MotaiValidationService.php:110-189` (responseCode MOTV1001 vs MOTV1000: decide si el flujo pide datos de ingreso Abaco). **El doc previo (§4.8) describe correctamente el código del intersect pero induce a creer que el modo filtra lenders — con la data actual es NO-OP de visibilidad.**

### 4.5 Frecuencia datacrédito (capa 4) — el interruptor del gate del LISTADO

`DatacreditoFrequency` (dump §8, **40 allieds**) es el INTERRUPTOR del gate datacrédito legacy en el LISTADO. Sólo si el allied está en esta tabla Y existe Experian-Acierta `score!=null` corre `RiskCentralValidationService` (`ProfilingRulesService.php:32-44`). Allieds: **97,26,38,14,73,95,94,65,85,88,89,87,24,83,92,106,67,109,53,108,112,118,119,111,113,107,41,122,123,42,43,103,99,91,131,127,133,132,134,130**. El `frequency/every` es metadata de re-consulta (1, 3, 4, 10000, 1000000, 999999999), NO un umbral. **Fuera de esta lista, el filtro de score por sucursal NO corre en el listado** — recién aparece en el cupo (rt=2 vía genérica) o en la pre-aprobación externa (rt=1).

### 4.6 Exclusión estática (capa 4)

`LenderRetrievalService.php:248-256`: `$excludedPreApproveLenderIds = [12, 23, 141, 142, 166]` → `array_filter` los saca ANTES de `validatePreApproveLender` (`:259`). Cubre **Prami (12), Welli (23/141/142)** y lender/allied 166. TODO temporal por falta de paridad en el flujo nuevo. En v1 estos NO llegan al listado (no es que la pre-aprobación los rechace).

---

## 5. Universo de condiciones (valores distintos + frecuencia, dump §5)

### `field_29` ocupación (op `=`, pipe-OR)
| valor | n |
|---|---|
| `Independiente\|Empleado\|Pensionado` | 6679 |
| `Empleado\|Pensionado\|Independiente` | 386 |
| `Empleado\|Pensionado` | 155 |
| `Independiente\|` | 139 |
| `Independiente` | 92 |
| `Pensionado` | 80 |
| `Empleado\|Pensionado\|Independiente\|Desempleado` | 33 |
| `Empleado` | 4 |
| (otros con Desempleado / permutaciones) | ≤2 |

### `field_87` ingreso mensual (op `>=`)
| umbral | n |
|---|---|
| **1.300.000** (default de facto) | 3398 |
| **0** (sin piso) | 2069 |
| **1.850.000** (premium) | 318 |
| **1.000.000** | 144 |
| 1.400.000 | 84 |
| 3.600.000 / 2.140.000 | 4 c/u |
| 3.000.000 / 3.500.000 / 3.550.000 | ≤2 |

### `field_160` reportado en centrales (op `=`)
| valor | n | efecto |
|---|---|---|
| `no` | 3053 | exige NO reportado (filtra de verdad) |
| `no\|si` | 2525 | acepta ambos = **NO filtra** |
| `no\|` | 423 | no + vacío |
| `si\|no` | 16 | |
| `si` | 6 | raro, exige estar reportado |

### `field_161` continuidad/maduración laboral en MESES (op `>=`, fuera del molde canónico)
| valor | n |
|---|---|
| 12 | 5 |
| 0 / 6 | 3 c/u |
| 3 / 24 | 1 c/u |

Sólo ~13 reglas en todo el dataset; el panel estándar NO las crea (path/panel por ubicar).

### `users.age` (cols reales)
- **tope `<=`**: 68 (×2166), 74 (×1631), 69 (×1562), 70 (×352), 82 (×121), 73 (×92), 85 (×77), 72 (×37), 100 (×36), 75 (×30), 80 (×4), 99 (×2).
- **piso `>=`**: 18 (×3947), 21 (×1787), 20 (×234), 35 (×88), 19 (×30), 22 (×18), 23 (×4), 0 (×2).

### `users.gender` (op `=`)
`M|F` (×5490) y `F|M` (×441) = acepta cualquiera (no filtra); `F|` (×90), `M` (×88, sólo hombres), `F` (×1). En la práctica casi nunca filtra por género.

**Categoría (dump §4) — dimensiones que NO salen en §5/§6**: la columna `min_income`/`monthly_income` del tier NO está volcada aunque `evaluateEligibility` la gatea como filtro duro (`:416`). Hay que volcarla aparte (`SELECT lender_id, lender_users_category_id, monthly_income FROM lender_users_category_rules`).

---

## 6. Implicancias para el harness — fabricar usuario que apruebe en lender L, comercio C

### 6.1 Receta por response_type

**Si L es rt=2/rt=3 (CreditopX — inyectable 100%):**
1. **Identidad/demografía**: `users.age` dentro del `[min_age,max_age]` del **tier de categoría** que querés que matchee (OJO: el cupo corta por la categoría, p.ej. CrediPullman ≤78, Supermercar/CrediFis 18-69, DENTIX 22-100), `users.gender` permitido (`M|F` casi siempre). `users.age` es columna real, setear explícito.
2. **Ingreso/ocupación**: EAV `field_29` = `'Empleado'` (o `'Independiente'`/`'Pensionado'`, según ocupación del tier), EAV `field_87 >= umbral` del group rule, y `user_summaries.agildata.approximate_real_salary` ALTO (pisa al EAV 87 vía `getSalary` agildata>mareigua>EAV87) — debe superar el `min_income` del tier.
3. **Reportado**: EAV `field_160 = 'no'` (para sucursales que exigen `no`; con `no|si` es indiferente).
4. **Datacrédito (capa 2 + capa 3)**: inyectar la fila Experian **encriptada** (`risk_central_user_data`, central `'Experian - Acierta'`/`'Acierta+Quanto'`) con: `score` ≥ max(`dc-gen` del lender, `min_score` del tier laxo); `agregatedInfo.overview.principals.negativeHistoricalLast12Months` ≤ umbral; `consultedLast6Months` ≤ umbral; `maturationSince` viejo (cumple `>=` del NUEVO motor); vector TC válido si el tier exige `min_credit_cards>0`+`tcv1`. **Sin esta fila, todo tier que llegue al bloque datacrédito (`:429`) rechaza** aunque ocupación/edad/ingreso sean perfectos.
5. **Verificar el path real**: el group rule de ingreso/edad para rt=2+have_ctopx CLASIFICA, no excluye → no es el corte. El corte es la categoría.

**Si L es rt=1 (Bancolombia/Welli/Sistecrédito/Meddipay/Prami/BdB) o rt=4 (Credifamilia SOAP):** la BD **NO controla la decisión** — sólo afecta listado/probabilidad. Hay que **mockear la API** (`fakeExternalLendersForLocal`/`fakeBancolombiaForLocal`). Welli/Prami además están **excluidos** del listado v1 (§4.6) → hay que sortear el array estático.

### 6.2 Qué setear según el lender elegido (atajo)

| Quiero aprobar | Setear mínimo |
|---|---|
| CrediPullman #77 (Amoblando Pullman) | `age∈[?,78]`, EAV 29='Empleado'/IEP, 87>=1.3M (clasifica), 160='no', Experian score≥400 + neg≤3 + mora≤1 |
| Magnocréditos #84 (venezolano) | `document_type='CE'` — bypass total, NI requiere Experian (`DatacreditoRuleEvaluator.php:21`) |
| Celupresto #96 | tier cat95 piso **-1** (neg≤1000 mora≤1000) → casi cualquier Experian presente pasa; gate real = ocupación/edad/ingreso |
| DENTIX #139 | tier cat115 edad 22-100 pasa-todo de score; + special granting DFS |
| Cualquier CreditopX "pasa-todo de bureau" (54/111/128/62/84) | el bureau NO gatea; gate real = ocupación/edad/género/`min_income` |

### 6.3 Qué NO controla la decisión

- El **modo** del comercio (Motai) NO filtra lenders (§4.4) — gobierna Abaco, no visibilidad.
- El **`frequency/every`** de `DatacreditoFrequency` es metadata de caché, no umbral.
- El group rule de ingreso/edad para **rt=2+have_ctopx** no excluye (clasifica).
- En reglas con `current_dues=100000` o `neg/mora/cons=1000/10000/100000`, ese chequeo está **efectivamente apagado** (el valor del usuario nunca lo supera).
- `consulted_last_6_months` se **skipea si el umbral del tier es ≥100** (`validateConsultedLast6Months:607`) → consultas sólo gatean donde `cons6<100` (p.ej. CrediPullman cat12 `<=20`, cat13 `<=10`).

---

## 7. Gotchas / fragilidades y preguntas abiertas

### 7.1 Gotchas confirmados

- **Operadores INVERTIDOS entre los dos motores de datacrédito**: NUEVO `score>=` (`:80`) vs LEGACY `score<→remove` (`:42`); maturación NUEVO `<` estricto (`:94`) vs LEGACY `<=` off-by-one (`:56`). **Inyectar pensando en uno puede no satisfacer al otro.**
- **Campo de negativos distinto**: NUEVO usa `negativeHistoricalLast12Months` vs `negative_historical_last_12_months`; LEGACY usa `additional_info.negativeAccounts.total` vs `current_dues`. Son columnas/métricas DIFERENTES de la misma fila.
- **`score=0` en la genérica NO apaga el gate completo** — sólo el chequeo de score; sigue gateando neg/cons/maturación.
- **Fail-closed asimétrico**: NUEVO motor "sin regla" = pass (skip), "con regla y sin datos" = reject. La categoría es fail-closed SIEMPRE por dato de bureau ausente (al revés de los group rules, que sin GroupRule dejan pasar).
- **Opt-in por sucursal MIXTA**: lender NO referenciado por ninguna GroupRule en una sucursal con otras group rules → se DROPEA (no entra a return ni false). El "entran todos sin reglas" sólo vale para sucursal con CERO group rules.
- **Tier laxo admite, primer tier (menor id, suele ser el 700 estricto) da el cupo** — el `max_amount`/`min_initial_fee` salen del primer match, no del laxo.
- **`allow_0_score`**: en dump §2 está en 0 en TODAS las 107 genéricas → nadie usa esa rama hoy; además `updateDatacreditoRule` no la actualiza y no hay migración (viene de la app vieja).
- **Default de columna datacrédito sin poblar**: `score=0, current_dues=0, tfs=0, neg=1, cons=10` → una fila en default deja pasar casi todo en el NUEVO motor (salvo >1 neg histórico o >10 consultas).

### 7.2 Preguntas abiertas / a verificar

1. **Falta volcar `monthly_income` por tier** (`SELECT lender_id, lender_users_category_id, monthly_income FROM lender_users_category_rules`) — sin eso no se boundary-testea el `min_income` de la categoría, que es FILTRO DURO (`:416`).
2. **rt=2 con reglas datacrédito por sucursal** (ej. #77, 111 branches score 400): ¿quedan inertes en el cupo (sólo la genérica gatea)? Confirmar que ningún path rt=2 usa la regla por sucursal.
3. **CrediPullman #77 — contradicción con MEMORY/doc previo**: el dump SÍ muestra fila genérica 400 (§2:207); el doc decía "no hay fila → skip→pass". Resuelto aquí: hay fila pero 400 es tan laxo que un sintético `>=400` nunca rechaza → la categoría es el corte. Actualizar el doc previo §5.
4. **Credifamilia id 6 (addi, gate apagado) vs id 24 (rt=4, gate 710)**: ¿productos distintos o legacy duplicado?
5. **`lender_id 540`** (categoría) y **`cat 540`**: huérfanos, no mapean a lender vivo. ¿Borrados con reglas residuales?
6. **`have_ctopx` sólo en 4 allieds (§9, "primeras filas")** pero CrediPullman se ofrece vía allied 94 que NO aparece con have_ctopx=1: ¿está truncada §9 o el path rt=2 usa otra señal? Afecta la regla "rt=2+have_ctopx no excluye".
7. **rt=2 sin `cat_rules`** (smartpay 152, Bold 106, 65/66/67…): se sellan por scoring-policy. Falta volcar `lender_user_category_scoring_policy_rules`.
8. **v2 (`LenderListingService`)**: ¿aplica la exclusión `[12,23,141,142,166]`? (sólo se vio en v1). La memoria frontend-e2e sugiere que v2 deja pasar Welli/Prami. Bajo strangler/parallel-run, confirmar cuál corre por comercio.
9. **Catálogo `field_options`** de `field 29`/`160`: §5 muestra valores REALMENTE usados, no el set permitido. Leer `field_options` para boundary-testing.
10. **`field_161`**: confirmado `>=` meses pero no se ubicó el panel que crea esas group rules (fuera del molde canónico).

---

### Procedencia
Síntesis de 4 reportes (datacrédito por lender; categoría rt=2/3; group rules por comercio; cobertura/modos/frecuencia/exclusión) cruzados con `ONBOARDING-DATOS-DECISION-ANALISIS.md` y verificados verbatim contra `legacy-backend` el 2026-06-30. Citas dump §1-9 y `archivo:línea` a lo largo del documento.
