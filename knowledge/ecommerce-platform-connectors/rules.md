# Conectores de plataforma: VTEX y Shopify

Cubre los conectores que viven en sus propios repos (`vtex`, `shopify`) y hablan con la API de
tienda de Creditop. El lado de Creditop (`payment-link`, `status`, `cancel`, el aviso al comercio)
está en el tema `ecommerce-store-api`; la entrada del wizard, en `ecommerce-context`. En `main`,
sólo el repo `vtex` contiene código: lo de Shopify queda acotado en la última sección.

## En VTEX la afiliación trae el hash y el token de la sucursal en cada llamada

El conector es una app de VTEX IO (`manifest.json`: `creditop.creditop`, builders `paymentProvider`
y `node`) que implementa `PaymentProvider` en `node/connector.ts`. No guarda credenciales de
Creditop: `getProviderCreds` las lee de los encabezados de cada petición del gateway,
`x-provider-api-appkey` / `x-provider-api-apptoken` (o sus variantes `x-vtex-api-*`).

El *App key* de la afiliación es el hash de la sucursal y el *App token* su token de ecommerce.
El hash viaja en el cuerpo de `payment-link` (`hash`) y el token es el `Authorization: Bearer` de
las tres llamadas a Creditop (`payment-link`, `status`, `cancel`). De qué tienda viene el pedido
lo dice entonces la afiliación configurada en esa cuenta de VTEX, no un dato del carrito.

Si faltan los encabezados, los dos valores quedan en cadena vacía y la llamada sale igual; el
rechazo lo da Creditop y el conector lo traduce como cualquier otro fallo de esa operación.

## El ambiente sale de la configuración de la app y una lectura fallida niega el pago

`apiBaseUrl` (`node/creditop.ts`) elige la base entre dos hosts fijos según `settings.environment`
(`production` | `develop`, declarados en `settingsSchema` de `manifest.json`); sin valor es
producción. `CREDITOP_API_URL` pisa la base, y sólo existe fuera de IO (arranque local). Cada host
tiene que estar en una política `outbound-access` del manifest.

`settings()` lee `getAppSettings(VTEX_APP_ID)` y la guarda en memoria por
`cuenta/workspace/app` durante `SETTINGS_TTL_MS`. Distingue dos casos:

- configuración vacía (`{}` o `null`): es válida y significa producción;
- lectura fallida: reintenta (`SETTINGS_ATTEMPTS`), luego usa la última leída por el proceso aunque
  su caché haya vencido, luego la copia `last-good` del bucket `settings` de VBase (que se guarda
  sin esperar tras cada lectura buena) y, sin ninguna, lanza `SettingsUnavailable`.

Quien llama trata `SettingsUnavailable` como «Creditop no contesta»: `authorize` niega con
`CREDITOP_UNAVAILABLE` sólo en la primera llamada; en el reintento de un pago en redirect, la
excepción cae en el `catch` de `resolveFromCreditop` y devuelve la misma respuesta pendiente.
`cancel` niega sin guardar y `settle` da `SETTLE_ERROR`. Ante una lectura fallida nunca se supone
producción; en cambio, sin `VTEX_APP_ID`, `settings()` devuelve `{}` sin leer nada y `apiBaseUrl({})`
resuelve a producción salvo `CREDITOP_API_URL`. La configuración es por workspace.

## Authorize pide el enlace a payment-link y responde redirect

`authorize` primero busca la respuesta guardada en el bucket `authorizations` de VBase por
`paymentId`. Sin respuesta previa, y fuera de la Test Suite:

1. Si `currency` viene y no es `COP` (`CREDITOP_CURRENCY`), niega con `CREDITOP_INVALID_CURRENCY`
   sin llamar a Creditop.
2. Guarda la petición original en `authorizations-request` en paralelo; si ese guardado falla, el
   pago no se niega.
3. Hace `POST {base}/ecommerce/payment-link` con el cuerpo de `paymentLinkBody`.
4. Responde `Authorizations.redirect` con `redirectUrl` y `paymentUrl` iguales al `redirect_url`
   devuelto, `authorizationId` = `order_key`, `tid` = `paymentId`, y `delayToAutoSettle` y
   `delayToCancel` fijos; esa respuesta se persiste.

El conector no arma la URL del wizard: la devuelve Creditop y sólo lleva una referencia. Lo que
manda `paymentLinkBody`:

- `hash` (App key), `order_key` = `paymentId`, `id` = `orderId`, `total` = `value`;
- `billing` desde `miniCart.buyer`: nombre, apellido, correo, celular sin el indicativo `57`,
  `document_number` y `document_type` (`cedulaCOL` → `CC`; sin tipo o `CPF` → `CC`; otro pasa tal
  cual). Los campos vacíos se omiten;
- `products` desde `miniCart.items` (`id`, `name`, `price`, `quantity`);
- `return_url` = `returnUrl` de VTEX y `webhook_url` = `callbackUrl` de VTEX.

Si `payment-link` falla (HTTP, red o configuración ilegible), niega con `CREDITOP_<status>` o
`CREDITOP_UNAVAILABLE` y **no persiste**: un reintento de VTEX vuelve a pedir el enlace.

La Test Suite de VTEX (`this.isTestSuite`) nunca llega a Creditop: `node/testSuite.ts` contesta
según la tarjeta de prueba, y `cancel`, `refund` y `settle` se aprueban directamente.

## El auto-onboarding de VTEX lee el pedido del OMS y nunca frena el pago

Lo gobierna el switch `autoOnboarding` de la configuración de la app. El checkout de la tienda lo
consulta en la ruta pública `GET /_v/creditop/auto-onboarding` (`node/service.json`,
`autoOnboardingEnabled`), que ante una lectura fallida responde apagado.

