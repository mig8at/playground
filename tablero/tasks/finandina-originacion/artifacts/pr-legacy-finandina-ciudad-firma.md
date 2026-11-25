fix(finandina-documents): documents from a generic-city branch are signed in Bogotá

## Qué cambia y por qué

Los T&C de Banco Finandina se firmaban «en la ciudad de TODAS LAS CIUDADES». Visto en qa en la solicitud 505325: su
sucursal (2251, una sucursal de autogestión) tiene `country_city_id` 1123, la ciudad genérica de las sucursales
virtuales y de ecommerce. `FinandinaPayloadBuilder` ponía en `signature_city` el nombre de la ciudad de la sucursal tal
cual.

El resto de los documentos ya traduce esa ciudad: el pagaré (`PromissoryNoteService`, `allied_city`), el
consentimiento (`ConsentService`) y la garantía (`GuaranteeService`) imprimen «BOGOTÁ» cuando la ciudad es la 1123.
Ahora el armador de Finandina hace lo mismo, con `FinandinaPayloadBuilder::signatureCity`, y un poco más: aquellos sólo
comparan el id 1123, y esta regla reconoce también cualquier fila que se llame «TODAS LAS CIUDADES»: en qa existen la 1285 y la 3160, y en producción la 1283 y la
3158. Una sucursal con una ciudad real sigue firmando en su ciudad.

En qa y en producción, la 1123 es «TODAS LAS CIUDADES» y Bogotá D.C. es la 149. El comentario de
`CrediAsycoPayloadBuilder` que llama «Bogotá D.C.» a la 1123 no coincide con la base, aunque su comportamiento es el
mismo. No se toca en este PR.

## Qué se tocó

- `Modules/Loans/App/Services/DocumentGeneration/Payload/FinandinaPayloadBuilder.php`: `signatureCity()` y su uso en
  `signature_city`.
- `Modules/Loans/tests/Unit/FinandinaSignatureCityTest.php` (nueva): ciudad real, la 1123, otra fila genérica por
  nombre, el nombre en minúscula y sin ciudad.

## Cómo se comprobó

- `FinandinaSignatureCityTest`: 6 de 6 (prueba pura, sin base).
- Falta verlo en qa: firmar una solicitud de Banco Finandina desde una sucursal de autogestión y revisar la última página
  de los T&C.
