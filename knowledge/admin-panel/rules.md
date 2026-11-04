# Admin de legacy-application: secciones, roles y escrituras

El mapa del panel `admin.<host>` de `legacy-application` para entender qué hace cada sección por el
negocio, quién la ve y qué escribe, antes de tocarlo o de usarlo para preparar una prueba. Describe el
código de `main`; no dice qué permisos tiene cada rol en una base concreta (eso vive en la base, ver
abajo) ni mide el uso de nada.

## Quién entra y qué es cada perfil

Al admin entran sólo los usuarios con alguno de estos roles (`FortifyServiceProvider::shouldAuth`):
Administrador, Operaciones, Entidad, Superadmin comercio, Admin comercio, Mesa de servicio, Tesoreria,
Contabilidad, Analista, Logistica y Entidad Comercio. **Cliente y Comercial (el asesor) no entran**: el
asesor trabaja en el wizard, no acá.

El perfil del usuario (`users.user_profile_id`) es el mismo número que su rol de Spatie. El orden sale
del seeder de roles: 1 Cliente, 2 Administrador, 3 Operaciones, 4 Comercial, 5 Entidad, 6 Superadmin
comercio, 7 Admin comercio, 8 Mesa de servicio, 9 Tesoreria, 10 Contabilidad, 11 Analista, 12 Logistica.
El 13, Entidad Comercio (el usuario de una entidad, atado por `users.lender_id`), está como constante
en `UserProfile` y no en el seeder. Las cuentas internas llevan su perfil como prefijo de la cédula y
del celular (`2-…`, `4-…`); las de cliente, no.

**Qué permiso tiene cada rol no se puede saber desde git**: el seeder de permisos está incompleto y
asigna por ids numéricos, que dependen del orden de inserción de cada base, y muchos permisos se dan
directo por usuario. Para el reparto real hay que leer `role_has_permissions` y `model_has_permissions`
en la base del ambiente.

## El menú y el backend piden permisos distintos

El menú lateral se arma en `resources/js/navigation/vertical/` en este orden: Dashboard, Reportes,
Gestión, Créditos de consumo (CreditopX), Configuración y Tecnología. Cada ítem pide un permiso para
MOSTRARSE, pero la acción del backend suele pedir otro, o ninguno: por ejemplo, «Usuarios» se muestra con
`view list of users` y su listado exige `view users`. El grupo de rutas `admin` (`RouteServiceProvider`
y el grupo `admin` del `Kernel`) sólo exige estar autenticado: no hay `can:` de grupo, ni chequeo en el
controlador base, ni `Gate::before`. Lo que limita es el login, el `can:` que lleve cada ruta (los
vouchers, los pagos, recuperación, subsidio, refinanciación y condonación de CreditopX, bloqueo de
dispositivos y «Validar usuario»), el `authorize()` de cada FormRequest y el alcance que arma cada
controlador (por rol, `allied_id`, `multiple_allieds` o `lender_id`). Que un ítem no aparezca no prueba
que su URL esté cerrada.

## Gestión: usuarios, solicitudes y autorizaciones

- **Usuarios** (`/usuarios`) busca a CUALQUIER usuario —clientes y cuentas internas— por nombre, id,
  cédula, correo o celular, con una expresión regular. Desde ahí se ven sus solicitudes, su formulario y
  sus documentos de identidad, se edita (`update user`; una ficha temporal no se edita), se valida o
  rechaza su identidad a mano (`validate identity manually`) y se da de baja, salvo que la guarda de
  baja lo impida (ver «Las bajas son lógicas»).
- **Solicitudes** (`/solicitudes`) es la bandeja operativa: cada perfil gestiona su etapa (documentación,
  autorización, facturación, logística) y cambia el estado. Al «gestionar», el estado nuevo NO lo elige
  quien gestiona: sale de la fila de `status_per_profiles` del comercio (`allied_id`) y del perfil del
  usuario QUE GESTIONA —no del comercio de la solicitud—, salvo que se pida 6, 7 o 20, que se aplican
  tal cual. Cambiar los módulos de un comercio (su pestaña «Módulos») cambia el flujo operativo de sus
  usuarios.
