**El subsidio no descuenta nada al crear el crédito: se paga cuota por cuota, de madrugada.** Lo decide `app:apply-credit-benefits` (legacy-application). Lo lanza el worker nocturno de `loan-servicing` después de la causación y de los pagos retenidos, aunque alguno de los dos haya fallado. Ese worker arranca por defecto en modo sombra: sin cambiar su configuración, no corre los comandos de verdad. El planificador de `legacy-application` ya no lo agenda.

**Cada noche mira la cuota que facturó el último corte.** Si esa cuota está dentro de las cubiertas, hay plazo para decidirla hasta su fecha de pago. Pasada esa fecha la deja sin rastro: no la vuelve a mirar.

**Qué paga:** sólo el **interés corriente** que se causó en el ciclo cerrado, con tope en lo que sigue exigible. Si el cliente ya pagó parte del interés, Creditop paga el resto. Nunca abona mora, gasto de cobranza, seguros ni capital.

**Lo que puede pasar con una cuota** (`creditop_x_credit_benefit_decisions`):

- **Aplicado**: Creditop paga.
- **Perdido**: el corte trae más días de mora que la tolerancia. El cliente paga el interés de esa cuota, y no se reintenta. Por defecto, la tolerancia son los días entre el corte y el pago según el tipo de corte de la entidad (5 en el corte mensual y en el quincenal). Un programa o un crédito puede fijar otra.
- **Nada que cubrir**: esa cuota la condona la entidad, no le queda interés exigible, o el crédito ya se cerró. Se evalúa antes que la mora: una cuota sin nada que cubrir nunca queda como perdida.
- **En espera**: hay un pago del cliente sin resolver, de la caja Pullman o de Wompi. Se reintenta la noche siguiente.
- **Falló**: algo no cuadró después de aplicar y se deshizo todo, o el crédito no tiene fila vigente sin estar cerrado, o el corte no tiene fechas. Se reintenta.

Aplicado, perdido y nada que cubrir son **finales**: un índice único impide decidir dos veces la misma cuota, aunque se crucen dos corridas. Por eso correrlo a mano para un crédito (`--user-request=`) no paga dos veces.

**Un pago retenido no le gana al subsidio.** Antes de liberar un retenido, el job de retenidos aplica primero el subsidio de ese crédito. Si no, el retenido pagaría el interés y a Creditop ya no le quedaría nada que cubrir. Lo que sobra del retenido sigue su camino.

**El pago de Creditop no es recaudo del cliente.** Va a `creditop_x_payments` con el tipo `SUBSIDIO INTERESES CREDITOP`, sin registro de recaudo (`payment_register_id = 0`), y el histórico lo anota como `PAGO INTERESES CREDITOP`. Las vistas de recaudo excluyen los pagos sin registro, así que el subsidio no infla lo recaudado. Para conciliarlo con cada comercio y entidad, el admin descarga la liquidación del subsidio desde las solicitudes originadas (mismo permiso que la configuración).

**Aplicar el subsidio no tiene efectos hacia afuera**: no genera comprobante, no desbloquea el equipo y no le manda mensajes al cliente.
