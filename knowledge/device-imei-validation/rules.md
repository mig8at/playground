# Registro de IMEI y espera del titular

Describe el wizard y backend modular revisados en la ref local de main. El estado persistido y la respuesta del gateway son señales distintas; una corrida con MDM simulado no acredita inscripción ni desembolso externos. Las rutas `device/*` existen sólo en legacy-backend; application no las tiene.

## Paso del asesor al formulario de IMEI

Cuando el titular valida el OTP de firma (`promissory-note/validate/verify-otp`), el backend pasa la solicitud al estado «Autorizado pendiente desembolso» (buscado por nombre) y deja un registro en el histórico de estados. Esa transición corre para cualquier flujo, no sólo IMEI. Si la solicitud tiene `corporate_user_id` y ese usuario tiene celular, se le manda al asesor un mensaje de texto avisando que el cliente firmó; si el envío falla, sólo queda en el log y la transición se mantiene.

Del lado del asesor, `loan-continue` consulta `device/advisor-status/{id}` sólo cuando el lender es de flujo IMEI y la solicitud no exige Ábaco (con Ábaco la pantalla es terminal y no consulta). La primera consulta sale a los 45 segundos y las siguientes cada 10 segundos, hasta cubrir 10 minutos. Pasa a `/imei` únicamente cuando la respuesta trae `is_documents_signed` verdadero. Una respuesta HTTP con error corta la espera; una respuesta correcta sin firma sigue esperando. Al cortarse o agotarse, la pantalla muestra «No pudimos confirmar la firma a tiempo…» con el botón «Consultar estado», que repite la misma consulta.

`advisor-status` da `is_documents_signed` verdadero sólo si el estado actual es el intermedio. El docblock del método dice que también lo es en 11, pero el código no lo hace: con la solicitud ya en 11 devuelve `is_documents_signed:false` e `is_disbursed:true`, y `loan-continue` no lee `is_disbursed`. Un asesor que entra a `loan-continue` con la solicitud ya desembolsada nunca pasa a `/imei` y termina en el mensaje de firma no confirmada.

## Registro del equipo desde el asesor

El formulario manual pide IMEI y confirmación de 15 dígitos iguales, más un teléfono de diez dígitos. El loader muestra selector +1/+57 cuando `alliedCountry` de la sesión es 60. El action compartido valida el teléfono y actualiza ese dato antes de ejecutar el caso de uso de IMEI: una entrada de IMEI inválida puede haber actualizado primero el teléfono. El caso de uso exige 15 dígitos y solicitud positiva; el FormRequest del backend exige tamaño 15 y que la solicitud exista, sin aplicar allí el servicio Luhn ni mirar su estado. No asumir que otra clase de validación encontrada en el repo se ejecuta en esta ruta.

El action registra el equipo y después llama a `device/{id}/disburse`. Un fallo del segundo paso muestra error de desembolso aunque el IMEI ya quedó registrado; no revierte ese registro. Con éxito dirige a `imei/scan/success`. El backend inscribe mediante merchant-gateways, consulta el estado y exige un dispositivo con nombre o modelo. Dentro de una transacción actualiza o reemplaza las filas de `user_request_products` y conserva ahí el IMEI; no basta buscarlo en `user_request_device_info`. El controller de desembolso exige un producto con IMEI y elige la rama SmartPay o la autorización general. Registrar y autorizar son comprobaciones distintas.

El orden dentro de `enroll` importa: primero el POST de inscripción al gateway, después la consulta de estado, después la exigencia de nombre o modelo y recién al final la transacción que guarda la fila. Si el gateway no reporta nombre ni modelo, o la consulta de estado no devuelve el equipo, el equipo ya quedó inscrito afuera y no hay fila con IMEI en la base.

`registerDevice` responde 500 a cualquier resultado de `enroll` que traiga `error`: solicitud o aliado inexistentes, equipo sin nombre ni modelo y cualquier respuesta 4xx o 5xx del gateway, incluidos los rechazos de negocio («TAC not found in database», «Device UID already exists», «Invalid IMEI»), que `mapDeviceError` traduce a un mensaje en español. Sólo «No se encontró el IMEI» (estado sin dispositivos) sale con 422. El wizard muestra el mensaje del backend bajo «No pudimos registrar el dispositivo», sin distinguir el código.

