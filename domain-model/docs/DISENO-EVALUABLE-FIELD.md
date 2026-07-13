# EvaluableField — diseño recomendado para reglas dinámicas

## Comparación de los 4 enfoques

| Enfoque | Fortaleza | Debilidad | Qué tomar |
|---|---|---|---|
| **1. Agregado-catálogo de Decisioning** (EvaluableField + FactSourceBinding, source-discriminator) | Modela el fact como **aggregate root de un contexto transversal Decisioning** con identidad y ciclo de vida; binding por país con fallback; argumentación anti-EAV sólida (proyecciones indexadas). | `FactSourceBinding` con 4 campos opcionales mutuamente excluyentes (muchos NULL sin CHECK); deja COMPUTED como slug quemado sin estructura; no resuelve reglas compuestas AND/OR. | El **source-discriminator** en el fact, el **binding por país con especificidad**, la ubicación en contexto **Decisioning transversal**, y el **CHECK por source**. |
| **2. Feature Store** (EvaluableField + FieldSourceBinding + FeatureTransform + FeatureDependency + FeatureValueSnapshot) | El más completo en **derivados/computados**: fórmula declarativa versionada, grafo de dependencias (DAG), TTL de frescura, snapshot tipado por familia para reproducibilidad y serving a volumen. | Sobre-ingeniería para el estado actual (42 funciones SQL legacy); FeatureValueSnapshot puede degenerar en algo EAV-en-disco si se diseña mal; parser de expresiones es trabajo real y riesgoso (capacidad de pago es regulatoria). | **FeatureTransform** (computados como dato con `transform_kind` incl. `sql_routine` como puente), **FeatureDependency** (DAG + orden topológico), **freshness_ttl**, **is_pii**, y el **snapshot tipado opcional por columnas (value_number/value_string/value_date)** para reproducibilidad. |
| **3. BRMS con reglas compuestas** (EvaluableField + FactSourceBinding + RuleDefinition recableada + ScoringClause + RuleGroup/RuleGroupMember + matriz operator↔value_type) | Único que resuelve **reglas compuestas AND/OR anidadas** como pura data, y la **matriz operator↔value_type** + `enum_catalog` + `cardinality`; `priority` y `on_missing` en el binding (espejo de `on_fail`). | Mete `semantic_role` redundante en el fact Y en el binding; el árbol RuleGroup necesita editor visual o es inoperable para back-office. | **RuleGroup/RuleGroupMember**, la **matriz operator↔value_type**, `on_missing` en el binding, `enum_catalog`/`cardinality`, y la **separación ScoringClause** (banda por fila colgando de un fact). |
| **4. Migración pragmática** (EvaluableField + EvaluableFieldSource, FK incremental nullable, legacy preservado) | El **camino de migración** más realista: FK nullable + backfill + **tabla de alias legacy→code**, espejo explícito de `CountryProviderBinding`, `bureau_provider_kind` como **capability** (no proveedor), retiro datado del string. | Mínimo en computados/versionado; backfill manual es el punto frágil reconocido. | Toda la **estrategia de migración** (FK nullable, alias, reporte de cobertura, fecha de retiro), `bureau_provider_kind`=**capability** delegando en CountryProviderBinding, y el principio "**distinto significado = fact distinto; misma semántica, distinta fuente = binding**". |

## Diseño recomendado

Núcleo del enfoque 1/3 (catálogo tipado + binding por país por especificidad), columna de derivados/versionado del enfoque 2 (sin sobre-construir el snapshot), reglas compuestas y matriz de tipos del enfoque 3, y plan de migración del enfoque 4. El registro vive en un **contexto transversal `decisioning`** (no dentro de `credit`).

### Entidades nuevas

#### `EvaluableField` — raíz del registro de facts (el "qué se puede evaluar")

