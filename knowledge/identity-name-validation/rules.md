# Identidad: coincidencia y adopción de nombres

Para retomar #47 sin tratar el diagnóstico original como comportamiento vigente.
Describe los servicios revisados en `main`; no es una medición de errores ni prueba que esos
servicios se ejecutaran para una persona. Los casos individuales, la configuración de mocks
y la validación funcional siguen en la tarea y en las herramientas.

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
la central sí las trae, gana la central. La adopción también registra una fila en
`kyc_name_checks` mediante `KycNameCheckRecorder`. Si no se cumplen las condiciones, los dos
servicios continúan por su validación anterior. Por tanto, no describir toda la identidad
como una compuerta que siempre devuelve exactamente lo tecleado.

## Un no-match de nombres no rechaza solo: la cascada sigue a TusDatos

En `OnboardingService::storePersonalInfo` la identidad es una cascada Ágil Data → Mareigua → TusDatos.
Cuando Ágil Data o Mareigua devuelven error **con** `errors` (los nombres no coinciden), no se rechaza
de una: si `shouldValidateTusDatos` lo permite se consulta TusDatos, y sólo si no lo permite se responde
`ONB005`. `shouldValidateTusDatos` cuenta los fallos por usuario en caché y deja pasar hasta
`personal_info_validation_error_max_attempts` (3 por defecto) dentro de
`personal_info_validation_error_cache_duration` minutos (5 por defecto). Así, el primer no-match de
Ágil Data termina decidido por lo que conteste TusDatos.

`kyc_name_checks` sólo monitorea: `KycNameCheckRecorder` registra ingresado contra devuelto y clasifica
el motivo (`match`, `wrong_document` cuando no hay ninguna palabra en común, `token_order`,
`token_mismatch`, `provider_no_data`), pero nunca decide ni lanza. Una fila `passed = 0` de Ágil Data
no significa que la persona fue rechazada. TusDatos guarda sus filas con `user_request_id` en null:
para ver todas las de una solicitud hay que buscarlas también por `user_id`.

## La tolerancia no certifica identidad ni completa todos los nombres

`NameSimilarity::compare` normaliza a ASCII, mayúsculas y espacios simples. Acepta igualdad o las
mismas palabras reordenadas; rechaza vacíos y que la central traiga menos partes.
En la comparación por posición permite hasta tres cambios Levenshtein por palabra (`MAX_TYPOS`).
Puede aceptar partes adicionales al final, por lo que en Mareigua una parte de más al final de
nombres o apellidos también se adopta. `alignedSplit` limita las formas de completar descritas
arriba y, para completar, no usa la tolerancia sino coincidencia exacta.

Esto fija un criterio del código, no garantiza que dos nombres pertenezcan a la misma persona.
Al investigar una falta de corrección, comprobar qué proveedor respondió y si entró al camino
de adopción; no convertir el máximo de tres cambios en una política del proveedor.

## La aplicación anterior tiene otro camino de escritura

En `application`, `Customer/PersonalInfoController` puede tomar los nombres de Ágil Data
y, en la rama donde Mareigua respondió con `respuesta_id == 4`, asigna sus campos de nombre
y apellido al usuario. Esa escritura no equivale a la adopción con `NameSimilarity` de los
servicios modulares. Revisar el controlador de la entrada utilizada antes de trasladar
un hallazgo de un monolito al otro.
