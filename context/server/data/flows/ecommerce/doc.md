# Ecommerce · contexto
> **estado:** al día con main · **Canal / storefront** (eje 4 del negocio: response_type × producto × modo × **canal**). Cubre cómo la tienda del comercio (VTEX, WooCommerce, desarrollo propio) hace **handoff del carrito** a CreditOp y cómo CreditOp **vuelve al comercio** con el resultado. NO decide crédito ni cobra: solo transporta la orden y notifica el veredicto.

## Qué es
El **canal ecommerce** es el punto de entrada donde una **tienda online** (no un asesor en punto físico, no un link directo) inicia una solicitud de crédito CreditOp desde su checkout. El storefront empaqueta el carrito (monto, orden, comprador, URLs de retorno/callback) en un **contrato base64 unificado**, redirige al comprador al wizard de CreditOp, y al final recibe de vuelta el resultado (aprobado/negado) en su `process_url` + el comprador es redirigido a `return_url` ("volver al comercio").

Lo que distingue al canal de los otros ejes: **un comercio es "ecommerce" si tiene una fila en `allied_ecommerce_credentials`** para esa sucursal. Esa credencial es la llave que (a) habilita el canal, (b) define la plataforma (`ecommerce_type_id`: 1=Woo, 2=self, 3=VTEX), (c) porta las credenciales de callback de la tienda (AppKey/AppToken o consumer_key/secret, encriptadas). Sin credencial el flujo es "regular" (asesor/físico); con credencial bifurca al camino ecommerce (`UserRequestService::findOrCreateUserRequest` chequea `AlliedEcommerceCredential::where('allied_branch_id',...)->exists()`).

**Estado de la migración (clave):** hay DOS implementaciones en paralelo (strangler). El **monolito viejo `application`** todavía sirve el checkout server-rendered (`WoocommerceController::show` en `/checkout/{hash}`, `VtexController` en `/api/*/vtex/*`) para la mayoría de comercios. **legacy-backend** reconstruyó el canal sobre una **arquitectura unificada** (contrato base64 + patrón estrategia de notificadores + un solo `EcommerceRequest`) y ya se llevó a producción para **VTEX** (rama `feature/onboarding/ecommerce-unify-base64-vtex`, mergeada) y para la familia **Corbeta/Bancolombia retail** (`CorbetaCheckoutController`). El cutover es **por-allied hardcodeado**: el monolito redirige `allied_id ∈ [24,209,210,211,311]` a legacy-backend; el resto sigue en el monolito.

## Contenido

**1 · Entrada / handoff del carrito.** Dos formas de entrar, mismo contrato:
- **VTEX (server-to-server):** el conector VTEX postea `POST /vtex/init` (protocolo Payment Provider, sin Cognito). `VtexService::init` valida `partnerKey`(=`allied_branch.hash`)+`secretToken`(=`credential`), registra/upserta el `EcommerceRequest` y **devuelve la `redirectUrl`** = URL base64 unificada. Al resolverse, VTEX consulta `POST /vtex/settel`, que aprueba **solo si el `UserRequest` vinculado llegó a Estado 11**.
- **WooCommerce / self / VTEX-frontend:** el storefront (o el `redirectUrl` que devolvió `/vtex/init`) lleva al comprador a `{ECOMMERCE_FRONTEND_URL}/ecommerce/{hash}/checkout?o&p&t&u&ps&config`. El front decodifica el contrato y postea `POST ecommerce-request/create/{partner_id}` → `EcommerceRequestService::createEcommerceRequestOrchestrator` valida token+monto, upserta el `EcommerceRequest` y responde con `ecommerceRequestId` + `prefill` + `readonlyFields` para arrancar el onboarding stateless.

