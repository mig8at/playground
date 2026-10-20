# Alta y baja de comercios

Punto de entrada para #98 y para configurar comercios. Describe los métodos de las refs
locales de `main`, no los pools, permisos ni secretos de un ambiente. El asesor de prueba
automático existe sólo en el alta del admin anterior (`application`), no en la API modular.
No dar por creado un acceso al wizard sólo porque exista el comercio.

## El admin anterior tiene su propia alta

En `application`, `Admin/AlliedController::store` (`AlliedController.php:100`) abre una transacción,
genera slug y hash, sube la imagen a S3 y crea el comercio con los campos validados, incluidos `nit`
y `country_id`, y confirma la transacción. Después, ya fuera de ella, llama a
`TestAdvisorProvisioner::provision` (`AlliedController.php:133`): crea una sucursal `b<hash>-fake`
con la ciudad comodín del país (si existe) y un asesor de perfil Comercial (4) con correo
`c<hash>-fake@<dominio>`, marcado como de prueba si la base ya tiene `users.is_test`; luego intenta
su cuenta en el pool de Cognito de comercios (`TestAdvisorProvisioner.php:258` y `:316`).

Ese paso nunca rompe el alta: atrapa toda excepción y devuelve qué quedó. Si el ambiente no tiene el
pool configurado o Cognito falla, el asesor queda en la base sin poder entrar al wizard; si el correo
ya existía en el pool se deja con su clave anterior. Es idempotente por comercio: si ya hay un
Comercial `c%-fake@` no crea otro. El resultado, con la clave, sólo viaja en el flash a quien tenga
rol «Administrador» y permiso `create allied` (`AlliedController.php:140`); para los demás perfiles
el asesor se crea igual sin mostrarse. Comprobar en la sucursal y en el pool qué quedó; no inferir
un acceso funcionando sólo porque el alta respondió.

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
