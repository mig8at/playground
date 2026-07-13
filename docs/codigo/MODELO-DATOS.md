# MODELO DE DATOS — tablas, columnas y relaciones (verificado contra BD local)

> **Dueño de la estructura de datos.** Índice curado de las tablas/columnas/relaciones de la BD local
> (`legacy-backend-mysql-1` / `creditop`) que importan para los flujos de originación: entidades centrales,
> las **3 capas de config**, cierre Creditop X, integraciones externas, identidad, Perfilador, IMEI y cartera.
>
> **Lo que NO vive aquí** (solo punteros): taxonomía `response_type` y el ciclo de vida de
> `user_request_statuses` → [`./CREDITOP.md`](../CREDITOP.md). Todos los hardcodes (IDs, montos, status, branches,
> PII) → [`./LOGICA-QUEMADA.md`](./LOGICA-QUEMADA.md). Por qué "falla el random" y cifras de deuda rt=2 →
> [`./CASOS-ESPECIALES.md`](./CASOS-ESPECIALES.md). El detalle exhaustivo por-tabla (modelo deber-ser +
> realidad) vive en [`../domain-model/`](../../domain-model/) (`docs/audit/REALIDAD-ACTUAL.md`).
>
> Consulta directa: `docker exec legacy-backend-mysql-1 mysql -ucreditop -ppassword creditop -e "SQL"`.

## Las entidades centrales

| Entidad | Tabla | Llaves / columnas clave |
|---------|-------|--------------------------|
| **Comercio / aliado** | `allieds` | `id`, `name`, `slug`, `hash`, **`have_ctopx`**, `country_id`, `status`, `payment_plan_id` |
| **Sucursal** | `allied_branches` | `id`, `allied_id`, `hash` (entrada al flujo), `name`, `country_city_id`, `status` |
| **Entidad / lender** | `lenders` | `id`, `name`, `slug`, **`response_type`**, `promissory_type_id`, `path_id`, `signing_provider_id`, `country_id`, `status`, `validation_type` |
| **Solicitud** | `user_requests` | `id`, `user_id`, `allied_id`, `allied_branch_id`, `lender_id`, **`user_request_status_id`** (FK → `user_request_statuses`), `amount`, `rate`, `fee_number` |
| **Cliente** | `users` | `id`, `cell_phone`, `document_number`, `document_type`, `multiple_allieds` (JSON) |

> ⚠️ **Corrección:** `have_ctopx` y `slug` viven en **`allieds`**, NO en `allied_branches`
> (`SHOW COLUMNS allied_branches` no los tiene; docs previos lo afirmaban y la query falla).

## Las 3 capas que definen "qué puede ofrecer un comercio"

Esta sección es **dueña de la estructura de las tablas** de las 3 capas. El *concepto* de negocio (por qué la
config en BD decide, no el código) lo explica [`./CREDITOP.md`](../CREDITOP.md) §4.

| Capa | Tabla(s) | Pregunta que responde |
|------|----------|------------------------|
| 1. Catálogo | `lenders_by_allieds` (allied) · `lenders_by_allied_branches` (sucursal) | ¿qué entidades **ofrece** este comercio? |
| 2. Creditop X | `allieds.have_ctopx` (columna, no tabla; a nivel **aliado**) | ¿el comercio opera con **CreditopX**? (marca blanca operada por CreditOp; el **capital lo pone el comercio** — ver [CREDITOP.md §1](../CREDITOP.md)) |
| 3. Credencial | `lender_allied_credentials` | ¿tiene **contrato/llaves reales** con esa entidad? |