**El contrato base64 unificado** (round-trip verificado por `tests/Feature/VtexInitTest.php`): seis params, cada uno codificado distinto —
| param | contenido | codificación → decodificación |
|---|---|---|
| `o` | order (id, order_key, total, currency, billing) | `base64(serialize(array))` → `unserialize` (fallback `json_decode`) |
| `p` | products | `base64(json_encode)` → `json_decode` |
| `t` | token (=credential) | `base64(plain)` → plain |
| `u` | returnUrl | `base64(serialize(string))` → `unserialize` |
| `ps` | processUrl (=callbackUrl) | `base64(plain)` → plain |
| `config` | mapa de campos de billing | `base64(serialize(json_encode(array)))` → `unserialize`+`json_decode` |

Lo arma `EcommerceContractBuilder::buildCheckoutUrl` (compartido; lo usa `VtexService`) y lo decodifica `EcommerceRequestService::unserializeCreateEcommerceRequest` — la codificación tiene que casar exactamente. El `order->order_key`(=paymentId) y `order->id`(=orderId) son las claves de **idempotencia**: el `create/{partner_id}` posterior del front hace `updateOrCreate` sobre la MISMA fila que creó `/vtex/init` (no duplica).

**2 · Persistencia + link.** `EcommerceRequestRepository::upsert` escribe `ecommerce_requests` con `data = json(order) . 'config' . json(config)` (concatenación con separador literal "config", que luego se parte con `explode('config', …, 2)`), y fija `ecommerce_id` = **`credential.ecommerce_type_id`** (la fuente de verdad; fallback a la heurística vieja `isset(config)?1:2` si la credencial no trae tipo). Cuando nace el `user_request`, `UserRequestService::handleEcommerceRequest` lee el `ecommerce_request_id` del **request (mundo moderno) o de la sesión (mundo viejo)**, lo vincula (`ecommerce_requests.user_request_id` + tabla puente `user_requests_by_ecommerce_request`) y deja rastro en `ecommerce_requests_log`.

**3 · Resultado + "volver al comercio".** Punto de notificación **ÚNICO**: `UserRequestObserver::updated()` (implementa `ShouldHandleEventsAfterCommit`) dispara cuando un `user_request` cambia a un **estado FINAL {6 Negada, 7 No terminó, 8 Cancelado, 11 Autorizada}** — de CUALQUIER lender (CreditopX, agregadores, futuros) — y llama a `EcommerceRequestService::notifyStoreForUserRequest`. Éste mapea el estado interno a `woocommerce_statuses`, calcula el monto (`final_amount ?? amount + initial_fee`) y delega en `processEcommerceTransaction`, que resuelve el **notificador por `ecommerce_id`** vía `config/ecommerce.php` y postea a `process_url`. Es **idempotente** (`ecommerce_requests.processed=1`). La `return_url` (redirección visual del comprador de vuelta a la tienda) la resuelven la cancelación (`CancelRequestService`/`CorbetaCheckoutController::cancelAndReturn`) y el front.

**Patrón estrategia de notificadores** (`Ecommerce\EcommerceNotifier` interfaz + resolución por config, sin `if/else` por plataforma):
- **VtexNotifier** (`ecommerce_id=3`): headers `X-VTEX-API-AppKey/AppToken` (de `customer_key/secret`), payload `{paymentId, status, authorizationId, tid, nsu, value}`, `status` mapeado por `vtexStatus()` (`completed→approved`, `failed/cancelled→denied`, resto→`pending`).
- **WooCommerceNotifier** (`ecommerce_id=1`): `BasicAuth(consumer_key, consumer_secret)`, POST a `process_url . order_identifier`, body `{status}`.
- **SelfDevelopmentNotifier** (`ecommerce_id=2` + **default**): JSON de 7 campos sin auth… **salvo Corbeta** (allied ∈ `Setting('corbeta_allieds')`), que usa payload extendido (issuer `68→BPL`/`100→CON`, `approvedAmount` string, status en mayúsculas) + `BasicAuth('Mulesoft', …)` hacia Mulesoft/Bancolombia. Es la réplica del `WoocommerceController::process` del monolito.

