# Cliente temporal y consolidado al validar el OTP y guardar datos personales

Cubre qué decide `legacy-backend` cuando una persona valida su código y cuando envía el formulario de
datos personales, según sea un usuario temporal o uno consolidado. Describe los módulos
`OnboardingV2` (el camino del pipeline de KYC) y, donde difiere, el `Onboarding` de siempre; el
wizard de `frontend-monorepo` sólo en cómo elige el endpoint y traduce los códigos. No certifica qué
comercios van por cada camino (ver `kyc-pipeline`) ni cubre la vigencia de consultas a centrales.

## Temporal y consolidado

Un usuario temporal nace al registrar el celular: `full_name`, `first_name` y `surname` valen
`TEMPORAL USER` y `document_number` es un marcador `TEMP-<n>-<celular>`
(`UserService::createTemporalUser`). La definición de temporal en todo el monolito es literal:
`OnboardingService::isTemporalUser` compara `full_name === 'TEMPORAL USER'`.

Se consolida cuando algo escribe `full_name`. En v2 el formulario NO lo escribe, a propósito: lo
escribe `RiskV2 UserRepository::markConsolidated` (concatena nombre y apellido guardados) cuando
una central confirma, y, si ninguna confirma, `CompleteKycService` al cerrar la corrida con el
nombre tecleado. Mientras no se consolida, la persona puede corregir su formulario las veces que
haga falta.

## Los desenlaces al validar el OTP (v2)

`ValidateOtpAuthService` (`POST api/v2/onboarding/otp-auth/validate/{partnerBranchId}`), después de
validar el código:

1. Resuelve la sucursal; si ella o su comercio no pueden originar, responde `OBV22012` (403) antes
   de crear o reutilizar la solicitud.
2. Busca o crea la solicitud del usuario en esa sucursal.
3. Si el usuario es temporal (y el comercio no es Corbeta) responde `OBV22005`: va al formulario de
   datos personales.
4. Si no tiene información laboral **y** no está validado con centrales (lectura local de
   agildata/mareigua, no una consulta) responde `OBV22006`: va al formulario laboral.
5. Si no es temporal, firma y envía términos y condiciones (sin bloquear la respuesta) y responde
   `OBV22000` (u `OBV22007` para Corbeta).

Corbeta salta los pasos 3 y 4 y, si no hay información laboral, la autocompleta. El v1
(`OnboardingController`) tiene los mismos cortes con `ONB002` (temporal) y `ONB004` (laboral).

## Las guardas del formulario, en orden

`StorePersonalInfoService` (`POST api/v2/onboarding/personal-info/{partnerBranchId}/{userRequestId}`),
que el wizard usa sólo cuando el flujo KYC es `pipeline`; si no, llama al v1. Antes de escribir:

1. Fechas que no existen en el calendario → `OBV21005`.
2. Usuario dado de baja (`status != 1`) → `OBV21013`. Va antes del límite de intentos para no
   gastarlos en un rechazo que la persona no puede resolver; la salida es una solicitud nueva.
3. **Documento de otra persona** → `OBV21004`: si el número y tipo ya pertenecen a otro usuario, no
   se escribe nada. El dueño de la solicitud queda exento, así que reenviar el propio formulario no
   cuenta como duplicado. Corre antes del límite de intentos.
4. Límite de intentos por documento y hora → `OBV21009` (misma clave de caché que v1).
5. **El documento se escribe una vez** → `OBV21007`: si el guardado no está vacío ni empieza por
   `TEMP-` y difiere del enviado, se rechaza. El wizard muestra «El número de documento no se puede
   cambiar. Si te equivocaste, inicia una solicitud nueva».

Después vienen las guardas por comercio (fecha de expedición, fecha de nacimiento manual, estrato).

## Qué puede cambiar un consolidado

Un consolidado no se rechaza: se le acota la escritura. `CONSOLIDATED_OVERWRITABLE` es
`first_name`, `surname` y `gender` (el género se deduce del nombre). Para cualquier otra columna
del envío (documento, correo, expedición, nacimiento, edad), si lo guardado tiene valor se descarta
lo enviado; si está vacío, se completa. El descarte es silencioso para la persona y deja un warning
con las columnas. Si `IsTemporalUser` no encuentra al usuario, se lo trata como no temporal, que es
la dirección que restringe. `OBV21006` («ya consolidado») quedó sin usar, aunque el wizard todavía
lo traduce.

El correo se valida `unique` en `users`, ignorando sólo al dueño de la solicitud
(`StorePersonalInfoRequest`). Esa excepción no existe en v1, que tiene un `unique` sin excepción.

## Diferencia con el v1 en el documento duplicado

El pre-chequeo de v1 (`OnboardingController::validateAndStorePersonalInfoOrchestrator`) rechaza con
`ONB005` (`DOCUMENT_DUPLICATE`) cuando el documento ya existe y su dueño no es el codeudor de la
solicitud. Para el solicitante no hay exención del dueño: un usuario que reenvía su propio
documento choca con su propia fila. La exención del dueño es de v2.

## Quien cambia de celular

El reconocimiento de un usuario existente es por celular (`getOrCreateUser` busca con
`findByCellPhone`). Con un número nuevo se crea otro temporal; al escribir su cédula, que pertenece
al registro anterior, la guarda de documento de otra persona (`OBV21004`, o `ONB005` en v1) la
rechaza. El código no ofrece salida desde el formulario.
