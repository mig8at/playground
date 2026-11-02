# Cartera CreditopX: noche, cobranza, colilla y beneficios

Después de originar, un crédito CreditopX vive en `creditop_x_requests_history`: una cadena de filas
por crédito donde la vigente tiene `status = 1` y cada movimiento (corte, pago, condonación) apaga la
anterior y deja la nueva. El estado del crédito es `creditop_x_requests_status_id` (1 al día, 2 en
mora, 3 paz y salvo, 6 producto recuperado, 7 recuperado por fondo de garantías). Este tema cubre lo
que le pasa a esa cartera **sin que el cliente pague**: la cadena nocturna, el gasto de cobranza, la
condonación de colillas, las acciones del admin y el subsidio de intereses. Cómo se aplica un pago
está en `creditopx-payment-application`; los cortes semanales y recordatorios, en
`weekly-collection-reminders`.

## La noche de cartera la corre loan-servicing

La cartera se mueve con comandos artisan de **legacy-application**. Hasta octubre los programaba el
scheduler de ese monolito; su `Kernel` los tiene ahora comentados con la nota «la corre el worker de
loan-servicing (CRED-497)». loan-servicing es un worker de Temporal en Go que no reimplementa nada:
lanza cada comando como una tarea de ECS de una sola corrida, en orden y a hora fija de Bogotá:

| paso | comando | no antes de | se puede repetir |
|---|---|---|---|
| pagos de Wompi no aplicados | `app:update-creditop-x-not-applied-wompi-payment-command` | 00:02 | sí |
| colillas y regularización | `app:update-creditop-x-remove-outstanding-balances` | 00:10 | sí |
| **causación diaria** | `app:update-creditop-x-requests-command` | 00:30 | **no** |
| pagos retenidos | `app:update-creditop-x-apply-payment-command` | 03:30 | sí |
| cupos rotativos | `app:update-creditop-x-revolving-credits-command` | 04:00 | sí |
| beneficios del crédito | `app:apply-credit-benefits` | 04:15 | sí |
| recordatorios | `app:reminder-creditop-x-requests-command` | 10:15 | sí |

Un paso espera a su hora, nunca corre encima de otro y se salta si la fecha de negocio ya no es hoy.
Además, algunos pasos **dependen** de otros y sólo se lanzan si el paso del que dependen terminó
completo; si falló, se saltó o terminó con errores parciales, el dependiente no corre y queda una
alerta:

- la causación depende de las colillas;
- los cupos rotativos y los beneficios dependen de la causación;
- los recordatorios dependen de la causación, los pagos retenidos, los rotativos y los beneficios.

Los pagos de Wompi no aplicados y los pagos retenidos no dependen de nadie. La causación no se relanza
si se muere a mitad: causar dos veces el mismo día duplica intereses. El worker arranca en modo sombra por defecto
(cada tarea corre `php artisan --version`); el valor de producción vive en su secreto
(`prod/loan-servicing`), no en el código, así que salir de sombra es configuración y se comprueba en
los logs del worker (cada lanzamiento registra `shadow`).

legacy-backend tiene copias de algunos de estos comandos, pero el worker invoca los de
legacy-application: su familia de tarea por defecto es la del scheduler de ese monolito, y en
producción su rol de IAM sólo puede lanzar `legacy-application-worker-production`.

## Gasto de cobranza por días de mora

Cada entidad configura en `creditop_x_lender_collection_charges` tramos de días de mora con un monto
fijo; los tramos son inclusivos. Existe una regla de validación para que no se solapen
(`NonOverlappingCollectionChargeRange`), pero ningún formulario ni servicio la invoca: el código asume
que no se solapan y no lo garantiza. En la causación, si los días de mora del
crédito **coinciden exactamente** con el inicio de un tramo (`min_due_days`), se cobra ese monto una
sola vez: se suma al pago mínimo exigible, al saldo de cobranza y al saldo total. Un crédito que
salta el día de inicio (por ejemplo, porque la noche no corrió) no recibe el cargo de ese tramo.

