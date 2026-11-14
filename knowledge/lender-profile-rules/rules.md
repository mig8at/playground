# Perfiles de una entidad: orden, criterios y bloqueos del cupo

Una entidad de riel 2 a 4 decide cuánto prestarle a un cliente con **perfiles** (categorías,
`lender_users_categories`) y sus **reglas** (`lender_users_category_rules`): la primera regla que el
cliente cumple le asigna la categoría, y de la categoría cuelgan cupo, plazo máximo, cuota inicial y
tasa. Este tema cubre, en legacy-backend, el orden de evaluación, cómo se convierte la capacidad en
cupo, criterios que no se leen como parecen (continuidad laboral, licencia, Ábaco) y lo que niega
el cupo antes de mirar perfiles. El alta de perfiles está en `creditopx-setup-diagnosis`; el puntaje
por respuestas, en `field-scoring-policy`; la tarjeta de oferta, en `creditopx-offer-calculation`.
`legacy-application` tiene su propio motor de perfiles, con otras reglas (última sección).

## Gana la primera regla que se cumple

Las reglas de la entidad se ordenan por `priority` y, a igual prioridad, por
`lender_users_category_id`. No hay que suponer `priority` en NULL, como asume el comentario del
repositorio: las reglas cargadas la traen informada y es común que varias empaten, y entonces decide el
id de la categoría. Sólo entran las reglas de categorías **activas**: un perfil
que ya asignó clientes no se borra, se apaga con `lender_users_categories.active`, y deja de evaluarse
sin perder el historial que explica decisiones pasadas. Cada etapa tiene su juego de reglas por
`lender_users_category_type_id`: titular inicial (1), titular extendida (2, la que tiene formulario) y
codeudor.

Un caso quemado se salta todo esto: un cliente con documento `CE` en la entidad 84 (Magnocell) recibe la
categoría 22 sin evaluar reglas, y no se escribe `users_category_log`. Si esa categoría no está cargada,
no hay nada que lo ataje.

Qué categoría quedó se lee en `users_category_log` (la fila más reciente por entidad; 0 es «ninguna»), y
se comprueba corriendo con `make harness-suite TARGET=local SUITE=harness/suites/categorias-creditopx.json`,
que mueve un dato del buró por caso (consultas, tarjetas, negativos, meses de aportes).

## De la capacidad mensual al cupo

Todo lo de esta sección es de legacy-backend
(`Modules/Loans/App/Services/LenderUserCategoryService.php`). La capacidad mensual del perfil se convierte en cupo con la fórmula de anualidad sobre el plazo
máximo a la tasa de la entidad: cuánto capital aguanta esa cuota. Si la categoría declara
`available_amount_multiplier`, **el multiplicador manda** y la fórmula no corre: el cupo es N veces la
capacidad mensual, sin depender de tasa ni plazo. Es una decisión comercial por categoría.

Ese monto se topa después (`calculateAvailableAmount`) con el cupo mensual de la categoría, su
`max_amount` y el `max_amount` de la línea de crédito, todos llevados a monto con `min_initial_fee`; con
`debt_capacity_amount_validation` en 0 la capacidad no entra y manda el menor de los topes. Si la
entidad declara `lender_requirements.monthly_disbursement_limit`, también se topa con lo que le queda
de ese tope en el mes (`LenderMonthlyLimits::remainingDisbursements`); sin tope configurado esa cota no
cuenta.

Un perfil cuya fila de reglas tiene `capacity_method = finandina_v1` no usa ni la anualidad ni el
multiplicador: el monto lo calcula `FinandinaAmountCalculator`, con las condiciones que lee
`FinandinaTerms`. La capacidad es el ingreso menos el porcentaje de ley y el de gastos de la banda del
perfil (`income_bands`), menos las cuotas del buró (Tabla 3) y las de los créditos del cliente con la
entidad autorizados en los últimos días, que el buró todavía no ve. Esa capacidad se lleva a monto con
la tasa de modelado (`capacity_rate` de la línea; sin valor, `rate`), el plazo, el FGA y el seguro de
vida. El cupo es el menor entre ese monto, el múltiplo de ingreso de la banda, el tope sin experiencia
crediticia, el `max_amount` del perfil, su cupo mensual, lo que le queda a la entidad en el mes y el
máximo de la línea. Sin SMMLV del año, con bandas inválidas o con un ingreso bajo la primera banda, el
perfil no aplica. El monto mínimo de la línea no se aplica ahí: lo rechaza `available-quota` con
`below_min_amount`, como al resto.

