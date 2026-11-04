# Oferta de CreditopX en la tarjeta: cupo, cuota inicial y cuota

Cómo se calculan el cupo, la cuota inicial mínima, el valor a financiar y la cuota que muestra la
tarjeta de una entidad CreditopX (`response_type` 2) o rotativa (3) en el listado del asistente.
Describe `frontend-monorepo` (el cálculo), `pre-approvals-service` (el cupo que llega) y
`legacy-backend` (los parámetros, lo que persiste al elegir y la regla que repite al liquidar).
`legacy-application` tiene su propio listado y no está cubierto acá. No certifica los valores de
configuración de una entidad ni lo que se ve en un ambiente: eso se lee en su base. El cupo mensual
del perfil está en `creditopx-quota`; renting y RTO, en `renting-plans`.

## De dónde salen los números de la tarjeta

Los calcula el navegador con `CalculateLoanFinancialsUc` (paquete `lenders-marketplace`). El
backoffice reconstruye la simulación de un perfilamiento con el mismo caso de uso, pero con la
configuración vigente de la entidad y sin cuota inicial escrita: reproduce la tarjeta sólo si esos
insumos no cambiaron. Los parámetros llegan en dos tiempos:

- `lenders-v2` hidrata cada entidad con su fila de `lenders_by_allieds` (costos administrativos %
  y fijo, FGA, IVA, `initial_fee_percentage`, seguros) y su línea de crédito; el `max_amount` de esa
  fila, si existe, reemplaza al de la línea. Cuando la entidad tiene perfiles, el FGA y el plazo ya
  vienen recortados por la categoría del cliente; en la rotativa, el FGA del cupo activo pisa al resto.
- Al resolverse la preaprobación, `mergeLenderWithResolution` pisa `available` con el `available`
  numérico del resultado y `initial_fee_percentage` con `quota_details.initial_fee_percentage` si
  viene (en `creditop_x`, el `min_initial_fee` de la categoría; en la rotativa, el del cupo). Sólo
  si el producto es `creditop_x` pisa además la tasa (`category.rate`) y el FGA (`category.fga`).

`lenders-v2` no devuelve `amountConditions` ni `categoryCredipullman` en la raíz de la respuesta:
en este camino esas dos entradas del cálculo llegan nulas, y el porcentaje y el FGA salen de lo que
trae la entidad. Los tramos de monto viajan por entidad (`amount_conditions`) y sólo los usa el
filtro de plazos.

## El cupo que llega como `available`

El adaptador `creditop_x` del servicio de preaprobaciones llama a `available-quota` y, si la
respuesta trae `has_quota` y estado `approved`, usa `quota_details.max_requestable` como monto
aprobado y `available`. En CreditopX por categoría, `max_requestable` es el menor entre el cupo del
motor de categorías (ya topado por el tramo más alto de `creditop_x_conditions_by_amount_by_lender`
menos 1, contando sólo los tramos cuyo plazo cabe en el de la categoría), lo que le queda al perfil
en el mes y el `max_amount` del perfil. Si ese cupo es positivo pero queda por debajo del
`min_amount` de la línea, la respuesta es un rechazo `below_min_amount`. En la rotativa,
`max_requestable` es el disponible del cupo.

## La cuota inicial mínima es el mayor de dos pisos

`calculateMinimumInitialFee` parte de v1 = monto × (1 + admin%/100) + admin fijo. El tope es el
menor entre `credit_lines.max_amount`, el `max_amount` del producto (si hay) y `available` (si es
positivo). La mínima es `ceil(max(v1 − tope, porcentaje × v1 / 100))`: cubre a la vez el excedente
sobre el cupo y el porcentaje de política. El porcentaje es el del tramo de monto si llegan
`amountConditions` con `initial_fee_percentage` para esa entidad, y si no el `initial_fee_percentage`
de la entidad.

## Cuándo se resta la cuota inicial

`requiresInitialFee` la exige siempre con `response_type` 2. Con 3, la exige si la entidad trae un
porcentaje mayor que cero o si el monto supera el cupo (`available` positivo, o el `max_amount` de
la línea sin él). En CreditopX (2 y 3) también se resta una cuota escrita aunque no se exija,
porque el backend resta la que llegue. La escrita, si es mayor que cero, reemplaza a la mínima; si
no hay escrita y se exige, se resta la mínima.

## La cuota inicial escrita y la que no se escribe

