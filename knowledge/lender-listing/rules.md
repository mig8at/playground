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
cada entidad con su probabilidad, `weighted_score`, porcentaje y monto. Cuando terminan de resolverse
las consultas de preaprobación (al cargar y tras cada reintento exitoso), `AvailableLenders` del
asistente nuevo manda las entidades visibles, armadas por `buildLenderResultsPayload`, al endpoint
`lender-results` (`ListLenderController::storeLenderResults`).

`replaceLenderResults` archiva la revisión vigente y crea otra con exactamente esas entidades: una
oculta por el asistente (respaldo, Welli Risk, error del servidor) desaparece, no queda «Rechazado».
El docblock de `storeLenderResults` dice lo contrario; el código las descarta. Cada entidad conserva
`weighted_score` y porcentaje del primer guardado; aprobada queda «Pre aprobado» o el texto enviado,
con su monto; cualquier otro estado queda con monto 0 y la etiqueta de su tarjeta («Rechazado», «Sin
cupo disponible», «No consultado por políticas internas», «error»…), o la probabilidad original si no
tenía estado. El resultado de una sola entidad (`lender-result`, Credifamilia, la vuelta de Cuotéalo)
usa `updateAsyncLender`, que reescribe esa entrada sobre la revisión vigente sin sacar a las demás.

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


## Las reglas duras sólo sacan del listado a algunas entidades

El listado evalúa las `lender_rules` de los grupos de la sucursal: por campo del formulario
(`field_id`) o por tabla, donde sólo se leen `age` y `gender` del usuario (cualquier otra columna
compara contra vacío). Los operadores son `=` (varios valores separados por `|`), `>=`, `<=` y `!=`.
Lo que pasa cuando una entidad no cumple depende de su `response_type`:

- Con 2 (CreditopX) sale del listado.
- Con 3 (rotativo), en el backend modular, sale salvo que el cliente ya tenga un cupo rotativo
  aprobado con esa entidad. application no tiene este caso y la deja.
- Con cualquier otro valor se queda, marcada «Probabilidad muy baja» y ordenada al final. Las
  entidades 5, 135, 136 y 137 quedan además con «0% de probabilidad».

Por eso cargar en `lender_rules` la política de una entidad de respuesta externa no la saca del
listado. En el backend modular una regla con `status = 0` no se evalúa, como en el flujo de cupo;
application la sigue evaluando.

El umbral de score de `lender_datacredito_rules` (con `allow_0_score` para aceptar score 0) sólo lo
aplican caminos de CreditopX: en el backend modular, el cupo de CreditopX y el rotativo
(`DatacreditoRuleEvaluator`), porque en el listado esa evaluación está comentada; en application,
el listado lo evalúa sólo para `response_type` 2. `cities_by_lender` existe como tabla en los dos
monolitos, pero ningún código la lee: no restringe por ciudad.
