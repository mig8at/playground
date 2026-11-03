# Alta y baja de comercios

Punto de entrada para #98 y para configurar comercios. Describe los métodos de las refs
locales de `main`, no los pools, permisos ni secretos de un ambiente. El asesor de prueba
automático existe sólo en el alta del admin anterior (`application`), no en la API modular.
No dar por creado un acceso al wizard sólo porque exista el comercio.

## El admin anterior tiene su propia alta

En `application`, `Admin/AlliedController::store` (`AlliedController.php:100`) abre una transacción,
genera slug y hash, sube la imagen a S3 y crea el comercio con los campos validados, incluidos `nit`,
`price` y `country_id`, y confirma la transacción. Después, ya fuera de ella, llama a
`TestAdvisorProvisioner::provision` (`AlliedController.php:133`): crea una sucursal física
`p<hash>-fake` con la ciudad comodín del país (si existe) y un asesor de perfil Comercial (4) con
correo `c<hash>-fake@<dominio>`, marcados como de prueba si la base ya tiene `users.is_test` y
`allied_branches.is_test`; luego intenta su cuenta en el pool de Cognito de comercios
(`TestAdvisorProvisioner.php:379` y `:442`). Los comercios dados de alta antes conservan la sucursal
con el nombre `b<hash>-fake`; al asesor se lo encuentra por el correo, no por ese nombre. El hash de
esa sucursal de prueba no es el del alta: el provisionador mezcla el id del comercio, el reloj y un
azar, y descarta cualquiera que ya exista (`uniqueBranchHash`).

Del mismo hash base sale también una sucursal ecommerce de prueba `e<hash>-fake`, con hash `e<hash>`,
plataforma «Desarrollo propio» y un token de payment-link que se muestra una sola vez. Va separada de la
física porque en legacy-backend una solicitud es ecommerce cuando su sucursal tiene credencial de
ecommerce: compartirla cambiaría el canal asesor. El hash distinto evita que una compra por la tienda
caiga en la física, porque legacy-backend resuelve la sucursal por hash con `->first()` (ver la sección
de los hashes). Para comercios que no la tienen, `provisionEcommerce` la crea sin tocar al asesor y no
crea otra si ya existe.

Ese paso nunca rompe el alta: atrapa toda excepción y devuelve qué quedó. Si el ambiente no tiene el
pool configurado o Cognito falla, el asesor queda en la base sin poder entrar al wizard; si el correo
ya existía en el pool se deja con su clave anterior. Es idempotente por comercio: si ya hay un
Comercial `c%-fake@` no crea otro. El resultado viaja en el flash sólo a quien tenga rol
«Administrador» y permiso `create allied` (`AlliedController.php:140`); para los demás perfiles el
asesor se crea igual sin mostrarse. Comprobar en la sucursal y en el pool qué quedó; no inferir un
acceso funcionando sólo porque el alta respondió.

## La clave del asesor de prueba puede ser compartida por el ambiente

La clave no es necesariamente propia de cada comercio. Si el ambiente define
`ALLIED_TEST_ADVISOR_PASSWORD` (`services.allied_test_advisor.password`), `generatePassword` la usa
para todos los asesores de prueba que crea, y también al restablecer la clave desde la edición del
comercio; sólo si no está configurada genera una aleatoria por asesor. El correo de esos asesores se
deduce del hash de su sucursal, que viaja en el QR y en el enlace de entrada al wizard, así que con la
clave compartida la clave es lo único que protege esas cuentas, y la misma abre las de todos los
comercios del ambiente.

El flash (`TestAdvisorResult::toFlash`) sólo lleva la clave si la cuenta del pool se creó en esa
operación y la clave no es la compartida; con la compartida marca `passwordFixed` y no la muestra.
Restablecer la clave deja sin efecto la anterior para todos los que la usaban, porque el asesor de
prueba es uno por comercio.

## Los hashes de alta se repiten dentro del mismo segundo

Varias altas calculan el hash con `hash('crc32', date('Y-m-d H:i:s'))`, es decir, de la fecha al
segundo sin nada propio del registro:

- el comercio, en las dos entradas (`application` `AlliedController.php:105`, legacy-backend
  `AlliedManagementService::storeAllied`);
