feat(cache): un switch para dejar de usar Redis y S3 en los formularios dinámicos

## En corto

form-service guarda en Redis y en S3 una copia de todo lo que arma desde MySQL: el esquema de cada formulario, las respuestas, el árbol de países, la lista de países y la información suplementaria. **Esas copias no aceleran nada que haga falta acelerar, y sí generan problemas reales.** Este PR agrega un switch (`DYNAMIC_FORMS_CACHE_ENABLED`) para no usarlas. Queda **prendido por defecto**: mergearlo no cambia ningún ambiente hasta que se configure.

## Por qué no hacen falta

MySQL contesta igual de rápido. Medido en local, contra la base de legacy, con el mismo servicio prendido y apagado. Son milisegundos por pedido, en caliente:

| pedido | con Redis/S3 | directo de MySQL |
|---|---|---|
| esquema del formulario 25 | 1–1,5 | 2–3 |
| respuestas de una solicitud | 1,5–4 | 2–3 |
| árbol de países (105 KB) | 3–4 | 8–14 |
| países | ~1 | ~4 |
| información suplementaria | ~2 | ~3,7 |

En los cinco casos el contenido fue **idéntico byte a byte**. La diferencia es de 1 a 10 ms, invisible frente a lo que tarda una pantalla del wizard. El esquema son tres consultas chicas; el árbol de países es el más pesado y aun así queda por debajo de 15 ms.

## Por qué generan problemas

1. **Un cambio en las tablas no se ve.** El esquema se lee primero de Redis y después de S3, y la copia de S3 **no vence nunca**. Después de cada migración que toca `forms` o `fields`, alguien tiene que acordarse de llamar a `PUT /v1/dynamic-form/<id>/schema`. Si se olvida, el wizard sigue mostrando el formulario viejo sin ningún error. Pasó con el formulario de Finandina en qa el 2026-11-24: la migración estaba aplicada y el formulario seguía sin los campos nuevos hasta el `PUT`.
2. **Las respuestas se leen de un lugar distinto al que se escriben.** El POST guarda las respuestas en `user_field_values` (MySQL) y además una copia en S3, pero el GET las lee **sólo** de Redis y S3, nunca de MySQL. Si S3 falla después de que MySQL guardó, el POST devuelve error con los datos ya guardados, y el GET no los ve. La fuente de verdad (MySQL) y lo que se lee (S3) pueden quedar distintos.
3. **Es más infraestructura que puede fallar.** Cada lectura pasa por Redis y S3, y cada reconstrucción del esquema por un workflow de Temporal. Si cualquiera de los tres está caído, el formulario no carga, aunque MySQL esté bien.

## Qué hace el switch

Con `DYNAMIC_FORMS_CACHE_ENABLED=false`:

| dato | cómo se lee |
|---|---|
| esquema | se arma desde las tablas en cada pedido, en el mismo proceso: las mismas tres consultas y el mismo ensamblado que el workflow `BuildSchemaWorkflow`, sin Temporal. Una migración se ve en el siguiente pedido, sin `PUT` |
| respuestas | el POST escribe `user_field_values` como siempre y el GET las lee de ahí. Devuelve el mismo registro que guardaba S3: los campos `number` y `currency` como número, el resto como texto, y una respuesta en blanco como `""` |
| árbol de países, países, información suplementaria | directo de MySQL |
| árbol de autos de BCP | **no cambia**: ese objeto de S3 es la fuente del catálogo, no una copia |

Los casos de uso no cambian. Lo que cambia es qué repositorio se inyecta (`internal/infra/storage/cache_providers.go`): con el switch apagado entran versiones que siempre contestan «no existe» con el mismo error que Redis o S3 y no guardan nada (`internal/infra/storage/nocache`). Así cada caso de uso sigue su camino de siempre hasta MySQL. Para las respuestas, que no tenían camino a MySQL, hay un lector nuevo: `internal/infra/storage/mysql/repositories/response_storage_repository.go`.

Dos ajustes chicos para poder correrlo en local, que en los ambientes no cambian nada:
- `dynamic_forms_s3.endpoint`, opcional, para un S3 local;
- el cliente de Temporal ya no manda credenciales vacías cuando no hay API key.

## Cómo se probó

- `go test ./...` pasa (34 paquetes) y `golangci-lint` da 0 problemas. La cobertura del código nuevo es 92,5 %. Hay tests nuevos para el armado del esquema sin Temporal, los repositorios vacíos, el lector de respuestas (con sqlmock: tipos, vacíos, 404, error de la base) y el switch.
- Corrido en local con la MySQL de legacy, Redis, un S3 local y un Temporal de desarrollo:
  - con el switch prendido: un POST de respuestas y los GET de esquema, respuestas, árbol de países, países e información suplementaria;
  - después, el mismo servicio con el switch apagado: los mismos GET devolvieron lo mismo, y un POST nuevo se vio en el GET siguiente.

## Cómo aplicarlo

1. Mergear: no cambia nada.
2. Apagarlo en dev/qa (`DYNAMIC_FORMS_CACHE_ENABLED=false`) y mirar una o dos semanas los tiempos y errores del servicio.
3. Decidir producción con lo medido ahí.

⚠ **Apagarlo es de una sola vía para las respuestas.** Lo que se guarda con el switch apagado está en MySQL pero no en S3. Si después se volviera a prender, el GET de respuestas leería la copia vieja de S3, o daría 404. Antes de volver a prenderlo habría que vaciar las claves de Redis y hacer `PUT /schema` de los formularios que cambiaron. Durante el despliegue, un pod prendido y uno apagado pueden darse respuestas distintas por unos minutos.

## Sobre el check de Sonar en rojo

**No es de este PR.** Falla por `new_security_rating`: una consulta SQL armada con formato en `internal/infra/storage/mysql/repositories/app_form_response_repository.go:160` (regla go:S2077), que entró a `develop` con el PR #21. Sonar compara contra `main`, así que la cuenta como nueva en cualquier PR a `develop`: #21, #22 y #24 tienen el mismo rojo, y la rama `develop` está en ERROR desde el 2026-11-18. La consulta es segura: el texto sólo repite `?` y los valores van como parámetros. Se resuelve marcando ese hallazgo como revisado en Sonar, o cuando `develop` llegue a `main`. Las condiciones que sí son de este PR pasan: cobertura 92,5 % (mínimo 80) y duplicación 1,2 % (máximo 3).
