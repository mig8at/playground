# Listado de entidades

Este tema cubre las puertas del listado, la resolución del monto en el backend modular, cómo se
reescribe el perfilamiento guardado después de las consultas y qué necesita Welli Risk para aparecer.
Describe código revisado en main; la configuración de un comercio y el comportamiento de una
solicitud concreta se consultan en su ambiente.

## Dos puertas en el backend modular

Las rutas de Onboarding conservan GET `lenders/{user_request_id}` y GET
`lenders-v2/{user_request_id}`. La primera entra a `ListLenderController@index` y delega en
`LenderRetrievalService`; la segunda entra a `LenderListingController@index` y delega en
`LenderListingService`. Un diagnóstico debe identificar qué puerta atendió el pedido antes de
atribuirle el comportamiento de la otra.

## El monto del listado v2 se resuelve antes del cálculo

En `LenderListingService::getLenders`, un monto numérico positivo se normaliza con `Amount`;
en otro caso se usa el monto de la solicitud. El controlador suministra 180000 cuando el query
no trae `amount`, por lo que omitirlo en esa puerta no equivale a forzar el fallback de la solicitud.
Si `EcommerceRequest::orderTotalForUserRequest` devuelve un total, ese total reemplaza al monto
resuelto. El monto usado para ese cálculo se maneja sin persistirlo en ese punto del listado;
esto no afirma que todo el endpoint sea de sólo lectura.

## El monolito anterior tiene su propia entrada

En `legacy-application`, `ListLenderController::indexV2` recibe un `UserRequest` y llama a su
propio `LenderRetrievalService::getLenders(UserRequest)`. Después intenta aplicar un filtro
adicional; si ese filtro lanza una excepción, conserva la lista anterior y registra el error.
Comparar listados requiere leer la implementación que atendió cada caso: compartir el nombre
del servicio no demuestra que ambos recorridos decidan lo mismo.

## El último guardado del perfilamiento es lo que vio el cliente

Al armar el listado, `ProfilingReviewController::store` guarda en `profiling_reviews.displayed_lenders`
cada entidad con su probabilidad, `weighted_score` y porcentaje, y el monto disponible sólo para
algunas entidades (CreditopX preaprobado, Sistecrédito, Welli, Meddipay). Cuando terminan de resolverse
las consultas de preaprobación, el asistente nuevo manda las entidades visibles al endpoint
`lender-results` (`ListLenderController::storeLenderResults`) por dos caminos: el loader de
`available-lenders` lo hace desde el servidor cuando se resuelven todas las promesas que lanzó
(`postLenderResultsWhenSettled`, que arma la misma vista que la pantalla con
`buildServerLenderResultsPayload`), y `AvailableLenders` lo hace desde el navegador al cargar y tras
cada reintento exitoso (`buildLenderResultsPayload`). Los dos llevan `run_started_at_ms`, el momento en
que arrancó la corrida del loader.

`replaceLenderResults` bloquea la fila de `user_requests` y la revisión vigente (`lockForUpdate`),
igual que `store`, `updateAsyncLender`, `updateSelectedLenders` y `updateDisbursedLender`, así que los
guardados de una misma solicitud van en fila. Un snapshot con `run_started_at_ms` anterior al de la
revisión vigente es de una corrida vieja y se descarta sin tocar nada (`stale_run`). Si coincide con
la revisión vigente (mismas entidades y mismo recomendado) no crea otra y sólo adelanta
`run_started_at_ms`. Si no, archiva la revisión vigente y crea otra con exactamente esas entidades,
conservando `hard_rules`, `selected_lenders` y las predicciones: una oculta por el asistente
(respaldo, Welli Risk, error del servidor) desaparece, no queda «Rechazado». El docblock de
`storeLenderResults` dice lo contrario; el código las descarta. `recommended_lender` sale de la
primera entidad del snapshot, que el asistente ordena con la tarjeta recomendada primero; el campo
`recommended_lender` del request queda sin efecto.

Cada entidad conserva `weighted_score` y porcentaje del primer guardado; aprobada queda «Pre
aprobado» o el texto enviado, con su monto; cualquier otro estado queda con monto 0 y la etiqueta de
su tarjeta («Rechazado», «Sin cupo disponible», «No consultado por políticas internas», «error»…), o
la probabilidad original si no tenía estado. El resultado de una sola entidad (Credifamilia, y el
endpoint `lender-result`, que en `main` no tiene llamador activo: pre-approvals-service lo llama
detrás de `legacyLenderResultEnabled = false`) usa `updateAsyncLender`, que reescribe esa entrada
sobre la revisión vigente sin sacar a las demás. La vuelta de Cuotéalo no lo usa: sólo marca la
entidad desembolsada con `updateDisbursedLender` (`CuotealoReturnResolver`).

## Welli Risk depende de la sucursal, de la consulta compartida y de la comisión del aliado

Welli Risk (166) entra al universo del listado sólo si está en `lenders_by_allied_branches` de la
sucursal y activa. En el asistente nuevo hay una sola consulta para todas las variantes de Welli: la
dispara Welli Tasa Full (23) si está, o si no la primera variante, con sus credenciales, y las demás
reusan esa respuesta. `computeHiddenWelliRiskLenderIds` oculta la 23 cuando la respuesta trae
`comision_aliado` mayor que cero y la 166 está presente, y oculta la 166 en el caso contrario. Sin la
23 en la sucursal no hay de dónde leer la comisión y no oculta nada.

