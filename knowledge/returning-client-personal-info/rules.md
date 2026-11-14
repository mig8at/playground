# Cliente temporal y consolidado al validar el OTP y guardar datos personales

Cubre qué decide `legacy-backend` cuando una persona valida su código y cuando envía el formulario de
datos personales, según sea un usuario temporal o uno consolidado. Describe los módulos
`OnboardingV2` (el camino del pipeline de KYC) y, donde difiere, el `Onboarding` de siempre (v1); el
wizard de `frontend-monorepo` sólo en cómo elige el endpoint y traduce los códigos. `legacy-application`
(legacy-application) tiene su propio formulario Blade (`Customer/PersonalInfoController`), que este
tema no cubre. No certifica qué comercios van por cada camino (ver `kyc-pipeline`) ni cubre la
vigencia de consultas a centrales.

## Temporal y consolidado

Un usuario temporal nace al registrar el celular: `full_name`, `first_name` y `surname` valen
`TEMPORAL USER`. El `document_number` es un marcador `TEMP-<n>-<celular>`
(`UserService::createTemporalUser`, que corre al pedir el OTP), salvo que el paso de registro del
celular ya traiga el documento: `RegisterCellPhoneService` lo guarda tal cual en la fila temporal, o
se lo escribe a un temporal existente.

La definición que usan las decisiones de este tema es literal sobre `full_name`:
`OnboardingService::isTemporalUser` (v1) y `UsersV1 IsTemporalUserService` (v2) comparan
`full_name === 'TEMPORAL USER'`. Hay lectores que miran `first_name` en su lugar
(`RegisterCellPhoneService::isTemporaryUser`, las reglas de `PersonalInfoRequest` y
`StorePersonalInfoRequest` sobre el tipo de documento), así que una fila con nombre tecleado y
`full_name` todavía marcador no es temporal para ellos.

Se consolida cuando algo escribe `full_name`. En v2 el formulario NO lo escribe, a propósito. Lo
escribe `RiskV2 UserRepository::markConsolidated` (concatena nombre y apellido guardados) cuando una
central estableció identidad y coincide (`checked && matches`), desde `StoreRiskCentralDataService`
y desde la re-comprobación de `CheckIdentityService`. Si ninguna confirma, `CompleteKycService` lo
escribe al cerrar la corrida con el nombre tecleado, salvo que nombre o apellido sigan siendo el
marcador. Mientras no se consolida, la persona puede corregir su formulario las veces que haga falta.

## Los desenlaces al validar el OTP (v2)

`ValidateOtpAuthService` (`POST api/v2/onboarding/otp-auth/validate/{partnerBranchId}`), después de
validar el código y de desviar al codeudor:

1. Resuelve la sucursal; si ella o su comercio no pueden originar, responde `OBV22012` (403) antes
   de crear o reutilizar la solicitud.
2. Busca o crea la solicitud del usuario en esa sucursal.
3. Si el usuario es temporal (y el comercio no es Corbeta) responde `OBV22005`: va al formulario de
   datos personales.
4. Si no tiene información laboral **y** no está validado con centrales (lectura local del resumen
   del usuario, `agildata` o `mareigua` no nulos; no una consulta) responde `OBV22006`: va al
   formulario laboral. Este corte no mira si el comercio recoge información laboral.
5. Si no es temporal, firma y envía términos y condiciones (un fallo de esa firma se traga y no
   cambia la respuesta) y responde `OBV22000` (u `OBV22007` para Corbeta).

Corbeta salta los pasos 3 y 4 y, si no hay información laboral, la autocompleta.

El v1 (`OnboardingController::validateOtpCodeAndRedirectOrchestrator`,
`POST api/onboarding/loan-application/otp-validate/{partner_branch_id}`) tiene los mismos cortes con
`ONB002` (temporal) y `ONB004` (laboral), ambos con HTTP 200, y bloquea la originación con `ONB041`.
Difiere en que, entre los dos cortes, sí puede consultar centrales (la viabilidad de Experian si
no hubo pre-aprobación, y `validateRiskCentrals` si el comercio tiene CreditopX), y en que no manda
al formulario laboral cuando el comercio no recoge información laboral.

## Las guardas del formulario, en orden

`StorePersonalInfoService` (`POST api/v2/onboarding/personal-info/{partnerBranchId}/{userRequestId}`),
que el wizard usa sólo cuando el flujo KYC del comercio es `pipeline`; si no, llama al v1. Antes de
escribir:

