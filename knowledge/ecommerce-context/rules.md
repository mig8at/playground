# Ecommerce: entrada, contexto y monto

Para #6 y #95. Cubre la entrada y el contexto del pedido; el cierre, el cobro y la notificación
al comercio se comprueban en sus tareas. «Sin cookie» se refiere al contexto del pedido, no a
la ausencia de cookies o autenticación en todo el wizard. Los resultados de una rama o ambiente
no sustituyen el mecanismo de las refs de `main` indicadas en las fuentes.

## El monolito anterior decide si envía al wizard

`application` conserva una entrada en `WoocommerceController::show`: hay una salida anterior
para los ids de comercio `[24, 209, 210, 211, 311]`. Para los demás, `NewFrontendUrlService`
consulta `settings`: habilita el hash incluido en `new_frontend_allied_branches.hashes` o
el comercio cuyo valor en `new_frontend_allieds` sea el booleano `true`.

Una configuración ausente o con otra forma no habilita el wizard. La URL stateless necesita
una base de frontend no vacía; si no puede construirse, continúa el checkout anterior.
Se reenvía el query original del contrato, sin decodificar y recomponer su base64.
El código permite leer el mecanismo; qué comercios están habilitados se mide en la base.

## El contrato se deserializa antes de validar la credencial

En legacy-backend, `POST api/onboarding/ecommerce-request/create/{partner_id}`
(`Modules/Onboarding/routes/api.php:235`) no lleva middleware propio: el grupo del módulo sólo
agrega `otel` y `auth.cognito` (`RouteServiceProvider.php:41-44`), y `ResolveCognitoUser` resuelve
el actor sin rechazar la petición. `CreateEcommerceRequest::validate` sólo exige cadenas. El
orquestador empieza por `unserializeCreateEcommerceRequest` (`EcommerceRequestService.php:418`,
`:599-622`): decodifica de base64 `order`, `returnUrl`, `processUrl`, `config` y, si viene, `backUrl`,
y los reconstruye con `unserialize()` sin la opción `allowed_classes` (`:640`, `:651`, `:660`, `:670`;
`processUrl` sólo si contiene `"`). `products` pasa por `json_decode` y `token` sólo se decodifica.
Recién después valida el total (`:420`), la sucursal (`:428`) y la credencial con
`findValidCredential` (`:437`). La entrada del wizard (`checkout.tsx:164-179`) reenvía esos
parámetros sin tocarlos a este endpoint.

application repite el patrón en `WoocommerceController::show` (`GET /checkout/{allied_branch_hash}`,
fuera del grupo `auth` de `routes/customer.php:244`). Corbeta y las sucursales habilitadas para el
wizard salen antes (`:153-180`) sin decodificar; el resto decodifica y deserializa (`:207-213`, con
`unserialize()` sin `allowed_classes` en `:732`, `:744`, `:755`, `:767`) antes de comparar la
credencial (`:249`). En cambio, el checkout de Corbeta en legacy-backend deserializa con
`['allowed_classes' => false]` y cae a JSON si falla (`CorbetaCheckoutController.php:950`).

## El pedido se relee por id antes y después del OTP

El loader `/ecommerce/:partner_hash/checkout` tiene dos entradas. Con el contrato en la URL
reenvía `o`, `p`, `t`, `u`, `ps` y `config` al backend (`create/<hash>`) como `order`, `products`,
`token`, `returnUrl`, `processUrl` y `config`, y `b` como `backUrl` si viene; necesita hash
válido, orden y token. El backend valida el total positivo, la sucursal y su credencial, y
devuelve `ecommerceRequestId`. Con `?ref=` (pedido creado por la tienda con `payment-link`) sólo
envía esa referencia a `by-reference/<hash>`; el backend exige que sea de esa sucursal y abre el
pedido ya guardado, sin crearlo (`EcommerceRequestService.php:294-337`). Las dos entradas siguen
igual (`continueCheckout`, `checkout.tsx:184`): el redirect lleva `?erId=`; sólo usa `?amount=`
como respaldo cuando la respuesta no contiene ese id.

En la entrada por contrato el loader también reenvía `sig` y `ts` como `signature` y
`signatureTimestamp` cuando vienen los dos (`checkout.tsx:52`). El backend verifica esa firma del
comercio sobre el `o` recibido (`EcommerceRequestService.php:452`, `MerchantOrderSignatureService`)
y, si vale, marca el pedido y devuelve `merchantVerified` con un `verificationToken` de un solo
uso. En la entrada por referencia el token sale sólo si la sucursal tiene auto-onboarding, el
pedido trae teléfono y aceptaciones (`termAccepted`, `policyAccepted`) y la referencia está
vigente y sin usar, que se gasta en ese momento; si falta algo el pedido se abre igual y el
comprador sigue por OTP. Las dos devuelven `autoOnboarding` según el setting
`auto_onboarding_allied_branches` (`{"hashes": [...]}`; ausente o con otra forma no habilita).
Con id de pedido y `autoOnboarding` verdadero, el redirect va a `/auto/<hash>/inicio?erId=` en vez
de `solicitar` (`checkout.tsx:188-189`); sólo en ese camino el token se guarda en la cookie de
sesión para entrar sin OTP. Un pedido verificado en una sucursal sin auto-onboarding sigue por
`solicitar` y el token no se usa. Esa cookie lleva la verificación, no el contexto del pedido,
que se sigue releyendo por `erId`.

