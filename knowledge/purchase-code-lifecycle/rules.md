# Código de compra y conciliación

Mecanismo de emisión, consulta y conciliación disponible en las refs locales de `main` de backend, legacy-application y wizard. No certifica disponibilidad del banco, vigencia contractual, despliegue ni equivalencia con otro emisor. Un código visible, una factura local y una confirmación bancaria son evidencias distintas.

## Entrada y emisor

El wizard llega a `/bancolombia/{bnpl|consumo}/purchase-code/{encrypt_code}` desde el procesamiento de
cada flujo; el loader decodifica la solicitud y hace POST a
`/api/onboarding/purchase-code/generate/{user_request_id}`. `PurchaseCodeService` exige solicitud
existente, comercio incluido en el setting `corbeta_allieds`, estado 25 y entidad 68 o 100. Una
condición fallida responde PCS000/HTTP 500 (también una excepción capturada por el servicio o el
controller); no es una autorización de crédito ni un paso por estado 11.

En `legacy-backend`, `CodeGenerationService::getRequestNumber` elige el emisor con el mismo setting
`corbeta_allieds` que el guard, sin ids fijos. Un comercio fuera de ese setting recibe un código interno de
ocho caracteres hexadecimales en mayúsculas, comprobando que no exista en información adicional. Dentro de
`corbeta_allieds`, si el comercio figura además en `bancolombia_billing_code_allieds` (vacío: todos siguen en
Corbeta) llama a `getFromBancolombia`: `BancolombiaBillingCode::generateBillingCode` con el `transactionId` de
`LenderIntegrationFlow` (`bnpl_transaction_id` para 68, `loan_validate_key` para 100), la dirección del
cliente (o la de la sucursal) con la vía abreviada y truncada a 20 caracteres, y `cityCode` y
`departmentCode` DANE; fuera de producción manda valores fijos. `PurchaseCodeService::validateCurrentOrder`
lee el mismo setting para consultar con el mismo emisor. Si no, llama a Corbeta con el monto final entero
y el convenio BNPL para 68, consumo para el otro caso, y extrae el PIN de la respuesta de `register` con
`/PIN\s+([a-f0-9]{20,})/i`. Esa respuesta procede de `setOrder`, no de una consulta posterior de factura.

En `legacy-application`, el controller del cliente usa directamente los cuatro ids (24, 209, 210 y 211) para
su guard y retorna una vista Inertia vacía ante rechazo; su `CodeGenerationService` conserva el `switch` por
esos ids. El controller además desvía los comercios PASH a otro recorrido antes del guard. Compartir tablas
no convierte esas entradas en el mismo contrato HTTP ni hace que un setting gobierne ambos monolitos.

## Reuso y persistencia

La API modular toma la última fila de `purchase_codes` y la última información adicional cuyo `type_data` contiene `barcode`. Reutiliza si hay fila y URL de imagen, o si `barcode_type` es null: devuelve PCS001/200 con el token guardado, con fallback al número de solicitud, y vuelve a intentar SMS. Sólo cuando no cumple ese criterio pide código al generador; si su texto contiene `error` responde PCS003/422. Crear un código responde PCS002/200.

El PIN vive en `user_request_additional_information.data_json.verification_token`; `type_data` incorpora el nombre del comercio y `barcode`, con `token_type` fijo `ean_128`. `purchase_codes` guarda URL y `barcode_checked`, no el PIN ni su caducidad. El flujo genera la orden y la imagen antes de guardar ambas filas. Con `barcode_type` definido, si la sucursal no tiene `hash` responde PCS000 después de pedir el código y generar la imagen, sin guardar filas. El SMS sale sólo con `barcode_type` definido y enlaza siempre `/bancolombia/bnpl/purchase-code/{hash}`, también para la entidad 100; ese `flowType` cambia el aviso de la vista de éxito, no el medio de pago, que llega del backend. En `legacy-application` el reuso no reenvía SMS y el enlace es la ruta Inertia del cliente. No contiene bloqueo ni transacción que haga atómica la llamada externa y esa persistencia; la migración revisada tampoco declara unicidad por solicitud. El reuso posterior no acredita idempotencia concurrente del emisor ni evita un reintento tras fallo parcial.

## Disponibilidad y vigencia visual

