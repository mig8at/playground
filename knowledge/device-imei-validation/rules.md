# Registro de IMEI y espera del titular

Describe el wizard y backend modular revisados en la ref local de main. El estado persistido y la respuesta del gateway son señales distintas; una corrida con MDM simulado no acredita inscripción ni desembolso externos.

## Registro del equipo desde el asesor

El formulario manual pide IMEI y confirmación de 15 dígitos iguales, más un teléfono de diez dígitos. El loader muestra selector +1/+57 cuando `alliedCountry` de la sesión es 60. El action compartido valida el teléfono y actualiza ese dato antes de ejecutar el caso de uso de IMEI: una entrada de IMEI inválida puede haber actualizado primero el teléfono. El caso de uso exige 15 dígitos y solicitud positiva; el FormRequest del backend exige tamaño 15, sin aplicar allí el servicio Luhn. No asumir que otra clase de validación encontrada en el repo se ejecuta en esta ruta.

El action registra el equipo y después llama a `device/{id}/disburse`. Un fallo del segundo paso muestra error de desembolso aunque el IMEI ya quedó registrado; no revierte ese registro. Con éxito dirige a `imei/scan/success`. El backend inscribe mediante merchant-gateways, consulta el estado y exige un dispositivo con nombre o modelo. Dentro de una transacción actualiza o reemplaza las filas de `user_request_products` y conserva ahí el IMEI; no basta buscarlo en `user_request_device_info`. El controller de desembolso exige un producto con IMEI y elige la rama SmartPay o la autorización general. Registrar y autorizar son comprobaciones distintas.

## Espera del titular y señal de finalización

Cuando el OTP del titular devuelve `metadata.lender_path:IMEI`, el wizard dirige a `security-validation` en lugar de llamar a la autorización estándar de esa action. La pantalla consulta el estado tras 30 segundos y vuelve a hacerlo con demoras de 30 segundos, hasta 20 intentos. Ante error o límite deja la consulta manual disponible. Navega a aprobado cuando el action obtiene `success` e `is_disbursed:true`; un IMEI inscrito por sí solo no libera la espera. Este mecanismo no depende del socket del saga de codeudor.

`client-status/{id}` obtiene `is_imei_enrolled` de un producto con IMEI e `is_disbursed` de `user_request_status_id === 11`; también informa el path del lender. El nombre de ese booleano no acredita una transferencia de dinero, una marca de desembolso ni la inscripción externa efectiva. Para comprobar el recorrido local hay que observar al titular antes y después, el destino emitido por el action del asesor y el estado/IMEI persistidos; una consulta inicial sobre una solicitud ya finalizada no cubre la transición.