`ecommerce-context.server.ts` consulta `detail/<erId>` antes del OTP y
`by-user-request/<loan_request_id>` después. Valida ids de uno a diecinueve dígitos antes del
fetch. Los POST pueden recuperar `erId` desde el Referer si no viene en su URL.
Ante error HTTP, red o respuesta sin id devuelve `null`. Ese resultado no demuestra que la
solicitud no tenga pedido: al depurar, contrastar el vínculo en backend.

## El vínculo con la solicitud vive en tres lugares

`EcommerceRequest::existsForUserRequest` considera `user_request_id`,
`original_user_request_id` y la tabla `user_requests_by_ecommerce_request`.
`latestForUserRequest` toma el mayor id de pedido entre los tres vínculos; el endpoint
`by-user-request` utiliza esa misma resolución. Buscar sólo el primer campo puede perder
una solicitud recreada o vinculada por la tabla puente.

Al crear la solicitud en una sucursal ecommerce con el pedido identificado (`ecommerce_request_id`
en la petición o en la sesión), legacy-backend (`UserRequestService::handleEcommerceUserRequest`)
retoma la solicitud más reciente del mismo usuario vinculada a ESE pedido por la tabla puente, sólo
si sigue en 1, 3 o 9; si no la hay, o ya terminó, crea otra. Nunca reutiliza la de otro pedido ni
reabre un estado final. Sin pedido identificado sigue la búsqueda anterior por usuario y monto.

El total se obtiene de la orden guardada en `data`, antes del separador `config`.
Si no es numérico y positivo, `orderTotalFromData` devuelve `null`. La ausencia de total
verificable exige revisar el pedido, no inventar un monto desde un dato del navegador.

## El canal de tienda tiene precedencia y gobierna el monto

`OnboardingOrigin::resolve` recibe dos booleanos y mira el vínculo ecommerce antes que la
autenticación; el vínculo lo calcula el llamador con `existsForUserRequest`
(`UserRequestService.php:898-902`, `LenderListingService.php:748-750`).
Con pedido devuelve `ECOMMERCE` incluso si viaja sesión de asesor. Sólo sin pedido distingue
`ADVISOR` y `SELF_SERVICE`. `isCustomerPresent` es falso únicamente para asesor;
`locksAmount` es verdadero únicamente para ecommerce.

El loader del listado relee el pedido por solicitud: con contexto ecommerce ignora el
`?amount=` recibido y usa el total positivo del pedido o cero para que el backend resuelva.
En `LenderListingService` el total conocido del pedido prevalece sobre el monto de entrada.
El tema `lender-listing` detalla esa entrada. No extrapolar este bloqueo a una garantía
de todos los endpoints de escritura ni usar una sesión abierta para reclasificar el canal.

## El link «Volver a la tienda» prefiere backUrl

`storeBackUrlOf` del wizard prefiere `backUrl` y cae en `returnUrl`; lee los dos del detalle del
pedido (`buildEcommerceRequestDetailData`). El `backUrl` es a dónde vuelve el comprador si sale a pagar
con otro medio, y viaja dentro del JSON del pedido en `data` como `back_url`:

- con la URL armada, el checkout manda `b` como `backUrl` en el create; `CreateEcommerceRequest` lo
  acepta opcional y el orquestador lo decodifica como la `returnUrl`, lo filtra con `storeUrlOrNull`
  (`EcommerceRequestService.php:607-609`) y lo guarda en el pedido después de verificar la firma del
  comercio, que sigue siendo sobre el `o` recibido (`:469-471`);
- con `payment-link`, `back_url` debe ser una URL `https://` (`CreatePaymentLinkRequest.php:49`) y
  queda en el pedido sólo si llegó.

El detalle y la respuesta del create devuelven `backUrl` sólo si es una URL absoluta `http` o `https`
(`storeUrlOrNull`); vacía, sin protocolo o con otro esquema llega como `null`, y entonces el link del
listado vacío lleva a la `returnUrl` de la tienda, que suele ser la confirmación del pedido. Los
pedidos guardados antes de este cambio por la URL armada no tienen `back_url`.