**Simulador (testing).** Los agregadores deciden vía API externa y el harness no los puede cerrar; `POST simulator/aggregator-result` (`EcommerceSimulatorController`, **bloqueado en prod**) cambia el estado del `user_request` **vía Eloquent** (para disparar el observer), resetea `processed` y re-notifica al comercio. Imita el webhook del lender externo.

## Verdades de BD
- **`allied_ecommerce_credentials`** — la llave del canal. Cols: `allied_id`, `allied_branch_id`, `credential` (=`secretToken`/`token` del contrato), **`ecommerce_type_id`** (string "1"/"2"/"3" = plataforma), `customer_key`/`customer_secret`/`headers` (**`encrypted:collection`**, `hidden`; para VTEX = AppKey/AppToken, para Woo = consumer_key/secret). Nació con `unique(allied_id)`; después se agregó `allied_branch_id`, `ecommerce_type_id`, `headers`.
- **`ecommerces`** (catálogo de plataformas): `1=Woocommerce` (seeder), `2=Desarrollo propio`, `3=VTEX` (`seed_vtex_ecommerce`, migración `2026_06_17`). Ojo: `EcommercesTableSeeder` solo crea id1; id2 "self" es implícito (no sembrado) y el fallback lo asume.
- **`ecommerce_requests`**: `order_key`, `order_identifier`, `allied_id`, `allied_branch_id`, `user_id`, `user_request_id`, `original_user_request_id`, `ecommerce_id`, `data` (`json(order)+"config"+json(config)`), `products`, `return_url`, `process_url`, `processed` (bool, default 0, = flag de idempotencia de notificación). `process_url` se **sanea** (quita espacios/control chars) en el mutator/accessor del modelo para no romper cURL (error 3 URL_MALFORMAT).
- **`user_requests_by_ecommerce_request`**: puente N:1 (`ecommerce_request_id`, `user_request_id`); se resuelve por `latest()`.
- **`woocommerce_statuses`**: mapa `woocommerce_status` ↔ `creditop_status_id`: `completed=11`, `pending payment=10`, `cancelled=8`, `failed=6`, `failed=7`. Los intermedios sin mapeo (4, 10) NO se notifican.
- **`ecommerce_requests_log`**: auditoría por request (uso intensivo en el monolito `application`; legacy-backend prefiere Loki vía `Log`, no escribe log rows en el path VTEX).

## Dónde mirar

**Contrato + entrada unificada (legacy-backend, mundo nuevo):**
- `config/ecommerce.php:14` `ECOMMERCE_FRONTEND_URL` (default `originaciones.dev.creditop.com`) · `:27` map notifiers `1→Woo`,`3→VTEX` · `:32` default `SelfDevelopmentNotifier`.
- `Modules/Onboarding/App/Services/Ecommerce/EcommerceContractBuilder.php:20` `buildCheckoutUrl` (`:22-28` encoding, `:33` shape `{base}/ecommerce/{hash}/checkout?…`).
- `Modules/Onboarding/App/Services/EcommerceRequestService.php:282` `createEcommerceRequestOrchestrator` (`:315` upsert con `ecommerce_type_id`) · `:378` `unserializeCreateEcommerceRequest` (decode) · `:471` `notifyStoreForUserRequest` (`:486` map wooStatus, `:488` monto) · `:493` `processEcommerceTransaction` (`:502` idempotente `processed`) · `:536` `resolveNotifier`.
- `Modules/Onboarding/App/Http/Controllers/EcommerceRequestController.php` (`create`/`detail`/`by-user-request`/`notify-store`) · `Modules/Onboarding/App/Http/Requests/CreateEcommerceRequest.php:40-46` (params `partnerId,order,products,token,returnUrl,processUrl,config`).
- `Modules/Onboarding/App/Repositories/EcommerceRequestRepository.php:16` (ecommerce_id = type ?? heurística) · `:18` claves de upsert · `:24` `data` concatenado. `AlliedEcommerceCredentialRepository.php:27` `findValidCredential` (branch+token → credencial con su type).

