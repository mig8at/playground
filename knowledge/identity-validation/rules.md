# Validación de identidad: proveedores y cuándo corre

Qué valida la identidad de una persona en el recorrido «en casa», con qué proveedor y en qué orden.
Describe el módulo `Identity` y los servicios de `CredifamiliaV2` de `legacy-backend` en las refs de
`sources.json`. Lo que decide cada proveedor de su lado no se puede comprobar en este código.

## Dos etapas que no hay que confundir

Hay dos momentos en que se habla de «identidad», y son distintos:

- **Los datos de la persona**, en el tramo común, al enviar los datos personales: Ágil Data, Mareigua
  y TusDatos comparan nombre, apellidos y fecha de expedición contra lo que escribió el cliente
  ([coincidencia de nombres](knowledge:identity-name-validation)). Pasa para cualquier entidad.
- **La persona misma**, después de elegir una entidad que origina en casa: un proveedor comprueba que
  quien está del otro lado es el dueño del documento (foto del documento, selfie, preguntas). Es lo que
  cubre este tema.

Netco no valida identidad: es el proveedor de la **firma** de los documentos, que viene después.

## Cada entidad elige sus proveedores, en orden

Los proveedores salen de `lender_identity_validation_types`: las filas activas de la entidad, por
`order`. La de orden 1 es el primario; las demás son respaldo. Cuando un proveedor termina sin
validar, `SwitchValidationProviderService` pasa al siguiente en orden; si no hay siguiente, sigue el
destino propio del proveedor que falló. Si el país del comercio no tiene centrales de riesgo
habilitadas, el proveedor es `none` sin mirar la configuración de la entidad: los proveedores sólo
conocen personas colombianas.

Antes de mirar el proveedor, `CreditopXFlowService` revisa dos cosas: si la persona tiene una
validación manual de las últimas 24 horas, el paso se salta; y si la entidad no tiene proveedor
primario, el backend contesta `next_step: error` («no tiene tipo de validación principal
configurado»), con HTTP 200. El asistente no reconoce ese tipo y cae a su destino por defecto, las
instrucciones de identidad: el cliente ve la pantalla de siempre y el error no se nota.

`IdentityValidationStepResolver` traduce el proveedor al paso que sigue:

| proveedor | qué pide | paso |
|---|---|---|
| **Sin validación** (`none`) | nada | sigue el flujo |
| **ADO** | foto del documento y selfie en la plataforma de ADO | `ado_validation` |
| **AWS** (OCR + Rekognition) | lee el documento y compara la cara | `aws_validation` |
| **CrossCore** | enrolamiento biométrico y evaluación del proveedor | `crosscore_validation` |
| **Evidente** | un cuestionario de preguntas y, si hace falta, un código | `evidente_validation` |
| **Preguntas** (`questions`) | está en el catálogo, pero el resolver no lo atiende | error «no soportado» |

En el recorrido, la identidad se pide después de confirmar la entidad, del formulario adicional y de
Ábaco, y antes de la fecha de pago.

## ADO: documento y selfie, y la re-validación sólo con selfie

ADO devuelve un estado (`IdState`) que el backend traduce. En `enroll` (`/validar-persona`) sólo el 2 aprueba; en
`verify` (`/verificar-persona`) aprueban el 2 y el 14 («Persona registrada previamente») cuando llega con
`IsTransactionSuccessful = true` (`AdoService::isApproval`); en ese caso `AdoService::checkStatus` lo guarda normalizado
como 2 en `ado_confirmed_state_id` y conserva el 14 en `ado_state_id`. Otros estados conocidos son pendiente (1),
documento auténtico sin coincidencia de cara (4), captura mala (5), documento inválido (6), en verificación (7), la cara
no coincide (10), la huella no coincide (11), ya registrado (14 en `enroll`), error (15), cancelado por el usuario (17),
bloqueado (18) y documento que no corresponde (98). Un estado que no está en la lista queda como desconocido. Un rechazo
que el navegador guardó en `data` se contesta desde ahí sin consultar a ADO (`Ado::isBrowserRejection`), pero el 14 no
cuenta como rechazo, en ningún modo: se consulta a ADO para que quede la marca.

La primera validación de una persona siempre pide documento y selfie (`enroll`). Con `face_only_enabled` (o el id del
usuario en `face_only_test_user_ids`) del setting `ado_validation_config`, `AdoValidationModeResolver` decide en este
orden, contando sólo registros del mismo proyecto de ADO:

1. La racha: los `verify` sin aprobar desde su última aprobación de ADO en el proyecto (un `verify` o un `enroll`
   marcados 2), dentro de `attempts_window_hours`. Cuenta un rechazo o un cancelado (17); un `verify` sin veredicto
   cuenta sólo si tiene más de 10 minutos. Si llega a `max_failed_verifies`: si un `enroll` de la racha respondió 14,
   pasa a `Exhausted` (`ado_cannot_validate`); si no, vuelve a `enroll` (`verify_failed_repeatedly`).
2. Si su último `enroll` del proyecto marcado 2 o 14 fue 14 (`enroll_already_registered`), pasa a `verify`.
3. Si tiene un `enroll` aprobado (marca 2) dentro de `enrollment_max_age_days` y en el mismo proyecto, pasa a `verify`
   (`face_only_eligible`).
4. En cualquier otro caso, va a `enroll`.