Cuando la entidad tiene otorgamiento especial (el cálculo de DENTIX/DFS), ese monto reemplaza al cupo
del perfil, pero se topa con el `max_amount` de la categoría si está configurado mayor que 0.

En legacy-application (`app/Services/lenders/LenderUserCategoryService.php`) sólo se toma el menor entre el
monto del perfil, su `max_amount` y el cupo mensual, llevado a monto con `min_initial_fee`: no topa con
el máximo de la línea ni con el tope mensual de la entidad, y no existe `finandina_v1`.

## La continuidad laboral va por escalones

El motor no mide meses de continuidad: los deriva de banderas de AgilData (o, si no hay, de Mareigua)
y sólo puede valer 12, 6, 3 o 0. En legacy-backend, «si no hay» es un `??` sobre la columna, que el modelo convierte en
colección: un `agildata` guardado como `[]` es una colección vacía, no null, así que **no cae a
Mareigua** y la continuidad da 0 aunque Mareigua traiga meses. En legacy-application la cascada pregunta
`isset($userSummary->agildata['approximate_real_salary'])`, así que un `agildata` vacío sí cae a Mareigua
y, después, a Quanto (continuidad 0). Una regla que pide 8 meses exige en la práctica 12, y una que pide
más de 12 no la cumple nadie. Sin datos, la continuidad es 0.

En legacy-backend, un perfil cuya fila de reglas declara `income_sources` (centrales separadas por `|`, como
`agildata|mareigua`) no usa esa cascada: el ingreso es el de la primera de esas centrales con monto
(`MonthlyIncomeResolver::verifiedIncome`) y la continuidad sale de **esa misma** central, con los mismos
escalones. Ahí un `agildata` vacío no tapa a Mareigua. Si ninguna dio ingreso, la continuidad es 0 y el
criterio `verified_income` niega el perfil. legacy-application no tiene `income_sources`.

Se comprueba corriendo con `make harness-suite TARGET=local SUITE=harness/suites/continuidad-escalones.json`:
en CREDI TRACK, que pide 9 meses para Premium, un cliente con 11 meses de aportes no entra.

## Vigencia de la licencia, sólo en la etapa extendida

`min_license_validity_years` sólo se evalúa en reglas de la etapa extendida (tipo 2) con un valor
mayor que 0; en la etapa inicial se ignora porque no hay formulario. La fecha de vencimiento se lee
de la respuesta del formulario dinámico en el campo `license_expiry_field_id`, y la licencia debe
vencer en o después de hoy más N años. Sin campo configurado, sin solicitud o sin respuesta, la regla
**niega**: exige la vigencia y no hay con qué comprobarla.

## Cuándo se ofrece saltar Ábaco

«Continuar sin validar» el paso de Ábaco se ofrece (y el salto se acepta) si la entidad no tiene
reglas de etapa extendida, o si **alguna** de ellas deja pasar sin datos de Ábaco. Una regla niega
sin datos cuando configura viajes mensuales o antigüedad en plataforma **y** marca
`reject_without_gig_data`. Es por entidad y no por persona: antes de evaluar no se sabe en qué
categoría caerá el cliente. El resto del requisito está en `abaco-requirements`.

## Lo que niega el cupo antes de mirar perfiles

`available-quota` (y sus variantes de etapa extendida y codeudor) decide en este orden antes de mirar
perfiles:

- **riel 3 (rotativo):** sale por `RevolvingCreditsService`, que evalúa la misma política dura y no pasa
  por el crédito activo ni por la categoría.
- **`lender_not_creditop_x`** si la entidad es de riel 0 o 1: no tienen cupo financiado por Creditop.
- **`active_credit_exists`** si el cliente ya tiene con **esa misma entidad** de riel 2 un crédito
  vivo (fila vigente del histórico) con saldo de capital de $1.000 o más. Por debajo se trata como
  residuo y no bloquea. Otras entidades y el rotativo no cuentan.