**VTEX (legacy-backend):**
- `Modules/Onboarding/App/Http/Controllers/VtexController.php:25` init · `:42` settle (adaptador delgado; toda la lógica en el service).
- `Modules/Onboarding/App/Services/VtexService.php:48` `init` (`:57` partnerKey=hash / secretToken=token, `:81` order shape, `:98` upsert, `:105` genera checkout URL, `:126` devuelve `authorizationId/internalPaymentId/redirectUrl`) · `:138` `settle` (`:23` `AUTHORIZED_STATUS_ID=11`, `:175` aprueba solo con status 11).
- `Modules/Onboarding/App/Services/Ecommerce/VtexNotifier.php:30` headers X-VTEX · `:35` payload · `:47` `vtexStatus` map.
- `database/migrations/2026_06_17_100000_seed_vtex_ecommerce.php:15` siembra Ecommerce id3=VTEX · `tests/Feature/VtexInitTest.php:63` asserta unificación por `ecommerce_type_id=3` · `:87-108` decode round-trip.

**Notificadores + observer + estados:**
- `Modules/Onboarding/App/Services/Ecommerce/{EcommerceNotifier,WooCommerceNotifier,SelfDevelopmentNotifier}.php` (`SelfDevelopmentNotifier.php:25` `Setting('corbeta_allieds')`, `:32` issuer 68/100, `:51` BasicAuth Mulesoft, `:58` no-corbeta 7 campos sin auth).
- `app/Observers/UserRequestObserver.php:26` `STORE_NOTIFY_STATUSES=[6,7,8,11]` · `:51` `wasChanged` + `notifyStoreForUserRequest`.
- `database/seeders/WoocommerceStatusesTableSeeder.php:20` mapa de estados · `EcommercesTableSeeder.php:21` catálogo.
- `app/Models/EcommerceRequest.php:42/:53` saneo de `process_url` · `AlliedEcommerceCredential.php:43` casts encrypted:collection · `UserRequestsByEcommerceRequest.php` · `WoocommerceStatus.php` · `Ecommerce.php`.

**Link al user_request + cancelación/retorno (legacy-backend):**
- `Modules/Onboarding/App/Services/UserRequestService.php:100` `findOrCreateUserRequest` (bifurca por credencial) · `:201` `handleEcommerceRequest` (`:207` id de request||session, `:226` puente) — **punto de link, frontera con onboarding**.
- `Modules/Loans/App/Repositories/UserRequestsByEcommerceRequestRepository.php` (crea el puente) · `Modules/Loans/App/Services/CancelRequestService.php:132` `handleEcommerceRequest` (devuelve `return_url`; `:148` guard `class_exists` de `WoocommerceController` = no-op muerto).
- `Modules/Onboarding/routes/webhooks.php` (rutas públicas sin Cognito): `/vtex/init`, `/vtex/settel`, `simulator/aggregator-result`, `loan-application/{id}/lender-result[s]`.
- `Modules/Onboarding/routes/api.php:174-178` prefijo `ecommerce-request` (create/{partner_id}, detail, by-user-request, notify-store) · `:28` `checkout/{allied_branch_hash}`=`CorbetaCheckoutController@show` · `:26` result · `:27` `corbeta/checkout/cancel/{id}`.

**Checkout entry Corbeta/Bancolombia retail (legacy-backend — el cutover ya migrado):**
- `Modules/Onboarding/App/Http/Controllers/CorbetaCheckoutController.php:107` `show` (decodifica el MISMO contrato base64, crea user+user_request) · `:431/:1250` `redirectToResolveEcommerceFlow` (redirige a `{front}/bancolombia/self-service/{hash}/resolve-ecommerce-flow/{urId}?return=&amount=`) · `:444` `cancelAndReturn` · `:1161` `resolveFrontendBaseUrl` (config `app.frontend_url`/`_dev`) · `Modules/Onboarding/App/Services/CorbetaUserRequestService.php` (service del checkout).