| Nombre | Tipo | Nota |
|---|---|---|
| `id` | bigint unsigned PK | identidad del fact |
| `code` | varchar(80) UNIQUE | clave canónica estable: `monthly_income`, `age_years`, `formal_occupation`, `bureau_score`, `national_id`, `payment_capacity`. Destino de las 4 FK. UNIQUE = indexable. |
| `name` | varchar(160) | etiqueta legible para back-office |
| `value_type` | enum('number','integer','money','percent','date','bool','string','enum','list') | TIPO FUERTE del fact. Gobierna casteo y operadores legales. Fuente única del tipo (las reglas ya **no** lo redeclaran). |
| `cardinality` | enum('scalar','list') | valor único vs colección |
| `source_kind` | enum('form_input','customer_attribute','bureau_derived','computed','constant') | clase de origen conceptual; el binding por país lo refina. Corazón del diseño. |
| `unit` | varchar(24) NULL | COP, months, years, points, percent; el casteo a Money la usa con `Country.currency` |
| `enum_catalog` | varchar(80) NULL | si `value_type=enum`, nombre del catálogo de valores válidos (OccupationType, Gender) para validar el RHS de las reglas |
| `domain` | enum('customer','credit','identity','geography') | gobernanza/agrupación; no afecta resolución |
| `freshness_ttl_seconds` | int NULL | frescura máxima aceptable (buró con TTL fuerza reconsulta; form_input no caduca). NULL = no caduca |
| `is_pii` | tinyint(1) | enmascarado/logging para KYC |
| `status` | tinyint(1) | vigencia; soft-disable sin romper bindings. Nunca delete. |

#### `FactSourceBinding` — de DÓNDE sale el valor, por país (el "cómo")

| Nombre | Tipo | Nota |
|---|---|---|
| `id` | bigint unsigned PK | identidad del binding |
| `evaluable_field_id` | bigint unsigned FK→EvaluableField | fact que resuelve |
| `country_id` | bigint unsigned NULL | país de aplicación; NULL = binding base/fallback. Especificidad país>base (espejo de VerificationPolicy/CountryProviderBinding) |
| `lender_id` | bigint unsigned NULL | override por lender; NULL = todos |
| `resolver_kind` | enum('form_field','customer_column','bureau_mapping','domain_function','constant') | mecanismo concreto de obtención |
| `form_field_semantic_role` | varchar(40) NULL | si `form_field`: rol semántico del FormField que aporta el valor (no field_id físico) |
| `customer_attribute_path` | varchar(120) NULL | si `customer_column`: atributo tipado canónico de Customer (`birth_date`, `gender`, `country_id`) |
| `bureau_provider_kind` | varchar(40) NULL | si `bureau_mapping`: la **capability** (no proveedor); delega en CountryProviderBinding para el proveedor real y en BureauFieldMapping para el json_path |
| `transform_id` | bigint unsigned NULL FK→FeatureTransform | si `domain_function`/computado: fórmula registrada |
| `const_value` | varchar(255) NULL | si `constant`: literal tipado por value_type |
| `transform` | varchar(120) NULL | transformación post-extracción ligera (cast, parse locale, normalize, date→years) parametrizable como dato |
| `on_missing` | enum('treat_as_false','block','skip','use_default') | qué hace el motor si el fact no resuelve (espejo de `on_fail`). Evita NULL/0 silencioso |
| `priority` | smallint | orden de intento si hay varios bindings por (fact,país): fallback de proveedor |
| `status` | tinyint(1) | vigencia |
| | | **CHECK por `resolver_kind`**: exactamente una columna de fuente poblada (los 4 enfoques omiten esto salvo el 1; es obligatorio para integridad). |

#### `FeatureTransform` — definición versionada de un fact computado

