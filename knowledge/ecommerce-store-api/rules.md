# Ecommerce: la API de la tienda contra Creditop

Cubre lo que una tienda llama servidor a servidor (enlace de pago, consulta de estado, cancelación)
y el aviso que recibe cuando la solicitud termina. La entrada del comprador por URL, la
deserialización del contrato, el vínculo pedido-solicitud, el canal y `backUrl` están en el tema
`ecommerce-context` y acá sólo se nombran. Qué monolito recibe la llamada de un comercio depende del
enrutamiento del ambiente y no se lee en estos repos.

## El token de la sucursal con la abilidad ecommerce abre las tres rutas

En legacy-backend las tres rutas viven en `Modules/Onboarding/routes/webhooks.php`:
`POST api/ecommerce/payment-link`, `GET api/ecommerce/status/{orderId}` y
`POST api/ecommerce/orders/{orderKey}/cancel`. Las tres llevan `EnsureEcommerceToken` y excluyen
`AddOriginationFlowType`, que agregaría a la respuesta la metadata de la solicitud que viniera en la
petición, fuera de la sucursal que fuera.

`EnsureEcommerceToken` resuelve el guard `sanctum` a mano. Sin un `PersonalAccessToken` responde 401
`Unauthenticated.`; si el dueño no es un `AlliedBranch` o el token no trae `ecommerce` de forma
explícita en `abilities`, 403 `Invalid ability provided.`. El comodín `*` no pasa, y un usuario de
sesión (que resuelve un `TransientToken`) tampoco. La sucursal sale siempre de `$request->user('sanctum')`;
ningún controlador la lee del cuerpo, la query o los headers.

El token se emite de dos formas equivalentes, porque los dos monolitos comparten `personal_access_tokens`
y el `tokenable_type` `App\Models\AlliedBranch`: `php artisan ecommerce:issue-token <hash>` en
legacy-backend (exige que la sucursal tenga credencial de ecommerce) y `EcommerceTokenIssuer::issue`
desde application: en la ruta del admin `aliados/{alliedBranch}/ecommerce-token` (404 si la sucursal
no tiene credencial), y además automáticamente al crear la sucursal ecommerce
(`AlliedEcommerceCredentialsController::store`) y en el aprovisionamiento del asesor de prueba
(`TestAdvisorProvisioner`). Se llama
`ecommerce-payment-link`, lleva sólo la abilidad `ecommerce`, no vence y emitir otro no revoca los
anteriores; `EcommerceTokenIssuer::revoke` borra todos los de ese nombre. No es la credencial de la
sucursal (`allied_ecommerce_credentials.credential`), que es la que viaja en el contrato por URL.

## El enlace de pago crea el pedido y rechaza un order_key repetido con 409

`EcommercePaymentLinkService::create` valida en este orden:

- **el cuerpo** (`CreatePaymentLinkRequest::validate`): `hash`, `order_key`, `total` mayor que cero,
  `billing` presente y `return_url` y `webhook_url` con `https://`. Opcionales: `id` (texto o número),
  `products` como lista, `back_url` y las aceptaciones `termAccepted` y `policyAccepted` con zona
  horaria. Si falla, 422 con `message` (el primer error) y `errors` por campo;
- **la sucursal**: `hash` tiene que ser el de la sucursal dueña del token y esa sucursal tiene que
  tener fila en `allied_ecommerce_credentials`. Si no, 403 con el mismo cuerpo que una abilidad inválida;
- **el pedido**: `existsForBranchOrderKey` no puede encontrar ese `order_key` en la sucursal. Si lo
  encuentra, 409 `TransactionAlreadyExists`.

El 409 mira cualquier fila de `ecommerce_requests` de la sucursal con ese `order_key`, no sólo las de
esta ruta: un pedido que entró por el contrato en la URL o uno cancelado también bloquean. Es un
chequeo de aplicación y no un índice único, así que dos llamadas simultáneas con el mismo `order_key`
pueden crear dos filas. La entrada por URL no rechaza: `EcommerceRequestRepository::upsert` hace
`updateOrCreate` sobre `order_key`, `order_identifier`, comercio y sucursal.

La fila nace con `origin` `payment_link` (`EcommerceRequest::ORIGIN_PAYMENT_LINK`), `ecommerce_id` del
`ecommerce_type_id` de la credencial, `process_url` = `webhook_url`, `return_url`,
`checkout_reference` (UUID) y `reference_expires_at`. `data` es JSON puro, sin el separador `config`:
`id` (el `order_key` si no vino `id`), `order_key`, `total`, `billing` reducido a
`CreatePaymentLinkRequest::BILLING_KEYS`, y las aceptaciones y `back_url` sólo si llegaron. La
respuesta 200 trae `redirect_url` (`{app.frontend_url}/ecommerce/{hash}/checkout?ref=<referencia>`),
`order_key`, `status` `PENDING` y `expires_at` en hora de Colombia. Una excepción responde 500
`Server Error` y loguea sólo la clase y los códigos, nunca el cuerpo.

