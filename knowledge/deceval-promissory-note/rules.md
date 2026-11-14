# Pagaré en Deceval: ruteo, credencial y depuración

Describe cómo legacy-backend y legacy-application generan y firman en `main` el pagaré
desmaterializado en Deceval: qué decide que un lender vaya por Deceval, qué credencial del depositante
se elige y qué campos se usan, qué datos del girador se mandan, cómo se reutiliza un pagaré y dónde queda
el rastro para depurar. No certifica qué depositante parametrizó Deceval para cada entidad, ni qué
credenciales existen en un ambiente, ni el comportamiento del sandbox de Deceval.

## Qué manda un pagaré a Deceval

Lo decide el tipo de pagaré del lender: `lenders.promissory_type_id` apunta a `promissory_types`, y
`PromissoryNoteSigningFactory` lee su `name`. En legacy-backend, `deceval` va a
`DecevalPromissoryNoteService`, `ownership` o `traditional` al servicio tradicional, y cualquier otro valor
(o un lender sin tipo) lanza `UnknownPromissoryTypeException`. En legacy-application, `deceval` va a Deceval y
cualquier otro nombre cae al tradicional; el acceso no es null-safe, así que un lender sin tipo no llega
a ese `default`. Además, la vista del pagaré de legacy-application sólo entra al factory si
`promissory_type_id == 2`, un id fijo.

En legacy-backend, la previsualización y la firma consultan antes el catálogo `lender_signing_documents`
del lender para la rama de codeudor que corresponda. Si el lender no tiene filas ahí, el camino de siempre
pide el pagaré al factory cuando la validación lo requiere. Si tiene catálogo, el pagaré sale sólo si hay
una fila `promissory_note`, y esa fila no debe tener `template`: con plantilla propia se renderiza un Blade
y Deceval no interviene. Con catálogo y tipo `deceval`, la firma va por el camino propio del pagaré
Deceval, con lock por solicitud y sin volver a firmar si la fila ya tiene `otp_id`. Las entidades de
Credifamilia arman su propio juego de documentos y piden el pagaré al factory por fuera del catálogo.

## La credencial del depositante

Ambos monolitos toman la credencial con `RiskCentralCredential::findForUserRequest` sobre la central
llamada `Deceval`. La consulta usa `inRandomOrder()->first()`. legacy-backend le pasa el `lender_id` de la
solicitud: primero busca entre las filas colgadas del lender y, sólo si no hay ninguna, entre las del
comercio (`Allied`) y las de la sucursal (`AlliedBranch`), juntas y sin prioridad entre ellas. legacy-application le
pasa null: nunca mira las filas del lender, sólo el grupo comercio más sucursal.

Crear y firmar eligen la credencial cada uno por su cuenta: `DecevalSoap::createPromisoryNote` la busca
una vez y la reutiliza para el girador, el pagaré y la consulta; `DecevalSoap::signPromisoryNote` vuelve a
buscarla y la reutiliza para sus dos consultas y la firma. La elegida no se guarda: ni `promissory_notes`
ni `deceval_response_data` ni `deceval_logs` tienen una referencia a ella. Por eso, cuando más de una fila
califica en el nivel que se usa, la firma puede salir con una credencial distinta de la que creó el
pagaré. Con una sola fila en ese nivel, la elección es siempre la misma.

No hay respaldo en configuración: sin fila, la creación falla con un error de tipo antes de hablar con
Deceval. Los campos que se leen son `deceval_username` y `deceval_password` (UsernameToken de
WS-Security, con la contraseña como digest), `deceval_cert` y `deceval_key` (se escriben a archivos
temporales para firmar el XML y se borran al terminar), `deceval_depositante` y `deceval_nit_user`
(encabezado de cada mensaje), `deceval_nit_emisor` (girador y pagaré) y `deceval_clase_documento`
(plantilla del pagaré). El destino es `services.deceval.soap.host` (`DECEVAL_SOAP_HOST`); en
legacy-backend, si está vacío se lanza `DecevalConfigMissingException` con código `LNDV002` y HTTP 500,
distinto de la falla de comunicación. legacy-application no tiene esa guarda.

## Las cuatro operaciones y los datos del girador