## Colilla: el residuo se condona en el corte

Una colilla es un exigible tan chico que no vale cobrarlo. El umbral es por entidad
(`creditop_x_lender_residual_balances`) y, sin fila, $5.000. A las 00:10, para los créditos de
consumo (no utilizaciones de rotativo) que cortan hoy o antes:

- si el exigible es mayor que 0 y no supera el umbral de su entidad, se limpian los componentes del
  exigible del período, la fecha de pago avanza un ciclo y el crédito puede cortar;
- si el exigible ya es 0 pero el crédito sigue en mora, se regulariza: vuelve a al día.

La causación aplica el mismo umbral al saldo total: por debajo, lo lleva a 0. Las entidades de corte
semanal suelen configurar un umbral menor, porque $5.000 sería una fracción grande de la cuota.

## Cambio de fecha de pago

El admin de legacy-application deja cambiar la fecha de pago de un crédito sólo si no es una
utilización de cupo rotativo (la fecha la define el cupo), su entidad no es de corte semanal (siempre
pagan viernes) y el pago mínimo pendiente es 0: primero se paga, después se cambia la fecha, porque
el exigible quedaría colgado de un ciclo que no es el suyo.

## Acciones del admin sobre la cartera

Cada acción está detrás de su propio permiso, exige la fila vigente del histórico y deja su
movimiento con nombre propio. Ninguna toca los acumulados `paid_*`, porque no son pagos del cliente:

- **Producto recuperado** → estado 6; **recuperado por fondo de garantías** → estado 7.
- **Refinanciación:** sobrevive sólo el capital (que ya incluye el fondo de garantía) y, si quien la
  aplica lo decide, los seguros; se condonan intereses, mora, cobranza y el descuadre. El plan nuevo
  es de cuota fija sobre ese capital a la tasa del crédito (`user_requests.rate`), con un plazo libre
  que no se ata a los plazos de la entidad, y la primera cuota cae en el ciclo del crédito dejando al
  menos 15 días de facturación. Deja `CONDONACIÓN POR REFINANCIACIÓN` y `REFINANCIACIÓN`; queda al día.
- **Condonar y pasar a paz y salvo:** todos los saldos a 0 y estado 3, con el movimiento
  `CONDONACIÓN Y PASO A PAZ Y SALVO`.

## Subsidio de intereses Creditop

Un programa de beneficio hace que **Creditop le pague a la entidad el interés corriente** de las
primeras cuotas. Se fija al crear el crédito (fila `CREACIÓN`, `benefit_program_id`) y la decisión
vive espejada en los dos monolitos (`CreditBenefitResolver`):

- gana el programa vigente **del comercio** (y de la entidad, si lo nombra); si no hay, el programa
  **global**, sólo con el interruptor `creditop_interest_subsidy` de `settings` prendido;
- un programa con `requires_app_origin` sólo aplica a créditos con `is_app = 1`, los que nacen de
  canjear el código de cliente de la app;
- no aplica a utilizaciones de rotativo ni a entidades con `externally_serviced`;
- por defecto cubre 3 cuotas desde la primera, sin pasarse del plazo;
- un crédito de la app con programa no lleva además la condonación de intereses configurada en la
  entidad (`installments_waived_interest`): manda la promoción de la app.

Cada noche, `app:apply-credit-benefits` decide cuota por cuota con la estrategia `INTEREST_SUBSIDY`
de legacy-application: cubre sólo el interés corriente del ciclo cerrado (nunca mora, cobranza ni
capital), con el movimiento `PAGO INTERESES CREDITOP`. La cuota se pierde si en el corte el crédito
tenía más días de mora que la tolerancia: la del programa o, si no la fija, la que sale del tipo de
corte de la entidad (5 días en mensual). Si la entidad ya condona esa cuota, no hay nada que cubrir.