application tiene la misma ruta con otro contrato (`EcommerceController::create`,
`routes/api.php`): el middleware de autenticación está comentado, el `FormRequest` sólo exige
`order_id`, el 409 sale únicamente si existe un `LenderTransaction` con ese `order_id`, y no guarda
pedido: devuelve la URL del checkout anterior con el pedido serializado en base64 y la credencial de
la sucursal en `t`.

## La referencia vence para entrar sin OTP, no para abrir el pedido

La vigencia es `config('ecommerce.payment_link_ttl_minutes')` (`ECOMMERCE_PAYMENT_LINK_TTL_MINUTES`,
60 por omisión). `openByCheckoutReferenceOrchestrator` busca el pedido con
`findByCheckoutReference` y sólo responde no encontrado (`ERS004`) si la referencia no existe o es de
otra sucursal. Vencida o ya usada, el pedido se abre igual y el comprador sigue por OTP.

Lo que el vencimiento apaga es el token de verificación: `consumeCheckoutReference` exige
`reference_used_at` nulo y `reference_expires_at` futuro, en un `update` atómico, y sólo si pasa se
llama a `markMerchantVerified`. Antes de gastarla se descarta, en este orden, un pedido con
`cancelled_at`, una sucursal sin auto-onboarding y un pedido sin `paymentLinkEvidence` (teléfono en
`billing` y las dos aceptaciones con fecha válida). Las condiciones de esa entrada y lo que el wizard
hace con el token están en `ecommerce-context`.

## La consulta de estado sólo devuelve estados finales; lo demás sale pending

`EcommerceOrderStatusService::findForBranch` es de sólo lectura. El `orderId` de la ruta es el
`order_key`, no el número del pedido: toma la fila más reciente con ese `order_key` en la sucursal del
token (`findLatestByOrderKeyForBranch`), sea cual sea su origen. Sin fila, 404 `TransactionNotFound`.

El cuerpo son seis llaves planas, sin sobre `success`/`data`: `orderId`, `approvedAmount`, `currency`
(`COP` fijo), `status`, `statusDescription` y `statusTimestamp`.

- `approvedAmount` es `(final_amount ?? amount ?? 0) + (initial_fee ?? 0)`, la misma fórmula que
  `notifyStoreForUserRequest`. Si una cambia sin la otra, la tienda ve un monto por aviso y otro por consulta.
- `status` busca `woocommerce_statuses.woocommerce_status` por `creditop_status_id`, pero sólo
  `completed`, `cancelled` y `failed` pasan tal cual. Cualquier otro valor (`pending payment`) y un
  estado sin fila salen `pending`. Es lo contrario del aviso, que ante un estado sin fila manda `completed`.
- `statusDescription` es `user_request_statuses.name`; `statusTimestamp`, `disbursed_at` o si no
  `updated_at` de la solicitud, pasado de `app.timezone` a `America/Bogota` como `Y-m-d H:i:s`.

Sin solicitud todavía responde 200 con monto 0, `pending`, «Sin solicitud de crédito» y la creación
del pedido. La consulta no lee `cancelled_at`: un pedido que la tienda canceló antes de que naciera
la solicitud sigue saliendo `pending`, aunque la respuesta de la cancelación haya dicho `cancelled`.
Con solicitud, la cancelación la deja en 8 y la consulta sí sale `cancelled`.

La de application (`EcommerceController::status`) es otro contrato: `auth:sanctum` con
`ability:ecommerce`, sin atar el token a una sucursal; busca un `LenderTransaction` por `order_id`,
así que un pedido que ninguna entidad registró da 404; responde en snake_case y traduce con un
`switch` fijo (11 `COMPLETED`, 8 `CANCELLED`, 6 `FAILED`, 3 `PENDING PAYMENT`, el resto `PENDING`).

## La tienda puede cancelar hasta que la entidad empieza a decidir

`EcommerceOrderCancelController` valida `reason_code` (obligatorio, uno de `store_cancelled`,
`out_of_stock`, `expired`, `other`) y `reason_message` (opcional, hasta 255). El
`EcommerceOrderCancelService::cancelForBranch` toma el pedido más reciente con ese `order_key` en la
sucursal del token (404 `TransactionNotFound` si no hay) y su solicitud vigente
(`latestUserRequestId`). Según el estado de esa solicitud:

