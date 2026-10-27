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

**Qué permiso tiene cada rol no se puede saber desde git**: el seeder de permisos está incompleto y usa
ids que no coinciden entre ambientes, y muchos permisos se dan directo por usuario. Para el reparto real
hay que leer `role_has_permissions` y `model_has_permissions` en la base del ambiente.

## El menú y el backend piden permisos distintos

El menú lateral se arma en `resources/js/navigation/vertical/` en este orden: Dashboard, Reportes,
Gestión, Créditos de consumo (CreditopX), Configuración y Tecnología. Cada ítem pide un permiso para
MOSTRARSE, pero la acción del backend suele pedir otro, o ninguno: por ejemplo, «Usuarios» se muestra con
`view list of users` y su listado exige `view users`. El grupo de rutas `admin` sólo exige estar
autenticado; lo que limita es el login, el chequeo de cada FormRequest y el alcance que arma cada
controlador (por rol, `allied_id`, `multiple_allieds` o `lender_id`). Que un ítem no aparezca no prueba
que su URL esté cerrada.

## Gestión: usuarios, solicitudes y autorizaciones

- **Usuarios** (`/usuarios`) busca a CUALQUIER usuario —clientes y cuentas internas— por nombre, id,
  cédula, correo o celular, con una expresión regular. La lista sólo se recorta para Entidad Comercio:
  cualquier otro rol con el permiso ve a todos. Desde ahí se ven sus solicitudes, su formulario y sus
  documentos de identidad, se edita, se valida o rechaza su identidad a mano y se da de baja, salvo
  que la guarda de baja lo impida (ver «Las bajas son lógicas»).
- **Solicitudes** (`/solicitudes`) es la bandeja operativa: cada perfil gestiona su etapa (documentación,
  autorización, facturación, logística) y cambia el estado. Al «gestionar», el estado nuevo NO lo elige
  quien gestiona: sale de `status_per_profiles` del comercio y del perfil (la pestaña «Módulos» del
  comercio), salvo los estados 6, 7 y 20. Cambiar los módulos de un comercio cambia su flujo operativo.
- **Autorizaciones**, **Pagos**, **Perfilamiento usuarios** y **Mensajes marketing** completan la
  sección; los mensajes se mandan por Twilio a una lista de teléfonos.

## Créditos CreditopX

«Créditos de consumo» (`/solicitudes-originadas`) es la cartera de los créditos que originó CreditOp:
estado, amortización y pagos; registrar o reversar pagos; cambiar fecha de pago o plazo; anular,
condonar o refinanciar; marcar el producto recuperado; bloquear o desbloquear el celular financiado y
mandar el link de pago. Con `manage creditop interest subsidy` se fija el subsidio de intereses de un
crédito y se descarga la liquidación del subsidio para conciliar con cada comercio. Sin `see all ctopx request` se ve sólo el buscador por cédula. Funnel, Gestión de
cartera, Pagos y facturación y Cupos rotativos son vistas de la misma cartera.

## El historial de un crédito CreditopX lleva dos estados

En `creditop_x_requests_history`, `creditop_x_requests_status_id` es el estado del crédito, del catálogo
`creditop_x_user_request_statuses` (1 al día, 2 en mora, 3 paz y salvo, 4 cancelado, 6 producto
recuperado, 7 recuperado por fondo de garantías, 8 administrado externamente, 9 fallecido). `status` es
el de la fila: 1 la vigente, 0 una reemplazada o desactivada, 5 una reversada por un pago revertido.

Anular desde este admin (`disable`) pasa la solicitud a 8, deja la fila vigente en `status` 2 y estado
4, pone en 0 los días de mora y registra un `ANNULMENT` en `creditop_x_log`. La cancelación del
monolito nuevo (`CreditopXRequestHistoryService::disableCreditopXRequest`) sólo pone la fila en `status`
0 y registra un `CANCELLATION`: no toca la solicitud ni el estado del crédito. Para saber si un crédito
se anuló o canceló hay que mirar también `creditop_x_log`. Marcar recuperado (6 o 7) replica la fila
vigente con el mismo número en `status` y en el estado, y deja la anterior en 0.

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
crédito. «Solicitudes» (`Customer\UserRequestController`) sólo muestra las que tienen como
`corporate_user_id` al asesor que mira, salvo que el hash de su sucursal esté en
`allowed_comerces_to_se_all` de `express_credit_study_configuration`: las de un asesor que se fue no
las ve nadie más del comercio.