Con el registro guardado, el backend manda al titular un mensaje de que el dispositivo quedó registrado y puede continuar. Sale por `sendSms` del repositorio de mensajería con el canal `service`; el comentario del controlador lo llama WhatsApp. Si el envío lanza una excepción, sólo queda en el log y la respuesta sigue siendo éxito.

## Reintento después de un desembolso fallido

En el wizard, `disburse` sólo se llama dentro del éxito del registro, y no hay otra pantalla que lo invoque. Reintentar desde el formulario reenvía todo: actualiza el teléfono, vuelve a llamar a `device/register` y vuelve a inscribir el equipo en el gateway. Si el gateway rechaza la reinscripción de un equipo ya inscrito («Device UID already exists»), `enroll` devuelve error, el registro responde 500 con «El dispositivo ya está registrado» y el action termina antes de llegar a `disburse`. En ese camino la solicitud queda con IMEI guardado y en el estado intermedio, y desde el wizard no se vuelve a pedir el desembolso.

Lo mismo pasa cuando `enroll` falló después de inscribir (sin nombre ni modelo): el reintento choca con la misma reinscripción, y además no hay fila con IMEI, así que `disburse` tampoco pasaría su exigencia de IMEI.

## Ruta de desembolso del dispositivo

`device/{id}/disburse` vive dentro del grupo `requests` de `Modules/Loans/routes/api.php`, pero el subgrupo `device` le quita los tres middlewares del grupo: `onlyMobileValidation` (que responde 403 y manda el enlace para seguir en el celular cuando el user-agent es de escritorio; no autentica), `validate.authorized.status` (que corta las solicitudes en 11 y en 8) y `origination.flow` (que sólo agrega metadata a la respuesta). El proveedor de rutas del módulo pone `otel` y `api`, y el grupo `api` del Kernel sólo trae bindings, tracing y la misma metadata de originación. Ninguna de esas capas autentica a quien llama, igual que en `register`, `advisor-status` y `client-status`.

El controlador sólo exige que la solicitud exista y que tenga un producto con IMEI. En la rama SmartPay, `disburseImeiRequest` no mira el estado previo: regenera el acuerdo de bloqueo firmado y el plan de pagos, calcula montos, exige capital positivo, llama a `createFirstRegister`, deja la solicitud en 11 con `final_amount` y número de solicitud, crea un registro de estado 11, cancela los otros créditos del cliente y, fuera de la transacción, manda el correo del contrato, genera el voucher y cierra la solicitud. Así, una solicitud con IMEI pasa a 11 aunque no haya llegado al estado intermedio, y una ya en 11 vuelve a recorrer todo eso. `createFirstRegister` tiene su propia guarda: si la solicitud ya tiene una cadena viva en el histórico, devuelve la raíz existente en vez de crear otra.

Para las demás entidades la ruta llama a `authorize()` sin `otp_id`. Ese método tampoco consulta el estado previo: toma el último OTP validado del usuario (no necesariamente de esta solicitud), aplica las compuertas de codeudor y de fecha de pago rotativa, renumera y deja la solicitud en 11. En la ruta estándar de firma (`promissory-note/validate/authorize`) el 11 lo frenan el controlador y el middleware; por `device/{id}/disburse` ese freno no existe.

## Espera del titular y señal de finalización

Cuando el OTP del titular devuelve `metadata.lender_path:IMEI`, el wizard dirige a `security-validation` en lugar de llamar a la autorización estándar de esa action. La pantalla consulta el estado tras 30 segundos y vuelve a hacerlo con demoras de 30 segundos, hasta 20 intentos. Ante error o límite deja la consulta manual disponible. Navega a aprobado cuando el action obtiene `success` e `is_disbursed:true`; un IMEI inscrito por sí solo no libera la espera. Este mecanismo no depende del socket del saga de codeudor.

`client-status/{id}` obtiene `is_imei_enrolled` de un producto con IMEI, `is_pending_disbursement` de estar en el estado intermedio e `is_disbursed` de `user_request_status_id === 11`; también informa el path del lender. El nombre de ese booleano no acredita una transferencia de dinero, una marca de desembolso ni la inscripción externa efectiva. Para comprobar el recorrido local hay que observar al titular antes y después, el destino emitido por el action del asesor y el estado/IMEI persistidos; una consulta inicial sobre una solicitud ya finalizada no cubre la transición.
