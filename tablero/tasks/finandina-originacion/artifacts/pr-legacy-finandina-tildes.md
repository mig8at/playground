fix(CORE-845): los documentos de Finandina reconocen los campos con tilde también en el servidor

## Qué pasa

En qa, el formulario de vinculación de Banco Finandina salió **sin la actividad económica**, aunque el cliente la contestó («Empleado»). La solicitud de la prueba es la 505284.

`FinandinaPayloadBuilder` busca las respuestas del formulario por el nombre del campo, sin tildes ni mayúsculas. Para quitar las tildes usaba `iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', …)`, y eso depende de la librería del sistema:

| imagen | «Actividad económica · Sí» queda |
|---|---|
| Debian (el contenedor local) | `actividad economica · si` |
| Alpine (la de los ambientes, musl) | `actividad econ'omica · s'i` |

Con el apóstrofo, ningún nombre con tilde coincide. Por eso faltaba la actividad. Por lo mismo, un «Sí» de las preguntas PEP tampoco se habría reconocido, y la fecha de vinculación no se habría encontrado: con un cliente PEP, la vinculación saldría sin esos datos.

## Qué cambia

`plain()` usa `Str::ascii()` de Laravel (portable-ascii, PHP puro), que da lo mismo en cualquier imagen. Se agrega `Modules/Loans/tests/Unit/FinandinaPayloadBuilderPlainTest.php`, que fija las conversiones que usa el armador: «Actividad económica», «Sí» y «Fecha de vinculación» exactas, y que la pregunta PEP siga coincidiendo con su patrón.

⚠ El test corre en la imagen del entorno de pruebas. En local (Debian) también pasaba con el código viejo, porque el fallo es de la librería de Alpine. La diferencia entre las dos imágenes se midió aparte (abajo).

## Cómo se probó

- **El origen del problema:** en la imagen `php:8.2-fpm-alpine`, `iconv` devuelve `econ'omica S'i`. Con la librería de `Str::ascii`, sobre `php:8.4-cli-alpine`, salen `actividad economica`, `si`, `fecha de vinculacion` y `tu, tu conyuge o familiar hasta 2 grado son pep?`.
- **El test nuevo** está en verde en local. Ahí no distingue el código viejo del nuevo: lo que muestra el arreglo es la medición en Alpine del punto anterior.
- **En local**, el armador sigue llenando la actividad, las dos PEP, la entidad y las fechas de una solicitud que respondió «Sí».

## Al desplegar

Nada aparte: no hay migración ni configuración. Después del despliegue, una solicitud nueva de Finandina en qa tiene que salir con la actividad económica en la vinculación.
