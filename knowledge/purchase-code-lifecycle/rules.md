# Código de compra y conciliación

Mecanismo de emisión, consulta y conciliación disponible en las refs locales de `main` de backend, application y wizard. No certifica disponibilidad del banco, vigencia contractual, despliegue ni equivalencia con otro emisor. Un código visible, una factura local y una confirmación bancaria son evidencias distintas.

## Entrada y emisor

El wizard hace POST a `/api/onboarding/purchase-code/generate/{user_request_id}`. `PurchaseCodeService` exige solicitud existente, comercio incluido en el setting `corbeta_allieds`, estado 25 y entidad 68 o 100. Una condición fallida responde PCS000/HTTP 500; no es una autorización de crédito ni un paso por estado 11.

La selección del emisor usa otra fuente: `CodeGenerationService` llama a Corbeta sólo para comercios 24, 209, 210 y 211. El resto genera un código interno de ocho caracteres hexadecimales en mayúsculas, comprobando que no exista en información adicional. Agregar un comercio al setting no lo agrega al switch. El camino de Corbeta envía el monto final entero y el convenio BNPL para 68, consumo para el otro caso; extrae el PIN de la respuesta de `register` con `/PIN\s+([a-f0-9]{20,})/i`. Esa respuesta procede de `setOrder`, no de una consulta posterior de factura.

En `application`, el controller del cliente usa directamente los cuatro ids para su guard y retorna una vista Inertia vacía ante rechazo; el generador conserva el mismo switch. El controller además desvía los comercios PASH a otro recorrido antes del guard. Compartir tablas no convierte esas entradas en el mismo contrato HTTP ni hace que un setting gobierne ambos monolitos.

## Reuso y persistencia

La API modular toma la última fila de `purchase_codes` y la última información adicional cuyo `type_data` contiene `barcode`. Reutiliza si hay fila y URL de imagen, o si `barcode_type` es null: devuelve PCS001/200 con el token guardado, con fallback al número de solicitud, y vuelve a intentar SMS. Sólo cuando no cumple ese criterio pide código al generador; si su texto contiene `error` responde PCS003/422. Crear un código responde PCS002/200.

El PIN vive en `user_request_additional_information.data_json.verification_token`; `type_data` incorpora el nombre del comercio y `barcode`, con `token_type` fijo `ean_128`. `purchase_codes` guarda URL y `barcode_checked`, no el PIN ni su caducidad. El flujo genera la orden y la imagen antes de guardar ambas filas. No contiene bloqueo ni transacción que haga atómica la llamada externa y esa persistencia; la migración revisada tampoco declara unicidad por solicitud. El reuso posterior no acredita idempotencia concurrente del emisor ni evita un reintento tras fallo parcial.

## Disponibilidad y vigencia visual

Al recuperar un PIN guardado, `validateCurrentOrder` consulta Corbeta entre ayer a las 00:00 y mañana al final del día, con el status por defecto 2 (`EstadoOrden`). Devuelve true sólo si encuentra exactamente ese PIN; un resultado con campo `code` devuelve false. El cliente de Corbeta ordena por fecha de facturación y conserva una fila por PIN. No es una comparación con una fecha de caducidad del código.

La respuesta puede ser PCS001/success con `showBarCode:false`. El schema del wizard conserva esa bandera, pero `FinalizePurchase` decide entre éxito y vencido únicamente por `isExpired`: con contador vigente sigue mostrando el PIN; sólo la vista vencida usa `showBarCode` para elegir «Tiempo caducado» o «No encontramos el PIN para facturar». El schema exige `codeType` y `codeImageUrl` como strings: los null que admite el camino sin tipo/imagen del backend no forman un payload válido para ese consumidor. HTTP 200 no demuestra ni disponibilidad en caja ni compatibilidad del payload.

El loader calcula el próximo corte a las 01:30 UTC (20:30 de Bogotá): al llegar al corte lo mueve al día siguiente. Lo calcula al consultar, sin usar fecha de emisión o TTL del PIN; una nueva consulta puede mover el contador. `CountdownDisplay` conserva el texto fijo «Vence hoy a las 8:30 p.m.», aunque el corte calculado corresponda a mañana. El reloj, el texto y la disponibilidad del proveedor requieren comprobaciones separadas; ninguno acredita una vigencia contractual de 24 horas.

## Confirmación bancaria de la compra

En `application`, `InvoiceProcessCorbeta` y `InvoiceProcessCorbetaBnpl` consultan órdenes con status 3 y enlazan `order.pin` con `data_json.verification_token` en información adicional cuyo tipo contiene ` barcode`. Consumo selecciona entidad 100 y usa `loan_validate_key`; BNPL selecciona 68 y usa `latestLenderTransaction.order_id`. Construyen monto/factura/fecha desde la orden y llaman a `consumoConfirmed` o `bnplConfirmed`. Guardan monto y factura de la solicitud sólo cuando la respuesta declara `data.status:Recibida`.

En ambos comandos, la marca `barcode_checked` se guarda fuera de esa condición, incluso si la respuesta no declara recibida. Tampoco es una guarda previa que evite volver a llamar al banco. No certifica confirmación bancaria ni vuelve idempotente un nuevo recorrido del comando. Estos comandos no asignan directamente estado 26.

## Factura y estado 26

`UpdateOrdersFromCorbeta` es un camino distinto: toma solicitudes creadas entre ayer y hoy, con su información `barcode`, y órdenes facturadas de hoy por status 3. Cruza PIN y actualiza monto, número de factura y estado 26 sólo cuando el monto o número difiere. No llama a confirmación bancaria ni exige estado previo 25. Si monto/factura ya coinciden, no corrige por sí solo un estado distinto. Usa la primera información adicional de la relación, sin el orden por última fila del endpoint de emisión.

El controller de compra del admin tiene otra consulta: toma el último PIN, consulta desde el día de creación hasta el final del siguiente con el status recibido, y aplica la misma condición de cambios para pasar a 26. Tener estado 26 acredita esa actualización local, sin certificar que un comando de confirmación bancaria haya tenido respuesta recibida. Que el código de emisión ya esté restringido a 25 no impide que otros caminos hayan actualizado la factura.

## Calendario y límites de verificación

El Kernel de `application` programa consumo a las 06:05, BNPL a las 03:00 y actualización de órdenes cada dos horas, con `onOneServer` y `withoutOverlapping`. Los dos comandos de confirmación consultan ventanas diferentes: consumo desde ayer hasta mañana; BNPL desde ayer hasta hoy a las 03:30. Declararlos en el Kernel no acredita scheduler activo, zona horaria efectiva, ejecución exitosa ni aceptación por el banco. Esas protecciones de ejecución tampoco garantizan idempotencia de cada compra.

Cambiar el emisor exige conservar o adaptar el identificador que enlaza las órdenes y estos consumidores. Aceptar un formato en pantalla no prueba que ese identificador exista en Corbeta ni que el banco cree la misma orden. La equivalencia entre emisores y quién crea la orden requieren contrato/documentación o medición del proveedor; una configuración o un mock local no resuelven esas preguntas de negocio.