La tarjeta calcula con la cuota del campo. En la tienda el campo no se ofrece y la tarjeta usa
`max(campo, mínima)`; fuera de la tienda, sin campo (el comercio con `allied.initial_fee` apagado),
usa 0, y el caso de uso igual resta la mínima cuando la entidad la exige.

Al elegir, el front manda `initial_fee` = lo que hay en el campo (0 sin campo) y, en las entidades de
preaprobación, `amount` = la base con FGA ya reducida. `updateUserRequest` guarda los dos tal cual.
Al liquidar, el plan financia `original_amount − initial_fee` y, si `initial_fee` es 0, resta la de
la política; `final_amount` sale de ahí sin FGA. Así, sin campo y fuera de la tienda,
`initial_fee` queda en 0 mientras el monto financiado sí descuenta la cuota inicial.

Fuera de la tienda el backend no exige cobro por pasarela: `ValidateInitialFeePaid` deja pasar
porque la cobra el comercio. Al firmar, `StoreInitialFeeRegisterService` registra el cobro en caja
sólo con `response_type` 2, `initial_fee` mayor que 0 y sin pago en línea aprobado; con
`initial_fee` en 0, o en la rotativa, no queda registro de cómo se cobró.

## Valor a financiar, FGA y cuota

Los costos administrativos se calculan sobre el monto solicitado completo, no sobre el reducido. El
subtotal es (monto − cuota inicial) + costos; si la entidad tiene un factor de ajuste para el plazo
elegido, el subtotal se multiplica por factor × plazo. El FGA es subtotal × FGA% × (1 + IVA de
`lenders_by_allieds`), y la base de la cuota es subtotal + FGA. La cuota es la amortización francesa
a `rate/100` (o `rate/200` si `cutoff_type_id` es 2), o base/plazo con tasa cero, más seguros de
vida (porcentaje y fijo) y los porcentajes mensuales fijos, todos sobre esa base.

En CreditopX el «valor a financiar» mostrado es el subtotal sin FGA; para `response_type` 4 incluye
el FGA. Lo que se persiste como `amount` en las entidades de preaprobación es la base con FGA
(`financedAmountWithGuarantee`). El caso de uso muestra monto − cuota inicial cuando recibe
`isEcommerce`, pero la tarjeta no se lo pasa.

## Plazos que ofrece la tarjeta

El plazo inicial es `fee_number` del listado: el `max_fee_number` de la línea, recortado por el
`max_fee_number` de la categoría. Después el tramo de monto (`applyAmountConditionTermCap`, sobre
`user_requests.amount`) deja los plazos que no superan su tope y fija `fee_number` en el mayor; con
`mandatory_fee_number`, el plazo único es el tope del tramo aunque no esté en la lista de la entidad.

En la tarjeta, si la entidad no trae tarifario propio, `useInstallmentOptions` vuelve a filtrar las
opciones con el tramo que corresponde al capital (monto − cuota inicial efectiva): deja las que no
superan su `max_fee_number` y, con `mandatory_fee_number = 1`, sólo esa. Si el filtro deja la lista
vacía, conserva la original.

## El backend repite la regla con IVA fijo

`InitialFeePolicyResolver::compute` transcribe la misma cuota inicial (mayor de excedente y
política, sobre v1, acotada entre 0 y v1) para el plan de pagos, el intento de pago de la cuota
inicial y el middleware que exige tenerla pagada. El porcentaje se trunca a entero. Por categoría,
el cupo es el menor entre el disponible de la categoría, lo que le queda al perfil y su
`max_amount`, sin el tope por tramo que aplica `available-quota`; una entidad sin perfiles no
resta nada. En rotativo, el cupo es `approved_limit − used_limit` del cupo.

`PaymentCalculationService` resta la cuota inicial guardada o, si es 0, la de la política. El plan
no repite exactamente la tarjeta:

- grava el FGA con IVA del 19 % fijo (0 en República Dominicana), no con el IVA de
  `lenders_by_allieds`;
- aplica el factor de ajuste por plazo al capital antes de sumar los costos, no al subtotal;
- calcula el seguro de vida porcentual sobre `original_amount`, no sobre la base con FGA;
- convierte la tasa semanal a efectiva (`(1+i)^(7/30) − 1`) y usa la menor entre la tasa de la
  línea y la guardada en la solicitud (salvo en República Dominicana).

Si alguno de esos insumos aplica, la cuota de la tarjeta y la del plan difieren.
