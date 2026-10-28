# Oferta de CreditopX en la tarjeta: cupo, cuota inicial y cuota

Cómo se calculan el cupo, la cuota inicial mínima, el valor a financiar y la cuota que muestra la
tarjeta de una entidad CreditopX (`response_type` 2) o rotativa (3) en el listado del asistente.
Describe `frontend-monorepo` (el cálculo), `pre-approvals-service` (el cupo que llega) y
`legacy-backend` (los parámetros y la regla que repite al liquidar). No certifica los valores de
configuración de una entidad ni lo que se ve en un ambiente: eso se lee en su base. El cupo mensual
del perfil está en `creditopx-quota`; renting y RTO, en `renting-plans`.

## De dónde salen los números de la tarjeta

Los calcula el navegador con `CalculateLoanFinancialsUc` (paquete `lenders-marketplace`). El
backoffice usa el mismo caso de uso para reconstruir la simulación de un perfilamiento, así que su
desglose y la tarjeta coinciden. Los parámetros llegan en dos tiempos:

- `lenders-v2` hidrata cada entidad con su fila de `lenders_by_allieds` (costos administrativos %
  y fijo, FGA, IVA, `initial_fee_percentage`, seguros) y su línea de crédito; el `max_amount` de esa
  fila, si existe, reemplaza al de la línea. El FGA y el plazo ya vienen recortados por la
  categoría del cliente cuando la entidad tiene perfiles.
- Al resolverse la preaprobación, `mergeLenderWithResolution` pisa `available` con el cupo
  aprobado y, para `creditop_x`, la tasa (`category.rate`), el FGA (`category.fga`) y el
  porcentaje de cuota inicial (`quota_details.initial_fee_percentage`, que es el `min_initial_fee`
  de la categoría).

`lenders-v2` no devuelve `amountConditions` ni `categoryCredipullman` en la raíz de la respuesta:
en este camino esas dos entradas del cálculo llegan nulas, y el porcentaje y el FGA salen de lo que
trae la entidad.

## El cupo que llega como `available`

El adaptador `creditop_x` del servicio de preaprobaciones llama a `available-quota` y, si la
respuesta trae `has_quota` y estado `approved`, usa `quota_details.max_requestable` como monto
aprobado y `available`. `max_requestable` es el menor entre el cupo del motor de categorías (ya
topado por el tramo más alto de `creditop_x_conditions_by_amount_by_lender` menos 1, si la entidad
tiene tramos), lo que le queda al perfil en el mes y el `max_amount` del perfil. Si el cupo queda
por debajo del `min_amount` de la línea, la respuesta es un rechazo `below_min_amount`.

## La cuota inicial mínima es el mayor de dos pisos

`calculateMinimumInitialFee` parte de v1 = monto × (1 + admin%/100) + admin fijo. El tope es el
menor entre `credit_lines.max_amount`, el `max_amount` del producto (si hay) y `available` (si es
positivo). La mínima es `ceil(max(v1 − tope, porcentaje × v1 / 100))`: cubre a la vez el excedente
sobre el cupo y el porcentaje de política. El porcentaje es el del tramo de monto si llegan
`amountConditions` con `initial_fee_percentage`, y si no el `initial_fee_percentage` de la entidad.

## Cuándo se resta la cuota inicial

`requiresInitialFee` la exige siempre con `response_type` 2. Con 3, la exige si la entidad trae un
porcentaje mayor que cero o si el monto supera el cupo (`available`, o el `max_amount` de la línea
sin él). En CreditopX (2 y 3) también se resta una cuota escrita por el asesor aunque no se exija,
porque el backend la resta siempre. La escrita, si es mayor que cero, reemplaza a la mínima.

## Valor a financiar, FGA y cuota

Los costos administrativos se calculan sobre el monto solicitado completo, no sobre el reducido. El
subtotal es (monto − cuota inicial) + costos; si la entidad tiene un factor de ajuste para el plazo
elegido, se multiplica por factor × plazo. El FGA es subtotal × FGA% × (1 + IVA de
`lenders_by_allieds`), y la base de la cuota es subtotal + FGA. La cuota es la amortización francesa
a `rate/100` (o `rate/200` si `cutoff_type_id` es 2), o base/plazo con tasa cero, más seguros de
vida y fijos sobre esa base.

En CreditopX el «valor a financiar» mostrado es el subtotal sin FGA; para `response_type` 4 incluye
el FGA. Lo que se persiste siempre es la base con FGA (`financedAmountWithGuarantee`). En
ecommerce, con cuota inicial, el valor mostrado es monto − cuota inicial.

## Plazos que ofrece la tarjeta

El plazo inicial es `fee_number` del listado: el máximo de la línea, recortado por el
`max_fee_number` de la categoría y después por el tramo de monto (`applyAmountConditionTermCap`,
sobre `user_requests.amount`). En la tarjeta, `useInstallmentOptions` vuelve a filtrar las opciones
con el tramo que corresponde al capital (monto − cuota inicial efectiva): deja las que no superan
su `max_fee_number` y, con `mandatory_fee_number = 1`, sólo esa. Si el filtro deja la lista vacía,
conserva la original.

## El backend repite la regla con IVA fijo

`InitialFeePolicyResolver::compute` transcribe la misma cuota inicial (mayor de excedente y
política, sobre v1) para el plan de pagos, el intento de pago de la cuota inicial y el middleware
que exige tenerla pagada; el cupo que usa
es el menor entre el disponible de la categoría, lo que le queda al perfil y su `max_amount`, y en
rotativo `approved_limit − used_limit`. `PaymentCalculationService` resta la cuota inicial guardada
o, si es 0, la de la política. A diferencia de la tarjeta, el backend grava el FGA con IVA del 19 %
fijo (0 en República Dominicana), no con el IVA de `lenders_by_allieds`: si ese IVA no es 19, la
cuota de la tarjeta y la del plan difieren.