> ⚠️ **`lender_allied_credentials` se llave por `allied_id`** (cols: `id, lender_id, allied_type, allied_id,
> credential`), **NO** tiene `allied_branch_id`. Sin fila aquí, aunque el comercio "ofrezca" la entidad, el
> flujo falla (ej. PLS Bancolombia → "no preaprobado").
>
> ⚠️ `have_ctopx` es **columna de `allieds`** (no tabla, no a nivel branch). **SÍ se lee y ramifica lógica de
> decisión** en código (`LenderRetrievalService:115,129`, `LenderListingService:352,358`,
> `LenderValidationService:320,328`) — no es solo cast/fillable. Pero **no es el gate duro de la oferta rt=2**:
> la oferta efectiva pasa por `lenders_by_allieds` + credencial. Caso real: CrediPullman #77 (rt=2) se ofrece en
> allied 94 con `have_ctopx=0`. Detalle del gate → [`./CASOS-ESPECIALES.md`](./CASOS-ESPECIALES.md).

## Catálogos de referencia

### Estado y tipo de solicitud (punteros — dueño NEGOCIO)

- **`response_types`** (taxonomía `response_type`) y **`user_request_statuses`** (ciclo de vida de la
  solicitud) → **dueño** [`./CREDITOP.md`](../CREDITOP.md). Aquí solo se documentan como **FKs**:
  `lenders.response_type` y `user_requests.user_request_status_id`.
