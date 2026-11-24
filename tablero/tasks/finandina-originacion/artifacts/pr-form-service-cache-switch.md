feat(cache): un switch para apagar las copias en Redis y S3 de los formularios dinámicos

## Por qué

El servicio guarda copias en Redis y en S3 del esquema de cada formulario, de las respuestas, del árbol de países, de la lista de países y de la información suplementaria. Esas copias cuestan más de lo que aportan:

- **Un cambio en las tablas no se ve** hasta que alguien llama a `PUT /v1/dynamic-form/<id>/schema`. Cada migración de `forms` o `fields` necesita ese paso manual, y si se olvida, el wizard sigue mostrando el formulario viejo. La copia de S3 no vence nunca.
- **Las respuestas se leen sólo de S3**, aunque el POST las escribe primero en `user_field_values`. Si S3 falla después del commit, el GET no ve lo que quedó en MySQL.
- **Armar el esquema desde MySQL ya es rápido.** Medido en local con la base de legacy, tres pedidos seguidos (ms):

| pedido | con las copias | sin las copias |
|---|---|---|
| esquema del formulario 25 | 1–1,5 | 2–3 |
| respuestas de una solicitud | 1,5–4 | 2–3 |
| árbol de países (105 KB) | 3–4 | 8–14 |
| países | ~1 | ~4 |
| información suplementaria | ~2 | ~3,7 |

En los cinco casos, el contenido fue idéntico byte a byte con el switch prendido y apagado.

## Qué cambia

Nueva clave **`dynamic_forms_cache.enabled`**, o la variable de entorno `DYNAMIC_FORMS_CACHE_ENABLED`. **Si no está, vale `true`, y todo sigue igual que hoy**: este PR no cambia el comportamiento de ningún ambiente hasta que se configure.

Con `false`:

- **Esquema:** se arma desde las tablas en cada lectura, en el mismo proceso. `BuildSchemaActivities.BuildInProcess` hace las mismas lecturas y el mismo ensamblado que `BuildSchemaWorkflow`, sin pasar por Temporal: no hay nada que persistir. El `PUT /schema` lo arma y lo devuelve; una migración se ve en la siguiente lectura.
- **Respuestas:** el POST escribe `user_field_values` como siempre. El GET las lee de ahí (`mysql/repositories/ResponseStorageRepository`) y devuelve el mismo registro que guardaba S3:
  - las respuestas de campos `number` y `currency` vuelven como número;
  - el resto, como texto;
  - una respuesta en blanco (guardada como `NULL`) vuelve como `""`;
  - una respuesta cuyo campo ya no existe en `fields` vuelve como texto.

  Diferencias posibles con la copia de S3: un `null` enviado vuelve como `""` (en MySQL los dos se guardan igual), y un texto enviado en un campo `currency` vuelve como número. El formulario web manda `""` en los opcionales vacíos y números en `number` y `currency`, así que para lo que manda hoy el resultado es el mismo.

  Sin respuestas sigue siendo 404.
- **Árbol de países y países:** se arman desde MySQL en cada pedido.
- **Información suplementaria:** se lee de MySQL en cada pedido.
- **Árbol de autos de BCP: no cambia.** Ese objeto de S3 es la fuente del catálogo, no una copia.

Con el switch apagado, los repositorios de S3 de esos datos ni se construyen. Las cachés se reemplazan por versiones de `infra/storage/nocache`, que siempre contestan «no existe» con el mismo error que Redis o S3 y no guardan nada. Así los casos de uso no cambian: siguen por su camino de siempre hasta la fuente. Redis y Temporal siguen siendo dependencias del servicio, por la caché de settings, el flag de formularios de la app, el árbol de BCP y el worker, pero ningún pedido de formularios dinámicos pasa por ellos.

Para poder correrlo en local:

- `dynamic_forms_s3.endpoint` (opcional): apunta el cliente de S3 a un servidor compatible, con path-style. No se usa en ningún ambiente desplegado.
- El cliente de Temporal ya no manda credenciales de API key cuando `temporal.api_key` está vacío. Un servidor de desarrollo sin TLS las rechazaba. Con key, igual que antes.

Archivos:
- `internal/commons/core/cachemode`;
- `internal/infra/storage/cache_providers.go`, `module.go` y `nocache/`;
- `internal/infra/storage/mysql/repositories/response_storage_repository.go` y su consulta;
- `internal/core/mappers/dynamic_form_response_mapper.go` (`DynamicFormAnswerFromSQL`);
- `internal/core/workflow_activities/build_schema_in_process.go`;
- `internal/core/usecases/dynamic_forms/in_process_schema_executor.go` y `usecases/module.go`;
- `internal/infra/storage/s3/client/client.go`;
- `internal/orchestation/temporal/client.go`;
- `README.md` (sección Storage), `CHANGELOG.md` y `config/config.example.yaml`.

## Cómo se probó

- `go test ./...` pasa (34 paquetes). Tests nuevos:
  - el armado en proceso (caso feliz, tipo inexistente, sin campos, error de la base);
  - los repositorios vacíos (errores de «no existe», escrituras sin efecto);
  - el lector de respuestas con sqlmock (tipos, `NULL`, 404, error);
  - el mapeo de cada respuesta;
  - el switch (por defecto, `false`, variable de entorno).
- **Corrido en local** contra la MySQL de legacy, Redis, un S3 local y un Temporal de desarrollo:
  - con el switch prendido: un POST de respuestas para la solicitud 468455 y los GET del esquema 25, las respuestas, el árbol de países, los países y la información suplementaria;
  - después, el mismo servicio con `DYNAMIC_FORMS_CACHE_ENABLED=false`: los mismos GET dieron contenido idéntico y un POST nuevo se vio en el GET siguiente.

## Al desplegar

Nada: sin la clave, el comportamiento es el de hoy. Para apagar las copias en un ambiente, `DYNAMIC_FORMS_CACHE_ENABLED=false` en ese servicio.

- **Al apagar**, las copias de S3 y Redis dejan de leerse; no hace falta borrarlas. Mientras el despliegue convive con pods viejos (prendidos) y nuevos (apagados), una respuesta guardada por un pod nuevo no llega a S3, y un GET que caiga en un pod viejo puede devolver la copia anterior. Dura lo que dura el despliegue.
- **Volver a prender no es sólo sacar la variable.** Lo que se guardó con el switch apagado está en MySQL pero no en S3 ni en Redis, y con el switch prendido el GET de respuestas lee sólo S3 y Redis: devolvería la copia anterior al apagado, o 404. Antes de prender hay que vaciar en Redis las claves de respuestas y de esquemas, y hacer un `PUT /schema` de los formularios que cambiaron. Para las respuestas no hay un camino que las reconstruya en S3; por eso conviene decidirlo como un cambio de una sola vía.
- Con el switch apagado, el GET de respuestas devuelve las filas activas de `user_field_values` para ese formulario y esa solicitud, las haya escrito quien las haya escrito. Hoy ningún cliente pide por este servicio el formulario 1, que es el que escribe legacy-backend.
