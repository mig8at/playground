# Identidad: coincidencia y adopción de nombres

Para retomar #47 sin tratar el diagnóstico original como comportamiento vigente.
Describe los servicios revisados en `main`; no es una medición de errores ni prueba que esos
servicios se ejecutaran para una persona. Los casos individuales, la configuración de mocks
y la validación funcional siguen en la tarea y en las herramientas.

En `legacy-backend` hay dos implementaciones de la identidad. La del registro web
(`OnboardingService::storePersonalInfo`, con los servicios de `Modules/Identity`) es la que
describen las primeras secciones. El registro móvil (`MobileOnboardingV1`) usa la de `RiskV2`,
que corta y registra distinto. `application` tiene una tercera, en su controlador.

## TusDatos distingue ausencia de desacuerdo para cédula

En la rama `CC`, TusDatos construye mensajes con un `match` estricto: `null` = no proporcionado,
`0` = no coincide, `2` = coincide parcialmente. Sólo tolera `null` para `middle_name` y
`second_surname`. El filtro revisado usa `=== null`: ya no suprime el código entero `0`
de esos dos campos como hacía la comparación débil del defecto original.

Si hay errores devuelve rechazo. Cuando ese camino tiene éxito, devuelve los nombres y apellidos
introducidos, no nombres recuperados del proveedor. Esta regla no describe la rama `CE` ni
convierte un resultado de TusDatos en una corrección automática del nombre.

## Ágil Data y Mareigua pueden devolver una versión adoptada

Ágil Data pasa el nombre completo devuelto a `NameSimilarity::alignedSplit`
(`NameSimilarity.php:83`), que respeta la frontera nombre/apellido introducida. Adopta en tres
formas: con la misma cantidad de partes corrige ortografía, comparando cada mitad con la tolerancia;
con una parte de más, la agrega al final como segundo apellido; con un nombre y un apellido contra
cuatro partes, toma la segunda como segundo nombre y la cuarta como segundo apellido
(`NameSimilarity.php:99-118`). Al completar, lo introducido debe coincidir exacto en su lugar
(salvo tildes y Ñ), sin tolerancia de errores (`NameSimilarity.php:124-131`). Cualquier otra forma,
por ejemplo dos nombres posibles para una parte sobrante en medio, devuelve null: no adivina.

Mareigua recibe nombres y apellidos separados y usa `NameSimilarity::adoptSplit`
(`NameSimilarity.php:153`): adopta si ambos vienen y cada parte pasa la comparación con tolerancia.
En las dos centrales lo adoptado sale del texto original de la central, y `keepEnteredAccents`
restituye la Ñ y las tildes que escribió el asesor cuando la central trae esa palabra sin ellas; si
la central sí las trae, gana la central. En este camino (`Modules/Identity`) la adopción también
registra una fila en `kyc_name_checks` mediante `KycNameCheckRecorder`; la adopción de `RiskV2`
no lo hace. Si no se cumplen las condiciones, los dos servicios continúan por su validación
anterior. Por tanto, no describir toda la identidad como una compuerta que siempre devuelve
exactamente lo tecleado.

## Un no-match de nombres no rechaza solo: la cascada sigue a TusDatos

Esto vale para el registro web. En `OnboardingService::storePersonalInfo` la identidad es una cascada
Ágil Data → Mareigua → TusDatos. Cuando Ágil Data o Mareigua devuelven error **con** `errors` (los
nombres no coinciden), no se rechaza de una: si `shouldValidateTusDatos` lo permite se consulta
TusDatos, y sólo si no lo permite se responde `ONB005`. Un no-match de Ágil Data no pasa a Mareigua:
va directo a TusDatos o a `ONB005`.