| Nombre | Tipo | Nota |
|---|---|---|
| `id` | bigint unsigned PK | identidad |
| `evaluable_field_id` | bigint unsigned FK | fact computado que produce |
| `transform_kind` | enum('expression','aggregate','lookup_band','sql_routine') | `expression`=fórmula sobre otros facts; `aggregate`=avg/sum/window; `lookup_band`=banda min/max→valor; `sql_routine`=**puente a una FN_* SQL legacy mientras se migra** |
| `expression` | text | fórmula declarativa por code: `monthly_income * (1 - fixed_expense_perc) - monthly_debt`. El parser valida que cada code exista en EvaluableField |
| `version` | int | versión; se publica nueva, no se muta |
| `policy_version_id` | bigint unsigned NULL FK | ata la versión del fact derivado a la versión de política → reproducibilidad |
| `status` | enum('draft','active','retired') | ciclo de vida |

#### `FeatureDependency` — aristas del DAG entre facts

| Nombre | Tipo | Nota |
|---|---|---|
| `id` | bigint unsigned PK | identidad de la arista |
| `transform_id` | bigint unsigned FK→FeatureTransform | transform consumidora |
| `depends_on_field_id` | bigint unsigned FK→EvaluableField | fact insumo |
| `required` | tinyint(1) | si falta y required=1, el fact derivado queda `unresolved` (no false) |
| | | Validar **DAG acíclico** al publicar; resolver en **orden topológico** memoizado. |

#### `ScoringClause` — banda de scoring colgando de un fact (reemplaza `ScoringPolicy.variable`)

| Nombre | Tipo | Nota |
|---|---|---|
| `id` | bigint unsigned PK | identidad |
| `scoring_policy_id` | bigint unsigned FK | política dueña (por lender) |
| `evaluable_field_id` | bigint unsigned FK→EvaluableField | fact puntuado. Reemplaza el string `variable` |
| `min_value` | decimal(14,2) NULL | límite inferior (numérico/money/date) |
| `max_value` | decimal(14,2) NULL | límite superior |
| `fixed_value` | varchar(255) NULL | match discreto (enum/string/bool), validado contra value_type |
| `points` | decimal(8,2) | puntos si matchea |

#### `RuleGroup` / `RuleGroupMember` — reglas compuestas AND/OR como data

`RuleGroup`: `id`, `parent_group_id` (auto-ref, NULL=raíz), `connector` enum('AND','OR'), `policy_scope_id` (a qué política/binding pertenece el árbol), `sort` smallint.
`RuleGroupMember`: `id`, `rule_group_id` FK, `rule_definition_id` FK (la hoja fact+operator+value), `negate` tinyint(1), `sort` smallint.

#### `OperatorTypeRule` — matriz declarativa operator↔value_type

`operator`, `value_type`, `allowed` tinyint(1). Tabla única consultada **tanto al alta de reglas como por el evaluador**. Ej.: `between`/`gt`/`gte`/`lt`/`lte` solo number/integer/money/percent/date; `in` requiere cardinality=list o value lista; `matches` solo string; `exists` cualquier tipo.

#### `FactValueSnapshot` — materialización opcional (serving + reproducibilidad)

`id`, `loan_application_id` FK, `evaluable_field_id` FK, `value_number` decimal(18,4), `value_string` varchar(255), `value_date` date, `resolved_from_version` int, `resolved_at` timestamp, `source_ref` varchar(120) (FieldAnswer.id / BureauInquiry.uuid). **Columnas tipadas por familia, NO un value text universal.** Particionable por fecha; retención. Sólo facts calientes de la decisión.

### Re-cableado de referencias

