# CreditopX: alta de una entidad y por qué no aparece

Qué tablas tiene que tener una entidad CreditopX para que el listado la muestre y el cupo la apruebe,
y cómo leer en la base por qué un cliente no la vio o la vio sin cupo. Describe `legacy-backend`
(listado `lenders-v2`, `available-quota` y el backoffice nuevo) y el admin de `legacy-application`
donde copia reglas. No certifica la configuración de ninguna entidad ni el estado de un ambiente:
eso se consulta en su base. El listado general está en `lender-listing`, el cupo mensual del perfil
en `creditopx-quota` y la cascada de proveedores de identidad en `credifamilia-origination`.

## Dos puertas evalúan la misma política

El listado y el cupo leen filas distintas de las mismas tablas:

- El listado (`LenderValidationService`) evalúa las `lender_rules` de los `group_rules` de la
  sucursal de la solicitud. Una regla con `status = 0` no se evalúa; un grupo con todas sus reglas
  apagadas deja pasar a la entidad.
- `available-quota` (`LenderRuleEvaluator`) evalúa la plantilla: las `lender_rules` con
  `group_rule_id` nulo y `status = 1`. Si al cliente le falta el valor de un campo de la regla,
  rechaza (`missing_field_value_<id>`). `DatacreditoRuleEvaluator` lee la única fila de
  `lender_datacredito_rules` con `allied_branch_id` nulo; sin esa fila el filtro no aplica.

Por eso una entidad puede salir en el listado y fallar al pedir cupo, o al revés, cuando la
plantilla y las copias de la sucursal no coinciden.

## Alta: plantilla, copias y perfiles

El admin de `legacy-application` (`addNewLenderRule`) copia la plantilla (`group_rule_id` nulo) a
un `group_rule` nuevo de la sucursal al habilitar la entidad allí. Si no había plantilla, la
sucursal queda sin filtro en el listado.

El backoffice nuevo (`PUT lenders/{lender}/rules`, `LenderRulesWriterService`) escribe todo en una
transacción: la plantilla y sus copias por sucursal; si la entidad no tenía reglas, crea la
plantilla y un `group_rule` por cada sucursal activa en `lenders_by_allied_branches`. Sólo toca las
reglas de su catálogo; las demás se listan como no gestionadas. La regla de datacrédito se escribe
en la fila sin sucursal (la crea si falta) y se copia a las filas por sucursal. Los perfiles
(`lender_users_categories` y sus `lender_users_category_rules`) se sincronizan con el orden de la
pantalla en `priority`, que es lo que ordena la evaluación; `order` es sólo un espejo.
`already_used_loan` nunca se escribe desde ahí.

## Identidad y NIT

`CreditopXFlowService` toma el proveedor de identidad de la fila con `order = 1` de
`lender_identity_validation_types`, sin mirar su estado. Sin esa fila devuelve el paso `error` con
tipo `no_validation_configured`. El estado de la validación usa la misma fila y, si no existe, cae a
la columna heredada `lenders.validation_type` (2 AWS, 4 ADO, 5 CrossCore, entre otros). El
backoffice de configuración avisa `no_primary_provider`, `primary_inactive` o `no_active_provider`.
El NIT del pagaré y los consentimientos es `lenders.originator_nit`, que el backoffice guarda con
puntos y dígito de verificación.

## Diagnóstico: no salió en el listado

Con `response_type` 2, una entidad que no cumple las reglas de la sucursal sale del listado. El
detalle queda en `profiling_reviews.hard_rules` de la solicitud: por entidad y por `group_rule`, una
entrada por regla con `rule_id`, `field_id` o `specific_table`/`column`, `operator`, `value`,
`data_to_validate` y `response`. Una `response` en falso es la regla que la sacó. El reemplazo de la
revisión al guardar los resultados de preaprobación conserva el mismo `hard_rules`.

## Diagnóstico: salió sin cupo

Si la tarjeta aparece rechazada, decidió `available-quota`. Recorre, en orden: entidad inactiva,
crédito activo, plantilla de reglas, regla de datacrédito, categoría, bloqueo por categoría de
puntaje, otorgación especial, piso de `min_amount` y cupo. La razón viaja en `reason`
(`lender_rule_failed`, `score_below_threshold`, `negative_historical_exceeded`,
`consulted_6m_exceeded`, `time_finance_sector_insufficient`, `no_datacredito_data`,
`eligibility_criteria_not_met`, `scoring_policy_fallback_blocked`, `insufficient_debt_capacity`,
`below_min_amount`, `profile_quota_exhausted`, `zero_quota_calculated`) y en el log
`QUOTA_CHECK_REJECTED` con su `rejection_stage`. `profile_quota_exhausted` es el perfil sin bolsa
en el mes, no el cliente.

`scoring_policy_fallback_blocked` significa que ninguna regla de categoría aprobó y la categoría
salió de la política de puntaje, cosa que sólo se acepta si la entidad no tiene reglas de categoría.

## Leer `users_category_log`

El motor de categorías escribe una fila por evaluación; el listado (`stampCreditopXApproval`) y
`available-quota` evalúan cada uno, así que una solicitud deja varias. La tabla no tiene
`user_request_id`: se busca por `user_id` y `lender_id`, tomando la más reciente
anterior al momento que se diagnostica.

`category_rules_acceptance` es un JSON con una clave por id de `lender_users_category_rules`
evaluada, en orden de `priority` y luego id de categoría, y por cada una sus criterios en verdadero
o falso (`occupation`, `age`, `min_income`, `score`, `debt_capacity`, `datacredito`…). Gana la
primera que cumple todo: las anteriores muestran por qué no. Con aprobación la fila trae la
categoría y `available_amount`; si nada aprobó ni por puntaje, `lender_users_category_id` es 0. Un
`datacredito` en falso es un cliente sin consulta de buró, que corta la evaluación de esa regla
salvo que la entidad valide ingresos con Ábaco o el país no tenga centrales activas.
`legacy-application` tiene su propio servicio que escribe la misma tabla con otras claves (por
ejemplo `ocupations` en vez de `occupation`).