Al recuperar un PIN guardado de un comercio del setting `corbeta_allieds`, `PurchaseCodeService::validateCurrentOrder`
consulta la vigencia según el emisor del comercio, con el mismo setting que la emisión
(`bancolombia_billing_code_allieds`, vía `CodeGenerationService::emiteConBancolombia`). Si emite con Bancolombia,
`validateBancolombiaOrder` consulta `BancolombiaBillingCode::retrieveOrderDetails` con lógica fail-closed: devuelve
`true` únicamente cuando `data.orderInformation.billingStatus` es `PENDING_INVOICE`, y `false` ante PIN vacío, 404
(`BP40421052`), excepción o error de comunicación, `INVOICED`, `CANCELLED` o cualquier otro valor. Si no (o si no se
pasa la solicitud), consulta Corbeta entre ayer a las 00:00 y mañana al final del día, con el status por defecto 2
(`EstadoOrden`), y devuelve `true` sólo si encuentra exactamente ese PIN. El cliente de Corbeta ordena por fecha de
facturación, conserva una fila por PIN y reindexa la colección; la guarda `isset($responseOrders['code'])` se evalúa
sobre ese resultado reindexado, así que no reconoce un cuerpo de error con `code`, y si `getOrder` lanza, `query` lo
registra y no devuelve valor. En la API modular la consulta a Corbeta corre para cualquier comercio del setting que no
emita con Bancolombia, también con un código interno que Corbeta no emitió; `legacy-application` la limita a los cuatro
ids. No es una comparación con una fecha de caducidad del código.

La respuesta puede ser PCS001/success con `showBarCode:false`. El schema del wizard conserva esa bandera,
pero `FinalizePurchase` decide entre éxito y vencido únicamente por `isExpired`: con contador vigente
sigue mostrando el PIN; sólo la vista vencida usa `showBarCode` para elegir «Tiempo caducado» o «No
encontramos el PIN para facturar». El schema exige `codeType` y `codeImageUrl` como strings: los null
que admite el camino sin tipo/imagen del backend no forman un payload válido para ese consumidor. La
vista Inertia de `legacy-application` sigue la misma lógica: muestra el código mientras el contador sea
mayor que cero y sólo usa `showBarCode` en la vista de vencido. HTTP 200 no demuestra ni disponibilidad
en caja ni compatibilidad del payload.

## Fecha límite y relojes

El payload modular no entrega fecha de emisión, fecha límite ni TTL. El schema y el use case del wizard tampoco declaran esos datos. La migración de `purchase_codes` de ambos monolitos guarda timestamps de la fila, URL y marca de consulta; no guarda una caducidad del PIN. La fecha de creación de una fila o de una orden necesita una regla de vigencia confirmada antes de transformarse en vencimiento.

El loader del wizard calcula en el servidor el próximo corte a las 01:30 UTC (20:30 de Bogotá): al llegar al corte lo mueve al día siguiente; el contador del cliente resta `Date.now()` a ese instante. Lo calcula al consultar, sin usar fecha de emisión o TTL del PIN; una nueva consulta puede mover el contador si el backend vuelve a devolver el código disponible. `CountdownDisplay` conserva el texto fijo «Vence hoy a las 8:30 p.m.», aunque el corte calculado corresponda a mañana. El contador no identifica ni revoca el PIN y no acredita vigencia contractual de 24 horas.

La pantalla Inertia `customer/purchase-code/FinalizePurchase` de `legacy-application` usa otra regla visual: fija las 20:30 del mismo día con `setHours`, sin avanzar al siguiente corte. Si ya pasó, deja el contador en cero y avisa; al llegar a cero durante el intervalo también avisa. Usa la zona local del navegador, no una zona Colombia explícita, así que ese reloj cambia para clientes en otra zona. El SMS de ambos caminos dice «activo hasta las 8:30pm», pero no incluye fecha ni representa una respuesta de caducidad del proveedor.

Disponibilidad de la orden, reloj, texto y vencimiento del proveedor son comprobaciones separadas. Reemplazar el reloj del wizard por el de Inertia no resuelve por sí solo la zona horaria ni conserva un vencimiento a través de recargas y cambios de día. Un corte local debe distinguirse de una fecha límite respaldada por el proveedor o una regla de negocio confirmada y vinculada al PIN.

## Confirmación bancaria de la compra

En `legacy-application`, `InvoiceProcessCorbeta` (Consumo, entidad 100) e `InvoiceProcessCorbetaBnpl` (BNPL, entidad
68) toman sus pendientes con `BillingCodeReconciliation::pending(<entidad>)` y concilian cada solicitud con
`BillingCodeReconciliation::process`; una falla en una solicitud queda en `logs` y no corta la corrida. La confirmación
al banco la pone cada comando: Consumo llama a `consumoConfirmed` (`BancolombiaConsumerLoan`) con el `loan_validate_key`
de `LenderIntegrationFlow`, y BNPL a `bnplConfirmed` (`BancolombiaBnpl`) con `latestLenderTransaction.order_id`; los dos
con `purchase_amount`, `invoice_number` y la fecha de facturación.

