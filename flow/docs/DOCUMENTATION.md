# Simulador de onboarding (flow) — mapeo campo → tabla → uso real

Este documento ancla los campos económicos que muestra el simulador (`flow`) contra
el código real de CreditOp, para separar lo que **decide la oferta** de lo que es
**economía de negocio** o simplemente **no se usa**.

- **Repos auditados:** `application` (bitbucket, monolito Laravel viejo, vivo/default:
  admin + originación vieja + servicing) y `legacy-backend` (github, reescritura Laravel
  Modules, núcleo nuevo de originación rt=2).
- **Método:** barrido cross-repo con verificación adversarial (workflow de 16 agentes,
  confianza alta) + trazado inline del frontend admin y del cálculo de cuota.
- **Fecha:** 2026-07-10.

> Convención de veredictos:
> - **decisional** — el valor cambia la OFERTA: elegibilidad, cupo, cuota o plazo.
> - **display-only** — se persiste y se serializa al front, pero ningún cálculo del backend lo consume para decidir.
> - **stored-only** — se persiste y NO se lee en ningún lado (columna huérfana).
> - **negocio/servicing** — real, pero fuera de la adquisición (liquidación al comercio o cartera post-desembolso).

---

## 0. Hallazgo base: la tabla `lenders` NO tiene economía

`lenders` (migración `2023_04_20_202610_create_lenders_table.php`) solo guarda
`name, image, description, benefits, response_type, url, email, slug, sort, country_id,
additional_data, status`. **Toda la economía vive en otras tablas.** El tooltip viejo del
prototipo ("Config de lender → tabla lenders: montos, cuotas, tasa") era incorrecto.

### Dónde vive cada cosa

| Tabla | Nivel | Qué guarda |
|---|---|---|
| `credit_line_by_lenders` | lender (base) | `min_amount`, `max_amount`, `rate`, `min_fee_number`, `max_fee_number`, `fee_numbers` |
| `lenders_by_allieds` | comercio (override/calculadora) | override `min_amount`/`max_amount` + economía: `comission_percentage`, `initial_fee_percentage`, `administrative_costs_percentage`, `administrative_fixed_value`, `guarantee_fund_percentage`, `life_insurance_*`, `iva`, `expense_penalties_percentage`, `multiple_of_maximum_amount` |
| `lender_users_categories` | perfilamiento (categoría) | `min_initial_fee`, `max_amount`, `max_fee_number` — **estos DECIDEN el cupo rt=2** |
| `creditop_x_conditions_by_amount_by_lender` | tramo por monto | `min_amount`, `max_amount`, `initial_fee_percentage`, `max_fee_number`, `mandatory_fee_number` |
| `creditop_x_quota_restrictions` | otorgación especial | `min_quota`, `max_quota` (acotan CUPO, no cuota mensual), `fee_value` (**huérfano**) |
| `products` | producto | `initial_fee`, `max_term`, `max_amount` |
| `creditop_x_lender_configuration` | lender CreditopX | `late_payment_interest_rate` (mora), `installments_waived_interest` (condonadas) |
| `user_requests` | solicitud | snapshot: `initial_fee` (monto), `rate`, `final_amount`, `fee_value` |

---

## 1. Las TRES "cuotas" (la trampa de terminología)

En el código `fee` = cuota (installment). Hay tres conceptos distintos que en español
se dicen parecido:

| Concepto | Qué es | Columna | Unidad |
|---|---|---|---|
| **Número de cuotas** (plazo) | cuántas cuotas | `min_fee_number` / `max_fee_number` / `fee_numbers` | conteo |
| **Cuota inicial** (enganche) | pago adelantado | `min_initial_fee` / `initial_fee_percentage` / `initial_fee` | % o $ |
| **Cuota mensual** | el pago recurrente | se **calcula** (anualidad); no hay piso/techo paramétrico | $ |

**Clave (resuelve la confusión del prototipo):** en el admin de `application`
(`LenderCreate.vue`) el label **"Cuota mínima / Cuota máxima"** bindea a
`form.min_fee_number` / `form.max_fee_number` → o sea es el **mín/máx del NÚMERO de
cuotas** (plazo), **no** el monto del pago mensual. Y "Número de cuotas" bindea a
`fee_numbers` = la **lista** de plazos ofrecibles ("1,2,3,4,6,12,…,60"), que el backend
recorta con ese mín/máx (`LenderRetrievalService.php:774`).

