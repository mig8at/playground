# Trabajo: simplificar reglas + cómo se mezclan entre lenders y comercios

> **Brief autocontenido para arrancar un chat nuevo.** Objetivo: encontrar la forma correcta de
> **simplificar aún más las reglas de crédito** y definir **cómo se combinan/mezclan entre lenders y
> comercios (merchants)**, para llegar a un punto donde *uno define una regla y se evalúa fácil*.
>
> **Guardrails (no negociables):** todo es **análisis/diseño del DEBER-SER**, **documental**, sobre el
> dev REMOTO **solo lectura** (`SELECT`/`SHOW`/`information_schema`). **Cero cambios a la base de datos**,
> cero `INSERT/UPDATE/DELETE/DDL`. El modelo vive en `modelo-dominio.json` y se visualiza en
> `domain-model/` (app Vue). Las credenciales del dev rotan; pedir las vigentes.

---

## 0. Lo que ya está hecho (punto de partida)

El deber-ser ya invirtió el modelo a config-driven (ver `CREDITOP-MODELO-DATOS.md §0.1`). Para reglas,
ya existen como **diseño**:

- **`RuleDefinition`** — cláusula canónica `{field, operator, value, applies_to: lender|merchant|both}`,
  definida una vez y referenciada por bindings de lender (`lender_rules`) y merchant (`group_rules`).
- **`EvaluableField`** (catálogo de *facts*) + **`FactSourceBinding`** (de dónde sale el valor por país)
  + **`OperatorTypeRule`** (matriz operador↔tipo).
- **`RuleGroup` / `RuleGroupMember`** — reglas compuestas AND/OR anidadas.
- **`ScoringClause`** — banda de scoring por fact.

Docs de respaldo: `VALIDACION-INVERSION.md`, `AUDITORIA-REDUCCION.md`, `DISENO-EVALUABLE-FIELD.md`.

**Honestidad (verificado contra `schema-remoto.json` + backend):** las reglas data-driven **ya existen
hoy a medias** — no las inventamos. El trabajo es **ordenar + simplificar + definir la combinación**.

---

## 1. Cómo está HOY (la realidad, con referencias)

### 1.1 Tablas reales de reglas (confirmadas en `schema-remoto.json`)
| Tabla | Alcance | Forma |
|---|---|---|
| `lender_rules` | por **lender** | declarativa: `field_id, specific_table, column, operator, value, group_rule_id, status` |
| `group_rules` | por **merchant_branch** (lado comercio) | agrupador: `merchant_branch_id, rule_name` |
| `lender_users_category_rules` | por **lender + categoría** | **tipada** (20+ columnas: `occupation, min_age, max_age, monthly_income, min_score, negative_reports_last_12_months, …`) |
| `lender_datacredito_rules` | por **lender** | umbral de buró: `score, negative_historical_last_12_months, consulted_last_6_months, probability_levels(JSON)` |
| `risk_centrals` | catálogo de centrales | decisión de cuál consultar **quemada en código** |
| `fields`/`forms`/`form_types`/`field_categories`/`user_field_values` | formularios dinámicos | **bien organizado**, captura por dato |

### 1.2 El evaluador genérico EXISTE pero está contaminado con hardcode
Backend Laravel: `/Users/miguelochoa/Desktop/CREDITOP/bitbucket/application`
(rutas/líneas aproximadas — **verificar en el nuevo chat**, el código pudo cambiar):

- **`app/Services/lenders/LenderValidationService.php`**
  - **~105-111:** evaluador genérico real — `match($lender_rule->operator) { '=', '>=', '<=', '!=' }`. ✅ Esto es lo bueno.
  - **~123-162:** para `specific_table` solo soporta **`age` y `gender` hardcodeados** en un `match()`.
  - **~176-283:** rama especial si `$lender->response_type == 2` (CTOPX).
  - **~219-262:** reglas Datacrédito con **paths JSON quemados** (`data['agregatedInfo']['overview']['principals']…`).
  - **~333:** excepción quemada `document_type == "CE" && lender_id == 84` (Magnocell, venezolanos).
  - **~379-383:** probabilidades **hardcodeadas para lenders `[5, 135, 136, 137]`**.