`pending` selecciona las solicitudes de esa entidad en estado 25, sin `invoice_number`, creadas dentro de
`LOOKBACK_DAYS` y sin una fila de información adicional `barcode` con `data_json->billing_status`. `process` toma el
`verification_token` de la última fila cuyo `type_data` contiene `barcode` (sin código, salta) y pregunta si la orden
está facturada según el setting `bancolombia_billing_code_allieds`: comercio en la lista → Bancolombia
(`BancolombiaBillingCode::retrieveOrderDetails`; `INVOICED` sigue, `PENDING_INVOICE` se reintenta, `CANCELLED` marca
`billing_status = CANCELLED`, y sin respuesta u otra respuesta se reintenta); comercio fuera de la lista, o setting
vacío → la lista de Corbeta (`CorbetaBillingSource::invoicedOrder`; sin orden facturada se reintenta).

Con la orden facturada, `invoiced` exige `totalAmount` numérico y una fecha válida, fija `purchase_amount` e
`invoice_number` desde la orden y confirma al banco. Sólo si la respuesta declara `data.status = Recibida` guarda la
solicitud, la pasa de 25 a 26 de forma atómica (sólo si sigue en 25: nunca escribe 26 sobre 11), marca
`billing_status = INVOICED` en la fila `barcode` y pone `barcode_checked` en el código de compra. Sin `Recibida` no
guarda ni marca nada y la solicitud se vuelve a intentar en la corrida siguiente. Lo que la saca de la cola es salir
del 25, tener `invoice_number` o tener `billing_status`.

## Factura y estado 26

`UpdateOrdersFromCorbeta` quedó apagado en el `Kernel` porque escribir estado 26 e `invoice_number`
sacaba solicitudes de la cola de `BillingCodeReconciliation` sin confirmarlas al banco. Su clase toma
solicitudes creadas entre ayer y hoy, con su información `barcode`, y órdenes facturadas de hoy por
status 3, cruza PIN y actualiza monto, factura y estado 26 cuando monto o número difiere (comparación
estricta `!==` entre `purchase_amount`, sin cast, y un float, con `isset($orders['code'])` sobre la
colección reindexada y tomando la primera fila adicional sin orden).

El controller de compra del admin (`PurchaseCodeController::updateCurrentOrder`) tiene otra consulta,
que dispara la pestaña Documentación del detalle de la solicitud para los comercios 24, 209, 210 y 211:
toma el último PIN, consulta Corbeta (capturando excepciones para no romper la apertura del detalle y
validando `is_iterable`) desde el día de creación hasta el final del siguiente con el status recibido.
Si la solicitud aún no tiene `data_json->billing_status` en información adicional (`reconciled()`),
actualiza únicamente `purchase_amount` cuando difiere y retorna sin escribir `invoice_number` ni pasar a
estado 26 para no sacarla de `BillingCodeReconciliation`; sólo si ya tiene `billing_status` aplica la
actualización de monto, factura y estado 26. Tener estado 26 acredita esa actualización local, sin
certificar por sí solo que un comando de confirmación bancaria haya tenido respuesta recibida. Que el
código de emisión ya esté restringido a 25 no impide que otros caminos hayan actualizado la factura.

## Calendario y límites de verificación

El Kernel de `legacy-application` programa consumo (`app:invoice-process-corbeta`) a las 06:05 y BNPL
(`app:invoice-process-corbeta-bnpl`) a las 03:00, con `onOneServer` y `withoutOverlapping`; la tarea de
actualización de órdenes (`app:update-orders-from-corbeta` cada dos horas) quedó apagada en el
scheduler. Los dos comandos de confirmación ya no consultan ventanas de fechas en Corbeta: ambos toman
las solicitudes pendientes de `BillingCodeReconciliation::pending` (entidad 100 en consumo y 68 en
BNPL) y consultan cada código contra Bancolombia. Declararlos en el Kernel no acredita scheduler activo,
zona horaria efectiva, ejecución exitosa ni aceptación por el banco. Esas protecciones de ejecución
tampoco garantizan idempotencia de cada compra.

Cambiar el emisor exige conservar o adaptar el identificador que enlaza las órdenes y estos
consumidores. Aceptar un formato en pantalla no prueba que ese identificador exista en Corbeta ni que el
banco cree la misma orden. La equivalencia entre emisores y quién crea la orden requieren
contrato/documentación o medición del proveedor; una configuración o un mock local no resuelven esas
preguntas de negocio.
