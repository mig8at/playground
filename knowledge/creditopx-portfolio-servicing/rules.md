# Cartera CreditopX: noche, cobranza, colilla y beneficios

Después de originar, un crédito CreditopX vive en `creditop_x_requests_history`: una cadena de filas
por crédito donde la vigente tiene `status = 1` y cada movimiento (corte, pago, condonación) apaga la
anterior y deja la nueva. El estado del crédito es `creditop_x_requests_status_id` (1 al día, 2 en
mora, 3 paz y salvo, 6 producto recuperado, 7 recuperado por fondo de garantías). Este tema cubre lo
que le pasa a esa cartera **sin que el cliente pague**: la cadena nocturna, el gasto de cobranza y su
lugar en el saldo total, la condonación de colillas, las acciones del admin y el subsidio de
intereses. Cómo se aplica un pago está en `creditopx-payment-application`; los cortes semanales y
recordatorios, en `weekly-collection-reminders`.

## La noche de cartera la corre loan-servicing

La cartera se mueve con comandos artisan de **legacy-application**. Su `Kernel` los tiene comentados
con la nota «la corre el worker de loan-servicing (CRED-497)». loan-servicing es un worker de
Temporal en Go que no reimplementa nada: lanza cada comando como una tarea de ECS de una sola
corrida, en orden y a hora fija de Bogotá:

| paso | comando | no antes de | se puede repetir |
|---|---|---|---|
| pagos de Wompi no aplicados | `app:update-creditop-x-not-applied-wompi-payment-command` | 00:02 | sí |
| colillas y regularización | `app:update-creditop-x-remove-outstanding-balances` | 00:10 | sí |
| **causación diaria** | `app:update-creditop-x-requests-command` | 00:30 | **no** |
| pagos retenidos | `app:update-creditop-x-apply-payment-command` | 03:30 | sí |
| cupos rotativos | `app:update-creditop-x-revolving-credits-command` | 04:00 | sí |
| beneficios del crédito | `app:apply-credit-benefits` | 04:15 | sí |
| recordatorios | `app:reminder-creditop-x-requests-command` | 10:15 | sí |

Un paso espera a su hora y no se lanza mientras haya otra tarea nocturna viva (espera y reintenta);
si ya no es la fecha de negocio en la zona horaria de la aplicación, se salta. Además, algunos pasos
**dependen** de otros y sólo se lanzan si el paso del que dependen terminó completo; si falló, se
saltó o terminó con errores parciales (código de salida 1), el dependiente no corre y queda una
alerta:

- la causación depende de las colillas;
- los cupos rotativos y los beneficios dependen de la causación;
- los recordatorios dependen de la causación, los pagos retenidos, los rotativos y los beneficios.

Los pagos de Wompi no aplicados y los pagos retenidos no dependen de nadie. Los pasos repetibles se
relanzan una vez si el contenedor muere (137/143); la causación no, porque causar dos veces el mismo
día duplica intereses. La excepción es una tarea que nunca arrancó (`TaskFailedToStart`): no corrió
nada y se puede relanzar aunque el paso no sea repetible. Si los beneficios no terminaron a las
06:00 hay una alerta crítica aparte.

El worker arranca en modo sombra por defecto (cada tarea corre `php artisan --version`); el valor de
producción vive en su secreto (`prod/loan-servicing`), no en el código, así que salir de sombra es
configuración y se comprueba en los logs del worker (cada lanzamiento registra `shadow`).

legacy-backend tiene copias de algunos de estos comandos (su `Kernel` no las programa), pero el
worker invoca los de legacy-application: su familia de tarea por defecto es la del scheduler de ese
monolito, y en producción su rol de IAM sólo puede lanzar `legacy-application-worker-production`.

## Gasto de cobranza por días de mora

Cada entidad configura en `creditop_x_lender_collection_charges` tramos de días de mora con un monto
fijo; los tramos son inclusivos. Existe una regla de validación para que no se solapen
(`NonOverlappingCollectionChargeRange`), pero ningún formulario ni servicio la invoca, y ningún
código de los dos monolitos escribe esa tabla: el código asume que no se solapan y no lo garantiza.

