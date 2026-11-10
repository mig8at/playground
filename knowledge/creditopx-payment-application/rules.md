# Cómo entra y se aplica un pago CreditopX

Qué hace el código cuando entra dinero a un crédito CreditopX: cómo se reparte, qué registros escribe y
por qué canal llega (pasarela Wompi, caja de Pullman). Describe `legacy-backend` y `application` en las
refs de `sources.json`. No describe la causación nocturna (está en `creditopx-portfolio-servicing`) ni
los recordatorios (están en `weekly-collection-reminders`), ni certifica qué canal, credencial o
interruptor está activo en un ambiente.

## Dos motores con la misma cascada

El pago lo aplican dos implementaciones sobre la misma base: `CreditopXPaymentController::processPayment`
en application y `CreditopXPaymentService::processPayment` en legacy-backend. Las dos crean un registro en
`creditop_x_payment_register` (el dinero recibido) y uno o varios `creditop_x_payments` (las
imputaciones), y por cada movimiento una fila nueva de `creditop_x_requests_history` que deja la anterior
en `status = 0`. Diferencias: legacy-backend rechaza los pagos de ciclo de vida de una entidad
`externally_serviced` y lanza si no hay cartera activa (`status` 1 u 8); application lee sólo `status = 1`
y es el único que aplica el descuento por pronto pago (registro tipo 9). legacy-backend calcula ese
descuento para mostrarlo, pero su `processPayment` no lo aplica.

## El pago mínimo va en cascada

Si la fila vigente tiene `next_payment_amount > 0`, el dinero se imputa en este orden, cada componente
hasta lo que se debe: gasto de cobranza, interés de mora, interés corriente, seguro de vida (sólo si
queda saldo de seguro), seguro de garantía y capital. Se crea un pago tipo 3 (PAGO A CUOTA); su
`paid_amount` no suma el seguro de garantía. Lo que sobra sigue al paso siguiente.

La garantía FGA no es un paso ni toma dinero propio: vive dentro del capital. De cada peso de capital
que se mueve, es garantía la proporción que tienen los saldos, `guarantee_amount_balance /
principal_amount_balance`, topada por el propio capital y por el saldo de garantía y redondeada a dos
decimales (`GuaranteeAttribution::forPrincipal`, una copia idéntica en cada monolito). Es la misma regla
para la cuota, el abono a capital, el pago total, la liberación de retenidos y el pronto pago de
application, y el pago a cuota guarda la suya en `paid_guarantee`. `next_payment_guarantee` ya no topa
nada: es informativo, la garantía que lleva el capital del mínimo con esa misma proporción.

Cada fila nueva recalcula `total_payment_amount` como capital + interés + seguro de vida + seguro de
garantía + mora + gasto de cobranza; si la suma no supera el umbral residual queda en cero. Es la misma
composición que usa la causación nocturna.

## Qué pasa con el sobrante

Si sobrante + umbral residual ≥ total con promociones, es pago total: se condonan los intereses cuando
la cuota está dentro de `installments_waived_interest` (tipo 5), se aplican los retenidos y el resto va a
capital (tipo 4 si salda el capital, tipo 2 si no). Al liberar un retenido, la cuota y el abono salen
del mismo movimiento: el abono mide su garantía sobre lo que dejó la cuota y el saldo de garantía baja
por la suma de las dos. Cuando la fila nueva queda en `status` 3 o sin capital, el saldo de garantía se
escribe en cero sin sumar ese resto a lo pagado. El umbral sale de `creditop_x_lender_residual_balances`
con 5000 por defecto, en los dos monolitos; legacy-backend usa 1 en una utilización de cupo rotativo,
application sigue usando el de la entidad.

Si no alcanza, decide el tipo de abono (`principal_payment_type`). Con 3 el sobrante queda RETENIDO
(tipo 1, con `request_history_id = 0`), esté o no en mora. Con 1 o 2 y el crédito al día, se abona a
capital: 1 reduce plazo y 2 reduce cuota. Con mora y tipo 1 o 2, el sobrante no se imputa: queda sólo en
el registro del cobro y legacy-backend lo traza como `payment.unapplied`. Un pago de pasarela cuya
transacción tiene el tipo en 0 llega sin tipo y se trata como 1. Cuando el total queda en cero la fila
nueva lleva `status` 3 y estado de crédito 3 (paz y salvo).

