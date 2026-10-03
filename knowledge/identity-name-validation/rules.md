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

Ágil Data pasa el nombre completo devuelto a `NameSimilarity::alignedSplit`. Sólo adopta
cuando puede conservar el número de partes y la frontera de nombre/apellido introducida,
y ambas mitades pasan la comparación. Si la central trae más partes, no adivina cómo partirlas.

Mareigua recibe nombres y apellidos separados. Adopta si ambos están presentes y ambas
comparaciones dan `same`; devuelve esos datos. Si no se cumplen las condiciones, los dos
servicios continúan por su validación anterior. Por tanto, no describir toda la identidad
como una compuerta que siempre devuelve exactamente lo tecleado.

## La tolerancia no certifica identidad ni completa todos los nombres

`NameSimilarity` normaliza a ASCII, mayúsculas y espacios simples. Acepta igualdad o las
mismas palabras reordenadas; rechaza vacíos y que la central traiga menos partes.
En la comparación por posición permite hasta tres cambios Levenshtein por palabra.
Puede aceptar partes adicionales al final; `alignedSplit` agrega la restricción de cantidad
total de partes antes de usar esa comparación.

Esto fija un criterio del código, no garantiza que dos nombres pertenezcan a la misma persona.
Al investigar una falta de corrección, comprobar qué proveedor respondió y si entró al camino
de adopción; no convertir el máximo de tres cambios en una política del proveedor.

## La aplicación anterior tiene otro camino de escritura

En `application`, `Customer/PersonalInfoController` puede tomar los nombres de Ágil Data
y, en la rama donde Mareigua respondió con `respuesta_id == 4`, asigna sus campos de nombre
y apellido al usuario. Esa escritura no equivale a la adopción con `NameSimilarity` de los
servicios modulares. Revisar el controlador de la entrada utilizada antes de trasladar
un hallazgo de un monolito al otro.