1. Fechas (expedición o nacimiento) que no existen en el calendario → `OBV21005`.
2. Usuario dado de baja (`status != 1`) → `OBV21013`. Va antes del límite de intentos para no
   gastarlos en un rechazo que la persona no puede resolver; la salida es una solicitud nueva.
3. **Documento de otra persona** → `OBV21004`: si el número y tipo ya pertenecen a otro usuario, no
   se escribe nada. El dueño de la solicitud queda exento (se compara contra `user_requests.user_id`),
   así que reenviar el propio formulario no cuenta como duplicado. Corre antes del límite de intentos.
4. Límite de intentos por documento y hora → `OBV21009` (misma clave de caché que v1, así que el
   contador es uno para los dos caminos).
5. **El documento se escribe una vez** → `OBV21007`: si el guardado no está vacío ni empieza por
   `TEMP-` y difiere del enviado, se rechaza. El wizard muestra «El número de documento no se puede
   cambiar. Si te equivocaste, inicia una solicitud nueva».

Después vienen las guardas por comercio (fecha de expedición, fecha de nacimiento manual, estrato).
Un fallo de la FormRequest (`StorePersonalInfoRequest`) responde `OBV21003`.

## Qué puede cambiar un consolidado

Un consolidado no se rechaza: se le acota la escritura. `CONSOLIDATED_OVERWRITABLE` es
`first_name`, `surname` y `gender` (el género se deduce del nombre). Para cualquier otra columna
del envío (tipo y número de documento, correo, expedición, nacimiento, edad), si lo guardado tiene
valor se descarta lo enviado; si está vacío, se completa. El descarte es silencioso para la persona
y deja un warning con las columnas. Si `IsTemporalUser` no encuentra al usuario, se lo trata como
no temporal, que es la dirección que restringe. `OBV21006` («ya consolidado») quedó sin usar,
aunque el wizard todavía lo traduce.

El correo se valida `unique` en `users` ignorando sólo al dueño de la solicitud
(`StorePersonalInfoRequest`: `Rule::unique('users', 'email')->ignore(<user_id de la solicitud>)`).
Si la solicitud no existe, no se ignora a nadie.

## El consolidado que reenvía por v1

El v1 (`POST api/onboarding/loan-application/personal-info/{partner_branch_id}/{user_request_id}`,
`OnboardingController::validateAndStorePersonalInfo` → `validateAndStorePersonalInfoOrchestrator`
con `PersonalInfoRequest`) no tiene ninguna de las dos exenciones del dueño, así que un dueño ya
registrado que reenvía su propio formulario choca dos veces con su propia fila:

1. **Con el mismo correo** que tiene guardado: la FormRequest valida `unique:users,email` sin
   excepción y Laravel responde HTTP 422 con «El correo electrónico ya se encuentra registrado.»,
   antes de entrar al controlador.
2. **Con otro correo**: el pre-chequeo de documento (`findByDocumentAndType`) encuentra su propia
   fila. Sólo exime al codeudor (cuando el middleware `cosigner.token` dejó contexto de codeudor y la
   fila es la suya); para el solicitante no hay exención, así que responde `ONB005` con
   `error_subcode` `DOCUMENT_DUPLICATE`, HTTP 200, y el mensaje «El número de documento ya se
   encuentra registrado con el celular *******<últimos 3>.» con el celular de la fila encontrada, que
   es el del propio dueño.

En v2 las dos comparaciones excluyen al dueño de la solicitud: el `ignore` del correo en
`StorePersonalInfoRequest` y el `documentOwner->id !== user->id` del pre-chequeo de
`StorePersonalInfoService`. Por eso el reenvío de un consolidado sólo llega a la escritura acotada
por el camino v2.

## Quien cambia de celular

El reconocimiento de un usuario existente es por celular (`UserService::getOrCreateUser` y
`RegisterCellPhoneService` buscan con `findByCellPhone`). Con un número nuevo se crea otro temporal.
Si el registro del celular ya trae la cédula y ésta pertenece a otro usuario, el alta misma responde
«El número de documento ya se encuentra registrado con el celular *******<últimos 3>.». Si no la
trae, al escribirla en el formulario la guarda de documento de otra persona (`OBV21004`, o `ONB005`
en v1) la rechaza. El código no ofrece salida desde el formulario.