- **Comercio**, **Autorizaciones**, **Pagos**, **Perfilamiento usuarios** y **Mensajes marketing**
  completan la sección; los mensajes se mandan por Twilio a una lista de teléfonos. Autorizaciones y
  Pagos se ocultan del menú para usuarios de comercios de República Dominicana.

## Créditos CreditopX

«Créditos de consumo» (`/solicitudes-originadas`) es la cartera de los créditos que originó CreditOp:
estado, amortización y pagos; registrar o reversar pagos; cambiar fecha de pago o plazo; anular,
condonar o refinanciar; marcar el producto recuperado; bloquear o desbloquear el celular financiado y
mandar el link de pago. Con `manage creditop interest subsidy` se fija el subsidio de intereses de un
crédito y se descarga la liquidación del subsidio para conciliar con cada comercio. El listado exige
`view creditop x requests`; sin `see all ctopx request` se ve sólo el buscador por cédula. Funnel,
Gestión de cartera, Pagos y facturación y Cupos rotativos son vistas de la misma cartera.

## El historial de un crédito CreditopX lleva dos estados

En `creditop_x_requests_history`, `creditop_x_requests_status_id` es el estado del crédito, del catálogo
`creditop_x_user_request_statuses`. El código nombra 1 al día, 2 en mora y 3 paz y salvo
(`CreditopXUserRequestStatus` de legacy-backend), 4 cancelado (lo escribe la anulación), 6 producto
recuperado, 7 recuperado por fondo de garantías y 8 administrado externamente; el resto del catálogo
vive en la base. `status` es el de la fila: 1 la vigente, 0 una reemplazada o desactivada, 5 una
reversada por un pago revertido.

Anular desde este admin (`disable`, con `cancel creditop x requests`) pasa la solicitud a 8, deja la
fila vigente en `status` 2 y estado 4, pone en 0 los días de mora y registra un `ANNULMENT` en
`creditop_x_log`. La cancelación del monolito nuevo
(`CreditopXRequestHistoryService::disableCreditopXRequest`) sólo pone la fila en `status` 0 y registra un
`CANCELLATION`: no toca la solicitud ni el estado del crédito. Para saber si un crédito se anuló o
canceló hay que mirar también `creditop_x_log`. Marcar recuperado (6 o 7) sólo se puede sobre la fila
vigente: la replica con el mismo número en `status` y en el estado, y deja la anterior en 0.

## Facturación y recaudo suma por mes, no cuota por cuota

La pantalla de facturación y recaudo de créditos de consumo (`CreditopXPaymentManageController::index`)
cruza dos sumas mensuales. Facturado es `installment_value + next_payment_insurance` de las filas de
corte del historial, de solicitudes 10 u 11, sin rotativos ni pruebas ni usuarios atípicos, con el mes
de la fecha de corte más cinco días. Recaudado es `valor_pagado` de `VW_CtopX_Payments_Report` por mes
de pago, sin cuota inicial ni rotativos; la vista no filtra por estado del pago, así que pendientes y
reversados suman. El porcentaje es recaudado sobre facturado del mismo mes, y puede pasar de 100. Los
filtros mandan comercio y las dos fechas.

## El comercio ve un crédito por cédula y sus solicitudes por asesor

En la plataforma del comercio, «Créditos propios» (`Customer\CreditopXRequestHistoryController`) no
lista: busca por cédula un registro con `status` distinto de 0, de un cliente, cuya solicitud sea del
mismo comercio del usuario y que no sea un rotativo. No filtra por sucursal, asesor ni estado del
crédito. Los cupos rotativos del cliente salen aparte, filtrados por las entidades habilitadas para el
usuario y no por el comercio donde se originaron. «Solicitudes» (`Customer\UserRequestController`) sólo
muestra las que tienen como `corporate_user_id` al asesor que mira, salvo que el hash de su sucursal
esté en `allowed_comerces_to_se_all` de `express_credit_study_configuration`: las de un asesor que se
fue no las ve nadie más del comercio.

## Configuración: comercios, entidades y reglas