En los dos modos, una aprobación sólo pasa si el número de documento que devuelve ADO coincide con el del dueño del
registro; si no, queda en 98. El mismo flujo valida al titular y al codeudor.

## ADO paso a paso: enroll, callback y estado

1. **`ado/enroll`** (`AdoController::enroll`): genera una referencia (uuid), arma la URL de vuelta
   (`…/{solicitud}/identity-validation-status?provider=ado&risk_central_user_id={referencia}`), elige la credencial y el
   modo (`enroll`, `verify` o `exhausted`, ver arriba). Si el modo es `Exhausted`, responde HTTP 429
   `ADO_CANNOT_VALIDATE` con `retry_after` en horas sin crear fila en `risk_central_user_data` ni devolver
   URL de ADO; en los demás modos guarda el registro con el modo y la credencial usada (a nombre del
   codeudor si es él) y devuelve la URL de la plataforma de ADO.
2. El cliente hace la captura en ADO, que lo devuelve a la URL de vuelta.
3. **`ado/enroll/callback/{solicitud}`**: exige que el registro sea del titular o de un codeudor activo de la solicitud
   (si no, 403), guarda la respuesta de ADO (una que no es JSON o no trae `TransactionId` queda en el log, para no
   confundirla con ADO caído) y hace una verificación de estado.
4. **`ado/check-status`**: el asistente pregunta hasta tener veredicto; `AdoService::checkStatus` consulta la
   transacción en ADO y traduce el estado como dice la sección anterior.

Dos cosas del código que no se ven desde afuera:

- **La credencial de la entidad sólo se usa en la ruta IMEI.** `resolveEnrollCredential` delega en
  `Ado::enrollCredentialsFor`, que pide la cuenta de la entidad (o del comercio) a `Ado::getCredentials` sólo si la
  solicitud va por IMEI (`isImeiPath`); en cualquier otro caso usa la de configuración, aunque la entidad tenga su
  propia cuenta de ADO. `RecentAdoApprovalResolver` usa la misma función para decidir si reaprovecha una aprobación.
- **El callback verifica en línea, en todos los ambientes.** Corre `StatusCheck::dispatchSync(..., reschedule: false)`:
  una sola verificación dentro de la misma petición, porque los ambientes de prueba no tienen workers y los reintentos
  en línea serían una recursión. El seguimiento queda en manos de `check-status`. El comentario lo marca para volver a
  `dispatch()` en producción, pero el código no distingue el ambiente.

## CrossCore y Evidente

Los usa hoy Credifamilia: CrossCore primero y Evidente de respaldo. CrossCore sólo cuenta como
validado con decisión ACCEPT y código R0201; otras decisiones van a revisión, a reintento o a
rechazo. Evidente es la validación por preguntas, con un código como paso adicional. El detalle de
las decisiones de CrossCore y de cuándo se cae al respaldo está en
[la originación de Credifamilia](knowledge:credifamilia-origination#identidad-proveedor-primario-y-respaldos).

## La validación manual: quién la escribe y qué la frena

La validación manual es una marca en el usuario: `users.manual_validation = 1` con la hora en `last_validation`.
`CreditopXFlowService` mira esa hora: si la última validación tiene menos de 24 horas, el paso de identidad se salta
sin consultar al proveedor.

La inicia un administrador desde el admin viejo (`legacy-application`): «validación manual» en el detalle del usuario
(`POST usuarios/{user}/validacion-manual`, `UserController::manualValidation`; el rechazo es
`validacion-manual/rechazar`, ambos por `handleManualValidationAction`). Pide el permiso `validate identity manually`,
muestra como candidatas las solicitudes del usuario con entidad de `response_type` distinto de 0 y 1 (marcando como
no elegibles las vetadas en `CreditopXBlacklistedDocument` —que prima— o las de ADO leído desde
`lender_identity_validation_types` con `order = 1` o `lenders.validation_type`) y delega **toda** decisión —aprobación
o rechazo, de cualquier entidad— al microservicio de préstamos de `legacy-backend` (`handleManualVaidation`,
pasando el `user_request_id` elegido).

En `legacy-application` ya no existe respaldo local ni envío directo por Twilio: el microservicio es el único punto
de control (ventana de 24 horas, lista negra de la entidad, ADO, hallazgos «alto» de AML, escritura de los flags y
envío del enlace). Si el microservicio responde éxito, `UserController` emite el evento de socket al asistente
(`ValidationStatusChanged` con `APPROVED` o `REJECT`); si falla o rechaza, no emite socket y devuelve el mensaje
del microservicio.

## Las listas restrictivas (TusDatos AML) sólo frenan con hallazgos «alto»

TusDatos también consulta listas restrictivas y PEP. Su respuesta trae `hallazgo` (sí o no), `hallazgos` (el nivel:
«bajo» o «alto»), `validado` y, a veces, `error` con las listas que no pudo revisar.

- **`legacy-application`** (`ValidateIdentityController`) deja pasar si la respuesta está validada y el nivel no es
  «alto», o si el nivel es «bajo». Con «alto», la identidad se frena.
- **`legacy-backend`** (`TusDatosService`) cuenta como hallazgo sólo `hallazgo = true` con nivel «alto», y una respuesta
  con `error` o `mensaje_error` se informa como `has_error` en el estado: no frena por sí sola. Una lista que no se pudo
  consultar no es un hallazgo.
