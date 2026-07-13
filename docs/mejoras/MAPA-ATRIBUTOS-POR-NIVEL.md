# Mapa atributo → nivel: dónde vive hoy vs dónde debería (reubicación de config)

> **Qué es.** Auditoría de **cada atributo de configuración** de CreditOp contra los niveles donde
> podría vivir (**entidad/lender · comercio · sucursal · categoría/perfilamiento**), con veredicto:
> ¿está en el nivel correcto? ¿se pisa? ¿es fantasma? ¿es una decisión quemada que debería ser
> columna? Y la **reubicación propuesta**.
>
> **Intención:** `mejoras/` = deber-ser. La columna "dónde vive hoy" se apoya en material ya
> **verificado** (no se re-documenta acá): estructura de tablas → [`../codigo/MODELO-DATOS.md`](../codigo/MODELO-DATOS.md);
> inventario campo-por-campo del admin (adversarial, confianza alta) → `../../flow/DOCUMENTATION.md §7`;
> hardcodes → [`../codigo/LOGICA-QUEMADA.md`](../codigo/LOGICA-QUEMADA.md); reglas copiadas por sucursal →
> [`../codigo/HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md`](../codigo/HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md).
> La columna "dónde debería" es **propuesta de diseño** (marcada como tal).
>
> **Fecha:** 2026-07-11.

---

## 0. Los 4 niveles (y qué pregunta responde cada uno)

| # | Nivel | Tabla(s) dueña(s) | Pregunta que DEBERÍA responder | Granularidad correcta |
|---|---|---|---|---|
| **N0** | **Entidad / lender** | `lenders`, `credit_line_by_lenders`, `creditop_x_lender_configuration` | ¿Qué ES esta entidad y con qué condiciones **base** presta? (identidad, tasa, plazos, producto) | por `lender_id` |
| **N1** | **Comercio / aliado** | `lenders_by_allieds`, `allieds`, `lender_allied_credentials` | ¿Qué **acuerdo económico** tiene ESTE comercio con la entidad? (comisión, costos, contrato) | por `allied_id × lender_id` |
| **N2** | **Sucursal** | `lenders_by_allied_branches` (+ copias de reglas) | ¿Qué **varía en esta sucursal**? (ruteo, orden, visibilidad) | por `allied_branch_id × lender_id` |
| **N3** | **Categoría / perfilamiento** | `lender_users_categories`, `lender_users_category_rules` | ¿Qué condiciones según el **perfil de riesgo** del cliente? (enganche/cupo/plazo rt=2) | por `lender_id × categoría` |

> **La tesis** (ver [`../vision/RESUMEN-PROBLEMA-Y-SOLUCION.md`](../vision/RESUMEN-PROBLEMA-Y-SOLUCION.md)):
> el modelo de 4 niveles es correcto; el problema es que **atributos viven en el nivel equivocado,
> se copian en vez de heredar, se pisan entre niveles, o son decisiones quemadas en código** en lugar
> de columnas. Este mapa los enumera.
>
> **Censo columna-por-columna (2026-07-11):** el inventario exhaustivo de las 176 columnas de las 11
> tablas (33 muertas, 9 pisadas, ~20 divergencias app↔legacy, 1 bug activo `min_income`) vive en
> [`../codigo/CENSO-CAMPOS-CONFIG.md`](../codigo/CENSO-CAMPOS-CONFIG.md) — es la base verificada de
> las tablas de este mapa.

---

## 1. N0 · Entidad / lender

| Atributo | Tabla | ¿Lo lee/decide? | Veredicto de ubicación | Propuesta |
|---|---|---|---|---|
| `response_type` | `lenders` | **decide TODO el flujo** | ✅ correcto (por entidad) | Mantener. Pero ver §5: `rt=4` es un **valor huérfano** forzado por accessor quemado |
| `min/max_amount`, `rate`, `min/max_fee_number`, `fee_numbers` | `credit_line_by_lenders` | sí (base) | ⚠️ correcto como **base**, pero **se pisan** por categoría en rt=2 (ver §4) | Mantener como default; declarar que rt=2 los sobrescribe |
| `path_id`, `promissory_type_id`, `signing_provider_id`, `validation_type` | `lenders` | sí (firma/ruteo/KYC) | ✅ correcto | Mantener |
| `late_payment_interest_rate`, `installments_waived_interest` | `creditop_x_lender_configuration` | servicing (post-11) | ✅ correcto de nivel, pero **es servicing** (no originación) | Mantener; separar del set de originación |
| **producto / garantía** (celular, renting…) | *(no existe columna)* | se **infiere** de `response_type` + `path_id` (`IMEI`) + flags | 🔴 **sin hogar**: `product_type` es fantasma | **Crear** `product_type` a nivel N0 (o tabla `products` real). Hoy se resuelve con hardcodes |