- **Comercios** (`/aliados`): alta y datos del comercio, sus puntos de venta (con QR), zonas, entidades
  habilitadas por comercio y por punto de venta, módulos, credenciales de ecommerce, productos, usuarios
  comerciales y el usuario de prueba. En la pestaña de ecommerce se editan la plataforma, la URL y las
  llaves de una sucursal ecommerce, y se emiten (el token se muestra una sola vez) o revocan los tokens de
  payment-link de la sucursal; revocarlos deja a la tienda sin poder generar enlaces de pago. El alta del
  usuario de prueba crea además una sucursal ecommerce de prueba aparte (ver `merchant-onboarding`), y
  hay una acción para crearla en comercios que no la tienen. Guardar un punto de venta BORRA y recrea
  sus entidades, conservando los `document_types` que cada una ya tenía ahí; una entidad recién sumada
  toma los de la propia entidad. Pasar un comercio a inactivo por «Churn» o «No implementado» apaga a
  todos sus usuarios activos.
- **Entidades** (`/entidades`): el catálogo de entidades financieras, sus líneas de crédito y tasas, sus
  usuarios Entidad Comercio y el ajuste de la tasa de usura. Desactivar una entidad es `status = 0`.
- **Reglas** (`/reglas`, se abre desde la edición del punto de venta): las reglas duras por entidad,
  comercio y punto de venta; las reglas de Datacrédito por punto de venta y entidad
  (`lender_datacredito_rules`), y la frecuencia de Datacrédito por comercio (`datacredito_frequencies`,
  la periodicidad con que se consulta Experian). El disparador de Experian
  (`allied_branches.datacredito_trigger`) se guarda desde el mismo lugar, para un punto de venta o, con
  `apply_all`, para todos los del comercio.
- **Links de pago**, **Integraciones** (credenciales entre entidad y comercio), **Bloqueo de
  dispositivos**, **Encuestas modales**, **Perfilamiento** (Revisión de perfilamiento y Validar usuario)
  y **Centrales de riesgo** completan la sección. Para usuarios de comercios de República Dominicana se
  oculta el encabezado «Configuración» y el ítem «Video tutoriales», no el resto de los ítems.

## Centrales de riesgo y validación de usuarios

«Centrales de riesgo» (`view risk centrals module`) guarda las credenciales de los burós, muestra
cuántas consultas hizo cada comercio y tiene la consulta manual de Experian por cédula. ⚠ **Esa
consulta manual no lee caché: dispara una consulta NUEVA y facturable** al buró, a nombre del comercio
«Creditop», y deja un rastro en `logs`. «Validar usuario» (`can:view user validation module` en la
ruta) muestra el perfil de riesgo completo de una cédula y también deja rastro de quién consultó.

## Las bajas son lógicas

Dar de baja un usuario no borra la fila: la deja con `status = 0`, le agrega a la cédula el sufijo
`-t<n>` (el siguiente libre) y vacía correo y celular. La de **Usuarios** (`/usuarios/{id}/eliminar`)
además vacía `cognito_id`; las de usuarios comerciales y de entidad no. Sus solicitudes y sus datos de
centrales quedan en la cuenta vieja: con la cédula libre, el próximo registro crea un cliente nuevo y
las centrales se consultan otra vez. Por eso se usa para repetir pruebas (`bin/pg admin
client-disable`). Las bajas de Usuarios y de usuarios comerciales son **GET** sin chequeo de permiso;
la de usuarios de entidad sólo frena a un Entidad Comercio que intente dar de baja a alguien de otra
entidad.

`UserDisableGuard` frena las tres bajas (Usuarios, usuarios comerciales y usuarios de entidad) cuando la
persona tiene algo que cuelga de su cuenta: un crédito CreditopX en el historial, un pagaré firmado, una
solicitud en un estado posterior a la decisión (Desembolsada, Pendiente de autorización, Autorizada,
Cuota Inicial, Pendiente de formalización, entre otros, buscados por nombre) o una transacción con una
entidad que no esté en un estado terminal. Que el crédito esté al día, en mora o pagado no cambia nada.
Antes de la baja, `usuarios/{id}/eliminacion` devuelve los motivos para el diálogo. Para repetir una
prueba, la baja sólo funciona con clientes que no llegaron tan lejos.

## Escrituras que no piden permiso

Estas acciones escriben y sólo dependen de que el usuario esté logueado: la ruta no lleva `can:` y el
controlador recibe un `Request` plano o un FormRequest cuyo `authorize()` devuelve `true`.

