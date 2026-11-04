# Corte semanal y recordatorios de cobranza

Cómo se calculan las fechas y la tasa de los créditos con corte semanal, y quién les manda los
recordatorios de WhatsApp. Describe `legacy-backend`, `application` y `loan-servicing` en las refs de
`sources.json`. No dice qué entidades tienen hoy corte semanal ni qué plantillas están activas o
aprobadas en un ambiente: eso es dato de la base y de messaging-service. El caso de uso es Motai
(renting y Rent to Own).

## Los dos cortes semanales

`lenders.cutoff_type_id` decide el calendario. El 3 paga siempre viernes con corte el miércoles
(dos días antes); el 4 paga siempre martes con corte el lunes (un día antes). Los dos avanzan de 7
en 7 días y comparten días a causar y tasa. La primera cuota es el primer día de pago cuyo corte
quede al menos a un día de hoy: con corte 3, consultando lunes o martes se paga ese viernes y de
miércoles en adelante el viernes siguiente; con corte 4, consultando domingo se paga el martes que
sigue y consultando lunes, el de la otra semana. Mientras `selected_payment_date` esté vacía la
fecha se recalcula con el día de la consulta; al confirmarla, el cronograma queda anclado a ella.

Un `cutoff_type_id` que el código no conoce cae en silencio al calendario mensual. Asignar un corte
es configuración de la entidad; crear uno nuevo es código. Una migración apaga
`allow_payment_date_selection` en las entidades con `product` renting o `rto`: la fecha de pago se
muestra, no se elige. Una entidad nueva de esas líneas nace con el valor por defecto `true` y hay
que apagarlo al darla de alta.

## La tasa semanal es efectiva en los dos monolitos

legacy-backend origina y application causa la cartera, y los dos convierten la tasa mensual del
lender con `i_semanal = (1 + i_mensual)^(7/30) − 1`; application causa el interés diario como
`i_semanal / 7`. En application, mensual y quincenal causan `i/30`; en legacy-backend la cuota
quincenal se amortiza con la mitad de la tasa mensual. Las dos clases `CutoffCalendar` deben
coincidir: si una cambiara la conversión, la cuota originada no cerraría con el interés causado.

El contrato y el cronograma del Rent to Own de Motai no usan esta conversión: su builder convierte
con `(1 + r)^(12/52) − 1` para los dos cortes semanales. El exponente 12/52 es menor que 7/30, así
que para la misma tasa mensual el documento usa una tasa semanal algo más baja que la que causa la
cartera.

## Quién envía cada recordatorio

Los créditos con corte 3 los atiende sólo `app:reminder-weekly-loans` de legacy-backend, que el
`Kernel` agenda todos los días a las 09:00 de Bogotá sin solaparse. Toma las plantillas de
`creditop_x_reminder_messages` con `status = 1` y `cutoff_type_id = 3` y, por cada país de las
entidades con corte 3 y `status = 1`, busca la fila viva (`status = 1`) del histórico de créditos de
entidades con corte 3 de ese país, en el estado de la plantilla y con `next_payment_amount > 0`. El
corte 4 no entra en esa consulta.

Los dos comandos generales dejan fuera las plantillas con `cutoff_type_id` no nulo.
`app:reminder-creditop-x-requests-command` de legacy-backend (09:30 de Santo Domingo) sólo recorre
créditos de SmartPay. El de application ya no lo agenda su `Kernel`: lo lanza el worker de
loan-servicing como paso `reminders`, no antes de las 10:15 de Bogotá y después de causación,
beneficios, pagos retenidos y rotativos (en modo `shadow` el paso sólo corre `artisan --version`).
Ese comando excluye los créditos de los cortes de `config/reminders.php`
(`excluded_cutoff_type_ids`, que lista el 3) y de sus `excluded_lender_ids`; si la columna
`cutoff_type_id` no existe en la base, no filtra plantillas. El corte 4 no está excluido: sus
créditos quedan en ese comando, con las plantillas sin corte.

## Cuándo sale cada plantilla

Cada plantilla dispara un día exacto: con base `payment_date`, N días antes del pago; con base
`days_past_due`, cuando la mora vale exactamente N; con `recurrence_days`, cada R días desde N. Las
de Motai son 22: al día en t−2 (con estado de cuenta), t−1 y t; mora de primera vez en t+1, 3, 5 y
7; de reincidente en t+1, 2, 3, 5 y 7; mora en t+8, 14, 21, 30, 35, 45, 60, 75 y 90, y una
recurrente desde t+105 cada 15. Todas se siembran sólo con WhatsApp.

El comando no envía domingos ni festivos del país de la entidad; el sábado sí. Lo que cae en un día
no hábil se pierde (queda como `skipped` con razón de día no hábil), salvo el estado de cuenta, que
el siguiente día hábil amplía su ventana a los días saltados. Sale un solo recordatorio por cliente
y día: las plantillas con estado de cuenta se procesan primero y el tope mira las filas `sent` del
día en `reminder_dispatch_log`. Cada plantilla sale una vez por crédito y ciclo de pago
(`next_payment_date`); la recurrente, una vez por ventana de `recurrence_days`. Cada intento queda en
`reminder_dispatch_log`.

## Qué tiene que ser cierto para que un crédito reciba algo

Para un crédito con corte 3 tienen que darse todas: una entidad con corte 3 activa en su país; una
plantilla semanal activa cuyo estado y offset le toquen ese día; una fila en
`payment_methods_by_lender` para su entidad; país en el comercio (las plantillas por corte rutean
el WhatsApp por él); y que messaging-service acepte el `template_name` con sus variables. Si falla
alguna de las tres últimas, el intento queda `failed` y no se reintenta en esa corrida.

Si dos plantillas activas comparten estado, base, offset y recurrencia, el comando aborta la
corrida entera antes de enviar. Como los comandos generales excluyen el corte 3, con todas las
plantillas semanales inactivas, o con la corrida abortada, un crédito de corte 3 no recibe ningún
recordatorio.

## Variables de los mensajes

Las variables posibles son `nombre`, `lender`, `fecha` (con día de la semana en los cortes
semanales), `cuota`, `comercio`, `metodos` y `estadoCuenta`. `cuota` es `next_payment_amount`,
también en los mensajes de mora: no hay variable de días de mora ni de saldo total. `metodos` es el
link de pago (o el texto alterno de la entidad) más « o » y el `cash_payment_text` de la entidad si
existe, sin saltos de línea. Las posiciones del template salen de `content_variables` de la fila;
una variable desconocida o vacía, o una fila sin esa lista, lanza excepción y ese mensaje no sale.

## Límites

Las 22 plantillas de Motai se siembran inactivas y se activan a mano. Cuatro de las cinco de
reincidente (t+1, 3, 5 y 7) comparten estado y offset con las de primera vez: activarlas sin un
segmento hace abortar la corrida. Los toques que sólo eran llamada no existen. Que el código esté
en `main` no dice qué plantillas están activas, si las aprobó Meta ni si están registradas en
messaging-service; tampoco si el worker de loan-servicing corre fuera de `shadow` en un ambiente.