- Hecho estructural útil: el catálogo `response_types` tiene filas **0-3** (0=UTM, 1=Integración, 2=Creditop X,
  3=Cupo Rotativo) — **`response_type=3` SÍ es una fila real** del catálogo. El **valor huérfano es
  `response_type=4`** (Credifamilia #24, async): existe como valor en `lenders` pero **no tiene fila** en
  `response_types`.
- Estados clave que aparecen como FK en los flujos: `9` Formulario de perfil, `10` Pendiente de autorización,
  `11` Autorizada (objetivo del cierre in-platform). ⚠️ `40`/`41` **NO** son `user_request_statuses`: son
  `lender_transaction_statuses` (ver §Integraciones externas).

### `fields` (201 filas) + `user_field_values`

`fields` define cada campo (`id, name, type, validation, field_category_id, …`); `user_field_values` guarda la
respuesta del usuario por `field_id`. IDs que aparecen en los flujos (verificados):

| field_id | name | type | Dónde |
|----------|------|------|-------|
| 29 | Situación laboral | select_options | laboral |
| 87 | Ingresos mensuales | currency | laboral / capacidad de pago |
| 90 | Total egresos mensuales | currency | laboral / capacidad de pago |
| 162–172 | **formulario dinámico SmartPay** | select/file/checkbox/radio | `cityOfResidence`(162), `averageMonthlyIncome`(163), `primaryOccupationType`(164), `associateNumberScreenshot`(165, file), `incomeType`(166), `employmentOrBusinessTenure`(167), `incomeChannels`(168), `activeCredits`(169), `hasActiveCreditCard`(170), `approximateMonthlySpend`(171), `hasPaymentDelaysOver30Days`(172) |

> Qué inyecta cada flujo en estos campos (Corbeta `Empleado` en 29, Quanto/Pullman auto-ingreso en 87, etc.) →
> [`./LOGICA-QUEMADA.md`](./LOGICA-QUEMADA.md) y [`./REFERENCIA-FLUJOS.md`](./REFERENCIA-FLUJOS.md).

## El cierre Creditop X (rt=2/3) — tablas

| Tabla | Rol |
|-------|-----|
| `promissory_notes` | pagaré firmado (⚠️ `user_request_id` **sin UNIQUE ni índice** → N pagarés por solicitud posibles) |
| `creditop_x_consents` | filas de consentimiento por solicitud (FK `consent_type_id`; ver catálogo abajo) |
| `creditop_x_consent_types` | catálogo de tipos. ⚠️ **Solo `id=3` (`device_lock_agreement`) está sembrado en local.** Los tipos `1` (consent / 1er uso) y `2` (`consent-second-utilization` / revolving) viven en **código** y en filas de `creditop_x_consents`, pero **no existen como filas de catálogo local** (cuidado al hacer JOIN). Evidencia: `ConsentService.php:283`, `RevolvingCreditsService.php:184,192` |
| `creditop_x_revolving_credits` | cupo rotativo (rt=3): `approved_limit`, `used_limit`, `fga` |
| `creditop_x_requests_history` | libro mayor de utilizaciones (driver del bloqueo/desbloqueo IMEI: `days_past_due`, `creditop_x_requests_status_id`) |
| `lender_users_categories` | **categorías de riesgo** del lender (ver detalle abajo) |
| `lender_guarantee_criteria` | criterio de garantía. ⚠️ filas con campos NULL → rompen `authorize` (ver [`./CASOS-ESPECIALES.md`](./CASOS-ESPECIALES.md)) |

**`lender_users_categories`** — columnas: `name, loan_limit, already_used_loan, FGA, min_initial_fee,
max_fee_number, max_amount, rate, requires_other_lender, order, available_amount_multiplier,
life_percentage` (default `20`). Categorías reales en local (no solo las 3 "buenas"): **`Premium`**,
**`Recuperar mejores`**, **`Segunda oportunidad`** (mejor → peor perfil, FGA creciente 5% → 12% → 20%),
además de `Estandar`, `Malos`, `Última oportunidad`, `Reportados`, `Bancarizados`, `Unico`/`Unica`,
`DFS_1`, `DFS_2`.

## Integraciones externas (rt=1/4) — tablas

| Tabla | Rol |
|-------|-----|
| `lender_transactions` | transacción con la entidad externa: `status_id`, `order_id`, `request` (json), `response` (json) |
| `lender_transaction_statuses` | estados por lender. Ej. Credifamilia (lender 24): `40` **CREDIT_IN_PROCESS** / `41` **CREDIT_APPROVED** / `42` **CREDIT_DENIED** (nombres con prefijo `CREDIT_`) |
| `lender_allied_credentials` | credenciales (mTLS/OAuth/tokens) por comercio↔entidad |

## Identidad / centrales — tablas

| Tabla | Rol |
|-------|-----|
| `risk_central_user_data` | respuesta de centrales; `score` (decimal) plano + `data` (longtext, encriptado) |
| `risk_central_credentials` | credenciales por central; deceval requiere una de tipo `Lender` |
| `user_summaries` | resumen por usuario. Columnas (todas `json`): `agildata`, **`mareigua`**, **`tusdatos`**, `datacredito`, `quanto`, `abaco` |

> **Orden de consulta de identidad** (Onboarding): Agildata → Mareigua → TusDatos (de ahí las columnas
> homónimas en `user_summaries`). Si ninguna trae datos, se habilita el formulario manual. Si el cliente ya
> está **preaprobado**, se salta Datacrédito.

## Motor de riesgo / Perfilador (subdominio *Credit Underwriting*) — tablas

Subdominio que **decide a quién ofrecer y bajo qué condiciones** (NO ejercido por el harness E2E, que fuerza el
lender + siembra perfil). Tablas verificadas en el mirror local:

| Tabla | Rol |
|-------|-----|
| `lender_rules` | **reglas duras generales** por entidad. Cols: `group_rule_id, lender_id, field_id, specific_table, column, operator, value, status` → predicado configurable (campo/operador/valor). `group_rule_id=NULL` marca las reglas base y es **común a casi todos los lenders** (~6 reglas c/u; 135/136/137 tienen 7). Lender 46 = Mediarte X, pero su rol de "template" es convención y **no se distingue en los datos** |
| `lender_datacredito_rules` | reglas duras contra **Datacrédito**. ⚠️ **Matriz con miles de filas por entidad** (lender 6 → 1069, 68 → 998, 9 → 848 filas; 7183 totales). NO es "1 fila por entidad": solo 107 filas tienen `allied_branch_id` NULL (la mayoría lo lleva no-nulo) |
| `lender_users_categories` | **categorías** = condiciones de crédito por nivel de riesgo (ver §cierre Creditop X) |
| `lender_users_category_rules` / `lender_user_category_scoring_policy_rules` | validaciones por categoría (score mínimo, ocupación, reportes negativos 12m, consultas 6m, edad, capacidad de endeudamiento…) |
| **`profiling_reviews`** | **registro de la decisión del Perfilador** por solicitud. Cols clave: `recommended_lender`, `disbursed_lender`, `displayed_lenders`, **`hard_rules`**, `selected_lenders`, `datacredito_query`, **`demog_predictions`** (motor demográfico), **`matrix_predictions`** (motor matrices Datacrédito), **`ML_predictions`** |
| `users_category_log` | log de aceptación de categoría por usuario. Cols: `user_id, lender_id, lender_users_category_id, category_rules_acceptance, current_available_amount` → aquí se ve **qué regla quedó en `false`** cuando un usuario no califica |

> **Dos motores de perfilamiento** (campos en `profiling_reviews`): con buró = **matrices** sobre Datacrédito
> (reportes negativos 12m, consultas 6m, créditos negativos, score); sin buró = **demográfico** (género,
> situación laboral, rango de edad, rango de ingresos). Diagnóstico "¿por qué no aparece Ctop X?":
> `profiling_reviews.hard_rules` (regla en `false`) → luego `users_category_log.category_rules_acceptance`.

## Garantía IMEI / device-locking (Motai · SmartPay-RD) — tablas

Para créditos de **celulares**, el dispositivo es la garantía: se bloquea remotamente si el cliente entra en
mora (`days_past_due > 3`). Cadena: `Creditop X → LB → Trustonic` (host `MERCHANT_GATEWAYS_HOST`). Es
comportamiento **post-desembolso**; el harness E2E solo stubea el *enroll* MDM durante la originación Motai.

| Tabla | Rol |
|-------|-----|
| `device_locks` | estado de bloqueo por producto/IMEI. Cols: `user_request_product_id, imei, status, locked_at, unlocked_at, api_response`. `status` enum completo: `pending, locked, unlocked, failed, unlock_failed, pending_release, released, release_failed` |
| `user_request_products` | producto del pedido (lleva el `imei`) — lo que se ancla como colateral |

**Tres jobs diarios** (`legacy-backend/app/Console/Kernel.php:15-17`):

| Job | Hora | Acción |
|-----|------|--------|
| `app:lock-devices-past-due` | **04:00** | **Bloqueo** de dispositivos en mora |
| `app:unlock-devices-paid` | **05:00** | **Desbloqueo** |
| `app:unroll-devices-paid` | **06:00** | **Des-enrolamiento** MDM |

> ⚠️ **Corrección de horarios:** el bloqueo es 04:00 (no 05:00); 05:00 es el desbloqueo (docs previos los
> invirtieron). El desbloqueo **no** evalúa `next_payment_amount==0`: `UnlockDevicesPaidCommand.php:31-44`
> filtra `CreditopXRequestHistory` con `status=1` y `creditop_x_requests_status_id IN (1,3)`, cuyo lender
> tiene `path.name = 'IMEI'` y tiene `activeDeviceLock`.
>
> IMEI es de **Motai #158** (rt=2). **SmartPay #152 (rt=2) cierra vía `CreditopXClose` estándar, NO IMEI.**

## Ciclo post-desembolso / cartera (subdominio *Loan Servicing + Billing*) — tablas

NO cubierto por el harness E2E (que valida la **originación**). Punto ciego documentado en
[`./CREDITOP.md`](../CREDITOP.md) §7.4.

| Tabla | Rol |
|-------|-----|
| `creditop_x_requests_history` | libro mayor de utilizaciones del crédito (causación de intereses, cortes) |
| `creditop_x_payment_register` | registro de cada pago. FKs: `status_id` (estado), `payment_type_id` (tipo), `payment_gateway_transaction_id`, `payment_method` |
| `creditop_x_payments` | desglose del pago aplicado por ítem en el core |
| `payment_gateway_transactions` | transacciones de pasarela (Wompi). ⚠️ **SÍ existe en el mirror local** (en **plural**); `creditop_x_payment_register.payment_gateway_transaction_id` la referencia |

⚠️ **Catálogos de pago — son DOS, no mezclar** (el doc previo los conflacionaba):

| Catálogo | Columna FK | Valores |
|----------|-----------|---------|
| `creditop_x_payment_statuses` (**estado** del pago) | `status_id` | `1` Recibido · `2` Reversado · `3` Pendiente |
| `creditop_x_payment_types` (**tipo** del pago) | `payment_type_id` | `1` RETENIDO · `2` ABONO A CAPITAL · `3` PAGO A CUOTA · `4` PAGO TOTAL · `5` CONDONACIÓN INTERESES · `6` DESC. 5% SOBRE CAPITAL · `7` PAGO CUOTA INICIAL · `8` REVERSADO |

> Pagos vía **Wompi**: cada intento se registra en `payment_gateway_transactions` y se hace *polling* con
> `CheckStatus`; los pagos `RETENIDO` se liberan en el siguiente corte. Cifras de condonación/deuda rt=2 →
> [`./CASOS-ESPECIALES.md`](./CASOS-ESPECIALES.md).

## Deudas / gotchas del modelo (verificadas)

- `have_ctopx` y `slug` solo en `allieds` (no branches).
- `response_types` tiene filas `0-3` (rt=3 Cupo Rotativo es una fila real); `response_type=4` (Credifamilia #24)
  existe como valor en `lenders` pero **fuera del catálogo** `response_types` (único huérfano).
- `40`/`41` son `lender_transaction_statuses` (CREDIT_IN_PROCESS/CREDIT_APPROVED), **no** `user_request_statuses`.
- `lender_allied_credentials` se llave por `allied_id`, **no** tiene `allied_branch_id`.
- `promissory_notes.user_request_id` **sin UNIQUE ni índice**.
- `lender_datacredito_rules` = **miles de filas por entidad** (matriz), no "1 por entidad".
- `creditop_x_consent_types` local solo tiene `id=3` sembrado; tipos 1/2 viven en código.
- FKs colgantes: `allieds.payment_plan_id` (tabla `payment_plans` **no existe**),
  `lenders_by_allieds.{credit_note_calculation_id, starting_value_calculation_id}` (solo
  `treasury_calculations` existe).
- **`validation_type`** (en `lenders`, vía `identity_validation_types`): `1` = None (sin validación, usado por
  externos rt=1 probados), `2` = AWS (AwsOcrRekognition), `4` = ADO. Un valor distinto a 2/4 con flujo Creditop X
  rompe la pantalla "Confirmar".
- **Naming plural en BD vs singular en Confluence:** la BD usa `lender_users_categories`, `users_category_log`,
  `payment_gateway_transactions` (no `lender_user_categories` / `user_category_log` / singular).
- IDs de prod cableados que no existen local → ver [`./LOGICA-QUEMADA.md`](./LOGICA-QUEMADA.md). Caso SmartPay:
  en dev/local existen **lender `152`** (rt=2, `smartpay`) y **lender `153`** (rt=1, `SmartPay`); el lender
  **`160` NO existe en la BD local** — `160` es el `smartpay_lender_id` de **producción**
  (`config/lenders.php:24`, rama `APP_ENV==='production' ? 160 : 153`). El código nunca compara contra el
  literal `160`: lo hace contra `config('lenders.smartpay_lender_id')` vía `Lender::isSmartpayChannel()`
  (`Lender.php:65-67`).

> El modelo de dominio completo y la realidad por-tabla viven en [`../domain-model/`](../../domain-model/)
> (modelo deber-ser + `docs/audit/REALIDAD-ACTUAL.md`); **este doc es el resumen autoritativo de la estructura
> de las tablas que importan para los flujos**.