- **`app/Services/lenders/ProfilingRulesService.php`** (scoring/profiling en PHP)
  - **~32-40:** decide central buscando **`'Experian - Acierta'` por nombre** + `DatacreditoFrequency` (qué allieds usan Datacrédito).
  - **field_id=87** quemado para "salario aproximado"; cortes **45/70/75%** quemados; nombres de buró fijos.
- **`app/Http/Controllers/.../UserRequestController.php`**
  - **~873-909:** dispatcher: lee `$lender->action` de BD pero despacha con **`switch($lender->id)`** (ej. `case 24` Credifamilia).
  - **~816-991:** ramas por `response_type` y excepcionalmente por **`$lender->name`** (~967-988).
- **`app/Actions/Lenders/`** — **~20 clases por financiador**: `Welli, Sistecredito(+Pos/Pay), Payvalida, Credifamilia, BancoDeBogota, Bancolombia(+Bnpl/ConsumerLoan), Approbe, Prami, Meddipay, Compensar, Addi, Wompi…`. Cada una con su `STATUS_MAP`/flujo.

### 1.3 Diagnóstico (qué tan data-driven está hoy)
| Pieza | Estado | % data-driven |
|---|---|---|
| Reglas elegibilidad (lender_rules) | evaluador genérico **+ hardcode mezclado** | ~50% |
| Campos dinámicos | **bien** | ~90% |
| Código por lender (Actions + switch id) | **hardcodeado** | ~30% |
| Centrales de riesgo | semi-config (quemado a 'Experian - Acierta') | ~40% |
| Scoring/profiling | PHP con números mágicos (`field_id=87`) | ~30% |
| Catálogo de facts | **no existe** | 0% |

---

## 2. A dónde queremos llegar

> **"Uno define una regla y se evalúa fácil."** Una regla = elegir un *fact* del catálogo + operador +
> valor. El motor es **uno solo y genérico**: resuelve el valor del fact (por país) y compara. Agregar/
> cambiar reglas = **filas**, no código. Sin `if lender_id==N`, sin `field_id=87`, sin clase por lender.

Ver la página `/reglas` del visualizador (demo interactivo) y `DISENO-EVALUABLE-FIELD.md`.

---

## 3. El tema CENTRAL a resolver: cómo se mezclan las reglas entre lenders y comercios

Hoy una solicitud atraviesa **varias capas de reglas a la vez**:
1. **Comercio/sucursal** (`group_rules` por `merchant_branch_id`) — qué admite el comercio.
2. **Lender** (`lender_rules`) — qué exige el financiador.
3. **Categoría** (`lender_users_category_rules`) — perfil de riesgo por segmento.
4. **Buró** (`lender_datacredito_rules`) — umbrales de central.

**Preguntas a responder en el chat nuevo (con DATOS, read-only):**

1. **Precedencia / resolución:** cuando coexisten reglas de comercio y de lender (y categoría), ¿cómo se
   combinan? ¿Es siempre AND (todas deben cumplir)? ¿Hay overrides por especificidad
   (`país < lender < merchant < sucursal`)? → validar contra `group_rules`/`lender_rules` reales.
2. **AND/OR y agrupación:** ¿`group_rule_id` en `lender_rules` ya expresa grupos? ¿Cómo se mapea a
   `RuleGroup/RuleGroupMember`? ¿Hay reglas OR hoy o todo es AND?
3. **"Definir una vez, referenciar muchas":** ¿cuánta duplicación real hay? (ej. medir cuántos lenders
   repiten "mayoría de edad"/"ocupación formal" con `SELECT value, COUNT(DISTINCT lender_id) …`).
   ¿`RuleDefinition` compartida + bindings reduce esa duplicación sin perder excepciones legítimas?
4. **Criterios tipados vs declarativos:** `lender_users_category_rules` (20+ columnas tipadas) vs
   `lender_rules` (genérica). ¿Unificar todo a `RuleDefinition`+bindings, o la capa categoría es un
   "perfil de riesgo" distinto que conviene dejar tipado? (decisión de diseño pendiente).