- **11**: 409 `already_authorized`; ya hay un crédito y corresponde una devolución;
- **10**: 409 `not_cancellable`; la entidad ya está decidiendo;
- **6, 7 u 8**: 200 con su estado, sin escribir nada. Repetir la cancelación da lo mismo, y el
  pedido no queda con `cancelled_at`;
- **sin solicitud o cualquier otro estado**: cancela.

Cancelar escribe, en una transacción: en `ecommerce_requests`, `cancelled_at` (se conserva si ya
tenía), `cancellation_reason` (`code` y, si vino, `message`) y `processed` en verdadero; en la
solicitud, si existe, `user_request_status_id` 8 y un `UserRequestRecord` con `update_by`
`ecommerce-store` y el comentario `[CANCELADO POR LA TIENDA] <code> <message>`. La respuesta 200 lleva
`orderId`, `status` (`cancelled` si quedó en 8 o no hay solicitud, `failed` si ya estaba en 6 o 7) y
`statusDescription`.

A la tienda no se le avisa: antes de guardar se enciende `UserRequest::$skipStoreNotification`, que
el observer lee después del commit, y el pedido queda `processed`, así que ningún resultado posterior
de esa solicitud le llega tampoco.

Al comprador sí. `EcommerceOrderCancelled` (`ShouldBroadcastNow`) sale por el canal público
`EcommerceRequest.{id}` y, con solicitud, por `App.Models.UserRequest.{userId}`, con el motivo; si
el broadcast falla se reporta y la cancelación queda igual. El componente `EcommerceStoreExit` del
wizard escucha ese evento y además consulta `/api/ecommerce/order-state` al cambiar de pantalla; con
cualquiera de los dos tapa el flujo con «La tienda canceló tu compra», el texto del motivo
(`cancellationText`; `other` usa el mensaje de la tienda) y el botón de vuelta si hay dirección
válida. Un pedido cancelado tampoco entrega token por referencia. El campo `cancellation` del detalle
está descrito en `ecommerce-context`.

application no tiene una cancelación equivalente para la tienda: su `checkout/cancelar`
(`WoocommerceController::cancel`) es una ruta web del flujo del comprador.

## En legacy-backend el aviso sale en general una vez por pedido y gana el primer desenlace

`UserRequestObserver::updated` (después del commit) llama a
`EcommerceRequestService::notifyStoreForUserRequest` cuando `user_request_status_id` cambió a 6, 7, 8
u 11. De las llamadas explícitas, sólo la del cierre de CreditopX
(`ValidateOtpPromissoryNoteController`) está viva; las de los webhooks de Bancolombia
(`app/Http/Controllers/Api/BancolombiaController.php`) y Sistecrédito
(`Modules/Risk/App/Http/Controllers/Api/SistecreditoController.php`) están en controladores sin ruta
en legacy-backend (esos webhooks los atiende application). La solicitud tiene que estar en
`user_requests_by_ecommerce_request`: el aviso busca el pedido sólo por esa tabla.

Hay un tercer camino que no pasa por `notifyStoreForUserRequest` ni mira `processed`: el cierre por
OTP de entidad (`ValidateOtpController::validateLenderOtp`, Compensar y Sistecrédito) pone la
solicitud en 11, lo que dispara el observer, y después llama a `processWoocommerce`, copia vieja del
`process` de application. Hace su propio POST a `process_url` sin consultar `processed`, manda
`final_amount` sin cuota inicial, no usa los notifiers, manda el WhatsApp, pasa a 7 las hermanas salvo
las que están en 11 y marca `processed`. En ese camino la tienda puede recibir dos POST.

Si el pedido ya está `processed`, no hace nada. Como `processed` se marca con el primer estado final
de cualquier solicitud del pedido, una negada seguida de un reintento aprobado deja a la tienda con
`failed` y el `completed` no sale. Lo saltan dos transiciones que encienden `skipStoreNotification`:
la cancelación por cobro de Nequi no completado (`NequiUserRequestSealer`), que no marca el pedido
para no bloquear el aviso posterior, y la cancelación pedida por la tienda, que sí lo marca.

El estado se traduce con `woocommerce_statuses`; un estado sin fila se manda como `completed`. El
monto es lo financiado más la cuota inicial. `processEcommerceTransaction` elige la clase
`EcommerceNotifier` por `ecommerce_id` en `config/ecommerce.php` (`notifiers`, con
`SelfDevelopmentNotifier` por omisión), hace el POST a `process_url` y marca `processed` sólo si no
lanzó: las cuatro clases terminan en `->throw()`, así que un 4xx o 5xx de la tienda deja el pedido sin
marcar. No hay reintento programado; lo reintenta el siguiente estado final de una solicitud del pedido.

- `WooCommerceNotifier`: `process_url` + `order_identifier`, cuerpo `{status}`, basic auth con
  `customer_key` y `customer_secret` de la credencial.