**Front (frontend-monorepo, wizard `loan-request-wizard`) — canal/handoff:**
- `app/routes.ts:156/181` registra `resolve-ecommerce-flow/:loan_request_id` y `ecommerce-loan-processing/:encrypt_code`.
- `app/routes/bancolombia/ecommerce/resolve-ecommerce-flow.tsx:79` `session.set("channel","ecommerce")` (`:74` toma `return`/`amount` del query) · `ecommerce-loan-processing.tsx` (procesamiento).
- `app/routes/bancolombia/cancel-checkout.tsx` (`:5` fallback `CREDITOP_LANDING_URL`; ramifica por status 409/422/404/500) → `app/server/services/cancel-corbeta-checkout.server.ts:1` (`VITE_API_URL` fallback `http://legacy-backend.inertia-develop`, `:34` POST `corbeta/checkout/cancel/{id}`).
- `app/routes/bancolombia/user-request-status.tsx:22` `isEcommerce` (resource route **server-only**: comentario explica el Mixed Content — el browser no alcanza el host interno HTTP, el polling va same-origin y el Node resuelve) · `loan/redirect.tsx:41` / `bnpl/redirect.tsx:42` `isEcommerceFlow` → resuelve destino con `returnUrl`.
- `app/routes/bancolombia/{bnpl/ecommerce-errors,bnpl/ecommerce-errors-mount,bnpl/ecommerce-errors-disponibility,loan/ecommerce-errors-mount}.tsx` (pantallas de error del canal) · `app/utils/env.server.ts:4` `VITE_API_URL` requerido.

**Mundo viejo (monolito `application`, en deprecación):**
- `app/Http/Controllers/Customer/WoocommerceController.php:33` `show` (checkout server-rendered `/checkout/{hash}`, decodifica base64) · `:46` `revisionCorbeta=[24,209,210,211,311]` **redirige esos allieds a legacy-backend** · `:580` `buildLegacyCheckoutRedirectUrl` (→ `/api/onboarding/checkout/{hash}`) · `:234` `process` (notifica al comercio) · `:386` `returnCommerce` · `:222` `cancel` · `:425` `processIncompleteRequests` (reintento batch).
- `app/Http/Controllers/Api/VtexController.php:25` init/`redirect`/settel viejos · `app/Http/Controllers/Api/EcommerceController.php:20` `create` (`ecommerce/payment-link`), `:169` `status` · `app/Http/Controllers/Api/EcommerceReplayController.php:21` `replay` (re-disparo de notificación).
- `app/Http/Controllers/Admin/AlliedEcommerceCredentialsController.php:53` `store` (`:92` fija `ecommerce_type_id`) + `app/Http/Requests/Admin/AlliedEcommerceCredential/StoreRequest.php` — **provisión de la credencial del canal** (frontera con merchants). `app/Http/Requests/Api/Ecommerce/EcommerceRequest.php` (validación del create viejo).
- `app/Http/Middleware/RedirectIfEcommerceNoData.php:34` (si el hash es sucursal "Ecommerce" y no hay `session('ecommerce')` → redirige a login/solicitud-caducada). `app/Models/{EcommerceRequest,AlliedEcommerceCredential,EcommerceRequestsLog}.php`.
- `routes/customer.php:236-239` (`checkout/{hash}`, `checkout/process`, `checkout/return`, `checkout/cancelar`; `:119` `registrar-celular-eccommerce`) · `routes/api.php:156-181` (vtex + ecommerce) · `routes/admin.php:66` `aliados.ecommerce`.
- `app/Console/Commands/UpdateEcommerceRequestsCommand.php` — en legacy-backend está **neutralizado** (no-op; el reintento batch no está migrado); en `application` aún tiene lógica.

