# CreditopX: alta de una entidad y por qué no aparece

Qué tablas tiene que tener una entidad CreditopX para que el listado la muestre y el cupo la apruebe,
y cómo leer en la base por qué un cliente no la vio, la vio sin cupo o no pudo autorizar. Describe
`legacy-backend` (listado `lenders-v2`, `available-quota`, la autorización y el backoffice nuevo) y
`legacy-application` donde copia reglas y escribe categorías. No certifica la configuración de
ninguna entidad ni el estado de un ambiente: eso se consulta en su base. El listado general está en
`lender-listing`, el cupo mensual del perfil en `creditopx-quota`, la cascada de proveedores de
identidad en `credifamilia-origination` y cuándo se consulta Experian en
`kyc-path-and-experian-trigger`.

## Dos puertas evalúan la misma política

El listado y el cupo leen filas distintas de las mismas tablas:

- El listado `lenders-v2` (`LenderValidationService`) evalúa las `lender_rules` de los `group_rules`
  de la sucursal de la solicitud, y sólo si la sucursal tiene algún `group_rule`; una entidad sin ningún `group_rule` en la sucursal
  desaparece del listado (no queda ni aprobada ni rechazada). Una regla con
  `status = 0` no se evalúa; un grupo con todas sus reglas apagadas deja pasar a la entidad, y basta
  un grupo que pase. Las reglas por `specific_table` sólo leen `age`, `gender` y `document_type`;
  otra columna se compara contra vacío. Este listado no evalúa `lender_datacredito_rules` para excluir: lee la copia por sucursal en
  `RiskCentralValidationService` para la probabilidad y `can_check_preapproval`.
- `available-quota` (`LenderRuleEvaluator`) evalúa la plantilla: las `lender_rules` con
  `group_rule_id` nulo y `status = 1`. Lee cualquier columna de `specific_table` y compara con
  `LenderRuleEvaluator::matches` (los mismos operadores que el listado). Si al cliente le falta el
  valor de un campo de la regla, rechaza (`missing_field_value_<id>`, o
  `missing_specific_table_value`). `DatacreditoRuleEvaluator` lee una fila de
  `lender_datacredito_rules` con `allied_branch_id` nulo (la primera que devuelva la base, sin
  orden); sin esa fila el filtro no aplica. Sin datos de buró rechaza con `no_datacredito_data`, y
  con un registro sin puntaje o sin `principals`, con `datacredito_data_incomplete`. En
  `no_datacredito_data` el log dice además si alguna consulta de DataCrédito (Acierta o
  Acierta+Quanto) de esa persona falló en las últimas 24 horas (`datacredito_consult_failed`, un
  marcador en caché que no se borra al consultar bien), para separar un timeout o un 503 de alguien
  sin historial. La razón y el resultado no cambian.

Las dos puertas aplican el tope de créditos del cliente en el mes
(`lender_requirements.max_credits_per_client_month`, `ClientMonthlyCreditRuleEvaluator`) a las
entidades 2: el listado saca a la entidad de las que pasaron y `available-quota` rechaza con
`client_monthly_credits_exhausted` antes de evaluar la plantilla.

Por eso una entidad puede salir en el listado y fallar al pedir cupo, o al revés, cuando la
plantilla y las copias de la sucursal no coinciden.

## Alta: plantilla, copias y perfiles

El admin de `legacy-application` (`addNewLenderRule`, al asociar entidades a una sucursal o crear la
sucursal de un ecommerce) copia la plantilla (`group_rule_id` nulo) a un `group_rule` nuevo de la
sucursal, salvo que la sucursal ya tenga un grupo con reglas de esa entidad. La copia no lleva
`status`: queda activa por defecto aunque la regla de la plantilla esté apagada. Si no había
plantilla, crea el grupo vacío y la sucursal queda sin filtro para esa entidad en el listado.

El backoffice nuevo (`PUT lenders/{lender}/rules`, `LenderRulesWriterService`) escribe todo en una
transacción: la plantilla y sus copias por sucursal; si la entidad no tenía reglas, crea la
plantilla y un `group_rule` por cada sucursal activa en `lenders_by_allied_branches`. Sólo toca las
reglas de su catálogo; las demás se listan como no gestionadas. Rechaza las entidades con política
de otorgación especial, y a una rotativa sólo le edita la política, sin perfiles. La regla de
datacrédito se escribe en la fila sin sucursal (la crea si falta) y se copia a las filas por
sucursal. Los perfiles (`lender_users_categories` y sus `lender_users_category_rules`) se
sincronizan con el orden de la pantalla en `priority`, que es lo que ordena la evaluación; `order`
es sólo un espejo. `already_used_loan` nunca se escribe desde ahí. Un perfil se puede desactivar
(`lender_users_categories.active`): conserva sus filas para el historial, el motor de categorías de
`legacy-backend` sólo carga reglas de categorías activas y el readiness no lo cuenta como perfil
evaluable. El servicio de categorías de `legacy-application` no filtra por `active`. Un perfil con
asignaciones, productos o historial de cupo mensual no se puede borrar; se desactiva.