La credencial se busca distinto: `LenderAlliedCredential::findOrFailByLenderAndAlly` del monolito viejo
prueba la sucursal y después el comercio; `LenderCredentialService` del nuevo prueba el comercio y
después la sucursal. El `PreApprovedLenderService` viejo, además, saca a la 166 si el comercio de la
solicitud no es el `allied_id` 26, y la deja sólo si sale `approved` con monto máximo de al menos
180.000 y sin una solicitud previa de esa entidad en estado 11.

## Prami, Welli y la 166 quedan fuera del preaprobado, y del listado v1

En `legacy-backend`, el paso que decide si hay un preaprobado después de guardar la información laboral o
validar el OTP (`OnboardingController::storeLaboralInfoOrchestrator` y
`validateOtpCodeAndRedirectOrchestrator`, que llaman a `OnboardingService::validatePreApproveLender`) consulta
a las entidades de la sucursal, pero excluye a Prami (12), a las tres Welli (23, 141, 142) y a Welli Risk
(166) con un `whereNotIn` marcado «TEMPORAL» mientras se valida su paridad. A la 23 la volvió a excluir
CORE-553: crea la orden sin costos administrativos antes que el microservicio.

La puerta v1 del listado va más allá. `LenderRetrievalService::getLenders` saca esas cinco de la lista
armada antes de validar los preaprobados, así que **en esa puerta no aparecen en el listado**. El comentario
dice «del preaprobado», pero el filtro se aplica al listado entero. La puerta v2 (`LenderListingService`) no
tiene ese filtro.

En `legacy-application`, el mismo paso (`PersonalInfoController`) excluye 12, 141, 142 y 166, pero no la 23.
Prami queda afuera por diseño: necesita datacrédito y se dispara por `experian_trigger_allieds`, no como
preaprobado.

Qué puerta atendió un caso, y por lo tanto si estas entidades se ofrecieron, se mira en el caso, no en este
tema: que un filtro marcado temporal siga en `main` no dice qué recorre hoy cada cliente.

## Bancolombia tiene otra oferta en Sonría, sólo en la puerta v1

En los dos monolitos, `LenderRetrievalService::processLendersWithAdditionalInfo`, que arma las tarjetas de la puerta
v1, trae un «Filtro temporal para Sonria y Bancolombia». Cuando la solicitud es de Sonría (comercio 26) y la entidad
es Bancolombia (8), pisa la línea de crédito antes de mostrarla: plazos `1,2,3,4,6,12,18,24,30,36,48,60`, monto
máximo de 30.000.000 y tasa de 2,31. Lo que diga la configuración de esa línea no se ve en esa puerta.

La puerta v2 (`LenderListingService`) no tiene ese reemplazo, así que el mismo cliente de Sonría ve otra oferta de
Bancolombia según por qué puerta entre. Antes de diagnosticar una tasa, un plazo o un monto de Bancolombia en Sonría,
hay que saber qué puerta atendió el caso.

## Las reglas duras sólo sacan del listado a algunas entidades

El listado evalúa las `lender_rules` de los grupos de la sucursal: por campo del formulario
(`field_id`) o por tabla. Por tabla, el backend modular lee `age`, `gender` y `document_type` del
usuario; legacy-application sólo `age` y `gender`. Cualquier otra columna compara contra vacío. Los
operadores son `=` (varios valores separados por `|`), `>=`, `<=` y `!=`. Lo que pasa cuando una
entidad no cumple depende de su `response_type`:

- Con 2 (CreditopX) sale del listado.
- Con 3 (rotativo), en el backend modular, sale salvo que el cliente ya tenga un cupo rotativo
  aprobado con esa entidad. legacy-application no tiene este caso y la deja.
- Con cualquier otro valor se queda, marcada «Probabilidad muy baja» y ordenada al final. Las
  entidades 5, 135, 136 y 137 quedan además con «0% de probabilidad».

En el backend modular una entidad 2 sale también, aunque cumpla las reglas, si el cliente ya llegó
al tope de créditos del mes con ella (`lender_requirements.max_credits_per_client_month`,
`ClientMonthlyCreditRuleEvaluator`).

Por eso cargar en `lender_rules` la política de una entidad de respuesta externa no la saca del
listado. En el backend modular una regla con `status = 0` no se evalúa, como en el flujo de cupo;
legacy-application la sigue evaluando.

El umbral de score de `lender_datacredito_rules` excluye sólo en caminos de CreditopX: en el backend
modular, el cupo de CreditopX y el rotativo (`DatacreditoRuleEvaluator`, con `allow_0_score` para
aceptar score 0); en legacy-application, el listado lo evalúa sólo para `response_type` 2. En el listado del
backend modular el bloque de buró de las reglas duras está comentado, y la regla de la sucursal la
evalúa en cambio `RiskCentralValidationService`, sólo si el comercio tiene fila en
`datacredito_frequencies` y el cliente tiene score: sin `allow_0_score`, y una entidad que falla no
sale: vuelve a la lista con la probabilidad que le dan los niveles de score de la regla
(`probability_levels`, o «Probabilidad media» si no hay); sólo la entidad 5 queda en «0% de
probabilidad». `cities_by_lender` existe como tabla en los dos
monolitos y ningún listado la lee: no saca entidades por ciudad. En el backend modular sólo la lee el
motor de categorías, para el criterio `residence_city` de los perfiles de la etapa extendida con
`residence_city_field_id` (`ResidenceCityResolver::isAllowed`); legacy-application no la lee.