## Un cobro de pasarela se acredita una sola vez

Si ya existe un registro en `creditop_x_payment_register` con ese `payment_gateway_transaction_id`,
`processPayment` sale sin efectos en los dos monolitos. Ese chequeo sólo corre en el camino directo
(consumo, sin `revolving_credit_id`); en legacy-backend va antes del rechazo de `externally_serviced`,
para que reintentar una transacción ya acreditada no lance.

En un cupo rotativo el chequeo lo hace el reparto (`CreditopXRevolvingCreditPaymentController`, en
cada monolito) antes de llamar por cada utilización, porque todas comparten la transacción y el
reparto las llama pasando el id del pago del cupo, con lo que `processPayment` no vuelve a chequear.
El reparto lo hace dentro de su transacción, después de bloquear la cabecera del cupo
(`lockForUpdate`): dos entregas del mismo pago se serializan en ese bloqueo y la segunda ve el
registro que dejó la primera. application además hace el mismo chequeo antes de abrir la
transacción, como atajo.

## Wompi: intención y webhook

La API nueva vive en legacy-backend (`/api/loans/payments`), sin login. La intención acepta
`down_payment`, `installment` y `revolving_installment`; el monto en centavos debe ser múltiplo de 100 y,
en cuota o cupo, al menos 100.100 centavos. La cuota exige cartera activa y rechaza una compra de cupo;
el cupo exige utilizaciones vigentes y un monto que no pase su saldo. Una cuota reutiliza un PENDING del
TTL sólo con igual monto y tipo de abono; la cuota inicial reutiliza cualquier PENDING suyo. El pago de
cupo bloquea la fila del cupo, revalida el tope contra su saldo y recién ahí busca el PENDING más
reciente con concepto `revolving_installment`, igual monto y tipo de abono, para que dos intenciones
simultáneas no creen dos. La firma usa la credencial de la sucursal y, si no tiene, la del comercio (en
un cupo, la sucursal de su utilización más reciente); sin llaves pública, privada y de integridad no se
cobra.

El crédito se identifica con `credit_token` o con el id crudo (`loan_request_id` o
`revolving_credit_id`, cada uno prohibido en el concepto del otro); con
`services.wompi.payments.require_credit_token` encendido el token es obligatorio. El mismo interruptor
gobierna la vista previa (sección siguiente).

El webhook valida el checksum con `wompi_events` de esa credencial, bloquea la transacción y no repite
un estado terminal: un replay o una transacción sin `concept` (creada por application) no hace nada.
Una misma referencia puede tener varios intentos en Wompi (el cliente reintenta con otro medio): una vez
APPROVED, sólo el evento del intento que aprobó puede moverla; los de otro intento, o todos si no se
conoce el id aprobado, se ignoran y se registran como `wompi.webhook.foreign_transaction_ignored`. En
APPROVED rutea dentro de la misma transacción de base (si el post-proceso lanza, todo vuelve atrás): por
la columna del cupo si la tiene y, si no, por concepto. Una cuota sin cartera activa, un cupo sin
utilizaciones vigentes o un concepto desconocido se registra en el log y se corta, para reconciliar a
mano.

## Wompi: vista previa pública

`GET /api/loans/payments/{credit}/preview` (legacy-backend; responde igual bajo `/api/loans/customer`)
no pide login, no tiene límite de frecuencia y no crea transacción. `{credit}` se interpreta así:

- Un token firmado `{tipo}_{id}_{vencimiento}_{firma}` (HMAC con la clave de la app, tipo `con` o `rev`,
  vence a los `credit_token_ttl_minutes`, 60 por defecto) se acepta siempre. El tipo elige la tabla y el
  `concept` sólo puede confirmarlo. Lo emiten, entre otros, la consulta pública por documento
  (`credits/{document_number}`) y el resumen de deuda.