> ❌ El monto de la cuota mensual mín/máx **no existe como palanca**. El único campo que
> lo representaría, `creditop_x_quota_restrictions.fee_value` (comentado "Fee amount or
> percentage"), es **stored-only**: nunca se consume. Los `min_quota`/`max_quota` que sí
> deciden acotan el **CUPO**, no la cuota mensual (`LenderSpecialGrantingService`).

---

## 2. Config de lender (Config de entidad)

| Campo prototipo | Columna real | Tabla | application | legacy | Nota |
|---|---|---|---|---|---|
| Monto mín/máx | `min_amount` / `max_amount` | credit_line_by_lenders (+ override comercio) | **decisional** | **decisional** | Elegibilidad rt=2 + tope de cupo (`CreditopXQuotaController:483/528`) |
| Cuotas mín/máx | `min_fee_number` / `max_fee_number` | credit_line_by_lenders | **decisional** | **decisional** | El admin lo llama "Cuota mín/máx". Entra en la anualidad del cupo + recorta plazos |
| Nº de cuotas (lista) | `fee_numbers` | credit_line_by_lenders | **decisional** | **decisional** | Lista de plazos ofrecibles, recortada por mín/máx + `max_term` |
| Cuota inicial % | `min_initial_fee` | **lender_users_categories** | **decisional** | **decisional** | Fórmula de cupo `available/(1−fee)` + cobro Wompi. OJO: decide la **categoría de perfilamiento**, no el comercio |
| Tasa de interés | `rate` | credit_line_by_lenders → `user_requests.rate` | **decisional** | **decisional** | Anualidad del cupo + cálculo de la cuota |
| Cuotas condonadas | `installments_waived_interest` | creditop_x_lender_configuration | **servicing** | **servicing** | El campo de config NO baja la oferta: solo se copia al ledger post-aprobación. La cuota MOSTRADA la baja otra tabla (`promotions_by_lenders`), no este campo |
| Tasa de mora | `late_payment_interest_rate` | creditop_x_lender_configuration | **servicing** | **servicing** | mora = cuota·días·tasa/30, post-desembolso (Estado 11+). NO toca la oferta |

---

## 3. Cuota inicial: 3 representaciones (por qué se contradicen)

1. **`min_initial_fee`** (`lender_users_categories`, nivel **categoría/perfilamiento**) →
   **el que DECIDE rt=2**: divide el cupo `available/(1−fee/100)` y deriva el monto que
   cobra Wompi (`LenderUserCategoryService`, `InitialFeePaymentService:77`).
2. **`initial_fee_percentage`** (`lenders_by_allieds`, nivel **comercio**) →
   **display-only en backend**: todas sus lecturas son `$lender->initial_fee_percentage = …`
   para el front. El motor rt=2 no lo usa para decidir.
3. **`initial_fee`** (`products` / `user_requests`) → el **monto** congelado por solicitud
   (se resta del capital antes de la anualidad, `PaymentCalculationService:187`).

> En `legacy` hay además un filtro duro exclusivo (`CreditStudyService:705`): excluye el
> lender si el % elegido es menor al mínimo del comercio — pero ese mínimo viene de un
> **JSON de config** (`lenders_by_comerce_additional_hard_rules`), no de la columna.

---

## 4. Calculadora del comercio (`lenders_by_allieds`) — 3 baldes

Trazado en `application` (`PromissoryNoteController`, path vivo). El pagaré Y el simulador
de checkout comparten `calculateAmounts()`, así que lo que "afecta la cuota" se ve en la
oferta al cliente.

### Balde A — afectan la CUOTA (se financian en el capital / se suman al pago)

| Campo | Columna | Cómo |
|---|---|---|
| Costos administrativos | `administrative_costs_percentage` + `administrative_fixed_value` | `admin = amount·%/100 + fijo` → suma al capital (`:353`) |
| Fondo de garantías (FGA) | `guarantee_fund_percentage` | `(amount+admin)·FGA/100·1.19` → suma al capital (`:376`); override por categoría |
| Seguro de vida (var + fijo) | `life_insurance_percentage`, `life_insurance_fixed` | "Cant que se suma a cuota mensual" (`:415`) |
| Monto máx | `max_amount` | topea el cupo (decisional) |

### Balde B — economía de negocio (NO toca la oferta al cliente)

| Campo | Columna | Qué es |
|---|---|---|
| Comisión | `comission_percentage` (doble-s) | `%·final_amount` = lo que CreditOp le cobra al comercio, calculado **después** de originar (`UserRequest.php:127`). Liquidación, no oferta. |

### Balde C — NO se usan en el backend de originación (decorativos)

| Campo | Columna | Por qué |
|---|---|---|
| IVA | `iva` | El cálculo real usa **19% quemado** (`* (1 + 19/100)`); la línea con `$lender->iva` está comentada. La columna solo se serializa al front. |
| Castigo / Gastos | `expense_penalties_percentage` | Solo se copia al objeto para el front (`ListLender/Confirmation/Simulator/LenderRetrieval/LenderValidation`); ningún cálculo lo lee. |
| Múltiplo del ingreso | `multiple_of_maximum_amount` | Igual: solo se serializa. El nombre sugiere un tope de cupo por ingreso, pero **el backend no lo consume** (si algo lo usa, es el front). |

> **Elegibilidad** (quién se aprueba) no la toca **ninguno** de estos campos económicos:
> eso son las reglas (score, datacrédito, group rules, categoría) + `min/max_amount` +
> bounds de `fee_number`.

---

## 5. Caveats

- Lo trazado en el balde A/B/C es el path de **`application`** (`PromissoryNoteController`,
  vivo/default). En `legacy` el equivalente es `PaymentCalculationService`, que podría
  ensamblar los costos distinto (no auditado a fondo aquí).
- **Servicing vs originación:** la tasa de mora y las condonadas viven en config de lender
  CreditopX; la mora es 100% servicing (corre en `application`; la copia en `legacy` está
  dormida). Las condonadas de config NO llegan a la oferta (son servicing); la baja de la cuota
  mostrada la hace `promotions_by_lenders`.
- **Esquema compartido:** ambos repos comparten los archivos de migración; las diferencias
  son de dónde se LEE/consume (legacy centraliza rt=2 en `CreditopXQuotaController` +
  `PaymentSchedule/*`; application lo dispersa).

---

## 6. Qué modela el prototipo (fidelidad) — correcciones aplicadas

| Antes (prototipo) | Realidad | Corrección |
|---|---|---|
| "Cuota (mín/máx)" en `$` | = número de cuotas mín/máx (`min/max_fee_number`) | **Eliminado** del UI: es redundante — se **deriva** del listado "Nº de cuotas" (`min/max` de la lista). `entidadCfg` expone `feeNumMin/feeNumMax` calculados. |
| Tooltip "tabla lenders" | economía en `credit_line_by_lenders` / `lenders_by_allieds` / `lender_users_categories` | Tooltips con las tablas reales |
| Cuota inicial % (comercio) sin matiz | decide `min_initial_fee` de **categoría**; el del comercio es display | Nota en el tooltip |
| Toggle binario "Campos de negocio" | la pregunta correcta es "¿participa en la solicitud y quién paga?" | categorías con checks (apagados por defecto); solo lo **decisional** queda siempre visible |
| Enganche/cupo/plazo salían del comercio / reglas sueltas | los decide la **categoría de perfilamiento** del usuario (rt=2) | **Nodo Perfilamiento** nuevo (categorías + reglas + match en vivo); la categoría resuelta maneja la oferta |
| Fantasmas mostrados en opacity ("deber ser") | el código real no los usa | Primero se **eliminaron**; luego (2026-07) se **re-mostraron atenuados + sidebar con la causa** (IVA, castigo, múltiplo, cuota inicial del comercio) — ver §9 "Campos inertes". La cuota sigue fiel (IVA 19% fijo, sin castigo, sin múltiplo): los atenuados no entran en la matemática |

### Visibilidad: un solo toggle (barra Configuraciones)

**Actualización 2026-07-11.** Los 3 checks separados (revenue / servicing / campos sin usar) se
unificaron en **UN solo check**: **"Mostrar campos fuera de la solicitud"** (`settings.showExtra`,
atributo `data-hide-extra` en `<html>`). **Por defecto está APAGADO**, así que el grafo muestra **solo
el flujo de solicitud**. Al activarlo se revelan, atenuados y clicables, todos los campos que NO
participan en la solicitud:

| Estado | Clase | Campos | Por qué |
|---|---|---|---|
| **Siempre visible** | — | monto, nº de cuotas, tasa, monto máx + **categoría de perfilamiento** (enganche/cupo/plazo rt=2) | **Decide** la solicitud |
| **Siempre visible** (acento teal) | `.cfg-cuota` | cargo fijo, costos admin, fondo de garantías, seguros | **Dentro** de la solicitud: el CLIENTE los paga → entran en la cuota |
| Se revela con el check | `.cfg-biz` (ámbar) | comisión | Revenue: cobro al COMERCIO al liquidar, tras originar |
| Se revela con el check | `.cfg-servicing` (rojo) | tasa de mora, **cuotas condonadas** | Servicing post-desembolso (Estado 11+) |
| Se revela con el check | `.pv--info` (buró) | datos informativos del buró | Se entregan pero no deciden |
| Se revela con el check | `.fld-dead` (+ encabezado) | IVA, castigo, múltiplo, cuota inicial del comercio | Inertes del admin (muerto/pisado) |

> Nota: "cuotas condonadas" pasó de `.cfg-cuota` a `.cfg-servicing` (el valor del form no baja la
> cuota de originación — ver §9). Por eso ahora se revela con el check, no es "siempre visible".

> **Borrados (limpieza de ruido):**
> - Las 3 reglas especulativas que no evaluaban (`continuityMonths`, `requireValidDocument`,
>   `requireNoDeclaredNegatives`) y el mockup de **config operativa** del comercio.
> - Los **editores de reglas atenuados** que mostraba el toggle "Reglas por sucursal": la sección
>   "Reglas de riesgo" de *Configurar entidad* y "Otras reglas" de *Configurar sucursal* (+ el toggle).
>
> **Se CONSERVA:** el motor de riesgo (score/negativos/datacrédito/KYC) **sigue evaluando** la
> elegibilidad; el nodo **Configurar sucursal** sigue con su **disparador datacrédito** (ocupación/
> edad/ingreso/género). Solo se quitaron los editores "extra" atenuados, no la lógica.

---

## 7. Inventario COMPLETO de los formularios admin (verificado, confianza alta)

Barrido campo por campo de los dos formularios (`LenderCreate/Edit.vue` = entidad ·
`AlliedLenderCreateModal/Edit.vue` = comercio-lender), con verificación adversarial
en `application` (vivo) y `legacy-backend`. `→` marca sobre-escritura para rt=2.

| Campo (label admin) | Columna@tabla | application | legacy | ¿Fantasma? |
|---|---|---|---|---|
| Monto mín/máx | `min/max_amount`@credit_line_by_lenders | decisional | decisional | No (rt=2: `max_amount` de la entidad → se pisa por categoría; en legacy `max_amount` se elevó a regla dura de cupo) |
| Cuota mín/máx *(= nº de cuotas)* | `min/max_fee_number`@credit_line_by_lenders | cuota (`min` solo fallback de plazo) | decisional (`max` fallback de cupo) | `min_fee_number` **fantasma en legacy** (0 lecturas); `max_fee_number` display → se pisa por categoría en rt=2 |
| Nº de cuotas (lista) | `fee_numbers`@credit_line_by_lenders | cuota | cuota | No (simula una cuota por plazo; hardcodes puntuales por lender) |
| Tasa de interés | `rate`@credit_line_by_lenders | cuota | cuota | No (driver de la cuota; en cupo solo si `debt_capacity_amount_validation≠0`) |
| Tasa de interés de mora | `late_payment_interest_rate`@creditop_x_lender_configuration | servicing | servicing (copia muerta) | No (post-desembolso; el pagaré muestra "tasa máx legal", no este valor) |
| Cuotas con int. condonados | `installments_waived_interest`@creditop_x_lender_configuration | servicing | servicing | **Matiz:** el valor del FORM **no** alimenta la cuota de originación — esa usa `promotions_by_lenders` (promos con vigencia). El del form solo copia al ledger post-aprobación |
| Textos monto/cuotas/intereses | `amount_text`/`number_fee_text`/`rate_text`@lenders.additional_data | **ghost** | **ghost** | ✅ **SÍ** — write-only; en app solo repuebla el propio form de edición. El texto del pagaré se genera con `numberToWords`, no de acá |
| Orden | `sort`@lenders_by_allieds | comportamiento | comportamiento | No, pero **casi no manda**: el orden final lo recalculan probabilidad/perfilamiento (app) o `weighted_score` ML (legacy) |
| URL UTM | `url_utm`@lenders_by_allieds | comportamiento (ruteo rt=1/3) | comportamiento | No (→ se pisa con ruta interna para rt=2) |
| La gestiona el usuario | `user_self_management`@lenders_by_allieds | comportamiento | comportamiento | No (link WhatsApp/modal autogestión) |
| Habilitar recaudo | `enable_collection`@lenders_by_allieds | comportamiento (servicing) | **ghost** | **Fantasma en legacy** (solo `$fillable`/seeder) |
| Correos de confirmación | `confirmation_emails`@lenders_by_allieds | comportamiento (mail back-office) | **ghost** | **Fantasma en legacy** (el job apunta a una clase inexistente → nunca se despacha) |
| Cuota inicial (comercio) | `initial_fee_percentage`@lenders_by_allieds | cuota **solo en old-screens** | **ghost** | ✅ **Sí para rt=2** (se pisa con `category.min_initial_fee` en `LenderRetrievalService:716`) |
| Comisión | `comission_percentage`@lenders_by_allieds | negocio | negocio | No (cobro al COMERCIO; define el neto a liquidar, no la cuota del cliente) |
| Costos administrativos (% + fijo) | `administrative_costs_percentage` + `administrative_fixed_value` | cuota | cuota | No (suma al capital → sube la cuota; el valor del comercio SÍ sobrevive) |
| Seguro de vida (var + fijo) | `life_insurance_percentage` + `life_insurance_fixed` | cuota | cuota | No (se suma a la cuota; alimenta el SOAP de Credifamilia en legacy) |
| Fondo de garantías | `guarantee_fund_percentage`@lenders_by_allieds | cuota | cuota | **Matiz rt=2:** default que se pisa por `category.FGA` (o `RevolvingCredit.fga` en rt=3); solo sobrevive para in-platform sin categoría |
| IVA | `iva`@lenders_by_allieds | cuota **solo en simulación front** | cuota solo front | ✅ **Sí en el cálculo real**: el pagaré/plan hardcodea **19%**; en app se guarda 19 para rt=2 |
| Castigo / Gastos | `expense_penalties_percentage`@lenders_by_allieds | **ghost** | **ghost** | ✅ **SÍ** — se serializa al front pero ningún cálculo ni componente lo consume |
| Múltiplo del ingreso | `multiple_of_maximum_amount`@lenders_by_allieds | **ghost** | **ghost** | ✅ **SÍ** — required/validado/persistido/serializado, pero la multiplicación ingreso×factor **no existe** en ningún lado |

*(Metadata obvia — nombre, imagen, descripción, beneficios, país, response_type, url, emails — es display esperado, fuera de este análisis.)*

---

## 8. Campos FANTASMA (se piden en el admin pero el código no los usa)

Ordenados de "muerto total" a "muerto según el flujo":

1. **Textos de monto/cuotas/intereses** (`amount_text`, `number_fee_text`, `rate_text`) —
   write-only en ambos repos. El único read (app) repuebla el mismo form admin. El texto que
   ve el cliente en el pagaré se genera con `numberToWords`, no de estas columnas.
2. **Castigo / Gastos** (`expense_penalties_percentage`) — se copia a `$lender` en 5 servicios
   para el front, pero ningún cálculo de cuota ni componente cliente lo consume. Ausente de
   `PromissoryNoteController` (app) y `PaymentCalculationService` (legacy).
3. **Múltiplo del ingreso** (`multiple_of_maximum_amount`) — required y validado, persistido y
   serializado, pero la fórmula ingreso×múltiplo **no está implementada**. El cupo rt=2 lo
   decide `lender_users_categories`; `max_amount` viene directo, nunca multiplicado por este factor.
4. **IVA** (`iva`) — el plan/pagaré real hardcodea 19% (`* (1 + 19/100)`, con la línea de
   `$lender->iva` comentada); en app incluso se guarda 19 para rt=2. Solo varía la cuota
   *simulada* en el front para rt≠2.
5. **Cuota inicial del comercio** (`initial_fee_percentage`) — fantasma para rt=2 en ambos
   repos: se pisa con `category.min_initial_fee` antes de llegar al front (`LenderRetrievalService:716`).
   Solo tiene efecto real en el flujo old-screens de `application` (`Confirmation.vue:587`).
6. **`min_fee_number`** — fantasma **en legacy** (0 consumidores; solo se escribe vía Partner).
7. **`enable_collection` y `confirmation_emails`** — fantasma **en legacy** (sin lector / job
   apunta a clase inexistente); en `application` sí se usan (gate de recaudo / mail back-office).

> Nota transversal: el patrón "se guarda → se serializa → se **sobrescribe** con el valor de la
> categoría de perfilamiento antes de mostrarse" aparece en varios campos para rt=2
> (`initial_fee_percentage:716`, `max_fee_number:713`, `max_amount:718`, `guarantee_fund` por
> `category.FGA`). Para el producto insignia (CreditopX rt=2), **la categoría manda; la config
> del comercio-lender es en gran parte cosmética.**

---

## 9. Modelo del flow: fiel (no inventar reglas) — nodo Perfilamiento + fantasmas eliminados

Decisión de diseño: **no inventar reglas de negocio.** El único lugar donde vive la lógica
transversal que decide enganche/cupo/plazo es el **nodo Perfilamiento**, que replica el
mecanismo real de rt=2. Los campos que el código no usa se **eliminan** del UI (no se disfrazan
de "deber ser"), para claridad total de qué se tiene.

### Nodo Perfilamiento (hub + categorías + tramos)

> **Actualización 2026-07-11 — descompuesto para hacerlo comparable.** El Perfilamiento dejó de ser
> un nodo único con scroll: ahora es un **hub** (datos del usuario que perfilan + veredicto: qué
> categoría gana) conectado hacia **arriba** a una **fila de nodos**: **una tarjeta por categoría**
> (`CategoryNode`, se resalta la que gana) + **un nodo Tramos** (`TramoNode`). Solo rt=2. Así se ven
> las 3 categorías lado a lado (checks ✓/✗ y cupo en paralelo) en vez de scrolleando. El modelo de
> datos NO cambió (mismas `lender_users_categories` + `lender_users_category_rules` + tramos).

**Ubicación:** 4ª capa de **config de la entidad** — aparece al seleccionar, colgado del costado
IZQUIERDO de "Configurar entidad" (entra por su costado derecho). Fiel al código: las categorías y
sus reglas viven **por `lender_id`** (como su economía), no por usuario ni por comercio. Es una
función de 2 entradas — config de la entidad (el nodo) + perfil del usuario (los "datos que
perfilan" mostrados adentro).

Replica `lender_users_categories` + `lender_users_category_rules` + `LenderUserCategoryService`:
- **Categorías** editables por lender: `min_initial_fee` (enganche) · `max_amount` · `max_fee_number`
  (plazo) · **fondo** (`loan_limit − already_used_loan`) · **capacidad de pago** (toggle + % del ingreso).
- **Regla de asignación** por `priority` — DEMOGRÁFICO: ocupación · edad · ingreso mín (+ verificado) ·
  continuidad laboral mín · género. + **RIESGO (buró), que vive DENTRO de la regla de categoría**
  (`min_score`, `negative_reports_last_12_months`, `current_delinquencies`, `financial_history_length`,
  `consulted_last_6_months`). + **lista negra de documentos** (1ra compuerta → rechazo directo).
  > Hallazgo clave: el riesgo crediticio NO es una capa aparte para rt=2 — es parte de la regla de
  > categoría, **por `lender_id`** (verificado: `lender_users_category_rules` no tiene allied/branch).
  > Aparte siguen `group_rules` + `datacredito` por sucursal como 2ª capa (no modelada aún).
- **CUPO REAL** (espejo `LenderUserCategoryService:45-50/329`): `min(max_amount, fondo)` INFLADO por el
  enganche `/(1−min_initial_fee)`, topeado por capacidad de pago (anualidad inversa:
  `cuota_máx = ingreso×% → cupo = cuota_máx·(1−(1+r)^−n)/r`). El nodo muestra el cupo por categoría.
- **Match en vivo**: toma el perfil del buró (ocupación/edad/ingreso/continuidad/género + verificado)
  y resalta la **1ra categoría (por prioridad) que cumple**. Sin categoría / lista negra → no se ofrece.
- **rt=1 (agregador):** el nodo NO perfila — muestra un switch **aprueba/rechaza/timeout** (la API
  externa decide, `PreApprovedLenderService`); rechaza/timeout saca al lender del listado.
- La categoría resuelta **maneja la oferta**: el marketplace toma de ahí el enganche, el cupo
  (`min(monto, max_amount, montoMax comercio)`) y recorta los plazos por `max_fee_number`.
  Solo rt=2; para rt≠2 el nodo avisa que lo decide la API externa.

### Cuota (fiel)

`cuotaBreakdown` = `capital (financiado + costos admin + fondo garantías·1.19) → anualidad(tasa,
plazo) + seguros`. El **financiado** = monto − enganche (de la categoría). IVA **19% fijo**, sin
castigo, sin tope por múltiplo — igual que el pagaré real.

### Sidebar de detalle por campo (reemplaza al tooltip) + campos inertes atenuados

**Actualización 2026-07-11.** **Cualquier label** del flow es ahora **clicable** y abre un **sidebar a
la derecha** (`FieldInfoPanel`) con: **dónde se guarda** (tabla), **en qué capa vive la lógica**
(application / application-vue / legacy-backend / frontend-monorepo / microservicio), su **estado**
y el **detalle**. El contenido sale de `src/fieldDocs.js`, citado del censo
`docs/codigo/CENSO-CAMPOS-CONFIG.md` — el sidebar reemplaza al tooltip como fuente de la verdad.
Estados posibles: **decide** (verde), **display** (azul), **kyc/identidad** (teal), **pisado**
(ámbar), **muerto** (gris), **servicing** (rojo).

También están cableados al sidebar los datos de las **tarjetas del marketplace** (chip rt, cupo,
categoría, tasa, inicial, cuota estimada, badge "prob. baja") y los chips del catálogo (producto/rt)
— con eso ya **no queda ningún tooltip como fuente única**: todo abre el panel. Los labels clicables
llevan subrayado punteado permanente (sutil) para descubrirse sin hover; Esc y el clic en el canvas
cierran el sidebar (2º Esc deselecciona la entidad).

Los **headers de nodo** también son clicables (reemplazan su tooltip) y abren una **vista más rica**
(kind `node` en `fieldDocs.js`): la **etapa** (contexto/onboarding/buró/config/decisión/salida), el
**rol** del nodo, sus **tablas**, sus **capas**, y una lista de **puntos clave / gotchas** (ej. burós:
"el único que da score es Experian"; sucursal: "reglas copiadas, ~37k filas"; salida: "lo mostrado ≠
lo que decide el POS"). Un nodo contempla más que un campo, por eso su panel es más denso.

Además, los campos que NO tienen efecto se muestran **atenuados (opacity)** — así el campo existe
(como en el admin real) pero se ve de una que es inerte, y el clic explica por qué. Tres de esos
estados en la calculadora y la config de entidad:

- **muerto** (gris) — la columna existe pero ningún cálculo la lee: `IVA` (19% quemado), `castigo`
  (`expense_penalties_percentage`), `múltiplo del ingreso` (`multiple_of_maximum_amount`).
- **pisado** (ámbar) — se guarda pero otro valor la sobrescribe: `cuota inicial del comercio`
  (`initial_fee_percentage`, la pisa `category.min_initial_fee` en rt=2).
- **servicing** (rojo) — se usa post-desembolso, no en la oferta: `cuotas condonadas`
  (`installments_waived_interest`, el valor del form NO baja la cuota mostrada), `tasa de mora`.

Siguen **siempre visibles y editables** (participan en la cuota real): costos admin, cargo fijo,
fondo de garantías, seguros (teal), monto máx (cupo) y comisión (negocio, ámbar). La cuota se calcula
fiel (IVA 19% fijo, sin castigo, sin múltiplo) — los campos atenuados NO entran en la matemática.

### Cómo agregar un campo nuevo (criterio)

Antes de agregar un campo al flow, ubicá en qué eje entra (ver §7): ¿**decide** listado/cupo?
¿entra en la **cuota** (lo paga el cliente)? ¿es **cobro al comercio**? ¿**servicing**? Si no
cae en ninguno y el backend no lo consume, **no se agrega** (sería otro fantasma).