---

## 2. N1 · Comercio / aliado (`lenders_by_allieds` = "la calculadora")

Es donde más ruido hay: economía real mezclada con fantasmas y con campos que rt=2 pisa.

| Atributo | ¿Lo consume el backend? | Veredicto | Propuesta |
|---|---|---|---|
| `comission_percentage` | sí — **cobro al comercio** al liquidar | ✅ correcto (es el acuerdo económico N1) | Mantener. Es revenue, no toca la cuota |
| `administrative_costs_percentage` + `administrative_fixed_value` | sí — suma al capital → cuota | ✅ correcto de nivel | Mantener |
| `life_insurance_percentage` + `life_insurance_fixed` | sí — suma a la cuota | ✅ correcto | Mantener |
| `guarantee_fund_percentage` (FGA) | sí, **pero rt=2 lo pisa** con `category.FGA` | ⚠️ **se pisa**: default N1 que gana solo sin categoría | Declarar precedencia N3>N1; o mover FGA a N3 para rt=2 |
| `max_amount` | sí (tope), **pisado** por `category.max_amount` en rt=2 | ⚠️ **se pisa** | Idem: N3 manda en rt=2 |
| `initial_fee_percentage` | **NO para rt=2** — lo pisa `category.min_initial_fee` (`LenderRetrievalService:716`) | 🔴 **fantasma para rt=2** (solo vive en old-screens de application) | **Quitar de N1** para rt=2; el enganche vive en N3 |
| `min_amount` | **nunca se escribe** (fillable huérfano) | 🔴 **fantasma total** | **Borrar** columna o cablearla |
| `iva` | **no** — el cálculo real hardcodea 19% | 🔴 **fantasma** (se guarda 19 y se ignora) | **Borrar**; si el IVA varía algún día, entonces sí columna |
| `expense_penalties_percentage` (castigo) | **no** — se serializa al front, ningún cálculo lo usa | 🔴 **fantasma** | **Borrar** |
| `multiple_of_maximum_amount` | **no** — la fórmula ingreso×factor no existe | 🔴 **fantasma** (required/validado pero muerto) | **Borrar** o implementar |
| `amount_text` / `number_fee_text` / `rate_text` | **no** — write-only; el pagaré usa `numberToWords` | 🔴 **fantasma** | **Borrar** |
| `url_utm` | sí (ruteo rt=1/0) | ⚠️ **nivel dudoso**: existe en N1 **y** N2 (COALESCE) | Consolidar en N2 (es lo que varía por sucursal) |
| `bank_id` | sí | ✅ correcto | Mantener |
| `sort` | sí, pero **casi no manda** (lo recalcula ML/perfilamiento) | ⚠️ existe en N1 y N2 | Consolidar en N2 |
| `user_self_management` | sí (link autogestión) | ✅ correcto | Mantener |
| `enable_collection` | application sí (gate recaudo) · **legacy fantasma** | ⚠️ **deriva de repo** | Unificar; decidir dueño |
| `confirmation_emails` | application sí (mail back-office) · **legacy fantasma** (job a clase inexistente) | ⚠️ **deriva de repo** | Unificar; arreglar o borrar en legacy |

**Flags a nivel `allieds` (comercio, no la calculadora):**

