# Catálogo geográfico y árbol de opciones

Mecanismo de catálogo y lectura disponible en `main` local. Las cantidades de ciudades, los usos de comodines y los resultados de ambientes son mediciones fechadas de las tareas, no invariantes de esta biblioteca.

## Relación entre país zona y ciudad

La ciudad se relaciona con el país a través de `country_cities.country_zone_id → country_zones.country_id`. En el admin de `application`, las ciudades ofrecidas se filtran por el país del comercio y por `country_cities.status=1`. Los nombres repetidos dentro de ese conjunto se distinguen añadiendo la zona; cada opción conserva `zona_id`. La lista separada de zonas filtra además `country_zones.status=1`. Para revisar una sucursal, comparar el país de su comercio con el país obtenido por ese join; nombre de ciudad e id aislado no bastan.

## Selectores y validación al guardar

Los dos monolitos no ofrecen el mismo conjunto. En `application`, el listado de la pestaña de sucursales filtra por el país del comercio (sección anterior). En el módulo Partner de `legacy-backend`, el mismo listado (`AlliedManagementService::getAlliedBranchesIndex`) trae todas las ciudades con `status=1`, de todos los países, sin mirar el del comercio.

El buscador de ciudades de `application` (`Admin\CityController::getCities`) deriva el país de `allied_id`; si no llega o el comercio no existe, no filtra por país. Excluye por nombre toda fila «TODAS LAS CIUDADES», ordena por nombre descendente, corta en 15 resultados y antepone el comodín del país del comercio, o el de Colombia (`COL`) cuando no hay país. En `legacy-backend` existe una versión anterior de ese controlador, sin filtro de país y con el id 1123 fijo, que no aparece registrada en sus rutas.

Al guardar no hay control de país. En los dos monolitos, `StoreRequest` y `UpdateRequest` de `Admin/AlliedBranch` sólo exigen que `city_id` esté presente, sin `exists` ni comparación con el país del comercio, y el controlador (o el servicio de Partner) copia ese valor a `country_city_id` tal cual. Una ciudad de otro país enviada por una llamada directa, o elegida en el selector de Partner, queda guardada.

## Quién escribe la ciudad de una sucursal

Además del alta y la edición desde el admin, hay escritores que no pasan por el selector:

- **Sucursal ecommerce.** `application` (`EcommerceBranchCreator::create`) y `legacy-backend` (`AlliedManagementService::storeEcommerceCredential`, la sucursal `Ecommerce-…`) la crean con `country_city_id = 1123`, el comodín de Colombia, sea cual sea el país del comercio. Con un comercio de otro país, la sucursal nace con la ciudad en Colombia. En `application` la sucursal ecommerce de prueba sale de ese mismo creador y hereda la 1123.
- **Sucursal física de prueba.** `TestAdvisorProvisioner` de `application` busca por nombre la fila «TODAS LAS CIUDADES» activa dentro del país del comercio. Si el país no tiene comodín, la sucursal queda con la ciudad vacía.

## El comodín TODAS LAS CIUDADES

Colombia, RD y Perú tienen cada uno su fila «TODAS LAS CIUDADES» (las dos últimas, en la zona «Todos los departamentos» que crea la migración); no es un lugar, es la ciudad de una sucursal sin ciudad concreta. El código conoce sólo la de Colombia por id: 1123, y la trata de dos formas que no alcanzan a los comodines de otros países:

- **Documentos.** Pagaré, autorización y garantía (en `application`, los controladores de cliente; en `legacy-backend`, los servicios de `Modules/Loans` y el payload de Credi ASYCO) imprimen «BOGOTÁ» cuando la ciudad de la sucursal es 1123, y el nombre de la ciudad en cualquier otro caso. Una sucursal en el comodín de otro país imprime el texto literal «TODAS LAS CIUDADES». El comentario del payload de Credi ASYCO describe la 1123 como «Bogotá D.C.», pero en el catálogo es el comodín de Colombia.
- **Filtros de ciudad de reportes y tableros.** Varios listados de ciudades armados desde las sucursales activas excluyen `country_cities.id = 1123`. Los comodines de otros países no se excluyen y aparecen como una opción más.

## Auditoría de sucursales

`php artisan paises:auditar-sucursales [--pais=ISO2]` de `legacy-backend` lista, sólo leyendo, las sucursales cuya ciudad está en un país distinto del de su comercio, y sale con código 1 si encuentra alguna. Excluye las sucursales sin ciudad y toda ciudad llamada «TODAS LAS CIUDADES», de cualquier país; por cómo trata SQL los nulos, tampoco lista las que apuntan a un id de ciudad inexistente. Por eso no ve una sucursal de un comercio no colombiano que esté en el comodín 1123 de Colombia, que es justo lo que producen los creadores de sucursales ecommerce. Su comentario dice que el comodín «vive colgada de Colombia», lo que dejó de ser así cuando cada país tuvo el suyo.

## Árbol de opciones

form-service construye el árbol con el país activo, sus zonas activas y las ciudades activas de esas zonas, ordenadas por nombre e id. Con id explícito consulta ese país; sin id usa `app.country_iso_code`, normalizado en mayúsculas y sin espacios exteriores, contra `iso_code_1`. El GET sin id puede reutilizar el mapeo ISO→id guardado en Redis con su propio TTL. Este default sale de la configuración del servicio, no del comercio del wizard. El árbol se consulta por Redis y después S3; sólo una ausencia reconocida permite pasar a la siguiente capa y reconstruir desde MySQL. Un error real de caché, almacenamiento o decodificación aborta; no se trata como ausencia.

## Reconstrucción del catálogo

`PUT /v1/field-options/country-tree/:country_id` fuerza reconstrucción desde MySQL. Sin id resuelve el país configurado. `BuildAndReplace` construye y codifica, elimina la entrada del árbol en Redis, escribe S3 y repuebla Redis con el TTL configurado. Las escrituras no forman una transacción entre servicios: un error intermedio puede dejar las capas en estados distintos. Un GET con copia existente no contrasta cambios de tablas. Este árbol y el esquema de un formulario tienen rutas y cachés independientes; reconstruir uno no reconstruye el otro.

## Migración de RD y Perú

La migración de septiembre siembra DOM y PER localizando el país por `iso_code_2` y las zonas por nombre dentro del país. Inserta los nombres de ciudades faltantes por zona y crea el comodín propio del país cuando falta. Una zona requerida ausente provoca error; no cuelga esas ciudades de otra zona. Después aplica un mapeo revisado de sucursales y examina referencias geográficas rotas o de otro país en comercios de países distintos de COL. Si existe un comodín en su país lo usa; si no, informa la sucursal sin resolver. Por tanto, sembrar RD/Perú no implica que la reparación examine únicamente esos dos países. `down()` no revierte ciudades ni reasignaciones. Su presencia en `main` no demuestra ejecución en un ambiente, alineación de otras ramas ni un flujo peruano probado. Los comodines pueden tener referencias; decidir su eliminación requiere medir usos y acordar su significado de producto.