- `SelfDevelopmentNotifier`: siete campos (`orderId` = `order_key`, `approvedAmount`, `currency`,
  `status`, `statusTimestamp`, `paymentType`, `transactionId` = `<pedido>_<solicitud|NA>`), sin
  autenticación. Si el comercio está en el setting `corbeta_allieds` manda el contrato de Corbeta
  (`issuer` según la entidad 68 o 100, `status` en mayúsculas, monto como texto entero, `collector`)
  con una credencial basic fija en el código.
- `ShopifyNotifier`: los mismos siete campos, sin autenticación ni rama de Corbeta.
- `VtexNotifier`: headers `X-VTEX-API-AppKey` y `X-VTEX-API-AppToken`; `paymentId` = `order_key` y
  `status` traducido (`completed` → `approved`, `failed`/`cancelled` → `denied`, el resto `pending`).

`POST api/onboarding/ecommerce-request/notify-store` llama a `processEcommerceTransaction` con el
`status` y el `amount` del cuerpo, sin releer la solicitud y sin middleware propio en la ruta; el
grupo de Onboarding lleva `['otel', 'auth.cognito']`, así que no es una ruta abierta.

## application avisa desde cada integración, sin mirar si ya avisó

En application no hay observer: cada integración que cierra una solicitud (los webhooks de las
entidades, la firma del pagaré, la validación de identidad) busca el pedido en
`user_requests_by_ecommerce_request` y llama a `WoocommerceController::process` con el estado de
`woocommerce_statuses`. `process` no consulta `processed` antes de hacer el POST, así que el mismo
pedido puede avisarse más de una vez. El monto lo pasa cada llamador: la firma del pagaré manda
`final_amount + initial_fee`; el resto, `final_amount`.

Diferencias con legacy-backend:

- **Corbeta** es la constante `CORBETA_ALLIED_IDS`, no el setting `corbeta_allieds`.
- **Autenticación de la rama de desarrollo propio**: todo comercio recibe la credencial basic fija,
  también el que no es Corbeta y recibe el contrato genérico de siete campos; el comercio 250 recibe
  en cambio un bearer tomado de `headers` de su credencial.
- **VTEX**: POST con cuerpo vacío al `process_url`. Esa rama no asigna la respuesta, y el
  `$response->json()` posterior falla antes de marcar `processed`.
- **Las otras solicitudes del pedido**: después del POST pasa a 7 las demás solicitudes del pedido en
  la tabla puente, salvo las que están en 11, y marca `processed`.
- **Al comprador** le manda un WhatsApp con el resultado y la URL de retorno.

`EcommerceReplayController::replay` (`POST api/ecommerce/process/replay`, sin middleware) reenvía el
estado actual de un pedido sin `processed`, sólo para solicitudes de los comercios de Corbeta, y
responde 409 si ya estaba marcado o 422 si el estado no tiene fila en `woocommerce_statuses`.

`processIncompleteRequests`, que cerraba los pedidos sin desenlace pasada una hora y avisaba
`cancelled`, sólo lo invoca `app:update-ecommerce-requests-command`, y su línea en
`app/Console/Kernel.php` está comentada. Además llama a `process` con tres argumentos, cuando la
firma exige cuatro. Un pedido que el comprador abandona no recibe `cancelled` de ninguno de los dos
monolitos; lo cierra sólo la cancelación de la tienda.

## Una solicitud por pedido: para la tienda cuenta la de id más alto

En una sucursal ecommerce con el pedido identificado, `UserRequestService::handleEcommerceUserRequest`
retoma con `findEditableForEcommerceRequest` la solicitud del mismo usuario ligada a ese pedido por
`user_requests_by_ecommerce_request` si sigue en 1, 3 o 9, y si no crea otra. La regla completa y los
tres lugares del vínculo están en `ecommerce-context`.

Un pedido puede entonces acumular varias solicitudes: la que terminó y la del reintento. La consulta
de estado y la cancelación usan `EcommerceOrderStatusService::latestUserRequestId`: el mayor entre
`ecommerce_requests.user_request_id` y el máximo `user_request_id` de la tabla puente.
`original_user_request_id` no cuenta, es historia.

Las tres operaciones no miran lo mismo. La consulta sigue a la solicitud vigente y puede decir
`completed` para un pedido cuyo aviso ya salió `failed` con la solicitud anterior, porque el aviso
se gasta con el primer desenlace. La cancelación sólo evalúa la vigente: si esa está abierta y una
anterior terminó negada, cancela la abierta; las anteriores no se tocan. En application, y en el camino
de `validateLenderOtp` de legacy-backend, avisar un desenlace pasa a 7 las hermanas no autorizadas.