Generar es crear el girador (`CreacionGiradoresCodificados`), crear el pagaré
(`CreacionPagaresCodificado`) y consultarlo en estado 6, «listo para firmar en blanco», para obtener el
PDF. Firmar es consultar en estado 6 para obtener el `idPagareDeceval`, firmar con el OTP y volver a
consultar, con el estado 9 por omisión, para traer el PDF firmado. En legacy-backend el encabezado lleva
fecha y hora de Bogotá; en legacy-application usa `now()` con la zona de la aplicación (`TZ`, UTC por omisión).
Del cliente se mandan correo, fechas de expedición y nacimiento si existen, tipo de documento (sólo CC→1 o
CE→2), documento, celular como teléfono y como celular, nombres, y primer y segundo apellido partidos por
el primer espacio de `surname`; el país de expedición va fijo en `CO`. Campos extra sólo entran por
`options['girador']`. En legacy-backend los arma `DecevalGiradorFields`,
pero sólo para los lenders listados en el setting `deceval_girador_address`
(`{"enabled_lender_ids": [...]}`, leído por `DecevalGiradorAddressSwitch`; sin la fila, o si no se
puede leer, no van para nadie). `numPagareEntidad` no es del girador: viaja en `options['pagare']`.

`DecevalGiradorFields` sólo manda lo que puede afirmar: la dirección de residencia (los mismos
campos que `OnboardingPayloadBuilder::RESIDENCE_ADDRESS_FIELD_IDS`, cortada a 100 caracteres), el
departamento y la ciudad de expedición y de domicilio como códigos DANE (con país de domicilio `CO`)
y la nacionalidad `CO` sólo con CC. `DaneCodeResolver` traduce los nombres del formulario a
`country_zones`/`country_cities` normalizados; un lugar que no resuelve no se manda y queda en el
log `deceval.girador.place_unresolved`. `DecevalSoap` escribe como nodo de texto (escapando `&`) sólo lo
que entra por las opciones, así que un `&` en una dirección llega escapado; los campos fijos del
girador (correo, nombres, apellidos) siguen con `createElement($tag, $value)`, que no escapa.

## Reuso e idempotencia

`promissory_notes` tiene una fila por solicitud (`firstOrCreate` por `user_request_id` y `user_id`, con
`signing_method = deceval`). Si ya tiene `deceval_promissory_note_id` y `promissory_note_url`, se devuelve
sin volver a Deceval. Si no, el número es `{id}-{id con seis dígitos}` y se guarda como
`deceval_promissory_note_id`; la firma lo usa como `numPagareEntidad` para consultar. Los PDF, sin firmar y
firmado, se suben a S3 bajo `front-web/users/documents/{celular}/promissory_note/`. La respuesta de la
creación queda en `deceval_response_data` (cuenta e identificación del girador, id, nombre y base64 del PDF
sin firmar); la firma sólo cambia `promissory_note_url` y `otp_id`.

Lo que sigue es de legacy-backend. Si Deceval responde que el pagaré ya existe (`SDL.DA.0312`), lo acepta.
En créditos rotativos (`response_type` 3) con línea activa, generar y firmar reutilizan el pagaré maestro
(el primero firmado con OTP de esa línea) y la utilización sólo copia su referencia.
`shouldRequestPromissoryNote` no pide pagaré si la primera línea del cliente con ese lender, activa o no,
ya tiene uno firmado con OTP.

## Cómo falla

En legacy-backend, una excepción al llamar (red, TLS, armado del XML) se convierte en
`DecevalIntegrationException` con `LNDV001` y HTTP 502. Un fault de seguridad, como un certificado o una
contraseña rechazados, no lanza excepción HTTP: la respuesta no trae el DTO esperado y sale una
`ValidationException` genérica («No se puede crear el girador/el pagaré»). El girador exige `exitoso`
igual a `true`, el pagaré lo exige salvo `SDL.DA.0312`, y la firma exige que la descripción empiece con
`SDL.SE.0000`.

En legacy-application, las guardas de éxito de las cuatro operaciones usan `count() === 0 && …`: si el elemento
existe, la condición es falsa y un rechazo sigue de largo; si falta, leer `item(0)` sobre null es un error
de PHP en lugar de la `ValidationException`. Además, la generación del servicio de legacy-application captura
cualquier `Exception`, la registra y devuelve el pagaré con id, PDF y URL en null.

## Dónde mirar un caso

En legacy-backend cada operación escribe en `deceval_logs` (conexión `mysql_audit`, aparte, para que
sobreviva al rollback) con `user_request_id`, `name` legible, `method` y el XML enviado y recibido como
texto; el PDF en base64 se recorta y la `<clave>` se redacta. El XML enviado lleva `codigoDepositante`,
`usuario` y el `Username` de WS-Security: es la forma de saber qué credencial usó cada llamada. El
registro es best-effort: si falla, no corta el flujo. legacy-application escribe en la tabla general `logs`, no
en `deceval_logs`, sin recortar ni redactar (la `<clave>` de la firma queda en el XML) y sin capturar sus
propios errores. El estado del título se lee en `promissory_notes`: `deceval_promissory_note_id` vacío
significa que la creación no completó, y `otp_id` guarda el OTP con que se firmó. El tipo de pagaré del
lender está en `lenders.promissory_type_id`.