- Un id numérico crudo se acepta sólo con `require_credit_token` apagado, que es el valor por defecto
  (`WOMPI_PAYMENTS_REQUIRE_CREDIT_TOKEN`, `false`). Ahí el `concept` decide la tabla: `user_requests` por
  defecto, el cupo con `revolving_installment`. Con el interruptor encendido, o con un valor que no es
  token ni número, responde `InvalidCreditTokenException`.

Las dos formas devuelven lo mismo: entidad, comercio, `user_full_name` (el nombre completo del titular),
documento enmascarado salvo los últimos 4 dígitos, fecha y estado del crédito, si el comercio puede
cobrar y los montos del concepto (próxima cuota y total, o mínimo y base de la cuota inicial). Con ids
crudos cualquier entero secuencial devuelve esos datos de la solicitud o cupo que le corresponda; con el
interruptor encendido sólo se llega a un crédito cuyo token ya entregó otro endpoint, y mientras no venza.

## Wompi: consulta de estado y reconciliación

`Wompi::updateStatus` consulta a Wompi por la referencia y aplica el pago sólo al pasar a APPROVED: sale
si el estado ya era APPROVED o si ya hay registro con esa transacción, y no mira `concept`. Tipo 1 de
`creditop_x_payment_type_id` es cuota inicial; si no, cuota de consumo o pago de cupo. Es el camino de
las transacciones de application (sin `concept`), por su poller. En legacy-backend también lo llaman el
`GET {reference}/status` del flujo nuevo (con la transacción en PENDING desde hace más de 20 s, como
mucho una consulta cada 15 s por transacción) y la cuota inicial. Entre los intentos que Wompi devuelve
para la referencia, legacy-backend decide por el aprobado si hay alguno (si no, el primero de la lista) y
toma de él estado y monto; application lee siempre el primero. `app:reconcile-wompi-transactions` de
legacy-backend reconsulta los PENDING de las últimas horas, pero no está agendado.

## Cuota inicial

En la intención de legacy-backend el mínimo lo fija `InitialFeePolicyResolver` en las entidades de
categoría (respuesta 2) o de cupo (3): el mayor entre el porcentaje de la categoría o del cupo y el
exceso sobre el cupo disponible, ambos sobre `original_amount` más costos administrativos. Una entidad
sin categorías no exige mínimo; en los demás casos vuelve a `ceil(min_initial_fee% × amount) × 100`
centavos. Debe quedar algo por financiar. No se cobra con la solicitud en 6, 8, 12 o 24 ni con otra
aprobada.

El cupo disponible de una entidad de cupo es `approved_limit − used_limit`, el mismo que el listado
publica como `max_amount`. Al autorizar, el `final_amount` de la solicitud entra en `used_limit` y se
abre su cadena en el histórico; mientras esa cadena esté viva, `availableRevolvingQuota` le devuelve
su propio monto, así que volver a medir la solicitud autorizada no la cuenta como ya usada. En las de
categoría, la evaluación se hace con la solicitud (`userRequestId`), para que su propia cuota en el
histórico CreditopX no entre como deuda al reevaluar al cliente.

Al aprobarse, los dos monolitos recalculan sobre `original_amount`: costos administrativos =
(original − pagado) × porcentaje de la entidad en ese comercio, y `amount` = (original − pagado) +
costos. legacy-backend, además, omite el recálculo si falta `original_amount` y registra el pago como
tipo 7.

## Pago en caja de Pullman

Sólo existe en application. El asesor registra el pago: se busca el pedido «credipullman» del cliente
en la base de Pullman, se inserta un recaudo allí y se crea un registro pendiente (`status_id = 3`) con
el id de ese recaudo como referencia. `ValidatePullmanPayment` consulta cada 15 s, hasta 30 minutos,
los recaudos que Pullman confirmó; el que cruza el monto con un centavo de tolerancia se aplica con
`processPayment` y el pendiente se borra. Un administrador puede reabrir el sondeo.

## Límites

En main de los dos monolitos no hay recaudo BHD. El reverso administrativo (application) marca el
registro con `status_id = 2` y los retenidos como PAGO REVERSADO. Ninguno de los dos agenda la cadena
nocturna de cartera; application la dejó comentada atribuyéndola a otro servicio.