| Atributo | ¿Qué hace? | Veredicto | Propuesta |
|---|---|---|---|
| `have_ctopx` | ramifica lógica de decisión (`LenderRetrievalService:115/129`…) **pero NO es el gate real** de la oferta rt=2 (CrediPullman #77 se ofrece en allied 94 con `have_ctopx=0`) | 🔴 **engañoso**: parece el gate y no lo es | Redefinir: o es el gate de verdad (y se respeta) o se elimina; hoy confunde |
| `slug`, `country_id`, `status` | identidad/estado | ✅ correcto | Mantener |
| `payment_plan_id` | FK a `payment_plans` que **no existe** | 🔴 **FK colgante** | Borrar o crear la tabla |
| `lender_allied_credentials` | contrato/llaves — **por `allied_id`** (no branch) | ⚠️ granularidad **inconsistente** con las reglas (que se copian por branch) | Ver §3: alinear granularidad |

---

## 3. N2 · Sucursal — el nivel más mal usado (copiar en vez de heredar)

| Atributo | Realidad | Veredicto | Propuesta |
|---|---|---|---|
| `lenders_by_allied_branches`: `url_utm`, `sort` | override mínimo (hereda de N1 por COALESCE) | ✅ correcto de nivel (esto SÍ varía por sucursal) | Consolidar acá `url_utm`/`sort` (quitarlos de N1) |
| `lenders_by_allied_branches.status` | fillable **nunca escrito** por la copia | 🔴 **fantasma** | Borrar o cablear |
| **`group_rules` + `lender_rules`** (reglas duras) | se **COPIAN** por `allied_branch_id` al habilitar la entidad | 🔴🔴 **el peor caso**: la plantilla (`group_rule_id NULL`) se **clona** en cada sucursal → deriva, huérfanas al desactivar | **Heredar, no copiar**: referenciar la plantilla N0/N1 y permitir override N2 solo cuando de verdad difiere |
| **`lender_datacredito_rules`** | idem — **7.183 filas** (matriz por entidad × sucursal; solo 107 tienen `allied_branch_id NULL`) | 🔴🔴 **el peor caso** (miles de copias) | Idem: plantilla + override; el 95% de las copias es ruido |

> **Falencia estructural #1 — copiar en vez de heredar.** El disparador es el *update* de la sucursal
> (`AlliedAlliedBranchController` + `addNewRule`/`addNewLenderRule`) y un 2º disparador al crear la
> credencial ecommerce. Errores de copia se **tragan** (email a una persona) → sucursal habilitada
> **sin reglas**. Detalle y cadena exacta → [`../codigo/HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md`](../codigo/HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md).
> **Reubicación:** las reglas duras son **de la entidad** (a lo sumo por comercio); la sucursal casi
> nunca las cambia. Modelo correcto: regla en N0/N1 + tabla de *override por sucursal* solo para las
> pocas que difieren. Elimina ~37k filas y la deriva.

---

## 4. N3 · Categoría / perfilamiento — donde de verdad se decide rt=2

| Atributo (`lender_users_categories`) | Rol | Veredicto | Propuesta |
|---|---|---|---|
| `min_initial_fee` | **el enganche real** de rt=2 (pisa a N1) | ✅ correcto, pero **duplica** semántica con N1 `initial_fee_percentage` | Declararlo **único dueño** del enganche rt=2; quitar el de N1 |
| `max_amount`, `max_fee_number` | cupo/plazo reales rt=2 (pisan a N0) | ✅ correcto, pero **pisan** a N0 sin marca | Declarar precedencia explícita N3>N0 para rt=2 |
| `loan_limit`, `already_used_loan` | fondo del lender → topa cupo | ✅ correcto | Mantener |
| `FGA` | pisa a N1 `guarantee_fund` | ⚠️ **se pisa** | Declarar dueño único |
| `rate` | **legacy la usa** (pisa `creditLines->rate`; el wizard la consume) · app la ignora (ni en `$fillable`; migración solo-legacy) | ⚡ **divergencia app↔legacy** (corregido por censo 2026-07-11; antes se creía fantasma) | Unificar: o ambos motores la respetan o se quita |
| `available_amount_multiplier`, `life_percentage` | multiplicador / seguro | ✅ correcto | Mantener |
| reglas de categoría (`lender_users_category_rules`) | score/ocupación/negativos/edad/capacidad | ✅ correcto (por `lender_id`, no por sucursal) | Mantener; NO confundir con las reglas duras copiadas (N2) |

> **Falencia estructural #2 — economía partida y pisada.** La misma palanca (enganche, cupo, plazo,
> FGA) existe en 2-3 niveles y el de arriba **pisa silenciosamente** al de abajo para rt=2. Para el
> producto insignia, **N3 manda y N0/N1 son en gran parte cosméticos** (`../../flow/DOCUMENTATION.md §8`).
> **Reubicación:** un **dueño único por palanca** con precedencia declarada (ej. enganche → N3 para
> rt=2, N1 para rt≠2), en vez de "todos la tienen y gana el último que la escribe".

---

## 5. Decisiones QUEMADAS que deberían ser columnas/config

No son atributos mal ubicados: son decisiones que **no tienen columna** y viven en `if`s.
(Inventario dueño → [`../codigo/LOGICA-QUEMADA.md`](../codigo/LOGICA-QUEMADA.md).)