`shouldValidateTusDatos` cuenta los no-match por usuario en caché (`personal-info-validation-error-{id}`).
Lee dos settings: `personal_info_validation_error_max_attempts` y
`personal_info_validation_error_cache_duration` (minutos); si la fila no existe, el código usa 3 y 5.
Cada ambiente puede tener otros valores en `settings`: el número efectivo se mira allí, no en el
código. Con un tope M, los primeros M no-match van a TusDatos y el siguiente, con el contador en
`count >= M`, da `ONB005`. Cada incremento vuelve a escribir la clave con la duración completa, así
que la ventana se cuenta desde el último no-match, no desde el primero. Así, el primer no-match de
Ágil Data termina decidido por lo que conteste TusDatos. Fue al revés hasta el 2026-06-18: la versión original devolvía
`false` en los primeros intentos (el error de nombres iba al cliente para corregir) y consultaba TusDatos
recién al agotarlos; el PR #850 invirtió los dos `return`.

## El motivo registrado no dice si el nombre cambió

`kyc_name_checks` sólo monitorea: `KycNameCheckRecorder` nunca decide ni lanza. Cuando quien registra
no pasa un motivo, lo clasifica: `match` si pasó y, si no, `provider_no_data`, `wrong_document` (ninguna
palabra en común, o TusDatos con los tres grupos sin coincidencia), `token_order`, `token_mismatch` o
`mismatch`. Un motivo explícito gana sobre esa clasificación, y así llegan los de la adopción y la
reparación: Ágil Data escribe `completed` cuando la central trae más palabras que lo tecleado y
`adopted` en el resto de las adopciones; Mareigua escribe siempre `adopted`, también cuando completó;
`kyc:repair-adopted-names` escribe `repaired`. Una fila `passed = 0` de Ágil Data no significa que
la persona fue rechazada.

`adopted` no implica que el nombre cambiara. Ágil Data registra `adopted` cada vez que `alignedSplit`
no devuelve null, también con el nombre idéntico al tecleado, y Mareigua no distingue completar de
corregir. Para saber si hubo cambio hay que comparar `entered_normalized` con `returned_normalized`
de la fila. TusDatos y la reparación guardan sus filas con `user_request_id` en null: para ver todas
las de una solicitud hay que buscarlas también por `user_id`.

## La tolerancia no certifica identidad ni completa todos los nombres

`NameSimilarity::compare` normaliza a ASCII, mayúsculas y espacios simples. Acepta igualdad o las
mismas palabras reordenadas; rechaza vacíos y que la central traiga menos partes.
En la comparación por posición permite hasta tres cambios Levenshtein por palabra (`MAX_TYPOS`).
Puede aceptar partes adicionales al final, por lo que en Mareigua una parte de más al final de
nombres o apellidos también se adopta. `alignedSplit` limita las formas de completar descritas
arriba y, para completar, no usa la tolerancia sino coincidencia exacta.

El tope es absoluto: no depende del largo de la palabra. En un apellido de cuatro o cinco letras,
tres cambios son casi toda la palabra, así que pares como RUIZ/DIAZ, MORA/SOTO o PEREZ/LOPEZ
(distancia 3) pasan como la misma palabra y, cuando la forma no cambia, se adopta el apellido de la
central en lugar del tecleado. La copia de `RiskV2` (`NameUtils`) usa el mismo tope y documenta un
tope proporcional al largo que no está aplicado.

Esto fija un criterio del código, no garantiza que dos nombres pertenezcan a la misma persona.
Al investigar una falta de corrección, comprobar qué proveedor respondió y si entró al camino
de adopción; no convertir el máximo de tres cambios en una política del proveedor.

## El registro móvil corta en el primer veredicto

`MobileOnboardingV1` (`UpdateInfoService`) valida la identidad con
`RiskV2 ValidateUserPersonalInfoAgainstIdentityBurosService`, otra cascada Ágil Data → Mareigua →
TusDatos. El orden es fijo en el código; el setting `mobile_onboarding_active_risk_centrals` sólo
quita centrales de la lista, nunca agrega ni reordena. Una central que no está en el setting se salta
sin leer lo guardado ni consultar.