## Gotchas / riesgos
- **Cutover por-allied hardcodeado**: `application/WoocommerceController::show:46` redirige `allied_id ∈ [24,209,210,211,311]` (familia Corbeta) a legacy-backend; el resto de comercios ecommerce sigue 100% en el monolito. No hay flag de config — es un array quemado. Agregar un comercio al mundo nuevo exige tocar ese array (o migrarlo del todo).
- **`/vtex/settel` no usa HTTP status para el veredicto**: siempre responde **200**; el éxito viene en `body.success` (`true` solo si el UserRequest está en 11, si no `success=false` + `NOT_READY_TO_SETTLE`). En cambio `/vtex/init` sí usa códigos (400/403/412). Quien consuma settle debe leer el body, no el status.
- **`ecommerce_id=2` no está sembrado**: `EcommercesTableSeeder` solo crea id1 (Woo); id2 "Desarrollo propio" es implícito y solo existe como fallback numérico. Si algo hace join a `ecommerces` por id2 puede no encontrar fila.
- **`data` es una concatenación frágil**: `json(order) . "config" . json(config)`, partida luego con `explode('config', …, 2)`. Si un valor de `order` contiene el literal "config" (poco probable pero posible en un nombre/billing), el split se corrompe.
- **Notificación best-effort e idempotente por `processed`**: si el POST al comercio falla, se loguea pero no reintenta (el batch quedó no-op en legacy). Un `processed=1` bloquea reintentos; el simulador es el único que lo resetea. Riesgo de comercio sin notificar tras un fallo transitorio.
- **Degradación en local (Mixed Content)**: el checkout SSR y las resource routes leen `VITE_API_URL`; desde el browser la llamada directa al backend (HTTP + host interno `legacy-backend.inertia-develop`) la bloquea el navegador → por eso `user-request-status.tsx` es server-only. En local sin el host interno alcanzable, la entrada ecommerce se degrada (hay que apuntar al dev desplegado). La entrada unificada `/ecommerce/{hash}/checkout` del front **no está en `main`** (vive en ramas `feature/onboarding/ecommerce-{web-origination,fe-ecommerce-hydration,continue-route}`); en `main` el único entry ecommerce del wizard es el de Corbeta/Bancolombia.
- **Doble mundo en el link**: `handleEcommerceRequest` lee `ecommerce_request_id` de request (moderno) **o** de sesión (viejo). Si un flujo mixto pierde la sesión y no manda el id, no vincula y loguea un warning (evita el 500, pero deja el crédito sin notificar al comercio).
- **`CancelRequestService:148`** aún tiene un bloque `class_exists(WoocommerceController)` = no-op muerto (la clase no existe en legacy). El observer ya cubre el estado 8; ese bloque es redundante (limpieza pendiente).
- **Credenciales VTEX bidireccionales**: `credential` es el token que la tienda manda a CreditOp (`secretToken` en init); `customer_key/customer_secret` son las de CreditOp→tienda (AppKey/AppToken del callback). No confundirlas: van en direcciones opuestas.

## Fronteras (qué cede a los hermanos)
- **→ payments**: la pasarela real (Wompi/Payvalida), la cuota inicial y el recaudo. El canal solo transporta el `total` de la orden y notifica el estado; NO cobra. `PayvalidaController`/`ApprobeController`/`InitialFeePaymentController` son de payments aunque toquen `ecommerce_id`.
- **→ aggregator**: la DECISIÓN de lender y la pre-aprobación rt=1 (Bancolombia/Corbeta/Sistecrédito). Este nodo se queda con el **handoff del carrito y el retorno** (`channel=ecommerce`, `returnUrl`, `CorbetaCheckoutController` como *entry* del canal, las pantallas de error/redirect del wizard); la máquina de originación Bancolombia (`CorbetaUserRequestService` internals, `validateQuota`, `bnplConfirmed`, crons de conciliación) es del hermano. Incluí `CorbetaCheckoutController` y `resolve-ecommerce-flow` porque son literalmente el punto de handoff del canal, no la decisión.
- **→ merchants**: la config del comercio como entidad (toggles, sucursales, alta). Cedo el CRUD de sucursales/entidad; me quedo solo con `AlliedEcommerceCredentialsController` (la credencial **es** la llave del canal) como frontera compartida.
- **→ onboarding**: OTP, formulario, monto, `registrar-celular`. Cedo el wizard de datos del usuario; me quedo con el punto de **entrada** (`create/{partner_id}`, `checkout/{hash}`) y el punto de **link** (`UserRequestService::handleEcommerceRequest`), que son la costura canal↔onboarding.

