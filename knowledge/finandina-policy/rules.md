# Política de Finandina en el motor de CreditopX

Cómo corre la política de otorgamiento de Banco Finandina dentro del motor de perfiles de CreditopX en `legacy-backend`
(main): qué piezas la activan, en qué orden decide y qué se carga a mano. Las decisiones y sus porqués están en el ADR
del repo (`docs/finandina-policy-adr.md`). Los valores de un ambiente (qué perfiles tiene, con qué tasas) se miden en su
base. La fórmula de capacidad y el monto están en [la capacidad mensual al cupo](knowledge:lender-profile-rules#de-la-capacidad-mensual-al-cupo);
el riel por el que llega, en [el tipo 4](knowledge:lender-response-types).

## Qué la activa: configuración del motor, no un código aparte

La política no tiene clase de decisión propia: son perfiles del motor (`lender_users_categories` y sus filas de reglas)
con campos que agregó la migración `2026_10_29_120100_add_finandina_policy_columns`. Lo que la enciende es una fila de
reglas con `capacity_method = finandina_v1` (`FinandinaPolicy::CAPACITY_METHOD`); en `NULL`, el perfil usa la fórmula de
siempre. Las piezas puras viven en `Modules/Loans/App/Services/RiskPolicy/Finandina/`, y las comparten el motor
(`LenderUserCategoryService`), el simulador del editor de reglas del backoffice y la revisión de capacidad del detalle de
la solicitud, para que den el mismo número.

El ADR fija la forma de la configuración: un perfil por letra de riesgo (AA, A, B, C, S, Y) y por ocupación (empleado,
pensionado), cada uno con su etapa base y extendida, ordenados por prioridad. La letra es el `min_score` del perfil; Y va
última y sin mínimo. El FGA y las veces el ingreso son de cada perfil.

## El orden en que decide

1. **Compuertas de la entidad**, antes de los perfiles: el score de `lender_datacredito_rules` (con `allow_0_score`), las
   `lender_rules` (cédula, por `users.document_type`), el crédito activo y el tope de créditos del cliente en el mes
   (`ClientMonthlyCreditRuleEvaluator`, `client_monthly_credits_exhausted`; ver la sección de los topes).
2. **El primer perfil que se cumple.** Con `finandina_v1`, `min_score` se compara contra el **Advance 1.1** del reporte
   (`BureauScore::advance`, modelo `Z0`), no contra `risk_central_user_data.score`, que es el promedio de los modelos del
   reporte. Sin Advance en el reporte, usa el score guardado.
3. **Lo que exige el perfil:**
   - ingreso y continuidad sólo de las centrales de `income_sources` (`agildata|mareigua`, en ese orden); sin ninguna,
     el perfil no aplica (`verified_income`);
   - ocupación (campo 29) y edad, como cualquier perfil;
   - un reporte de Experian de no más de `FinandinaPolicy::MAX_REPORT_AGE_DAYS` (60) días (`finandina_report_fresh`);
     el motor lee el último Acierta guardado sin mirar su fecha, así que esta guarda es la que lo frena;
   - en la **etapa extendida**, la ciudad de residencia dentro de las zonas de la entidad (ver abajo).
4. **El monto**, con `FinandinaAmountCalculator`: sin SMMLV del año, con bandas inválidas o con un ingreso bajo la
   primera banda, el perfil no aplica.

El SMMLV sale del setting `smmlv_by_year` (`Smmlv::forDate`) y falla cerrado: sin el año en curso, ningún perfil de
Finandina aplica y el motor lo deja en el log como error. `SmmlvNextYearCheck` avisa desde el 15 de diciembre si falta el
año siguiente.

## Experiencia crediticia y zonas

**Experiencia** (`CreditExperienceEvaluator`, modo «cualquiera»): tiene experiencia quien cumple una de dos.
- Una obligación abierta hace más de 12 meses en el sector financiero o cooperativo, con valor inicial o cupo de al
  menos el mínimo del perfil.
- Una obligación de cualquier sector, abierta o cerrada en los últimos 48 meses, del mismo mínimo.

Sin experiencia, el monto se topa con `without_experience_max_amount` del perfil.

**Zonas.** `ResidenceCityResolver` traduce la respuesta del formulario dinámico (departamento y ciudad, por nombre,
por id de `country_cities` o por código DANE, siempre dentro del departamento respondido) y la compara con
`cities_by_lender`. La lista la carga `finandina:sync-zones` con los códigos DANE de `FinandinaPolicy::ZONE_DANE_CODES`.
Sin respuesta o con una ciudad desconocida, el criterio `residence_city` niega. Sólo se evalúa en la etapa extendida
(`/available-quota/extended`), que el asistente llama después de identidad para cualquier entidad: el listado muestra a
Finandina a personas fuera de las zonas.

## Del cupo a la firma: el plazo y la oferta

- **El plazo.** El monto se calcula al plazo máximo, porque el cliente todavía no eligió. `CapacityTermPolicy` recorta
  los plazos que publican la tarjeta del listado y el plan de pagos a los que caben en la capacidad, con lo financiado
  sin FGA (`original_amount − initial_fee`). Lee la capacidad de la última evaluación guardada; `confirm()` rechaza un
  plazo que no cabe.
- **La oferta se sostiene hasta firmar.** Al elegir la entidad, `OfferSnapshotRecorder` guarda la cuota inicial que pide
  el resolutor para esa oferta. `OfferStillStandsGuard` vuelve a preguntarle en el plan, los documentos, el OTP y la
  autorización: si ahora pide más (bajó el cupo), contesta 409 `OFFER_CHANGED`. El mismo guard recuenta el tope de
  créditos del cliente en el mes. No es exclusivo de Finandina: cubre cualquier perfil cuyo cupo pueda bajar.

## Los topes del mes: de la entidad y por cliente

`LenderMonthlyLimits` lee dos columnas de `lender_requirements` (`NULL` = sin tope), con el mes calendario en hora de
Bogotá y contando al autorizar, no al desembolsar:

- **`monthly_disbursement_limit`**, el de la entidad: el tope menos la suma de `already_used_loan` de sus perfiles.
  Entra como uno de los topes del monto y, agotado, rechaza con `lender_quota_exhausted`; no frena la autorización. El
  bloqueo es por fila de perfil, así que dos autorizaciones en perfiles distintos pueden pasarse por un crédito.
- **`max_credits_per_client_month`**, por cliente: cuenta las solicitudes con `disbursed_at` en el mes, sin los estados
  6, 8 y 12. Frena en el motor antes de los perfiles, en la cuota inicial y la firma (`OfferStillStandsGuard`) y en el
  listado.

El filtro del listado sigue atado al tipo 2, mientras que la reserva del cupo mensual ya cubre al riel 4:
- El filtro del listado (`LenderValidationService::validateRulesByLender`, con `ClientMonthlyCreditRuleEvaluator`)
  sólo saca al cliente cuando la entidad es `response_type === 2`; con el riel 4 la tarjeta sale y la rechaza la
  preaprobación. No pasa por `dropsWhenRulesFail`, que sólo decide la salida por reglas duras (tipo 2, o 3 sin cupo
  rotativo aprobado).
- `CreditopXRequestHistoryService::createFirstRegister` reserva el cupo del perfil tanto en `response_type == 2` como en
  el riel 4 (`DelegatedOriginationLenders::RESPONSE_TYPE`) cuando la entidad tiene categorías configuradas
  (`hasCategories`). Así, en Finandina `already_used_loan` sí sube y el tope de la entidad se consume (a diferencia del
  tipo 2, si falta categoría vigente en riel 4 no lanza 422 y sólo registra un warning).

## Qué queda guardado

`users_category_log` guarda, para una evaluación con `finandina_v1` que registre log (`logResult: true`, como
`CreditopXQuotaController::resolveQuota`), el reporte usado y su fecha, el SMMLV, la versión de las reglas del editor,
el tope que ató y la capacidad con sus componentes (`finandina_*` en `category_rules_acceptance`).

`LenderRetrievalService::resolveCategory` llama al motor con `logResult: false`, por lo que los listados v1 y v2 no
escriben en `users_category_log`; la tarjeta de `LenderRetrievalService` lee los datos del plazo desde
`$user_category?->finandina_evaluation` vía `FinandinaEvaluationLog::fromEvaluation`, mientras que el plan de pagos
consulta la última evaluación en `users_category_log` (`FinandinaEvaluationLog`).

## Lo que se carga a mano

Según el runbook y las decisiones de configuración del ADR (`docs/finandina-policy-adr.md:66`):
- **Cada año:** el SMMLV en `settings.smmlv_by_year`.
- **Cada mes:** `rate` y `capacity_rate` de la línea, y el texto de la tasa de la tarjeta.
- **Por comercio:** el seguro de vida en `lenders_by_allieds` (`life_insurance_percentage`, que es el que entra en la
  cuota, e `insurance_percentage_per_million`, que sólo se muestra en documentos).
- **Una vez por ambiente:** por SQL, el alta en el riel (`response_type = 4`, `validation_type = 2`, la fila de
  `delegated_origination_profiles` con `inputs_source = creditop_x_pre_approval`, sin formalización, `forced_bond_type =
  Anticipada`, sin 4x1000 y días de pago `[5, 10, 15, 20]`, manteniendo `promissory_type_id = 1` hasta cargar la
  credencial de Deceval), el tipo de validación de identidad, la ubicación del formulario de residencia y los textos de
  la tarjeta; las zonas con `finandina:sync-zones`.
- **Una letra nueva o una tabla de riesgo nueva:** `min_score` y las bandas desde el editor de reglas.

## Lo que el ADR deja fuera o da por supuesto

- El ADR pone a Finandina en el riel de originación delegada (`response_type = 4`, con `externally_serviced = 1`): en el
  riel 4 la decisión llega por la preaprobación, y el adaptador `creditop_x` de pre-approvals-service llama al mismo
  motor por `/available-quota` (en un rechazo de negocio guarda `RejectionReason` desde `data.reason` o, si no, desde
  el `reason` del sobre). Algunas piezas siguen atadas al tipo 2 (ver la sección de los topes).
- Fuera del alcance del ADR quedan la formalización: el pagaré Deceval (pendiente de la credencial de Finandina), la
  entrega del crédito a Finandina, los documentos y la fianza FGA.
- No hay reglas negativas (compra de cartera, retanqueo, mora, castigos): no están configuradas.
- El riesgo del empleador que trae Mareigua no lo lee ningún criterio.
- Los dos plazos de 60 días (reporte y cuotas recientes) están marcados en el código como «por confirmar» con Finandina.
