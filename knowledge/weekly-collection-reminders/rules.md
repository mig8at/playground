# Corte semanal y recordatorios de cobranza

Cómo se calculan las fechas y la tasa de los créditos con corte semanal, y quién les manda los
recordatorios de WhatsApp. Describe `legacy-backend` y `application` en las refs de `sources.json`.
No dice qué entidades tienen hoy corte semanal ni qué plantillas están activas en un ambiente:
eso es dato de la base. Hoy el caso de uso es Motai (renting y Rent to Own).

## Los dos cortes semanales

`lenders.cutoff_type_id` decide el calendario. El 3 paga siempre viernes con corte el miércoles
(dos días antes); el 4 paga siempre martes con corte el lunes (un día antes). Los dos avanzan de 7
en 7 días y comparten días a causar y tasa. La primera cuota es el primer día de pago cuyo corte
quede al menos a un día de hoy: originando lunes o martes con corte 3 se paga ese viernes; de
miércoles en adelante, el viernes siguiente. Se cuenta desde la originación, no desde la firma.

Un `cutoff_type_id` que el código no conoce cae en silencio al calendario mensual. Asignar un corte
es configuración de la entidad; crear uno nuevo es código. Las entidades con `product` renting o
`rto` tienen `allow_payment_date_selection = false`: la fecha de pago se muestra, no se elige. Una
entidad nueva de esas líneas nace con el valor por defecto `true` y hay que apagarlo al darla de alta.

## La tasa semanal es efectiva en los dos monolitos

legacy-backend origina y application causa la cartera, y los dos convierten la tasa mensual del
lender con `i_semanal = (1 + i_mensual)^(7/30) − 1`; application causa el interés diario como
`i_semanal / 7`. Mensual causa `i/30` y quincenal usa la mitad de la tasa mensual. Las dos clases
`CutoffCalendar` deben coincidir: si una cambiara la conversión, la cuota originada no cerraría con
el interés causado.

El contrato y el cronograma del Rent to Own de Motai no usan esta conversión: su builder convierte
con `(1 + r)^(12/52) − 1` (52 períodos al año en los semanales). Son dos tasas semanales distintas
para la misma tasa mensual; no se verificó cuánto divergen las cuotas reales.

## Quién envía cada recordatorio

Los créditos con corte 3 los atiende sólo `app:reminder-weekly-loans` de legacy-backend, que corre
todos los días a las 09:00 de Bogotá. Toma las plantillas de `creditop_x_reminder_messages` con
`cutoff_type_id = 3` y estado activo, sobre la fila viva del histórico de créditos de entidades con
ese corte. El corte 4 no entra en esa consulta.

El comando general de application excluye las plantillas con `cutoff_type_id` no nulo y los créditos
de los cortes listados en `config/reminders.php` (`excluded_cutoff_type_ids`, hoy el 3), además de
sus `excluded_lender_ids`. Si la columna no existe en la base, no filtra plantillas.

## Cuándo sale cada plantilla

Cada plantilla dispara un día exacto: con base `payment_date`, N días antes del pago; con base
`days_past_due`, cuando la mora vale exactamente N; con `recurrence_days`, cada R días desde N. Las
de Motai son 22: al día en t−2, t−1 y t; mora en distintos días hasta t+90, y una recurrente desde
t+105 cada 15.

El comando no envía domingos ni festivos del país de la entidad; el sábado sí. Lo que cae en un día
no hábil se pierde, salvo el estado de cuenta, que el siguiente día hábil amplía su ventana a los
días saltados. Sale un solo recordatorio por cliente y día, y gana el del estado de cuenta. Cada
plantilla sale una vez por crédito y ciclo de pago; la recurrente, una vez por ventana. Si dos
plantillas activas comparten estado, base y offset, el comando aborta en lugar de mandar doble.
Cada intento queda en `reminder_dispatch_log`.

## Variables de los mensajes

Las variables posibles son `nombre`, `lender`, `fecha` (formateada según el corte), `cuota`,
`comercio`, `metodos` y `estadoCuenta`. `cuota` es `next_payment_amount`, también en los mensajes de
mora: no hay variable de días de mora ni de saldo total. `metodos` es el link de pago (o el texto
alterno de la entidad) más « o » y el `cash_payment_text` de la entidad si existe, sin saltos de
línea. Una variable desconocida o vacía lanza excepción y ese mensaje no sale.

## Límites

Las 22 plantillas de Motai se siembran inactivas y se activan a mano; las cinco de reincidente
siguen inactivas hasta que exista un segmento, porque colisionan con las de primera vez. Los toques
que sólo eran llamada no existen. Que el código esté en `main` no dice qué plantillas están activas
ni si las aprobó Meta.
