# La decisión de política guardada: qué se evaluó para el cupo y dónde se lee

Cómo `legacy-backend` deja, por solicitud, la foto de lo que evaluó la política de crédito de una entidad con perfiles
`finandina_v1` (Banco Finandina) en cada momento del recorrido, y cómo `legacy-application` la muestra en la
pestaña Perfilamiento del detalle de solicitud. Es un registro: no decide nada. La política en sí (compuertas, perfiles,
bandas, topes) está en [la política de Finandina](../finandina-policy/rules.md#el-orden-en-que-decide); el cupo mensual
del perfil, en [el cupo de CreditopX](../creditopx-quota/rules.md#se-carga-al-autorizar-con-la-fila-bloqueada).
`frontend-monorepo` no lee ni escribe esta decisión.

## Qué guarda: una fila por solicitud y momento

La tabla es `user_request_policy_decisions` (modelo `App\Models\UserRequestPolicyDecision` en los dos monolitos; la
migración y la escritura son sólo de `legacy-backend`). Columnas: `user_request_id`, `lender_id`, `stage`,
`lender_users_category_id` (nullable), `decision` (JSON) y los timestamps. No tiene llaves foráneas; el índice único
`uq_policy_decision_request_stage` es (`user_request_id`, `stage`).

`stage` toma cuatro valores, en el orden del flujo (`UserRequestPolicyDecision::STAGES`): `listing`, `selection`,
`extended` y `authorization`. `PolicyDecisionRepository::save` hace un upsert sobre el índice único: volver a pasar por
el mismo momento reemplaza la fila entera, `created_at` incluido, así que la fila dice cuándo se tomó esa decisión, no la
primera vez. Una solicitud puede tener filas de varias entidades: el `lender_id` es el de la evaluación, no
necesariamente el que la solicitud tiene hoy.

## El JSON de la decisión

`decision` lo arma `FinandinaDecisionSnapshot` (versión `VERSION = 2`). Es puro: copia los números de la evaluación que
el motor ya hizo (`finandina_evaluation` de la categoría más `finandina_decision_context`, que agrega
`LenderUserCategoryService::attachFinandinaDecisionContext`) y sólo calcula los plazos con `CapacityTermPolicy`.

- `outcome` (`approved` | `rejected`) y `rejection`: `null` si se aprobó; si no, `{at, reason, checks}` con `at` =
  `hard_policy` (una compuerta de la entidad o un tope después del motor) o `profiles` (ningún perfil pasó).
- `profile` (`category_id`, `name`, `rule_id`, `stage`, `min_score`), `score.advance`, `income` (monto, central,
  SMMLV), `band`, `obligations` (Tabla 3 con `items` por obligación, la cuenta ya enmascarada, y
  `recent_installments`), `capacity.monthly`, `rates`, `term_months`.
- `caps` con los topes de `FinandinaAmountCalculator` en el orden de `CAPS` (`capacity`, `income_multiple`,
  `without_experience`, `max_amount`, `profile_quota`, `lender_quota`, `credit_line`; `null` el que no aplica) y
  `binding_cap`, el que ató.
- `approved_amount` (el de la política) y `offered_amount` (lo que de verdad se ofreció en esa etapa; en
  `available-quota` ya recortado por las condiciones de monto de la entidad).
- `report` (id y fecha del reporte usado), `rules_snapshot_id` (`LenderRulesSnapshot::currentIdFor`), `residence`
  (`evaluated`, `allowed`, ciudad y departamento) y `request` (montos de la solicitud, `amount_with_fga`,
  `fitting_terms`, `installments_by_term` y `min_fitting_term`).

Un rechazo antes del motor (`buildRejected`) deja todo lo calculado en `null` y conserva `rejection`, los montos de la
solicitud, `rules_snapshot_id` y la residencia si se evaluó. Dinero en pesos, porcentajes como números y
`evaluated_at` en hora de Bogotá.

## Un PolicyCheck: cada filtro evaluado

`PolicyCheck::make` arma un arreglo `{criterion, label, rule, value, passed}`: el código del filtro, su nombre en español
(en un rechazo por perfiles, el nombre del perfil), la regla escrita para una persona (`operatorRule` traduce `>=`,
`<=`, `=` con `|` a «≥ X», «≤ X», «A o B»), el valor del cliente como texto y si lo cumplió. Sólo formatea: quien evalúa
decide `passed`. Las compuertas lo devuelven en `RuleValidationResult::$checks`, en orden y hasta la que rechazó, sin
cambiar `passed` ni `reason`:

- `ActiveCreditRuleEvaluator`: `active_credit`.
- `ClientMonthlyCreditRuleEvaluator`: `client_monthly_credits` (sólo si la entidad tiene
  `max_credits_per_client_month`).
- `LenderRuleEvaluator`: una por fila de `lender_rules`, con el `name` de la fila como código.
- `DatacreditoRuleEvaluator`: `datacredito_report`, `datacredito_score`, `negative_historical_12m`, `consulted_6m`,
  `time_finance_sector`.

El motor aporta un check por perfil que no pasó (`LenderUserCategoryService::lastProfileOutcomes`, con su primer
criterio fallido: `verified_income`, `occupation`, `score`, `residence_city`, `finandina_report_fresh`…) y
`PolicyDecisionRecorder::afterEngineCheck` uno para el filtro que rechazó después del motor: `below_min_amount`,
`lender_quota_exhausted` (con lo que le queda a la entidad, releído de `LenderMonthlyLimits::remainingDisbursements`),
`profile_quota_exhausted` o `zero_quota_calculated`.

## Cuándo se escribe cada momento

`PolicyDecisionRecorder` escribe sólo si alguna fila de `lender_users_category_rules` de la entidad tiene
`capacity_method = finandina_v1` con su categoría activa (`lenderUsesFinandinaPolicy`), y siempre reusa la evaluación que
ese momento ya hizo:

- **`listing`**: `CreditopXQuotaController::getAvailableQuota` (`POST api/loans/lender/available-quota`, tipo 1) llama
  a `recordQuota` con el `PolicyDecisionTrail` que anotó `resolveQuota` (cada compuerta con `gate()`, el motor con
  `engine()`, el monto mínimo con `minAmountCompared()`). Escribe aprobaciones y rechazos. Se congela en cuanto la
  solicitud tiene otra etapa: las consultas repetidas de la preaprobación del riel 4 no la reescriben.
- **`selection`**: `OfferSnapshotRecorder::record`, que corre desde `UserRequestService` al elegir la entidad
  (`update-user-request` y `soft-update-user-request`), llama a `recordSelection` con la categoría memoizada de
  `InitialFeePolicyResolver::category` (`logResult: false`); en el riel 4, donde la foto de la oferta no evalúa, es la
  única evaluación. Sólo escribe si hay categoría con `finandina_evaluation` (una aprobación).
- **`extended`**: `getExtendedQuota` (`available-quota/extended`, tipo 2), igual que `listing`, con la residencia.
- **`authorization`**: `CreditopXRequestHistoryService::createFirstRegister` pasa la categoría que acaba de reevaluar
  (tipo 2, o riel 4 con `hasCategories`) y el `principal_amount_balance` del registro de creación a `recordAuthorization`,
  registrado con `DB::afterCommit`: si el crédito hace rollback, la decisión no se escribe.

`recordQuota` exige `user_request_id`, respuesta 200 y que la solicitud sea del `user_id` evaluado (si no, un warning y
nada). No escribe si no corrió ninguna compuerta ni el motor, si ganó un perfil sin `finandina_v1` ni si la etapa no
tenía política. El cupo del codeudor (`cosigner-quota`) y el rotativo (tipo 3) no pasan trail; los listados de
`LenderRetrievalService` no pasan por el recorder.

## Sólo registro: nunca cambia el cupo

Guardarla no altera ninguna respuesta. Cada entrada del recorder atrapa cualquier excepción y la registra en el tracer
como `Policy decision not recorded` con `exceptionContext` (la clase y el código SQL, nunca el mensaje, que llevaría el
JSON con datos del cliente). Si la tabla no existe, el flujo sigue. El trail tampoco cambia la resolución: sólo anota.
Lo que decide sigue siendo el motor y sus compuertas; lo que sostiene la oferta hasta firmar es `OfferStillStandsGuard`
contra la foto de `user_request_offer_snapshots`, otra tabla.

## La lectura: GET policy-decision

`GET api/loans/admin/user-requests/{userRequestId}/policy-decision` (`PolicyDecisionController::show`) es de sólo
lectura. El grupo `api/loans/admin` lleva sólo los middlewares `otel` y `api`, sin autenticación en `legacy-backend`:
el control de acceso lo hace `legacy-application`. Responde 422 `invalid_user_request_id` si el id no es numérico, 404
`user_request_not_found`, 500 `policy_decision_failed` si algo falla, y si no lo que arma
`PolicyDecisionReviewService::forUserRequest`:

- `decided`: la fila que cuenta, por preferencia `authorization` > `extended` > `selection` > `listing`, entre las de
  la entidad que la solicitud tiene hoy, o entre todas si no hay ninguna de esa entidad. Lleva `stage`, `lender_id`,
  `created_at` y el JSON; si no evaluó la residencia, toma la de la fila `extended` de la misma entidad.
- `stages`: todas las filas, `{stage, lender_id, created_at, outcome}`, por fecha y con el orden del flujo de desempate.
- `recalculated_today` y `differs` (ver la sección siguiente).

## El recálculo de hoy y la capacidad informativa

`recalculated_today` es el bloque `finandina` de `DebtCapacityReviewService::forUserRequest`, recalculado al abrir la
pantalla con los datos actuales y con el perfil de la decisión (`profile.rule_id`); sin perfil (rechazo antes del motor)
usa el del último log del motor. Es `null` si `decided` es de otra entidad que la de hoy, si el perfil no es
`finandina_v1` o si el cálculo falla (se loguea y la decisión guardada sale igual). `differs` compara en pesos enteros
`approved_amount`, `binding_cap` y `capacity.monthly`; con `decided` rechazada, sin perfil o sin recálculo es `false`.

`DebtCapacityReviewService` (también en `GET …/debt-capacity`) es sólo informativo: recalcula con
`FinandinaAmountCalculator` y no decide. Para no restarle a una solicitud ya autorizada su propio crédito, descuenta lo
que ella reservó: `LenderMonthlyLimits::bookedThisMonth` (sus `credit_booked` del mes en `creditop_x_quota_events`, por
perfil) se le devuelve al cupo del perfil, y `remainingDisbursements` y `clientRecentInstallments` reciben
`exceptUserRequestId`. Sin eso el tope que ataría sería su propio crédito y `differs` saldría `true` solo.

## La pestaña Perfilamiento de legacy-application

La ruta es `solicitudes/{userRequest}/perfilamiento` en el subdominio `admin.`, con los middlewares `admin` y
`moved.to.backoffice` (`UserRequestProfilingController::index`). Quién entra
(`UserRequestPolicy::viewProfiling`): si la entidad exige aprobación manual, quien puede `manualApprove`; si no, sólo el
`Administrador` y sólo si `UserRequestPolicyDecision::existsFor` (hay alguna fila, de cualquier entidad; con la tabla
ausente, `false`).

La decisión se pide sólo si el usuario puede ver la política de esa entidad: `lenderIdFor` elige la entidad de la
solicitud si tiene fila, si no la de la fila más reciente, y `canSeePolicyOf` deja al `Administrador` o al usuario de
entidad (`UserRequestPolicy::isLenderUser`) con ese `lender_id`. `LoansApiClient::profilingReads` la trae en un
`Http::pool` junto a `risk-policy-review` y `debt-capacity` (timeout de 5 s). Los recortes:

- `policyDecisionOfAllowedLender`: si `decided.lender_id` no es la entidad permitida, el bloque no va; a quien no es
  `Administrador` se le quitan las `stages` de otras entidades.
- `policyDecisionForViewer`: sin `manualApprove` se quitan `obligations.items` y `tabla3.obligations`; respuesta fallida
  → `['failed' => true]` («No disponible»); sin `decided` → `null`, sin bloque.
- `debtCapacityForViewer`: el bloque `finandina` de la capacidad sólo le llega a quien pasa `canSeePolicyOf` para la
  entidad de la solicitud.

`PolicyDecisionReview.vue` pinta «Cómo se calculó el cupo»: las cuatro etapas como chips, el aviso «Recalculado hoy, el
resultado cambia.» con la tabla de diferencias si `differs`, y siempre lo decidido. En un rechazo, dónde se frenó y «Lo
que revisó la política» con los checks; en una aprobación, perfil, ingreso y banda, capacidad, topes, plazos y
residencia.

## Límites y diferencias entre monolitos

- `legacy-backend` crea la tabla, escribe y sirve la ruta; `legacy-application` no tiene migración y lee la tabla
  directo sólo para `existsFor`, `lenderIdFor` y el reporte `FinandinaCreditsReportExport` (créditos autorizados de
  Finandina con la etapa que más pesa). El contenido de la decisión lo pide por la API.
- Sólo hay filas para entidades con perfiles `finandina_v1`; otras entidades del motor no dejan nada.
- `selection` y `authorization` sólo guardan aprobaciones de un perfil `finandina_v1`; los rechazos quedan sólo en
  `listing` y `extended`.
- Una fila por momento: las evaluaciones repetidas del mismo momento se pisan y no queda historia. `listing` se congela
  tras la primera etapa posterior.
- No guarda la respuesta de pre-approvals-service ni la del codeudor, y no reemplaza `users_category_log`, que sigue
  sin `user_request_id` (ver [qué queda guardado](../finandina-policy/rules.md#que-queda-guardado)).
