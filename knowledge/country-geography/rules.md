# Catálogo geográfico y árbol de opciones

Mecanismo de catálogo y lectura disponible en `main` local. Las cantidades de ciudades, los usos de comodines y los resultados de ambientes son mediciones fechadas de las tareas, no invariantes de esta biblioteca.

## Relación entre país zona y ciudad

La ciudad se relaciona con el país a través de `country_cities.country_zone_id → country_zones.country_id`. En el admin de `application`, las ciudades ofrecidas se filtran por el país del comercio y por `country_cities.status=1`. Los nombres repetidos dentro de ese conjunto se distinguen añadiendo la zona; cada opción conserva `zona_id`. La lista separada de zonas filtra además `country_zones.status=1`. El filtro del selector no demuestra por sí mismo la validación del guardado. Para revisar una sucursal, comparar el país de su comercio con el país obtenido por ese join; nombre de ciudad e id aislado no bastan.

## Árbol de opciones

form-service construye el árbol con el país activo, sus zonas activas y las ciudades activas de esas zonas, ordenadas por nombre e id. Con id explícito consulta ese país; sin id usa `app.country_iso_code`, normalizado en mayúsculas y sin espacios exteriores, contra `iso_code_1`. El GET sin id puede reutilizar el mapeo ISO→id guardado en Redis con su propio TTL. Este default sale de la configuración del servicio, no del comercio del wizard. El árbol se consulta por Redis y después S3; sólo una ausencia reconocida permite pasar a la siguiente capa y reconstruir desde MySQL. Un error real de caché, almacenamiento o decodificación aborta; no se trata como ausencia.

## Reconstrucción del catálogo

`PUT /v1/field-options/country-tree/:country_id` fuerza reconstrucción desde MySQL. Sin id resuelve el país configurado. `BuildAndReplace` construye y codifica, elimina la entrada del árbol en Redis, escribe S3 y repuebla Redis con el TTL configurado. Las escrituras no forman una transacción entre servicios: un error intermedio puede dejar las capas en estados distintos. Un GET con copia existente no contrasta cambios de tablas. Este árbol y el esquema de un formulario tienen rutas y cachés independientes; reconstruir uno no reconstruye el otro.

## Migración de RD y Perú

La migración de septiembre siembra DOM y PER localizando el país por `iso_code_2` y las zonas por nombre dentro del país. Inserta los nombres de ciudades faltantes por zona y crea el comodín propio del país cuando falta. Una zona requerida ausente provoca error; no cuelga esas ciudades de otra zona. Después aplica un mapeo revisado de sucursales y examina referencias geográficas rotas o de otro país en comercios de países distintos de COL. Si existe un comodín en su país lo usa; si no, informa la sucursal sin resolver. Por tanto, sembrar RD/Perú no implica que la reparación examine únicamente esos dos países. `down()` no revierte ciudades ni reasignaciones. Su presencia en `main` no demuestra ejecución en un ambiente, alineación de otras ramas ni un flujo peruano probado. Los comodines pueden tener referencias; decidir su eliminación requiere medir usos y acordar su significado de producto.