5. **Conflictos:** ¿qué pasa si comercio y lender se contradicen (comercio acepta, lender rechaza)?
   ¿el resultado es el outcome no-binario de `CreditDecision` (approved/rejected/counteroffer/pending)?
6. **Scope merchant como configurador:** el merchant declara qué acepta (documentos, montos, etc.) — ya
   se modeló `VerificationPolicy`/`MerchantSetting`. ¿Las reglas de admisión del comercio también van por
   `RuleDefinition applies_to=merchant`, o por `group_rules` reescrito? Definir el camino único.

**Cómo simplificar más (hipótesis a validar):**
- Un único `RuleDefinition` + bindings polimórficos `{scope_type: lender|merchant|branch|category, scope_id}`
  en vez de 3-4 tablas de reglas distintas.
- Resolución por especificidad declarada (como `VerificationPolicy` y `CountryProviderBinding`).
- `RuleGroup` para AND/OR; el resultado alimenta `CreditDecision`.
- El catálogo `EvaluableField` como único namespace de "qué se evalúa" (forms + customer + buró).

---

## 4. Queries read-only útiles para arrancar (validar la mezcla real)

```sql
-- Duplicación de reglas por lender (¿la misma condición repetida?)
SELECT name, `column`, operator, value, COUNT(DISTINCT lender_id) lenders
  FROM lender_rules WHERE status=1 GROUP BY name,`column`,operator,value ORDER BY lenders DESC LIMIT 30;
-- ¿group_rules cuelga de merchant_branch? ¿cuántas reglas por grupo?
SELECT gr.id, gr.merchant_branch_id, COUNT(lr.id) reglas
  FROM group_rules gr LEFT JOIN lender_rules lr ON lr.group_rule_id=gr.id GROUP BY gr.id ORDER BY 3 DESC LIMIT 20;
-- ¿qué operadores se usan realmente? (alcance del evaluador genérico)
SELECT operator, COUNT(*) FROM lender_rules GROUP BY operator;
-- ¿specific_table además de age/gender? (qué más toca el hardcode)
SELECT specific_table, `column`, COUNT(*) FROM lender_rules WHERE specific_table IS NOT NULL GROUP BY 1,2;
-- categorías: ¿qué columnas-criterio están realmente pobladas?
SHOW COLUMNS FROM lender_users_category_rules;
```

---

## 5. Artefactos de referencia (en `docs/`)
- `CREDITOP-MODELO-DATOS.md` — doc maestro (negocio + what-is + deber-ser + §0.1 cambios).
- `modelo-dominio.json` — el deber-ser (fuente del visualizador). Entidades clave: `RuleDefinition`,
  `EvaluableField`, `FactSourceBinding`, `RuleGroup`, `ScoringClause`, `CreditPolicy`, `CreditDecision`.
- `DISENO-EVALUABLE-FIELD.md` — diseño del catálogo de facts.
- `VALIDACION-INVERSION.md` — dónde el modelo aún se adapta al actor vs lo invierte.
- `AUDITORIA-REDUCCION.md` — qué se puede reducir/colapsar.
- `schema-remoto.json` — dump físico real (verificar columnas acá).
- `schema-remoto-logic.md` — las 26 vistas + 42 rutinas SQL (el motor de scoring legacy).
- `domain-model/` — visualizador del modelo/ERD (deber-ser). `simulador-filtros/` — simulador de filtros comercio×lender.
- Backend real (solo lectura): `/Users/miguelochoa/Desktop/CREDITOP/bitbucket/application`.

---

## 6. Entregable esperado del chat nuevo
1. **Modelo de combinación de reglas** lender↔merchant↔categoría definido (precedencia, AND/OR, conflictos).
2. **Decisión:** unificar a `RuleDefinition`+bindings polimórficos o mantener capas. Con datos que lo respalden.
3. **Propuesta de simplificación** aplicada al deber-ser (`modelo-dominio.json`, documental), preservando `legacy`.
4. Actualizar la página `/reglas` si el modelo de combinación cambia.
5. Mantener la **honestidad**: marcar qué ya existe vs qué se agrega.