## Configuración: comercios, entidades y reglas

- **Comercios** (`/aliados`): alta y datos del comercio, sus puntos de venta (con QR), zonas, entidades
  habilitadas por comercio y por punto de venta, módulos, credenciales de ecommerce, productos, usuarios
  comerciales y el usuario de prueba. Guardar un punto de venta BORRA y recrea sus entidades, conservando los
  `document_types` que cada una ya tenía ahí; una entidad recién sumada toma los de la propia entidad. Pasar un
  comercio a inactivo por «Churn» o «No implementado» apaga a todos sus usuarios activos.
- **Entidades** (`/entidades`): el catálogo de entidades financieras, sus líneas de crédito y tasas, sus
  usuarios Entidad Comercio y el ajuste de la tasa de usura. Desactivar una entidad es `status = 0`.
- **Reglas** (`/reglas`, se abre desde la edición del punto de venta): las reglas duras por entidad,
  comercio y punto de venta, y las reglas y la frecuencia de Datacrédito por comercio
  (`datacredito_frequencies`, la periodicidad con que se consulta Experian). El disparador de Experian
  del punto de venta (`allied_branches.datacredito_trigger`) se guarda desde el mismo lugar.
- **Links de pago**, **Integraciones** (credenciales entre entidad y comercio), **Bloqueo de
  dispositivos** y **Encuestas modales** completan la sección. Todo el título «Configuración» se oculta
  para usuarios de comercios de República Dominicana.

## Centrales de riesgo y validación de usuarios

«Centrales de riesgo» guarda las credenciales de los burós, muestra cuántas consultas hizo cada comercio
y tiene la consulta manual de Experian por cédula. ⚠ **Esa consulta manual no lee caché: dispara una
consulta NUEVA y facturable** al buró, a nombre del comercio «Creditop», y deja un rastro en `logs`.
«Validar usuario» muestra el perfil de riesgo completo de una cédula y también deja rastro de quién
consultó.

## Las bajas son lógicas

Dar de baja un usuario no borra la fila: la deja con `status = 0`, le agrega a la cédula el sufijo
`-t<n>` (el siguiente libre) y vacía correo y celular. La de **Usuarios** (`/usuarios/{id}/eliminar`)
además vacía `cognito_id`; las de usuarios comerciales y de entidad no. Sus solicitudes y sus datos de
centrales quedan en la cuenta vieja: con la cédula libre, el próximo registro crea un cliente nuevo y
las centrales se consultan otra vez. Por eso se usa para repetir pruebas (`bin/pg admin
client-disable`). La baja de Usuarios es un **GET** sin chequeo de permiso.

`UserDisableGuard` frena las dos bajas (la de Usuarios y la de usuarios comerciales) cuando la persona
tiene algo que cuelga de su cuenta: un crédito CreditopX en el historial, un pagaré firmado, una
solicitud en un estado posterior a la decisión (Desembolsada, Pendiente de autorización, Autorizada,
Cuota Inicial, Pendiente de formalización, entre otros, buscados por nombre) o una transacción con una
entidad que no esté en un estado terminal. Que el crédito esté al día, en mora o pagado no cambia nada.
Antes de la baja, `usuarios/{id}/eliminacion` devuelve los motivos para el diálogo. Para repetir una
prueba, la baja sólo funciona con clientes que no llegaron tan lejos.

## Escrituras que no piden permiso

Varias acciones que escriben se apoyan sólo en que el usuario está logueado: la baja de usuarios (de
Usuarios y de comercio), desactivar una entidad, borrar credenciales de integración (borrado real),
desactivar un link de pago, guardar las reglas y la frecuencia de Datacrédito, el disparador de un
punto de venta, cambiar el estado de una solicitud al gestionarla y mandar mensajes de marketing.
Cualquier rol que entre al admin puede ejecutarlas llamando a la URL. Antes de automatizar una acción
del admin, comprobá en el controlador qué chequea, en vez de suponer que el menú la protege.