El guardado puede llevar un documento de soporte (`LenderRulesSupportDocumentService`): sólo se
acepta si el guardado cambia algo, se sube dentro de la misma transacción y queda referenciado en el
snapshot de esa versión (`support_document_key`, `support_document_name`).

Los montos mínimo y máximo de la entidad (`credit_line_by_lenders`, el rango de monto que acepta el
wizard) se editan desde la configuración del backoffice (`PUT lenders/{lender}/config/credit-line`)
y quedan versionados en el mismo historial que la política; una entidad sin fila de línea de crédito
se rechaza en vez de crearle una. El mismo `PUT` acepta opcionalmente `capacityRate`
(`credit_line_by_lenders.capacity_rate`, la tasa con que la política de Finandina modela la
capacidad): sin la clave la columna no se toca. La misma configuración guarda el método de pago de la
entidad (`PUT lenders/{lender}/config/payment-method`, `payment_methods_by_lender`, ver
`lender-response-types`).

## Identidad y NIT

`CreditopXFlowService` toma el proveedor de identidad de la fila con `order = 1` de
`lender_identity_validation_types`, sin mirar su estado. Sin esa fila devuelve el paso `error` con
tipo `no_validation_configured`, salvo que el cliente tenga una validación manual de menos de 24
horas. El estado de la validación (`ValidationStatusService`) usa la misma fila: sin ella el tipo
queda en desconocido (0) y sólo exige TusDatos; la columna heredada `lenders.validation_type`
(2 AWS, 4 ADO, 5 CrossCore, entre otros) sólo se usa si la fila trae un tipo fuera del catálogo, y
si las dos difieren se registra la deriva. El backoffice de configuración avisa
`no_primary_provider`, `primary_inactive` o `no_active_provider`. El NIT del pagaré y los
consentimientos es `lenders.originator_nit`, que el backoffice guarda con puntos y dígito de
verificación.

## Diagnóstico: no salió en el listado

Con `response_type` 2, una entidad que no cumple las reglas de la sucursal sale del listado; con 3,
también, salvo que el cliente ya tenga un cupo rotativo aprobado con ella. El detalle queda en
`profiling_reviews.hard_rules` de la solicitud: por entidad y por `group_rule`, una entrada por
regla con `rule_id`, `field_id` o `specific_table`/`column`, `operator`, `value`,
`data_to_validate` y `response`. Una entidad pasa si cualquiera de sus `group_rule` sale entero en verdadero, así que una `response`
en falso explica la salida sólo si ningún grupo de esa entidad pasó; una entrada con
`rule_id` nulo y `all_rules_disabled` es un grupo con todo apagado. El reemplazo de la revisión al
guardar los resultados de preaprobación conserva el mismo `hard_rules`.

Una entidad 2 también sale si el cliente ya llegó al tope de créditos del mes con ella
(`lender_requirements.max_credits_per_client_month`, `ClientMonthlyCreditRuleEvaluator`), y esa
salida no deja rastro en `hard_rules`: sus reglas pueden figurar todas en verdadero. Se confirma
pidiendo cupo, que rechaza con `client_monthly_credits_exhausted`.

La falta de categoría no saca a una entidad CreditopX de `lenders-v2`: el listado evalúa la categoría
(`stampCreditopXApproval`) sólo para sellar el estado 11 cuando alguna entidad 2 aprueba con cupo.

## Diagnóstico: salió sin cupo

Si la tarjeta aparece rechazada, decidió `available-quota`. Para `response_type` 2 recorre, en
orden: entidad inactiva, crédito activo, tope de créditos del cliente en el mes, plantilla de reglas,
regla de datacrédito, categoría, bloqueo por categoría de puntaje, otorgación especial, tope por
condiciones de monto, piso de `min_amount` y cupo. Una rotativa (3) va por su propio cálculo y los
tipos 0 y 1 se rechazan con `lender_not_creditop_x`. La razón viaja en `reason`
(`active_credit_exists`, `client_monthly_credits_exhausted`, `lender_rule_failed`,
`missing_field_value_<id>`, `no_datacredito_data`, `datacredito_data_incomplete`,
`score_below_threshold`, `negative_historical_exceeded`, `consulted_6m_exceeded`,
`time_finance_sector_insufficient`, `eligibility_criteria_not_met`,
`scoring_policy_fallback_blocked`, `insufficient_debt_capacity`, `below_min_amount`,
`lender_quota_exhausted`, `profile_quota_exhausted`, `zero_quota_calculated`) y en el log
`QUOTA_CHECK_REJECTED`. Ese log trae `rejection_stage` sólo hasta el bloqueo por puntaje (validación,
crédito activo, tope mensual del cliente, plantilla, datacrédito, puntaje). `profile_quota_exhausted`
es el perfil sin bolsa en el mes, no el cliente.

