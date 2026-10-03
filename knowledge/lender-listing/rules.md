# Listado de entidades

Este tema cubre las puertas del listado y la resolución del monto en el backend modular.
Describe código revisado en main; la configuración de un comercio y el comportamiento de una
solicitud concreta se consultan en su ambiente.

## Dos puertas en el backend modular

Las rutas de Onboarding conservan GET `lenders/{user_request_id}` y GET
`lenders-v2/{user_request_id}`. La primera entra a `ListLenderController@index` y delega en
`LenderRetrievalService`; la segunda entra a `LenderListingController@index` y delega en
`LenderListingService`. Un diagnóstico debe identificar qué puerta atendió el pedido antes de
atribuirle el comportamiento de la otra.

## El monto del listado v2 se resuelve antes del cálculo

En `LenderListingService::getLenders`, un monto numérico positivo se normaliza con `Amount`;
en otro caso se usa el monto de la solicitud. El controlador suministra 180000 cuando el query
no trae `amount`, por lo que omitirlo en esa puerta no equivale a forzar el fallback de la solicitud.
Si `EcommerceRequest::orderTotalForUserRequest` devuelve un total, ese total reemplaza al monto
resuelto. El monto usado para ese cálculo se maneja sin persistirlo en ese punto del listado;
esto no afirma que todo el endpoint sea de sólo lectura.

## El monolito anterior tiene su propia entrada

En `legacy-application`, `ListLenderController::indexV2` recibe un `UserRequest` y llama a su
propio `LenderRetrievalService::getLenders(UserRequest)`. Después intenta aplicar un filtro
adicional; si ese filtro lanza una excepción, conserva la lista anterior y registra el error.
Comparar listados requiere leer la implementación que atendió cada caso: compartir el nombre
del servicio no demuestra que ambos recorridos decidan lo mismo.