- **`client_monthly_credits_exhausted`** si la entidad declara
  `lender_requirements.max_credits_per_client_month` y el cliente ya llegó a ese número de créditos con
  ella en el mes calendario (`ClientMonthlyCreditRuleEvaluator`: solicitudes con `disbursed_at` en el
  mes, hora de Bogotá, sin canceladas ni negadas). Va antes del motor y no como criterio de perfil
  porque el motor se vuelve a correr después de reservar el cupo, y ahí el crédito recién autorizado ya
  contaría. Sin la columna, no hay tope. `OfferStillStandsGuard` lo recuenta al firmar.
- **la política dura de la entidad:** `LenderRuleEvaluator` (`lender_rules`) y después
  `DatacreditoRuleEvaluator` (`lender_datacredito_rules`), los de `creditopx-setup-diagnosis`.
  El listado no los usa (tiene su propio `match` en `LenderValidationService`), salvo el rotativo,
  vía `RevolvingHardPolicyGate`.

Si después ninguna categoría sale y es la etapa extendida de una entidad **sin reglas de esa etapa**,
no se rechaza: se aprueba sin política (`no_type_policy_approved`) y el cupo vigente es el de la etapa
inicial.

Con categoría, el monto todavía puede negarse por la entidad y no por el cliente: bajo el `min_amount`
de la línea es `below_min_amount`, o `lender_quota_exhausted` si lo que le queda a la entidad de su
`lender_requirements.monthly_disbursement_limit` ya no alcanza ese mínimo. Con monto 0 es
`profile_quota_exhausted` si se agotó el cupo mensual del perfil, `lender_quota_exhausted` si se agotó
el tope de la entidad, y si no `zero_quota_calculated`.

Se comprueba corriendo con `make harness-suite TARGET=local SUITE=harness/suites/cupo-creditopx.json` (cierra
en Motai R y vuelve: Motai R niega el cupo, Motai RB no) y su compañera sin cierre,
`make harness-suite TARGET=local SUITE=harness/suites/cupo-sin-credito.json` (cliente nuevo con cupo; entidades de
riel 0 y 1 con `lender_not_creditop_x`). En local, el cupo mensual del
perfil se agota con las corridas que cierran: `make harness-quota-reset TARGET=local APPLY=1` lo reinicia.

## La periodicidad de corte se congela

En el backoffice, el tipo de corte de una entidad deja de poder cambiarse: siempre en un rotativo,
porque el cupo y todas sus compras se facturan con ese corte, y en consumo apenas la entidad originó
un crédito, porque cambiarlo movería las fechas de pago de créditos firmados.

## El motor de legacy-application

`legacy-application` calcula la categoría con su propio `LenderUserCategoryService`, que llaman el
consentimiento, el pagaré, la garantía (de ahí sale el FGA), el pago de la cuota inicial, el listado y
dos pantallas del admin. Para el mismo cliente puede dar otra categoría que `legacy-backend`:

- **No filtra:** toma todas las reglas de la entidad, ordenadas por `priority` y categoría, sin mirar
  `active` ni la etapa (`lender_users_category_type_id`). Una categoría apagada o de otra etapa puede
  ganar.
- **Lista negra:** un documento en `CreditopXBlacklistedDocument` para esa entidad deja sin categoría y
  escribe `users_category_log` con categoría 0. `legacy-backend` no la consulta.
- **Continuidad e ingreso:** usa AgilData sólo si trae `approximate_real_salary`; si no, Mareigua con
  esa misma condición, y si no, Quanto (con continuidad 0). Así un `agildata` vacío sí cae a Mareigua.
  Una regla con `verified_income` exige que el ingreso salga de una de esas tres fuentes.
- **Edad:** la evalúa siempre. `legacy-backend` la da por cumplida cuando el comercio no pide la fecha de
  expedición; acá una edad vacía no pasa.
- **Magnocell (84) con `CE`:** también usa la categoría 22, pero escribe la 2 en `users_category_log`.
