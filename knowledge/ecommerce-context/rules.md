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

## El pedido se relee por id antes y después del OTP

El loader `/ecommerce/:partner_hash/checkout` reenvía `o`, `p`, `t`, `u`, `ps` y `config`
al backend como `order`, `products`, `token`, `returnUrl`, `processUrl` y `config`.
Necesita hash válido, orden y token. El backend valida el total positivo, la sucursal y su
credencial, y devuelve `ecommerceRequestId`. El redirect lleva `?erId=`; sólo usa `?amount=`
como respaldo cuando la respuesta no contiene ese id.

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

El total se obtiene de la orden guardada en `data`, antes del separador `config`.
Si no es numérico y positivo, `orderTotalFromData` devuelve `null`. La ausencia de total
verificable exige revisar el pedido, no inventar un monto desde un dato del navegador.

## El canal de tienda tiene precedencia y gobierna el monto

`OnboardingOrigin::resolve` comprueba el vínculo ecommerce antes de la autenticación.
Con pedido devuelve `ECOMMERCE` incluso si viaja sesión de asesor. Sólo sin pedido distingue
`ADVISOR` y `SELF_SERVICE`. `isCustomerPresent` es falso únicamente para asesor;
`locksAmount` es verdadero únicamente para ecommerce.

El loader del listado relee el pedido por solicitud: con contexto ecommerce ignora el
`?amount=` recibido y usa el total positivo del pedido o cero para que el backend resuelva.
En `LenderListingService` el total conocido del pedido prevalece sobre el monto de entrada.
El tema `lender-listing` detalla esa entrada. No extrapolar este bloqueo a una garantía
de todos los endpoints de escritura ni usar una sesión abierta para reclasificar el canal.