En la causación, si el crédito está vencido y sus días de mora **coinciden exactamente** con el
inicio de un tramo (`min_due_days`), se aplica ese monto: se suma al pago mínimo exigible
(`next_payment_amount` y `next_payment_collection_charge`) y al saldo de cobranza
(`collection_charge_amount_balance`). No queda registro de qué tramo ya se cobró. Los días de mora
suben de a uno por causación, pero un pago parcial que baja capital o interés los reconstruye: si
con eso el crédito vuelve a pasar por el inicio de un tramo, el cargo se repite, y si lo saltea, ese
tramo no se cobra.

En cada corte, el gasto de cobranza pendiente del mínimo se arrastra y vuelve a entrar al nuevo pago
mínimo, como cualquier otro componente.

## Saldo total y gasto de cobranza

`total_payment_amount` incluye el gasto de cobranza. Quién lo escribe y cómo:

- **Causación** (legacy-application, `UpdateCreditopXRequestsCommand`): capital + interés + seguro de
  vida + fianza + mora + `collection_charge_amount_balance`, llevado a 0 si no supera el umbral de
  colilla. Recalcula el total desde los componentes cada noche, así que corrige lo que haya dejado
  cualquier otro camino.
- **Aplicación de pagos**, en los dos monolitos (`applyPayment` de legacy-application y
  `CreditopXPaymentService` de legacy-backend): misma suma, con el saldo de cobranza que queda tras
  el pago.
- **Condonación libre** (`CondoneCreditBalances`): suma los saldos remanentes, cobranza incluida.
- **Copian o restan sin recalcular**: colillas (copia el total), condonación de intereses en la
  causación (`waiveInterests`: total menos interés), recuperaciones (copia), paz y salvo (0) y
  refinanciación (el monto refinanciado).
- **Lo dejan afuera**: la re-causación de `amortization()` que corre al reversar un pago
  (`CreditopXRequestHistoryController`), los comandos manuales `creditopx:correct-negative-*` y la
  copia de la causación en legacy-backend, que el worker no corre. Ese total queda corto hasta la
  causación siguiente.

La **vista previa de la refinanciación** (`RefinanceCredit::preview`) supone lo contrario: su
comentario dice que el total no incluye cobranza y calcula el «descuadre» como total − (capital +
interés + mora + seguros). Con un total que sí la incluye, el descuadre absorbe el gasto de cobranza
y el total condonado lo cuenta dos veces (una como cobranza y otra dentro del descuadre positivo).
El efecto se queda en lo mostrado: el popup, el `condoned.total` y el «descuadre saneado» del log
salen inflados por ese monto; los saldos que se escriben no cambian, porque la refinanciación pone
cobranza en 0 y el total en el monto refinanciado.

## Colilla: el residuo se condona en el corte

Una colilla es un exigible tan chico que no vale cobrarlo. El umbral es por entidad
(`creditop_x_lender_residual_balances`) y, sin fila, $5.000. A las 00:10, para los créditos de
consumo (no utilizaciones de rotativo) que cortan hoy o antes:

- si el exigible es mayor que 0 y no supera el umbral de su entidad, se limpian el pago mínimo y la
  mora del período, el capital exigido vuelve a quedar por facturar, la fecha de pago avanza un ciclo
  y el crédito queda al día y puede cortar;
- si el exigible ya es 0 pero el crédito sigue en mora con la fecha de pago vencida, se regulariza
  igual: vuelve a al día.

El gasto de cobranza no se condona como colilla: su saldo y su componente del mínimo se arrastran.
El saldo total se copia sin recalcular; la causación de las 00:30 lo rearma desde los componentes.

La causación aplica el mismo umbral dos veces: a un exigible vencido (fuera de rotativos), que limpia
igual que la colilla, y al saldo total, que por debajo lleva a 0. Las entidades de corte semanal
suelen configurar un umbral menor, porque $5.000 sería una fracción grande de la cuota.

## Cambio de fecha de pago

