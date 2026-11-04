# Cupo mensual y mandato de CreditopX

Este tema cubre el cupo de los perfiles de consumo de CreditopX (`lender_users_categories`) y el
mandato de la entidad (`lenders.amount_to_lend`), en los dos monolitos. Describe código revisado en
main; cuánto lleva colocado un perfil se mide en la base del ambiente.

## El cupo es una bolsa mensual por perfil

Un perfil es una fila de `lender_users_categories` de la entidad, sin columna de comercio ni de
sucursal: lo comparten todos los clientes y comercios de esa entidad. `MonthlyQuota`, con la misma
regla en los dos monolitos, define el tope del mes como `period_loan_limit` si existe y, si no,
`loan_limit` (nulo cuenta como 0); lo colocado es `already_used_loan`; el disponible es
`max(0, tope − colocado)`. Autorizar no se frena por cupo, así que lo colocado puede pasar el tope. El
mes es calendario en `America/Bogota`, calculado en el código y no con la zona de la aplicación.

## Se carga al autorizar, con la fila bloqueada

Cada crédito autorizado suma su monto (`final_amount`) redondeado a `already_used_loan` y escribe un
evento `credit_booked` en `creditop_x_quota_events`; si con ese crédito el perfil pasa de tener
disponible a no tenerlo, también un `limit_reached`.

En el monolito nuevo lo hace `MonthlyQuotaBookingService::book`, llamado desde
`CreditopXRequestHistoryService::createFirstRegister` dentro de la transacción de la autorización y
sólo para entidades `response_type = 2`. Antes de cargar, reevalúa el perfil del cliente: si no hay
perfil vigente, la autorización falla con un 422 y no se crea el crédito. `book` toma la fila con
`lockForUpdate`; si esa fila ya no existe, sólo deja un aviso en el log y el crédito queda sin cargar.

En el viejo, `createFirstRegister` del controlador de historial carga sólo si la entidad tiene algún
perfil: reevalúa el del cliente, bloquea la fila y llama a `MonthlyQuota::charge`, que devuelve los
eventos para escribir en la misma transacción. Si ningún perfil coincide, deja un aviso en el log y el
crédito sigue sin cargarse a ningún cupo.

## El día 1 se reinicia, y el backoffice puede reiniciar o cambiar el tope

`app:reset-creditop-x-monthly-quota` corre el día 1 a las 00:00 de Bogotá desde el `Kernel` del
monolito nuevo, sin solaparse. Para cada perfil, en su propia transacción y con la fila bloqueada,
pone lo colocado en 0, descarta `period_loan_limit` y escribe un `month_reset`; un perfil que ya tiene
su `month_reset` del mes se salta, así que repetirlo es seguro. El monolito viejo no reinicia: lee el
mismo perfil.

El backoffice nuevo (`LenderQuotaWriterService`, rutas `lenders/{lender}/quota` con
`cognito.token:staff`) reinicia lo colocado del mes (`used_reset`) o cambia el tope (`limit_changed`):
sólo del mes, en `period_loan_limit`, o de forma permanente, en `loan_limit` por el editor de reglas,
lo que sube la versión de reglas y descarta el tope del mes. Cada acción bloquea la entidad y la fila
y compara el valor que vio la pantalla con el actual: si otro crédito o cambio entró en el medio,
contesta conflicto en vez de pisarlo. Un tope más bajo que deja el perfil sin disponible también
escribe `limit_reached`.

## El «cupo» del log es lo que le queda al perfil

En `users_category_log`, `current_available_amount` guarda `MonthlyQuota::available` del perfil que
eligió el motor: la bolsa, no el cupo de la persona. Los dos `LenderUserCategoryService` lo escriben
así cuando un perfil coincide; si ninguno coincide, la fila va con perfil 0 y monto 0. El monto que se
le ofrece al cliente se topa además con el máximo por cliente (`max_amount`) y la cuota inicial. El
monolito nuevo lo agrega a `category_rules_acceptance` como `available_amount`; el viejo guarda ahí
`available_from_lender`, `available_from_profile` y `max_amount`.

El backoffice nuevo expone `current_available_amount` como `cupo` en cada corrida del perfilamiento y
lo usa de respaldo para el cupo de la simulación cuando la tarjeta no trae monto
(`ApplicationsService`). Un perfil recién reiniciado puede hacer parecer que una persona tiene un cupo
del tamaño de la bolsa entera.

## Un creditCard nulo en el reporte de Experian rompe la evaluación

El reporte del buró se guarda en `RiskCentralUserData.data`, convertido a colección. En los dos
`LenderUserCategoryService`, la validación de capacidad de endeudamiento recorre las tarjetas con
`->has('creditCard')` antes de mirar si el perfil exige capacidad mínima. `has` es verdadero aunque la
clave valga null, y el `foreach` sobre null lanza un error: la evaluación del perfil se corta sin
escribir su fila en el log. Ese recorrido corre sólo para un perfil que ya pasó los demás criterios.
Las otras dos lecturas de tarjetas sí toleran null: la de tarjetas mínimas (`isset`, rechaza el
perfil cuando exige alguna) y, en el monolito nuevo, la de cupo disponible en tarjetas (`?? []`).

## El mandato no frena ninguna originación

`lenders.amount_to_lend` es un entero `NOT NULL DEFAULT 0`: 0 es «sin mandato». Ningún camino de
listado, motor ni autorización lo usa para decidir; el wizard sólo lo copia a su entidad de oferta. El
tablero CreditopX del monolito viejo lo muestra como meta mensual: la suma de los mandatos de las
entidades `response_type = 2` de las solicitudes filtradas, menos el `final_amount` de las solicitudes
en estado 10 u 11 creadas en el mes. El backoffice nuevo lo muestra de sólo lectura y avisa, sin
bloquear el guardado, cuando la suma de los `loan_limit` de los perfiles activos lo supera; un perfil
desactivado no cuenta. También avisa, sin bloquear, cuando el `max_amount` de un perfil activo supera
el monto máximo de la entidad (`credit_line_by_lenders.max_amount`), porque el wizard
(`ValidateLoanAmountUc`) usa ese máximo como tope del monto financiado. Una entidad que rechaza por
cupo agotó el de un perfil, no el mandato.
