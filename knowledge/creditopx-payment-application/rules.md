# Cómo entra y se aplica un pago CreditopX

Qué hace el código cuando entra dinero a un crédito CreditopX: cómo se reparte, qué registros escribe y
por qué canal llega (pasarela Wompi, caja de Pullman). Describe `legacy-backend` y `application` en las
refs de `sources.json`. No describe la causación nocturna ni los recordatorios (están en
`weekly-collection-reminders`), ni certifica qué canal o credencial está activo en un ambiente.

## Dos motores con la misma cascada

El pago lo aplican dos implementaciones sobre la misma base: `CreditopXPaymentController::processPayment`
en application y `CreditopXPaymentService::processPayment` en legacy-backend. Las dos crean un registro en
`creditop_x_payment_register` (el dinero recibido) y uno o varios `creditop_x_payments` (las
imputaciones), y por cada movimiento una fila nueva de `creditop_x_requests_history` que deja la anterior
en `status = 0`. Diferencias: legacy-backend rechaza los pagos de ciclo de vida de una entidad
`externally_serviced` y lanza si no hay cartera activa (`status` 1 u 8); application lee sólo `status = 1`
y es el único que aplica el descuento por pronto pago (registro tipo 9).

## El pago mínimo va en cascada

Si la fila vigente tiene `next_payment_amount > 0`, el dinero se imputa en este orden, cada componente
hasta lo que se debe: gasto de cobranza, interés de mora, interés corriente, seguro de vida (sólo si
queda saldo de seguro), seguro de garantía y capital. Se crea un pago tipo 3 (PAGO A CUOTA); su
`paid_amount` no suma el seguro de garantía. La garantía FGA no es un paso: es la parte del capital
pagado, topada en `next_payment_guarantee`. Lo que sobra sigue al paso siguiente.

## Qué pasa con el sobrante

Si sobrante + umbral residual ≥ total con promociones, es pago total: se condonan los intereses cuando
la cuota está dentro de `installments_waived_interest` (tipo 5), se aplican los retenidos y el resto va a
capital (tipo 4 si salda el capital, tipo 2 si no). El umbral sale de
`creditop_x_lender_residual_balances` con 5000 por defecto; en una utilización de cupo rotativo es 1.

Si no alcanza, decide el tipo de abono (`principal_payment_type`): con el crédito al día, 1 abona a
capital y reduce plazo, 2 abona y reduce cuota, y 3 deja el sobrante como RETENIDO (tipo 1, con
`request_history_id = 0`). Con mora y tipo 1 o 2, el sobrante no se imputa: queda sólo en el registro
del cobro y legacy-backend lo traza como `payment.unapplied`. Cuando el total queda en cero la fila nueva
lleva `status` 3 y estado de crédito 3 (paz y salvo).

## Un cobro de pasarela se acredita una sola vez

Si ya existe un registro con ese `payment_gateway_transaction_id`, `processPayment` sale sin efectos en
los dos monolitos. En un cupo rotativo el chequeo lo hace el reparto antes de llamar por cada
utilización, porque todas comparten la transacción.

## Wompi: intención y webhook

La API nueva vive en legacy-backend (`/api/loans/payments`). La intención acepta `down_payment`,
`installment` y `revolving_installment`; el monto en centavos debe ser múltiplo de 100 y, en cuota,
al menos 100.100 centavos y con cartera activa. Una cuota reutiliza un PENDING del TTL sólo con igual
monto y tipo de abono; la cuota inicial reutiliza cualquier PENDING suyo. La firma usa la credencial de
la sucursal y, si no tiene, la del comercio; sin llaves pública, privada y de integridad no se cobra.

El webhook valida el checksum con `wompi_events` de esa credencial, bloquea la transacción y sólo
procesa estados nuevos: un replay o una transacción sin `concept` (creada por application) no hace
nada. En APPROVED rutea por concepto dentro de la misma transacción de base: si el post-proceso lanza,
todo vuelve atrás. Una cuota sin cartera activa o un concepto desconocido se registra en el log y se
corta, para reconciliar a mano.

## Wompi: consulta de estado y reconciliación

Las transacciones sin `concept` las aplica `Wompi::updateStatus` por consulta a Wompi, en los dos
monolitos y sólo al pasar a APPROVED: tipo 1 de `creditop_x_payment_type_id` es cuota inicial; si no,
cuota de consumo o pago de cupo. `app:reconcile-wompi-transactions` de legacy-backend reconsulta los
PENDING de las últimas horas, pero no está agendado.

## Cuota inicial

El mínimo es `ceil(min_initial_fee% × monto) × 100` centavos y debe quedar algo por financiar. No se
cobra con la solicitud en 6, 8, 12 o 24 ni con otra aprobada. Al aprobarse, los dos monolitos recalculan
sobre `original_amount`: costos administrativos = (original − pagado) × porcentaje de la entidad en ese
comercio, y `amount` = (original − pagado) + costos. legacy-backend, además, omite el recálculo si falta
`original_amount` y registra el pago como tipo 7.

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
