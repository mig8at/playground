**La portada de `merchant-api` describe sólo rutas del catálogo y no alcanza para delimitar su responsabilidad.**
Además del catálogo de comercios e industrias, monta un módulo
de crédito por solicitud, con arranque, consulta de estado, autorización del canal y pasos del titular
y del codeudor. Es la contraparte de lo que el monolito le reporta desde el recorrido de
[[arrendamiento/context]].

Hay dos dependencias distintas:

- **Las lecturas del catálogo usan el MySQL heredado.** Consultan industrias, comercios, sucursales y
  entidades habilitadas por sucursal. Cambiar esas tablas del monolito sí puede afectar a esta API; no
  encontrar un almacén de catálogo separado es lo esperado. **Las solicitudes del cliente no filtran
  el catálogo**: la lista de comercios de CreditopX es la misma para todos los clientes, sin importar su
  historial, y entra todo comercio activo, visible en la app y con una entidad de la familia de la casa
  en alguna sucursal —crédito por compra o rotativo, tipos de respuesta 2 y 3—. Las vitrinas parten de ese mismo catálogo y además exigen sucursal
  activa, en una ciudad conocida y con un vínculo activo a una entidad activa de esa familia. El arreglo
  del catálogo sale ordenado por el campo de orden del comercio y, a igual orden, por id; la consulta SQL
  en sí no ordena. La excepción a la base heredada es la ubicación de los
  puntos de venta: esta API la resuelve contra el proveedor de mapas, la escribe en esa misma base y
  guarda coordenadas en una caché propia, que al vencer deja la tienda sin coordenadas.
- **La coordinación del crédito corre en Temporal, en otro proceso.** El servidor HTTP inicia y
  consulta el flujo; el trabajador ejecuta los pasos y las notificaciones en tiempo real. Ese trabajador
  no carga el módulo de MySQL. Que el catálogo responda no demuestra que el trabajador esté avanzando
  una solicitud.

Para ubicar un dato hay que comprobar la dependencia de cada operación: **el nombre del
repositorio no determina dónde se guarda**.
