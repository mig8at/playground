# Esquema y respuestas de formularios dinámicos

Contrato de form-service y del componente backend-driven del wizard observado en `main` local. No certifica campos cargados ni pruebas de un ambiente. La ubicación de un formulario en el journey pertenece al contexto de onboarding de su tarea.

## Composición del esquema

El parámetro `form_id` del esquema identifica el tipo de formulario: los vínculos de `forms` se consultan por `form_type_id`, con `status=1` y orden por sort/id. Los campos activos provienen de `fields`. El mapper agrupa por categoría y omite vínculos sin campo o sin categoría; tener una fila en `fields` no basta para renderizarla. Ordena secciones por el menor sort de sus campos y desempata por id; los campos también se ordenan por sort/id. `hidden`, `editable` y `sort` vienen del vínculo; `data_source`, `related_field_id` y la validación vienen del campo. El estado final combina field y vínculo. Los ids autoincrementales no deben copiarse entre ambientes: la migración de ciudad de nacimiento localiza padre y gemela por nombre dentro del form type, crea el campo y su vínculo y lo coloca después del padre.

## Lectura y reconstrucción

`GET /v1/dynamic-form/:form_id/schema` consulta Redis, luego S3 y sólo ante ausencia en ambas capas reconstruye mediante un workflow. Un hit S3 refresca Redis; un error real de lectura, refresco o decodificación devuelve error interno. No hay una caída automática de Redis a S3 ante indisponibilidad. `PUT` en esa misma ruta fuerza el workflow de reemplazo y espera su resultado. El workflow construye, codifica, elimina Redis y ejecuta la escritura en S3 seguida de Redis con el TTL del setting. Modificar tablas no invalida por sí mismo una copia servida por GET; después de una migración de campos hay que reconstruir el esquema del form type afectado. Las capas externas no tienen una transacción conjunta. El resultado de una petición y el contenido servido después deben comprobarse en el ambiente elegido.

## Cascada de zona y ciudad

Los data sources `field_options.country_tree.zones` y `field_options.country_tree.zones.cities` consumen el árbol geográfico separado del esquema. En `DynamicSection`, el hijo lee el valor de `field_${relatedFieldId}` entre valores acumulados y edición actual. El resolver ofrece zonas activas y ciudades activas de la zona seleccionada; sin padre o con zona inexistente devuelve `[]`. Conserva el orden recibido del backend y envía ids como strings. El efecto de limpieza borra un valor string no vacío que dejó de pertenecer a las opciones resueltas y limpia su error. Un `related_field_id` correcto y un árbol del país correcto son condiciones distintas. La selección del árbol y su reconstrucción se describen en `country-geography`; reconstruir el esquema no refresca ese catálogo.

## Persistencia de respuestas

La ruta de escritura es `POST /v1/dynamic-form/:form_id/response/:user_request_id`. El usuario se obtiene de la solicitud; no lo elige un parámetro `user_id` en la ruta actual. El caso de uso rechaza answers vacío. En MySQL reemplaza respuestas mediante DELETE e INSERT dentro de una transacción, acotada por `(form_id, user_id, user_request_id)`; no es un parche parcial por campo. Tras confirmar MySQL serializa y escribe S3, invalida la caché de respuestas si existía y elimina la de información suplementaria del usuario. Un fallo posterior al commit de MySQL puede devolver error aunque las respuestas ya hayan cambiado. Las filas y las copias de lectura deben comprobarse por separado; un error HTTP no demuestra rollback de todos los servicios.
