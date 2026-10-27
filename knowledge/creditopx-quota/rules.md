# Cupo mensual y mandato de CreditopX

Este tema cubre el cupo de los perfiles de consumo de CreditopX (`lender_users_categories`) y el
mandato de la entidad (`lenders.amount_to_lend`), en los dos monolitos. Describe código revisado en
main; cuánto lleva colocado un perfil se mide en la base del ambiente.

## El cupo es una bolsa mensual por perfil

Un perfil es una fila de `lender_users_categories` que comparten todos los clientes y comercios de la
entidad. `MonthlyQuota`, igual en los dos monolitos, define el tope del mes como `period_loan_limit`
si existe y, si no, `loan_limit`; lo colocado es `already_used_loan`; el disponible es
`max(0, tope − colocado)`. El mes es calendario en `America/Bogota`, calculado en el código y no con
la zona de la aplicación.

## Se carga al autorizar, con la fila bloqueada

Cada crédito autorizado suma su monto redondeado a `already_used_loan` y escribe un evento
`credit_booked` en `creditop_x_quota_events`; si con ese crédito el perfil se agota, también un
`limit_reached`. En el monolito nuevo lo hace `MonthlyQuotaBookingService::book`, llamado desde
`CreditopXRequestHistoryService`; toma la fila con bloqueo y, si el perfil no existe, sólo deja un
aviso en el log y el crédito no se carga a ningún cupo. En el viejo, el controlador de historial
bloquea la fila y llama a `MonthlyQuota::charge`, que devuelve los eventos para escribir en la misma
transacción.

## El día 1 se reinicia, y el backoffice puede reiniciar o cambiar el tope

`app:reset-creditop-x-monthly-quota` corre el día 1 a las 00:00 de Bogotá desde el `Kernel` del
monolito nuevo. Para cada perfil pone lo colocado en 0, descarta `period_loan_limit` y escribe un
`month_reset`; un perfil que ya tiene su `month_reset` del mes se salta, así que repetirlo es seguro.
El monolito viejo no reinicia: lee el mismo perfil.

El backoffice nuevo (`LenderQuotaWriterService`, rutas `lenders/{lender}/quota` con
`cognito.token:staff`) reinicia lo colocado del mes (`used_reset`) o cambia el tope (`limit_changed`)
sólo del mes o de forma permanente. Cada acción bloquea la fila y compara el valor que vio la pantalla
con el actual: si otro crédito o cambio entró en el medio, contesta conflicto en vez de pisarlo.

## El «cupo» del log es lo que le queda al perfil

En `users_category_log`, `current_available_amount` guarda `MonthlyQuota::available` del perfil que
eligió el motor: la bolsa, no el cupo de la persona. Los dos `LenderUserCategoryService` lo escriben
igual. El monto que se le ofrece al cliente se topa además con el máximo por cliente (`max_amount`) y
la cuota inicial, y va en `category_rules_acceptance` como `available_amount`.

El backoffice nuevo expone `current_available_amount` como `cupo` en cada corrida del perfilamiento y
lo usa de respaldo para el cupo de la simulación cuando la tarjeta no trae monto
(`ApplicationsService`). Un perfil recién reiniciado puede hacer parecer que una persona tiene un cupo
del tamaño de la bolsa entera.

## El mandato no frena ninguna originación

`lenders.amount_to_lend` es un entero `NOT NULL DEFAULT 0`: 0 es «sin mandato». Ningún camino de
listado, motor ni autorización lo lee. El tablero CreditopX del monolito viejo lo muestra como meta
mensual: la suma de los mandatos de las entidades de consumo de las solicitudes filtradas, menos el
`final_amount` de las solicitudes en estado 10 u 11 creadas en el mes. El backoffice nuevo lo muestra
de sólo lectura y avisa, sin bloquear el guardado, cuando la suma de los topes de los perfiles lo
supera. Una entidad que rechaza por cupo agotó el de un perfil, no el mandato.
