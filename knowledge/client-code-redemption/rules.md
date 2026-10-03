# Canje del código de preaprobado

Para retomar #94 sin confundir el código con una aprobación nueva. Cubre el receptor en
legacy-backend, el wizard y el receptor anterior en application. No documenta la emisión ni el
vencimiento del código: requieren revisar el servicio emisor. Tampoco prueba cupo vigente ni
disponibilidad de una entidad para un cliente concreto.

## El receptor admite dos formatos y consulta por comercio

`POST /api/onboarding/client-code/redeem` acepta cuatro dígitos históricos o dos letras
y cuatro dígitos; convierte las letras a mayúsculas después de validar.
`ClientCodeRedemptionService` resuelve el comercio desde `partner_branch_hash` y consulta
el código mediante `GenerateServiceProxyService`. Exige ids positivos de usuario y entidad.
No obtiene la identidad del cliente de la sesión del asesor: proviene de la consulta del código.

Los errores se envuelven en el contrato del onboarding (`success`, `error_code`, `payload`).
Los fallos de consulta o consumo conservan el estado HTTP y mensaje del proxy; no asumir
que cada `CCO003` o `CCO006` tiene siempre un único estado HTTP.

## Se crea la solicitud antes de consumir el código

La solicitud nace en estado `9`, línea de crédito `1`, con usuario, comercio, sucursal y
entidad del canje; `corporate_user_id` queda en `null`. Si no llegan importes positivos,
`amount` queda en cero y `original_amount` usa el importe resuelto. Plazo, cuota y tasa
también nacen en cero: un canje exitoso no prueba que se haya seleccionado una oferta.

Primero se crea la solicitud y después se consume el código. Si el consumo devuelve un estado
HTTP distinto de 200, se intenta borrar la solicitud y se devuelve el error. Si el borrado
falla se registra; no prometer una transacción atómica con el servicio externo.
El registro de estado se intenta sólo después del consumo y su fallo no invalida el canje.

## El recorte del wizard depende de una marca de sesión

La pantalla del código llama al repositorio de canje y, al tener éxito, guarda
`clientCodeLender:<user_request_id>` en la sesión del funnel antes de redirigir al listado.
El loader de `available-lenders` lee esa clave y recorta las opciones antes de iniciar las
consultas de preaprobación por entidad. El backend sigue devolviendo el catálogo completo.

Sin marca no hay recorte. Si la entidad del código no aparece en las opciones, el filtro
conserva el listado completo. Por tanto, «el cliente siempre ve una sola entidad» no es una
garantía del comportamiento actual. Perder la cookie o no encontrar la entidad son casos
que deben comprobarse por separado en la tarea.

## El receptor anterior conserva cuatro dígitos y otro estado de sesión

En `application`, `Customer/ClientCodeController::confirmCode` valida `digits:4`, consulta
por el puente al backend, crea la solicitud y consume el código. Si el consumo falla ejecuta
su limpieza. Tras el éxito guarda el estado del flujo y marca `LoanFlow::markStarted`.

`ListLenderController::filterClientCodeFlowLenders` sólo usa `client_code.flow` cuando el id
de solicitud coincide; si falta la entidad en la lista, conserva la lista original.
No trasladar la clave del wizard al monolito anterior ni concluir que sus cuatro casillas
aceptan el formato de seis caracteres por haber cambiado el backend.
