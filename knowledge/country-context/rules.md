# País y documentos del flujo

Contrato observado en las refs locales de `main`. No certifica catálogos cargados, rutas desplegadas ni la habilitación comercial de un país. Las propuestas de una base por país, snapshots en solicitudes y reglas nuevas siguen en sus tareas; no se deducen de este contrato.

## País del comercio

`AlliedInfoController` resuelve la sucursal por hash y carga `allied.country`: el país que publica viene de `allieds.country_id`. No lo infiere de la ciudad de la sucursal ni de un snapshot de la solicitud. La solicitud opcional cambia la entidad y la línea de crédito usada para formularios. El payload incluye `country`, `allowed_document_types` y `document_type_rules`; `country` puede ser null. La clave pública `iso_code` sale de `iso_code_2`, y `cell_phone_length` sale de la columna histórica `cell_phone_lenght`, convirtiéndola a entero sólo si es numérica.

## Documentos del backend modular

`DocumentTypesService` modular obtiene el catálogo de filas activas de `document_types` por país, ordenadas por id. Sólo si esa tabla no existe usa `countries.document_types`; una tabla existente pero vacía no activa ese respaldo. Normaliza códigos a mayúsculas, sin espacios exteriores y sin duplicados. Une `lender.document_types` de asociaciones de sucursal con `status=1`; no lee una lista propia del pivote ni filtra aquí por `lenders.status`. Cruza esa unión con el catálogo del país: si el cruce tiene valores los devuelve; si no, devuelve el catálogo del país. Con catálogo del país vacío devuelve `[]`, aunque las entidades declaren tipos. No agrega un piso CC/CE. La sucursal puede llegar como hash o id: busca el hash primero y sólo después prueba un id si la entrada contiene dígitos. `primaryForBranch` usa el primer código del catálogo del país, no el primero de la unión de entidades. Las reglas del número usan longitud mínima/máxima e `is_numeric`; el default es 5–10 caracteres numéricos, y la alternativa alfanumérica acepta letras ASCII y dígitos. No implementan una expresión regular arbitraria por país.

## Diferencias del monolito

`application` conserva otro `DocumentTypesService`: recibe un id numérico, lee `countries.document_types` y une los tipos de entidades asociadas activas. Si el catálogo del país está vacío devuelve la unión de entidades; esto difiere del backend modular, que devuelve `[]`. Su resolución de sesión busca primero `allied_branch.hash` y después la sucursal de `user_request_id`. Compartir tablas no implica compartir la resolución, el catálogo por filas ni las reglas del número.

## Selector del wizard

`resolveDocumentTypeOptions` usa la lista recibida como opciones, normaliza y elimina duplicados; un código sin etiqueta conocida se muestra como código. Sólo null o undefined activan el respaldo CC/CE. Una lista explícita `[]` conserva el selector vacío y el documento por defecto queda vacío. `isAllowedDocumentType` devuelve true también ante una lista vacía: esa función por sí sola no prueba que el formulario sea enviable ni que el API acepte cualquier tipo. Para investigar un rechazo, contrastar payload, selector y validación del endpoint concreto.

## País activo y país con operación

En `application`, `Country::operating()` filtra `is_operating=true`; `operatingPlus` conserva el país heredado de un registro aunque no tenga operación, marcándolo para corregir. Las consultas geográficas de form-service filtran `countries.status=1`, no `is_operating`. Son criterios distintos: aparecer en el catálogo general no demuestra operación habilitada. El lookup de indicativos del repositorio modular de usuarios toma los países referenciados por comercios; tampoco equivale al scope `operating` del admin.