La cascada se detiene en la primera central que da veredicto, en cualquier sentido: si Ágil Data dice
que el nombre no es de esta persona, Mareigua y TusDatos no se consultan. Sólo pasa a la siguiente
cuando la central no pudo contestar (falla de transporte, sin registro, o TusDatos sin fecha de
expedición). No hay contador de intentos ni `shouldValidateTusDatos`. Con una central en `false`,
`UpdateInfoService` responde uno de los rechazos `MOV16008`–`MOV16013`; si ninguna dio veredicto,
responde `MOV16000` con `validated` en false y sin marcar al usuario como registrado.

Los validadores comparan contra el `users` guardado, no contra lo recién tecleado: el flujo móvil
escribe los datos antes de llamar a la cascada. El docblock del servicio dice que en el camino
anterior un no-match de Ágil Data termina en `ONB005` sin consultar Mareigua. Lo de Mareigua es
cierto, pero `storePersonalInfo` sólo responde `ONB005` cuando agotó los intentos; antes consulta
TusDatos. Las dos cascadas no deciden igual ante el mismo no-match.

## RiskV2 adopta con su propia copia y no deja registro

En `RiskV2` la comparación vive en `CommonsV1/App/Utils/NameUtils.php`, una copia de `NameSimilarity`
con `alignedSplit`, `compare` y `keepEnteredAccents`, pero sin `adoptSplit`. Los validadores por central
(`AgildataIdentityValidator`, `MareiguaIdentityValidator`, `TusDatosIdentityValidator`) devuelven un
`IdentityResult`; el de Mareigua compara nombres y apellidos por separado con `compare` y adopta si
los dos pasan.

Cuando el resultado trae adopción, `StoreRiskCentralDataService` (al guardar una respuesta nueva) y
`CheckIdentityService` (al revalidar una guardada) escriben el nombre en `users` con
`userRepository->updateNames`. Ninguno de los dos llama a `KycNameCheckRecorder`: las adopciones del
registro móvil no dejan fila en `kyc_name_checks`. Para ese flujo, la tabla no es el registro de lo
que se corrigió.

## Una reparación por lotes reescribe nombres con lo guardado

`kyc:repair-adopted-names` (`RepairAdoptedNamesCommand`) usa `StoredNameRepairService` para aplicar la
regla de adopción a clientes ya registrados, con la última respuesta guardada de Ágil Data
(`alignedSplit`) y, si ésa no cambia nada, la de Mareigua (`adoptSplit`). No consulta ninguna central.
Sólo considera clientes `CC`, sin `manual_validation`, con una consulta de Ágil Data o Mareigua desde
la fecha `--since` y sin ninguna solicitud con `disbursed_at`; se puede acotar con `--user`.

Sin `--apply` sólo lista los cambios en un CSV. Con `--apply` reescribe `first_name`, `surname` y
`full_name`, y deja una fila en `kyc_name_checks` con `passed = 1`, motivo `repaired` y
`user_request_id` en null. `--undo` con ese CSV devuelve el nombre anterior a quien todavía tiene el
nuevo. Es un camino de escritura de nombres fuera del registro.

## La aplicación anterior tiene otro camino de escritura

En `application`, `Customer/PersonalInfoController` puede tomar los nombres de Ágil Data
y, en la rama donde Mareigua respondió con `respuesta_id == 4`, asigna sus campos de nombre
y apellido al usuario. Esa escritura no equivale a la adopción con `NameSimilarity` de los
servicios modulares.

Con TusDatos depende de la entrada. En `store` (sin Ágil Data ni Mareigua en sesión) y en
`storeFromPreapproved` (sin `error_tusdatos`), escribe en el usuario los nombres que devolvió TusDatos
y quedaron en sesión: `primer_nombre`/`segundo_nombre` y `primer_apellido`/`segundo_apellido` para
cédula, o `nombre_completo` partido para `CE`. En `storePersonalInfo`, en cambio,
`TusDatosController::validateUserDataTusDatosV2` devuelve lo tecleado, como el servicio de
`legacy-backend`. Revisar el controlador de la entrada utilizada antes de trasladar un hallazgo de un
monolito al otro.