## Preguntas abiertas
- ¿Cuándo se completa el cutover del resto de comercios ecommerce (los que no están en `[24,209,210,211,311]`) del monolito a legacy-backend? Hoy la mayoría del checkout WooCommerce/self sigue server-rendered en `application`.
- La entrada unificada `/ecommerce/{hash}/checkout` del **front** no está en `main` (solo en ramas feature). ¿Qué app la sirve en prod hoy — el wizard nuevo o el checkout del monolito? El `ECOMMERCE_FRONTEND_URL` apunta a `originaciones.dev.creditop.com` (el wizard), pero el decode de contrato en el front no está mergeado a main.
- El conector VTEX (`vtex/node/connector.ts`, repo del conector, NO indexado) hardcodea `https://api.creditop.com` + `/vtex/{init,settel}`; el gateway debe enrutar `/vtex/*` a legacy-backend. ¿Está ya ruteado en prod o el conector sigue pegándole al monolito?
- Reintento de notificaciones fallidas: `UpdateEcommerceRequestsCommand` quedó no-op en legacy. ¿Se implementó un job/command nuevo para `processed=0`, o hay un hueco de reconciliación?
- `EcommerceReplayController@replay` (`application`) reprocesa notificaciones; ¿tiene equivalente en legacy o murió con el WoocommerceController?
- ¿Shopify u otra plataforma en el roadmap? La arquitectura (notifier + config + catálogo `ecommerces` + `ecommerce_type_id`) está pensada para agregar plataformas sin tocar el core; hoy solo hay Woo/self/VTEX sembrados.

## Bitácora
- **2026-07-18** — Nodo creado (fase de data). Superficie curada = **71 archivos** validados contra el oráculo (0 DROP): 44 legacy-backend (unified: contrato base64, VtexService/notifiers/observer/CorbetaCheckoutController, migraciones+seeders de `ecommerce_requests`/`allied_ecommerce_credentials`/`woocommerce_statuses`, VtexInitTest), 14 `application` (mundo viejo Woo/VTEX/Ecommerce controllers + admin credential + middleware + rutas), 13 frontend (handoff Corbeta/Bancolombia + return-to-store + errores + env). Doc enriquecido desde `legacy-backend/docs/vtex-migration.md` (no indexado). Hallazgos clave: cutover por-allied hardcodeado `[24,209,210,211,311]`; settle sin HTTP status; entry unificado del front fuera de main; contrato base64 de 6 params round-trip-verificado.

## Enlaces
- **Hermanos que reciben fronteras**: **payments** (Wompi/cuota inicial/recaudo), **aggregator** (decisión rt=1 Bancolombia/Corbeta; comparte `CorbetaCheckoutController` como *entry*), **merchants** (config de entidad/sucursal; comparte la credencial), **onboarding** (OTP/datos/monto; comparte el link `handleEcommerceRequest`).
- **Fuente profunda**: `legacy-backend/docs/vtex-migration.md` (migración monolito→legacy con contrato unificado). Rama de la migración: `feature/onboarding/ecommerce-unify-base64-vtex` (mergeada). Ramas del front ecommerce (no en main): `feature/onboarding/ecommerce-web-origination`, `fe-ecommerce-hydration`, `ecommerce-continue-route`.
- **Memorias**: `vtex-migration-legacy`, `modelos-canales-flujos`, `migracion-application-a-legacy-estado`, `frontend-e2e-split-view` (topología de ventanas + degradación local), `reglas-copia-por-sucursal`.