- la sucursal creada desde el admin anterior (`AlliedAlliedBranchController.php:254`);
- la sucursal ecommerce, en `application` `EcommerceBranchCreator::create` cuando no recibe un hash, y
  en legacy-backend `AlliedManagementService::storeEcommerceCredential`.

Dos altas del mismo tipo en el mismo segundo producen el mismo hash. Las migraciones que crean
`allieds` y `allied_branches` declaran `hash` como `string` nulable, sin índice único, en los dos
monolitos, así que la base no lo impide. La excepción es la sucursal física de la API modular
(`storeAlliedBranch`), que usa `AlliedBranchRepository::generateUniqueHash`: 32 caracteres al azar,
reintentando mientras exista.

legacy-backend resuelve la sucursal de una URL de entrada con `AlliedBranch::where('hash', $hash)->first()`,
sin orden explícito, en varios repositorios (por ejemplo `Onboarding/App/Repositories/AlliedBranchRepository.php`,
`Loans/App/Repositories/AlliedRepository.php` y `Partner/App/Repositories/AlliedBranchRepository.php`).
Si dos sucursales comparten hash, todas las solicitudes que entran por esa URL quedan en la misma, la
que devuelva primero la base; la otra no es alcanzable por su URL.

## La API modular es otra entrada

El módulo `Partner` monta sus rutas en `/api/partners`. Con `auth.cognito`,
`POST /merchants` pasa por `AlliedController::store` y `AlliedManagementService::storeAllied`.
El servicio crea el comercio dentro de una transacción, procesa la imagen si llegó e incluye
el país recibido. Puede guardar `theme_key` y `token_overrides` cuando esas claves están presentes.
Devuelve el comercio; sucursales y usuarios tienen rutas de creación separadas.

A diferencia del admin anterior, no guarda `nit` ni `price`: el controlador no los pasa al servicio y
el servicio no los incluye en los datos del comercio.

Antes de crear el comercio, `storeAllied` lee el setting `front_url` (o `front_url_local` si
`local_env` vale 1) con `SettingRepository::getValue`, sobre el modelo `Setting`, que castea `value`
como JSON, y lo concatena con `'aliados/onboarding…'`. Esa URL no se usa después. Si el valor guardado
es un objeto JSON, que es la forma que lee `application` (`->value['url']` en
`AlliedAlliedBranchController` y en el provisionador), `getValue` devuelve un arreglo, la
concatenación produce el aviso «Array to string conversion», Laravel lo convierte en excepción, la
transacción se revierte y el endpoint responde 422 con ese mensaje sin crear el comercio.
`storeAlliedBranch` concatena el mismo setting de la misma forma para armar el QR de la sucursal.
Qué forma tiene el setting depende de los datos de cada ambiente, no del código.

Revisar ambas entradas cuando cambie el alta. Cambiar el controlador del admin no cambia
esta API. El código no identifica por sí solo qué integraciones la usan hoy.

## La baja modifica usuarios en la base bajo condiciones concretas

En ambos monolitos, si el comercio estaba activo y el motivo es `Churn` o `No implementado`,
la operación de cambio de estado desactiva sus usuarios activos salvo los ids `1`, `2` y `5`,
desactiva el comercio y registra el cambio de estado en una transacción.
Los métodos revisados no borran cuentas de Cognito. Una baja en la base y la eliminación
de acceso en un pool son comprobaciones distintas; no extrapolar esta condición a cualquier
motivo de baja ni a todos los mecanismos de autenticación.

## La reactivación devuelve el acceso a todos los usuarios inactivos

La misma operación tiene el camino inverso: si el comercio está inactivo y el motivo es `Activacion`,
pasa a `status = 1` a todos los usuarios del comercio con `status = 0`, salvo los ids `1`, `2` y `5`,
reactiva el comercio y registra el cambio con motivo `Activacion` (`application`
`AlliedController::changeStatus`, legacy-backend `AlliedManagementService::changeAlliedStatus`). No
distingue a quién desactivó la baja: un usuario que se había desactivado por separado antes de la baja
vuelve también a quedar activo. Cualquier otra combinación de estado y motivo lanza una excepción sin
cambiar nada.