El tope de créditos del cliente (`ClientMonthlyCreditRuleEvaluator`) sólo aplica si la entidad tiene
`lender_requirements.max_credits_per_client_month`: cuenta los créditos del cliente con esa entidad en
el mes calendario y, al llegar al tope, rechaza con `client_monthly_credits_exhausted`. Va antes del
motor de categorías porque el motor se vuelve a correr después de reservar el cupo. Con
`lender_requirements.monthly_disbursement_limit`, lo que le queda a la entidad en el mes topa el monto
calculado; si por eso el cupo queda bajo `min_amount` o en cero, la razón es `lender_quota_exhausted`
en vez de `below_min_amount` o `zero_quota_calculated`: es el cupo de la entidad, no el del cliente.

`scoring_policy_fallback_blocked` significa que ninguna regla de categoría aprobó y la categoría
salió de la política de puntaje, cosa que sólo se acepta si la entidad no tiene reglas de categoría.

## Sin buró: sin categoría y la autorización rechaza

Sin fila de buró (`User::datacredito`, la última de Acierta o Acierta+Quanto), cada regla de
categoría falla en `datacredito`, salvo que la entidad valide ingresos con Ábaco o el país del
comercio no tenga centrales activas. Si además la política de puntaje no da categoría, el motor
devuelve nula: `available-quota` responde `eligibility_criteria_not_met` y el listado no sella la
aprobación.

Si el cliente igual elige la entidad y llega a autorizar, `legacy-backend`
(`CreditopXRequestHistoryService::createFirstRegister`, llamado desde `LoanAuthorizationService`)
vuelve a evaluar la categoría antes de crear el crédito y, con `response_type` 2 y categoría nula,
lanza `LoanAuthorizationException` 422 «El usuario no tiene una categoría vigente con la entidad
para registrar el consumo de cupo.», dentro de la transacción. Ese chequeo no aplica el bloqueo por
puntaje: una categoría que salió sólo de la política de puntaje pasa. `legacy-application`
(`CreditopXRequestHistoryController::createFirstRegister`) no rechaza: si la entidad tiene categorías
y nada aprueba, registra una advertencia y crea el crédito sin descontarlo de ningún cupo.

## Leer `users_category_log`

El motor de categorías escribe una fila por evaluación; el listado (`stampCreditopXApproval`),
`available-quota` y la autorización evalúan cada uno, así que una solicitud deja varias. No toda
evaluación escribe: con `logResult` en falso `getLenderUserCategory` no deja fila, y así evalúan, a
través de `InitialFeePolicyResolver`, la foto de la oferta al elegir la entidad
(`OfferSnapshotRecorder`) y la compuerta que la compara en el plan de pagos, los documentos, el OTP y
la autorización (`OfferStillStandsGuard`). La tabla no tiene `user_request_id`: se busca por
`user_id` y `lender_id`, tomando la más reciente anterior al momento que se diagnostica.

`category_rules_acceptance` es un JSON con una clave por id de `lender_users_category_rules`
evaluada, en orden de `priority` y luego id de categoría, y por cada una sus criterios en verdadero
o falso (`occupation`, `age`, `min_income`, `score`, `debt_capacity`, `datacredito`…). Un perfil
con `income_sources` suma `verified_income` (si alguna de esas centrales dio ingreso); una regla de
etapa extendida con `residence_city_field_id`, `residence_city`; y sólo los perfiles con la política
de Finandina (`capacity_method = finandina_v1`), `finandina_report_fresh` y `finandina_capacity`. Gana la primera que
cumple todo: las anteriores muestran por qué no. Con aprobación por regla la fila trae la categoría y
`available_amount`; en la raíz del JSON van, como escalares junto a `available_amount`, las consultas
evaluadas y, si aprobó un perfil de Finandina, las claves `finandina_*` (SMMLV, versión de reglas,
capacidad, ingreso, tasa, plazo, reporte usado…): un lector que tome cada arreglo de la raíz como una
regla las ignora. Si aprobó por puntaje, el JSON lleva `scoring_path`, `final_score` y sus
componentes en vez de los criterios; si nada aprobó, `lender_users_category_id` es 0. Las reglas de
un perfil desactivado no aparecen en las filas de `legacy-backend`: no se evalúan. Un `datacredito`
en falso es un cliente sin consulta de buró, que corta la evaluación de esa regla.
`legacy-application` tiene su propio servicio que escribe la misma tabla con otras claves (por
ejemplo `ocupations` en vez de `occupation`).
