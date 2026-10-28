# Pagaré en Deceval: ruteo, credencial y depuración

Describe cómo legacy-backend y application (legacy-application) generan y firman en `main` el pagaré
desmaterializado en Deceval: qué decide que un lender vaya por Deceval, qué campos de la credencial del
depositante se usan, qué datos del girador se mandan, cómo se reutiliza un pagaré y dónde queda el rastro
para depurar. No certifica qué depositante parametrizó Deceval para cada entidad, ni qué credenciales
existen en un ambiente, ni el comportamiento del sandbox de Deceval.

## Qué manda un pagaré a Deceval

Lo decide el tipo de pagaré del lender: `lenders.promissory_type_id` apunta a `promissory_types`, y
`PromissoryNoteSigningFactory` lee su `name`. En legacy-backend, `deceval` va a
`DecevalPromissoryNoteService`, `ownership` o `traditional` al servicio tradicional, y cualquier otro valor
(o un lender sin tipo) lanza `UnknownPromissoryTypeException`. En application, `deceval` va a Deceval y
todo lo demás cae al tradicional sin error; además, la vista del pagaré de application sólo entra al
factory si `promissory_type_id == 2`, un id fijo. Para que la pantalla de firma de legacy-backend muestre el
pagaré, el catálogo `lender_signing_documents` del lender necesita una fila `promissory_note` sin
`template` ni `generator`: con plantilla propia se renderiza un Blade y Deceval no interviene.

## La credencial del depositante

Ambos monolitos toman la credencial con `RiskCentralCredential::findForUserRequest` sobre la central
llamada `Deceval`. legacy-backend le pasa el `lender_id` de la solicitud: usa la fila colgada del lender y,
si no existe, la del comercio o la sucursal. application le pasa null: sólo comercio o sucursal. No hay
respaldo en configuración: sin fila, la creación falla con un error de tipo antes de hablar con Deceval.
Los campos que se leen son `deceval_username` y `deceval_password` (UsernameToken de WS-Security),
`deceval_cert` y `deceval_key` (se escriben a archivos temporales para firmar el XML y se borran al
terminar), `deceval_depositante` y `deceval_nit_user` (encabezado de cada mensaje), `deceval_nit_emisor`
(girador y pagaré) y `deceval_clase_documento` (plantilla del pagaré). El destino es
`services.deceval.soap.host` (`DECEVAL_SOAP_HOST`); en legacy-backend, si está vacío se lanza
`DecevalConfigMissingException` con código `LNDV002` y HTTP 500, distinto de la falla de comunicación.

## Las cuatro operaciones y los datos del girador

Generar es crear el girador (`CreacionGiradoresCodificados`), crear el pagaré
(`CreacionPagaresCodificado`) y consultarlo en estado 6, «listo para firmar en blanco», para obtener el
PDF. Firmar es consultar en estado 6 para obtener el `idPagareDeceval`, firmar con el OTP y volver a
consultar para traer el PDF firmado. El encabezado lleva fecha y hora de Bogotá. Del cliente se mandan
correo, fechas de expedición y nacimiento si existen, tipo de documento (sólo CC→1 o CE→2), documento,
celular como teléfono y como celular, nombres, y primer y segundo apellido partidos por el primer espacio
de `surname`; el país de expedición va fijo en `CO`. Campos extra sólo entran por `options['girador']`, y
el servicio de legacy-backend no pasa ninguno: sólo fija `numPagareEntidad`.

## Reuso e idempotencia

`promissory_notes` tiene una fila por solicitud (`firstOrCreate` por `user_request_id` y `user_id`, con
`signing_method = deceval`). Si ya tiene `deceval_promissory_note_id` y `promissory_note_url`, se devuelve
sin volver a Deceval. Si no, el número es `{id}-{id con seis dígitos}`; los PDF, sin firmar y firmado, se
suben a S3 bajo `front-web/users/documents/{celular}/promissory_note/`, y la respuesta de la creación queda
en `deceval_response_data` (cuenta del girador, id y nombre del PDF). Si Deceval responde que el pagaré ya
existe (`SDL.DA.0312`), legacy-backend lo acepta. En créditos rotativos (`response_type` 3) con línea
activa, generar y firmar reutilizan el pagaré maestro (el ya firmado de esa línea) y la utilización sólo copia su
referencia; `shouldRequestPromissoryNote` no pide pagaré si la línea ya tiene uno firmado con OTP.

## Cómo falla

En legacy-backend, una excepción al llamar (red, TLS, armado del XML) se convierte en
`DecevalIntegrationException` con `LNDV001` y HTTP 502. Un fault de seguridad, como un certificado o una
contraseña rechazados, no lanza excepción HTTP: la respuesta no trae el DTO esperado y sale una
`ValidationException` genérica («No se puede crear el girador/el pagaré»). El girador exige `exitoso`
igual a `true`; la firma exige que la descripción empiece con `SDL.SE.0000`. En application, las guardas
del girador y de la firma usan `count() === 0 && …`, una condición que nunca se cumple, así que no validan
el éxito y un rechazo sigue de largo.

## Dónde mirar un caso

En legacy-backend cada operación escribe en `deceval_logs` (conexión `mysql_audit`, aparte, para que
sobreviva al rollback) con `user_request_id`, `name` legible, `method` y el XML enviado y recibido como
texto; el PDF en base64 se recorta y la `<clave>` se redacta. El registro es best-effort: si falla, no
corta el flujo. application escribe en la tabla general `logs`, no en `deceval_logs`. El estado del título
se lee en `promissory_notes`: `deceval_promissory_note_id` vacío significa que la creación no completó, y
`otp_id` guarda el OTP con que se firmó. El tipo de pagaré del lender está en `lenders.promissory_type_id`.