El admin de legacy-application deja cambiar la fecha de pago de un crédito sólo si no es una
utilización de cupo rotativo (la fecha la define el cupo), su entidad no es de corte semanal (pago
fijo: viernes, o martes en el semanal de martes) y el pago mínimo pendiente es 0: primero se paga,
después se cambia la fecha, porque el exigible quedaría colgado de un ciclo que no es el suyo.

## Acciones del admin sobre la cartera

Cada acción está detrás de su propio permiso, exige la fila vigente del histórico y deja su
movimiento con nombre propio. Ninguna toca los acumulados `paid_*`, porque no son pagos del cliente:

- **Producto recuperado** → estado 6; **recuperado por fondo de garantías** → estado 7. Copian la
  fila sin tocar saldos.
- **Condonación libre:** quien la aplica elige monto por ítem (capital, interés, mora, seguro de
  vida, fianza, cobranza), topado al saldo de cada uno. Si el total queda en 0, paz y salvo; si pide
  dejarlo al día, se condona toda la mora y se limpia el exigible del período. Deja
  `CONDONACIÓN POR ACUERDO DE PAGO AUTORIZADO POR EL COMERCIO`.
- **Refinanciación:** sobrevive sólo el capital (que ya incluye el fondo de garantía) y, si quien la
  aplica lo decide, los seguros; se condonan intereses, mora, cobranza y el descuadre. El plan nuevo
  es de cuota fija sobre ese capital a la tasa del crédito (`user_requests.rate`), con un plazo que
  no se ata a los plazos de la entidad (de 1 a 120 cuotas), y la primera cuota cae en el ciclo del
  crédito dejando al menos 15 días de facturación. Deja `CONDONACIÓN POR REFINANCIACIÓN` y
  `REFINANCIACIÓN`; queda al día. Su vista previa sobrestima lo condonado cuando hay gasto de
  cobranza (ver la sección del saldo total).
- **Condonar y pasar a paz y salvo:** todos los saldos a 0 y estado 3, con el movimiento
  `CONDONACIÓN Y PASO A PAZ Y SALVO`.

## Subsidio de intereses Creditop

Un programa de beneficio hace que **Creditop le pague a la entidad el interés corriente** de las
primeras cuotas. Se fija al crear el crédito (fila `CREACIÓN`, `benefit_program_id`) y la decisión
vive espejada en los dos monolitos (`CreditBenefitResolver`):

- gana el programa vigente **del comercio** (y de la entidad, si lo nombra); si no hay uno elegible,
  el programa **global**, sólo con el interruptor `creditop_interest_subsidy` de `settings` prendido;
- un programa con `requires_app_origin` sólo aplica a créditos con `is_app = 1`, los que nacen de
  canjear el código de cliente de la app;
- no aplica a utilizaciones de rotativo ni a entidades con `externally_serviced`;
- por defecto cubre 3 cuotas desde la primera, sin pasarse del plazo; si el plazo no deja cuotas que
  cubrir, no se asigna;
- un crédito de la app con programa no lleva además la condonación de intereses configurada en la
  entidad (`installments_waived_interest`): manda la promoción de la app.

Después de originar, el admin de legacy-application puede activar, ajustar o quitar el subsidio de
un crédito (permiso propio, con motivo): deja una fila `CONFIGURACIÓN SUBSIDIO CREDITOP` con un
programa manual y los parámetros del crédito en `benefit_params`, que pisan a los del programa. Lo
que el motor ya decidió o pagó no se toca.

Cada noche, `app:apply-credit-benefits` decide cuota por cuota con la estrategia `INTEREST_SUBSIDY`
de legacy-application: cubre sólo el interés corriente del ciclo cerrado, topado a lo que sigue
exigible (nunca mora, cobranza ni capital), con el movimiento `PAGO INTERESES CREDITOP`. La cuota se
pierde si en el corte el crédito tenía más días de mora que la tolerancia: la de los parámetros
(del crédito o del programa) o, si no la fijan, los días entre corte y pago del tipo de corte de la
entidad (5 en mensual y quincenal, 2 en semanal de viernes, 1 en semanal de martes). Si la entidad
ya condona esa cuota, no hay nada que cubrir.