| Decisión quemada | Dónde | Debería ser |
|---|---|---|
| **Credifamilia (id 24) → rt=1** | accessor `Lender::getResponseTypeAttribute` fuerza el rt ignorando la BD | El `response_type` real en la columna (y resolver el caso rt=4) |
| **`rt=4` sin fila de catálogo** | valor en `lenders.response_type` sin fila en `response_types` | Fila real en `response_types` (o un `product_type`/flag async) |
| **Pullman `allied_id == 94`** | condicional esparcido | Columna de comportamiento (flag/enum) a nivel N1 |
| **Corbeta `[24,209,210,211]`** | lista de IDs en `settings` | Flag `is_corbeta`/canal a nivel N1 |
| **`country_id == 60` (RD)** | condicionales | Config por país |
| **SmartPay `lender_id` (160 prod / 153 dev)** | `config/lenders.php` + `isSmartpayChannel()` | Flag de canal a nivel N0 (`is_smartpay_channel`) |
| **mapa `id → case` (rt=1)** | `PreApprovedLenderService` conserva un mapa de ids que convive con `lenders.action` — que el censo confirmó como despachador FQCN **general** (SelfManager/PersonalInfo/UserRequest/Compensar), no "solo Sistecrédito" | Consolidar TODO el despacho en `lenders.action` (la columna ya funciona) |
| **`complementary_form` quemado a `lender_id==155`** | app **comentó la lectura de la columna** y la reemplazó por el id (`ContinueUserFlowController:172`); legacy sí la serializa | Volver a leer la columna (ya existe) |
| **Allowlist `$allowed_comerces`** | lista de hashes quemada en código, comparada contra `allieds.hash` (`ValidateOtpController:114`, `PersonalInfoController:1036`) | Flag/columna a nivel N1 |
| **DENTIX/DFS `allied_id==189`** | los flujos "DFS" se gatean por id de comercio (las categorías `DFS_1/DFS_2` son solo etiquetas, no hay branch por nombre) | Flag de programa a nivel N1 |

> **Falencia estructural #3 — CreditOp se adapta a cada quien.** Cada comercio/entidad especial tiene
> su camino quemado en vez de una fila de config. La regla: **si es una decisión de negocio que varía
> por entidad/comercio/país/canal, es una columna, no un `if id==N`.**

---

## 6. Resumen de reubicaciones (el "antes → después")

| Palanca | Vive hoy (disperso) | Dueño propuesto | Acción |
|---|---|---|---|
| Enganche | N1 `initial_fee_percentage` + N3 `min_initial_fee` | **N3** (rt=2) / N1 (rt≠2) | Quitar el de N1 para rt=2 |
| Cupo / plazo | N0 `credit_line` + N3 categoría | **N3** (rt=2) manda | Precedencia declarada |
| FGA | N1 + N3 | **N3** (rt=2) | Dueño único |
| Reglas duras + datacrédito | **copiadas** en N2 (37k filas) | **N0/N1 plantilla + override N2** | Heredar, no copiar |
| `url_utm` / `sort` | N1 **y** N2 | **N2** | Consolidar abajo |
| Producto / garantía | inferido (path_id + hardcodes) | **N0** `product_type` | Crear columna |
| Canal (SmartPay/Corbeta) | `config` + `if` | **N0/N1** flag | Columna |
| `rt` de Credifamilia | accessor quemado | **columna** `response_type` | Desquemar |
| Fantasmas (`iva`, castigo, múltiplo, `min_amount`, `*_text`, `category.rate`, `lbab.status`) | N1/N3 | — | **Borrar** |

**Prioridad sugerida:** (P0) heredar-no-copiar reglas por sucursal — es el que más filas, deriva y
soporte genera; (P1) dueño único por palanca económica + borrar fantasmas — quita ambigüedad de qué
decide; (P2) desquemar decisiones (rt Credifamilia, canales, Pullman/Corbeta) → columnas; (P3) crear
`product_type`.

---

## 7. Alcance y siguiente paso

- Este mapa es **de config/atributos**. La otra mitad ("qué decisiones se tomaron" en el código de
  `application`/`legacy-backend`/`frontend-monorepo`) — cutover, webhooks, qué repo es dueño de cada
  pieza — vive en [`../codigo/ESTADO-MIGRACION.md`](../codigo/ESTADO-MIGRACION.md) y
  [`../codigo/PENDIENTES-MIGRACION.md`](../codigo/PENDIENTES-MIGRACION.md).
- **Advertencia de granularidad de repo:** varias falencias (`enable_collection`, `confirmation_emails`)
  son **deriva application↔legacy**, no solo mala ubicación. Reubicar sin unificar el repo dueño
  primero puede empeorar la deriva.
- Ninguna acción de este doc está aplicada: es análisis/deber-ser. Editar los repos reales
  (`application`/`legacy-backend`) requiere pedido explícito (convención del workspace: no armar PRs
  sobre esos repos sin confirmación).

*Fuentes verificadas: MODELO-DATOS.md (estructura BD), flow/DOCUMENTATION.md §7-§8 (inventario admin
adversarial), HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md (copia), LOGICA-QUEMADA.md (hardcodes),
CREDITOP.md §4/§8 (niveles + tesis). La columna "debería" es propuesta de diseño.*