Con el switch prendido y `orderId` presente, `autoOnboardingData` lee
`/api/oms/pvt/orders/<orderId>-01` (el `orderId` del authorize es el grupo; `-01` asume un solo
vendedor) con el token de la app, y `autoOnboardingFromOrder` toma de
`customData.customApps[id=creditop].fields` tres campos: `birthDate` y `expeditionDate` sólo si
tienen forma `YYYY-MM-DD`, y `acceptedAt` si es una fecha interpretable (se normaliza a UTC).

Van a `payment-link` como `billing.birth_date`, `billing.document_expedition_date` y, con la misma
hora, `termAccepted` y `policyAccepted`. Un valor mal formado no se manda. Si el OMS no responde
dentro del timeout corto, da error o el pedido no trae los datos, el enlace se pide sin ellos y el
comprador sigue el camino normal. Requiere las políticas `OMSViewer` y `outbound-access` al OMS.
Que Creditop salte pasos depende además de su lado (sucursal habilitada).

## En VTEX el desenlace se toma del estado del pedido, no del cuerpo del aviso

Creditop avisa al `webhook_url` recibido, que es el `callbackUrl` del gateway de VTEX
(`EcommercePaymentLinkService` lo guarda como `process_url`). En legacy-backend, `VtexNotifier` hace
el POST sólo cuando la credencial de la sucursal es de tipo VTEX (`ecommerce_type_id = 3`, que
`EcommerceRequestService` guarda como `ecommerce_id` del pedido y `resolveNotifier` resuelve por
`config/ecommerce.php`), una sola vez (`processed`) y sólo al pasar a 6, 7, 8 u 11
(`UserRequestObserver`). El conector asume, según el protocolo de VTEX, que el gateway reacciona
volviendo a llamar a `authorize` con el mismo `paymentId`.

En ese reintento, una respuesta guardada `approved` o `denied` se repite tal cual. Una en redirect
pasa por `resolveFromCreditop`, que consulta `GET {base}/ecommerce/status/<paymentId>`:

- `completed` → `Authorizations.approve` (se persiste);
- `failed` o `cancelled` → `deny` con `CREDITOP_FAILED` / `CREDITOP_CANCELLED` (se persiste);
- otro estado, o la consulta falla → devuelve la misma respuesta pendiente, sin cambiarla.

`node/flow.ts` resuelve un aviso entrante con el cuerpo `{paymentId, status, …}` contra
`authorizations-request`: sólo `handleCreditopWebhook` está enganchado a la ruta `creditopWebhook`, y
`processCreditopCallback` no tiene llamadores. Esa ruta se agrega en `node/index.ts` fuera del
constructor de `PaymentProviderService` y no está en `node/service.json`, que sólo declara
`autoOnboardingStatus`. El camino vigente es el reintento
con consulta de estado; no dar por activo ese webhook sin medirlo.

## Settle, cancel y refund en VTEX deciden por el estado y por el código HTTP de Creditop

`settle` consulta el mismo `status`: aprueba sólo con `completed`; con otro estado niega
`NOT_READY_TO_SETTLE`; ante 404 (pedido que no es de esa sucursal) `ORDER_NOT_FOUND`; ante
cualquier otro fallo `SETTLE_ERROR`. No le pide a Creditop que cobre nada.

`cancel` es idempotente por `paymentId-requestId` (bucket `cancellations`). Llama
`POST {base}/ecommerce/orders/<paymentId>/cancel` con `reason_code: store_cancelled` y
`cancelDecision` traduce el código:

| Creditop | decisión | respuesta a VTEX |
|---|---|---|
| 200 / 201 | `approve` | cancelación aprobada, se guarda |
| 409 | `manual` | `deny` con `cancel-manually`, se guarda |
| 404 / 405 / 501 | `fallback` | decide por `status` |
| otro, o sin respuesta | `retry` | `deny` con `CREDITOP_UNAVAILABLE`, **sin guardar** |

En `fallback`: `completed` → `manual`; cualquier otro estado → aprueba; 404 del estado → aprueba;
otro fallo → `retry`. Como `retry` no se persiste, la siguiente llamada de VTEX vuelve a decidir.

`refund` no llama a Creditop: niega siempre con `refund-manually` y guarda la respuesta por
`paymentId-requestId`. La devolución se tramita fuera del conector.

## En main del repo shopify sólo hay un README y la comparación con Shopify no se puede sostener

En la ref `main` del repo `shopify` el árbol contiene únicamente `README.md`, con el título y sin
contenido; la app vive en ramas sin mergear (`develop`). Su mecanismo (enlace, credenciales,
captura, cancelación, reembolso) no se describe acá, y cualquier afirmación sobre ella debe
salir de la rama donde viva, con ese estado dicho.

El lado de Creditop del aviso a Shopify sí está en `main` de legacy-backend: `ShopifyNotifier`
(`Modules/Onboarding/App/Services/Ecommerce/ShopifyNotifier.php`), registrado en
`config/ecommerce.php` para `ecommerce_id = 4`, y la migración
`2026_10_19_120000_seed_shopify_ecommerce.php`, que siembra ese id en el catálogo `ecommerces`.

Lo que sí distingue a VTEX y sirve de vara al comparar otro conector:

- las credenciales de la sucursal llegan por petición desde la afiliación, sin almacenamiento propio;
- el ambiente es configuración por cuenta y workspace, con producción como valor por omisión;
- el desenlace lo confirma el conector preguntando el estado, y el aviso sólo dispara el reintento;
- capturar es una confirmación de estado, cancelar se delega en Creditop y reembolsar es manual.
