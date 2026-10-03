# Alta y baja de comercios

Punto de entrada para #98 y para configurar comercios. Describe los métodos de las refs
locales de `main`, no los pools, permisos ni secretos de un ambiente. El asesor automático
de #98 está documentado en esa tarea mientras su servicio no forme parte de `main`.
No dar por creado un acceso al wizard sólo porque exista el comercio.

## El admin anterior tiene su propia alta

En `application`, `Admin/AlliedController::store` abre una transacción, genera slug y hash,
sube la imagen a S3 y crea el comercio con los campos validados, incluido `country_id`.
Confirma la transacción y redirige al índice. El método revisado no llama a un provisionador
de sucursal, asesor o cuenta de Cognito. El alta automática de prueba de #98 no debe describirse
como comportamiento de este `main` por haber sido probada en desarrollo.

## La API modular es otra entrada

El módulo `Partner` monta sus rutas en `/api/partners`. Con `auth.cognito`,
`POST /merchants` pasa por `AlliedController::store` y `AlliedManagementService::storeAllied`.
El servicio crea el comercio dentro de una transacción, procesa la imagen si llegó e incluye
el país recibido. Puede guardar `theme_key` y `token_overrides` cuando esas claves están presentes.
Devuelve el comercio; sucursales y usuarios tienen rutas de creación separadas.

Revisar ambas entradas cuando cambie el alta. Cambiar el controlador del admin no cambia
esta API. El código no identifica por sí solo qué integraciones la usan hoy.

## La baja modifica usuarios en la base bajo condiciones concretas

En ambos monolitos, si el comercio estaba activo y el motivo es `Churn` o `No implementado`,
la operación de cambio de estado desactiva sus usuarios activos salvo los ids `1`, `2` y `5`,
desactiva el comercio y registra el cambio de estado en una transacción.
Los métodos revisados no borran cuentas de Cognito. Una baja en la base y la eliminación
de acceso en un pool son comprobaciones distintas; no extrapolar esta condición a cualquier
motivo de baja ni a todos los mecanismos de autenticación.