- **`RuleDefinition.field` (varchar 120) → `RuleDefinition.evaluable_field_id` (FK→EvaluableField).** La cláusula referencia el fact canónico. `RuleDefinition.value_type` se vuelve **derivado del fact y se elimina** (no se redeclara). `operator` se valida contra `OperatorTypeRule(operator, fact.value_type)`. Se conserva `field` como **legacy/trazabilidad** hasta el retiro datado.
- **`ScoringPolicy.variable` (varchar 255) → extraída a `ScoringClause.evaluable_field_id` (FK).** Las 6 políticas de scoring CX apuntan al **mismo catálogo** que las reglas de elegibilidad. `min/max/fixed_value/points` se preservan en la banda. `variable` se conserva legacy.
- **`FormField.semantic_role` (varchar 40) → permanece como propiedad de UI, pero su dominio de valores deja de ser libre.** El vínculo concreto se materializa en `FactSourceBinding(resolver_kind=form_field, form_field_semantic_role=X, country_id)`. Un `semantic_role` válido **debe existir como binding form_input** (validación). Así "registrar un FormField con semantic_role=X" lo cablea automáticamente al fact X. No se duplica `semantic_role` en EvaluableField (corrección al enfoque 3).
- **`BureauFieldMapping.field_code` (varchar 60) → `BureauFieldMapping.evaluable_field_id` (FK) + alineado 1:1 con el binding `bureau_mapping`.** El `json_path` **por proveedor** sigue viviendo en BureauFieldMapping. El binding apunta a la **capability**, y `CountryProviderBinding` resuelve el proveedor real del país. `field_code` se conserva como clave de extracción.

### Resolución de valor por source

El motor recibe un `evaluable_field_id` + `loan_application` + `country_id` (+`lender_id`), y ejecuta una función **pura, cacheable y materializable** `(fact, country, application) → valor tipado`:

1. Lee `EvaluableField` por id; obtiene `value_type`/`unit`.
2. Resuelve el `FactSourceBinding` **más específico** por `(country_id, lender_id)` con fallback a NULL, ordenado por `priority`.
3. Despacha por `resolver_kind`:
   - **form_field** → `FieldAnswer` del FormField cuyo `semantic_role = binding.form_field_semantic_role` para ese loan_application; castea el text al `value_type` usando `Country.locale/currency` (evita el CAST quemado que rompe en DOP).
   - **customer_column** → atributo tipado nativo de Customer (`birth_date` → `age_years` vía `transform` fecha→años con fecha de evaluación). Cero parsing de blobs.
   - **bureau_mapping** → `binding.bureau_provider_kind` (capability) → `CountryProviderBinding` decide el proveedor real → `BureauFieldMapping.json_path` extrae del payload de la `BureauInquiry` vigente (respetando `freshness_ttl`: si vencido, reconsulta, salvo override "usar último").
   - **domain_function/computed** → resuelve `FeatureTransform`: orden topológico de `FeatureDependency`, resuelve recursivamente cada insumo (memoizado), evalúa `expression`/`aggregate`/`lookup_band`, registra la versión usada. `sql_routine` invoca la FN_* legacy detrás de un puerto por slug.
   - **constant** → `const_value` tipado.
4. Aplica `transform` y castea a `value_type + unit`. Si no resuelve, aplica `on_missing` (nunca false/0 silencioso).
5. Opcional: persiste en `FactValueSnapshot` con `resolved_from_version` para reproducibilidad y serving a volumen.

El **mismo resolver** sirve a reglas (compara con operator/value) y a scoring (mapea a points/banda): una sola ruta de obtención de valor.

### Cómo "más reglas" y "fact nuevo" quedan como pura data

- **Más reglas sobre facts existentes** = puras filas: `RuleDefinition` (evaluable_field_id + operator + value) + sus bindings de lender/merchant + opcionalmente `RuleGroup`/`RuleGroupMember` para AND/OR. Cero esquema, cero código. *Ej.:* "rechazar si `payment_capacity` < 200000 para lender X" = 1 fila RuleDefinition + 1 binding de regla.
- **Fact nuevo capturado** = 1 fila `EvaluableField` (`code='dependents_count'`, `value_type=integer`, `source_kind=form_input`) + 1 `FormField` con `semantic_role` + 1 `FactSourceBinding(form_field)`. Inmediatamente referenciable.
- **Fact nuevo derivado** = 1 `EvaluableField(source_kind=computed)` + 1 `FeatureTransform` con la expresión + filas `FeatureDependency` hacia insumos. Sin tocar el motor.
- **Fact nuevo de buró** = 1 `EvaluableField(source_kind=bureau_derived)` + filas `BureauFieldMapping` (json_path por proveedor) + 1 binding `bureau_mapping`.
- **País nuevo que cambia la fuente concreta de un fact existente** = 1 fila `FactSourceBinding(country_id=PE)`. Las reglas no cambian. *Prueba de fuego:* "evaluar `age_years` ≥ 21 en Perú leyendo la fecha de nacimiento del documento en vez del formulario" = 1 binding + 1 RuleDefinition, cero código — idéntico patrón a dar de alta un proveedor en `CountryProviderBinding`.