- Las bajas de Usuarios (`usuarios/{user}/eliminar`) y de usuarios comerciales
  (`aliados/usuarios/{user}/deshabilitar`), las dos por GET.
- Desactivar una entidad (`LenderController::destroy`, `status = 0`).
- Borrar credenciales de integración (`CredentialsController::destroy`): borrado real de la fila de
  `lender_allied_credentials`, sin papelera.
- Guardar las reglas de Datacrédito (`actualizar-reglas-datacredito`) y crear o actualizar la frecuencia
  de Datacrédito (`crear-`/`actualizar-frecuencia-datacredito`).
- Guardar el disparador de Experian (`AlliedAlliedBranchController::updateTrigger`), que con `apply_all`
  pisa el de todos los puntos de venta del comercio.
- Gestionar una solicitud (`UserRequestController::update`): cambia su estado, monto final, número de
  solicitud y de orden, sobre cualquier solicitud por id, sin mirar su comercio.
- La validación manual por solicitud (`POST /validacion-manual`): su `StoreRequest` autoriza siempre;
  pasa la solicitud a 10 si la validación es «Si» o a 6 si no (a 2 si estaba en 21), manda la respuesta
  por Twilio y guarda la validación. La validación por usuario (`usuarios/{user}/validacion-manual`) sí
  exige `validate identity manually`.
- Desactivar un link de pago y emitir o revocar los tokens de payment-link de una sucursal ecommerce.
- Los envíos de mensajes de marketing, de prueba y masivo: sus FormRequests autorizan siempre; sólo la
  pantalla exige `send marketing messages`.

Cualquier rol que entre al admin puede ejecutarlas llamando a la URL. Antes de automatizar una acción
del admin, comprobá en el controlador qué chequea, en vez de suponer que el menú la protege.

## Lecturas por id sin alcance de comercio

Varias pantallas de detalle cargan el registro por el id de la URL y no comprueban permiso ni que
pertenezca al comercio, la entidad o las sucursales del usuario que mira:

- `usuarios/{user}/documentos` (`getUserDocument`): el resultado de AML con sus datos y, si hubo
  validación ADO, las imágenes del documento (dos caras) y la foto del cliente.
- `usuarios/{user}/formulario` (`getUserForm`): los últimos valores del formulario del cliente.
- `usuarios/{user}/solicitudes` (`getUserRequests`): todas sus solicitudes, de cualquier comercio.
- `solicitudes-originadas/{userRequest}` (`CreditopXRequestHistoryController::show`): el detalle de un
  crédito CreditopX con su amortización, pagos, pagaré y garantía.

El recorte por rol de los listados no protege estas URLs: quien tenga el id llega al detalle.

## Listados que no se recortan por rol

- **Usuarios**: sólo se recorta para Entidad Comercio; cualquier otro rol con `view users` ve a todos.
- **Links de pago**: sólo se recorta para Superadmin comercio (`user_profile_id == 6`, a sus
  `multiple_allieds`); cualquier otro rol con `view list payment links` ve los de todos los comercios.
- **Revisión de perfilamiento** (`revision-de-perfilamiento`): no pide permiso en el backend (el menú la
  muestra con `view risk centrals module`). Los datos se filtran sólo por el `allied_id` que trae la
  consulta, o ninguno; el rol sólo recorta las opciones del selector de comercio.

## Rutas de desarrollo en la versión publicada

`routes/admin.php` registra rutas de prueba del perfilamiento sin ninguna guarda de ambiente, así que
existen en todos los despliegues:

- `/test-perfilamiento` (`ProfilingController::calculateApprovalPercentage`) y `/pruebas-modelo`
  (`ProfilingModelTestController::index`) sólo exigen sesión. `/pruebas-modelo` muestra, por cédula, los
  datos de buró y de perfilamiento del cliente en todos los comercios y llama a un endpoint externo de un
  modelo alojado en replit, con la URL fija en `ProfilingModel`.
- `/create-profiling` (`ProfilingController::createProfiling`) exige `view dashboard module` (por su
  `DashboardRequest`): quita el límite de memoria y de tiempo, escribe con `Profiling::create` y termina
  en `dd()`.