### Por qué NO es EAV (cómo indexa/escala el motor)

1. **Catálogo de definiciones, no de valores.** `EvaluableField`/`FactSourceBinding` son **metadata** (decenas-cientos de filas, casi estáticas), no crecen con el volumen de solicitudes. EAV es (entity, attribute, value) con N filas por entidad.
2. **Los valores viven tipados en sus tablas nativas e indexables**: `FieldAnswer` (índice por `field_id, loan_application_id`), columnas reales de Customer (`birth_date date`, `gender`), payload de `BureauInquiry`. El registro **solo dice dónde mirar y de qué tipo**; nunca centraliza valores en un blob.
3. **Tipado fuerte y estático**: `value_type` es enum cerrado por fact; el operador y el casteo se validan contra él (`OperatorTypeRule`). No "todo es varchar".
4. **Consultable a volumen**: cada regla es un JOIN acotado (RuleDefinition→EvaluableField→FactSourceBinding→tabla nativa), compilable y cacheable por país; y `FactValueSnapshot` materializa columnas **tipadas por familia** indexables para el scorecard. EAV obligaría a un pivot por atributo. Lo que se generaliza es la **definición**, no el **almacenamiento**.

## Edge cases y cómo los maneja

- **Mismo concepto, dos fuentes por país** (income por formulario en CO, por buró en PE): UN `EvaluableField` con dos `FactSourceBinding`. Jamás dos facts.
- **Distinto significado por país** (ingreso bruto vs neto): **facts distintos** (`income_gross`/`income_net`), no un binding. Regla: *misma semántica + distinta fuente = binding; distinto significado = fact*.
- **Fact computado con dependencias** (`payment_capacity = f(income, fixed_expenses)`): grafo `FeatureDependency`; validar **DAG al publicar**, resolver topológicamente.
- **Multi-binding por país con fallback** (proveedor primario de `bureau_score` no responde): `priority` elige el siguiente binding.
- **Versionado**: cambiar fórmula/binding publica nueva `FeatureTransform.version` atada a `policy_version_id`; decisiones pasadas reproducibles vía `FactValueSnapshot.resolved_from_version`. **Nunca mutar in-place; nunca borrar un fact**: `status=0`.
- **Multi-país money**: `value_type=money` + `unit` normalizado con `Money(Country.currency/decimals)`; el umbral de la regla también es Money, no número suelto.
- **Fact no resoluble vs valor falso**: `on_missing` explícito (treat_as_false/block/skip/use_default), nunca NULL/0 silencioso. País sin proveedor para una capability → `unresolved`.
- **Casteo locale** (FieldAnswer text en DOP): el casteo usa `value_type+unit+Country.locale`, eliminando el CAST quemado a formato CO.
- **Fallback NULL que enmascara binding faltante**: si el fact es country-sensitive, **fallar explícito** en vez de leer la fuente base equivocada en silencio.

## Qué NO hacer (anti-patrones)

- **No** crear una tabla genérica `(entity, attribute, value)` para valores de solicitudes — eso es EAV.
- **No** dejar el `value_type` duplicado en `RuleDefinition`/`ScoringPolicy`: el fact es la única verdad; columnas redundantes se eliminan, no "se dejan por si acaso".
- **No** abusar de `source_kind=computed`/`domain_function` como escape hatch: si proliferan slugs, el catálogo se vuelve un índice de código quemado. `computed` debe ser **combinación declarada de otros facts**, no código nuevo por fact; gobernar qué FN_* son admisibles.
- **No** dejar los strings legacy activos indefinidamente: definir **fecha de retiro**; mientras tanto el motor prefiere la FK.
- **No** modelar matices de país como facts distintos cuando sólo cambia la fuente (over-normalization), ni esconder semánticas distintas detrás de un binding (under-normalization).
- **No** crear bindings por cada combinación `(fact, país, lender, merchant)`: acotar a país+fallback; empujar overrides finos a los bindings de regla.
- **No** dejar la matriz operator↔value_type en código: vive en `OperatorTypeRule`, aplicada en alta y en evaluación.
- **No** ubicar el registro dentro de `credit`: es transversal (`decisioning`); facts customer_attribute/form_input cruzan identity/origination.
- **No** dejar `FactValueSnapshot` sin partición/retención: mal diseñado degenera en algo que parece EAV en disco.
- **No** abrir el alta de facts sin **dueño del catálogo**: sin gobernanza reaparecen `income`/`income_monthly`/`monthly_income`.

## Spec de implementación

**Entidades a agregar (contexto `decisioning`):**
1. `EvaluableField` (raíz) — columnas arriba.
2. `FactSourceBinding` (binding por país, con CHECK por `resolver_kind`).
3. `FeatureTransform` (computados versionados).
4. `FeatureDependency` (DAG entre facts).
5. `ScoringClause` (banda de scoring por fact).
6. `RuleGroup` + `RuleGroupMember` (reglas compuestas AND/OR).
7. `OperatorTypeRule` (matriz tipo↔operador).
8. `FactValueSnapshot` (materialización opcional, particionada).

**Columnas/índices clave:** `EvaluableField.code` UNIQUE; índice en `FactSourceBinding(evaluable_field_id, country_id, lender_id, priority)`; índice existente en `FieldAnswer(field_id, loan_application_id)`; `FactValueSnapshot(loan_application_id, evaluable_field_id)` + partición por `resolved_at`.

**FKs a re-cablear:**
- `RuleDefinition.evaluable_field_id` FK→EvaluableField (nullable durante migración) — **elimina** `RuleDefinition.value_type` al cierre.
- `ScoringPolicy.variable` → extraída a `ScoringClause.evaluable_field_id` FK.
- `FormField` → vínculo vía `FactSourceBinding(form_field, form_field_semantic_role)`; `semantic_role` permanece como UI con dominio validado contra bindings.
- `BureauFieldMapping.evaluable_field_id` FK→EvaluableField; `field_code`/`json_path` por proveedor preservados; capability resuelta por `CountryProviderBinding`.

**Migración (FK incremental):**
1. Agregar columnas `evaluable_field_id` **nullable** en las 4 ubicaciones.
2. Crear **tabla de alias** `legacy_string → code` (revisada manualmente: `edad`/`age_min`/`age` → `age_years`; `ingreso`/`income` → `monthly_income`; `EXPERIAN_SCORE` → `bureau_score`), incluyendo encodings inconsistentes por lender.
3. Backfill: UPSERT `EvaluableField` por code; set FK; **reporte de cobertura** de strings huérfanos (deuda a sanear antes de cortar).
4. Reconciliar `value_type`: **gana el catálogo**; loguear conflictos, no fallar silenciosamente.
5. Freeze de escrituras al string; motor prefiere la FK.
6. **Fecha de retiro** datada: dropear las columnas string y `RuleDefinition.value_type`.

**Qué preservar como legacy (trazabilidad, no fuente de verdad):** `RuleDefinition.field`, `ScoringPolicy.variable`, `FormField.semantic_role` (este se queda como rol de UI), `BureauFieldMapping.field_code` (clave de extracción por proveedor). Todos los facts y bindings con `status` (soft-disable), nunca delete, para no romper decisiones históricas.