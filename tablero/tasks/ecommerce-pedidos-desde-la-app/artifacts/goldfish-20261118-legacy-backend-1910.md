# Goldfish · Creditop-SAS/legacy-backend #1910 · feat(ecommerce): marcar los pedidos que la app abre en la tienda del comercio

- PR: https://github.com/Creditop-SAS/legacy-backend/pull/1910 (de kevingamez, rama `feat/ecommerce-app-origin`)
- Commit validado: `92a3b22748` contra `origin/qa`
- Corrida: 2026-11-18T15:08:15-05:00 → 2026-11-18T15:11:08-05:00 · costo equivalente: US$2.96

**14 hallazgos**: 3 confirmados · 2 plausibles · 6 descartados · 0 sin veredicto

## Impacto: ALTO

Sin modelo: sale del diff, de la historia de la base y de lo que my-tools ya sabe. 25 archivos, +703 −14 · Modules/AlliedV1, Modules/MobileV1, Modules/Onboarding.

- `Modules/MobileV1/config/config.php` lo nombran 448 archivos de la base
- `Modules/MobileV1/App/Providers/RouteServiceProvider.php` lo nombran 65 archivos de la base
- `Modules/AlliedV1/Contracts/Repositories/AlliedRepositoryInterface.php` lo nombran 35 archivos de la base
- es grande: 25 archivos, +703 −14
- toca lo que explican 23 sección(es) de knowledge
- (no cambia el nivel) cambia rutas: `Modules/Onboarding/routes/api.php`
- (no cambia el nivel) `Modules/MobileV1/App/Providers/RouteServiceProvider.php` tiene su par en legacy-application:app/Providers/RouteServiceProvider.php: la regla puede vivir en los dos monolitos

**Lo que explica knowledge de estos archivos**:

- `ecommerce-store-api#en-legacy-backend-el-aviso-sale-en-general-una-vez-por-pedido-y-gana-el-primer-desenlace` · En legacy-backend el aviso sale en general una vez por pedido y gana el primer desenlace
- `ecommerce-context#el-pedido-se-relee-por-id-antes-y-despues-del-otp` · El pedido se relee por id antes y después del OTP
- `ecommerce-store-api#la-referencia-vence-para-entrar-sin-otp-no-para-abrir-el-pedido` · La referencia vence para entrar sin OTP, no para abrir el pedido
- `ecommerce-store-api#el-enlace-de-pago-crea-el-pedido-y-rechaza-un-order-key-repetido-con-409` · El enlace de pago crea el pedido y rechaza un order_key repetido con 409
- `ecommerce-store-api#la-consulta-de-estado-solo-devuelve-estados-finales-lo-demas-sale-pending` · La consulta de estado sólo devuelve estados finales; lo demás sale pending
- `ecommerce-store-api#la-tienda-puede-cancelar-hasta-que-la-entidad-empieza-a-decidir` · La tienda puede cancelar hasta que la entidad empieza a decidir
- `ecommerce-context#el-contrato-se-deserializa-antes-de-validar-la-credencial` · El contrato se deserializa antes de validar la credencial
- `lender-credential-sources#el-token-de-una-tienda-ecommerce` · El token de una tienda ecommerce
- … y 15 más

**Los archivos que más pesan** (dependen de ellos · commits y arreglos en 90 días):

- `database/migrations/2026_11_12_120100_add_app_origin_to_ecommerce_requests.php` · migración
- `Modules/MobileV1/config/config.php` · configuración · lo nombran 448
- `Modules/MobileV1/App/Providers/RouteServiceProvider.php` · lo nombran 65 · par en legacy-application:app/Providers/RouteServiceProvider.php
- `Modules/AlliedV1/Contracts/Repositories/AlliedRepositoryInterface.php` · lo nombran 35
- `Modules/Onboarding/App/Services/EcommerceRequestService.php` · lo nombran 18 · 9 commits, 1 arreglos
- `Modules/Onboarding/Contracts/Repositories/EcommerceRequestRepositoryInterface.php` · lo nombran 19 · 5 commits, 0 arreglos
- `Modules/AlliedV1/App/Repositories/AlliedRepository.php` · lo nombran 13
- `Modules/Onboarding/routes/api.php` · rutas · 17 commits, 4 arreglos

«Lo nombran» cuenta archivos de la base, sin pruebas ni migraciones, que mencionan el nombre de la clase o lo importan: una aproximación.

**Después de mergear**:

- las migraciones no se aplican al mergear: en local y qa, sólo la de la tarea con `--path`; en producción, a mano
- releer las secciones de knowledge que toca y actualizarlas si cambió la regla (`make knowledge-touch F='legacy-backend:origin/qa..<merge>'`)
- después del despliegue, `bin/sentinel deploy legacy-backend`: las señales antes y después contra lo normal de esa franja

---

## CONFIRMADO · media — No hay orden de despliegue entre la migración, el backend, infra, frontend y la app

`database/migrations/2026_11_12_120100_add_app_origin_to_ecommerce_requests.php` · goldfish · propuesta vs cambio

Lista cinco PRs pero no dice en qué orden se publican. Si el código sale antes que la migración, `markAppOrigin` falla en cada `create` y cada `by-reference`, todos los pedidos quedan en NULL y se registra un error `ecommerce.app_origin.failed` por pedido. Si la app sale antes que el gateway (PRs de infra) o que el wizard `/ecommerce/app/go` (frontend-monorepo#1409), el enlace devuelto no abre. Hay que escribir qué tiene que estar en producción antes de qué.

> Veredicto: Falta en la descripción. No rompe nada: `markAppOrigin` atrapa cualquier `Throwable` y sólo deja el log `ecommerce.app_origin.failed` (EcommerceRequestService.php, diff:971-985). Pero si el código sale antes que la migración, ese log sale en CADA `create` y `by-reference`. La migración (database/migrations/2026_11_12_120100_…) en producción se corre a mano. Conviene escribir el orden: migración → backend → infra (gateway) → frontend (`/ecommerce/app/go`) → app.

## CONFIRMADO · media — Ninguna prueba para el token, los endpoints nuevos ni la marca del pedido

`Modules/MobileV1/App/Support/AppHandoffToken.php:34` · goldfish · riesgos

El diff no agrega ni toca ningún test. Hay lógica delicada sin cubrir: `AppHandoffToken::verify` (formato, firma, vencimiento, comercio distinto, APP_KEY corta), la regla «la primera marca gana» de `markOriginChannel`, el 403 por `x-user-id` repetido, el limitador de 429 y el `valid:false` de `app-handoff`. Si en un refactor alguien invierte una condición, por ejemplo `$claims['e'] <= time()` o la comparación de `a`, los pedidos de la app quedarían todos como `no_token`, o se aceptarían tokens de otro comercio, y nada lo detectaría. La métrica que motiva el PR quedaría sesgada sin que nadie lo note.

> Veredicto: El diff no trae ninguna prueba: `git diff --stat origin/qa...refs/goldfish/pr-1910` no toca `tests/` ni los `tests` de los módulos. `AppHandoffToken::verify` (diff:634-656) es una función pura y es la que decide la métrica y la seguridad del token. Una prueba unitaria de verify (formato, firma, vencimiento, otro comercio, llave corta) y una de `markOriginChannel` (primer toque) son baratas. Que sean SIN `RefreshDatabase`, o con la ruta explícita.

## CONFIRMADO · baja — A las tablas de códigos les faltan MBV12001 y ERS000

`Modules/MobileV1/App/Services/CreateEcommerceStoreLinkService.php:491` · goldfish · propuesta vs cambio

La tabla de MobileV1 no lista `MBV12001` (500, que también sale sin `APP_KEY` válida porque `issue` lanza la excepción). La de `app-handoff` no lista `ERS000` 500 ante una falla de AlliedV1. El README sí incluye MBV12001. Para la app y el wizard son respuestas posibles que conviene documentar.

> Veredicto: Es menor y es de la descripción. `MBV12001` 500 está mapeado (CreateEcommerceStoreLinkService, diff:491) y sale también sin `APP_KEY` válida, porque `AppHandoffToken::sign` lanza (diff:662-665). `ERS000` sale en `app-handoff` ante una falla de AlliedV1 (diff:888-910). Basta con agregar las dos filas a las tablas.

## PLAUSIBLE · baja — La primera apertura sin token deja el pedido en `no_token` para siempre

`Modules/Onboarding/App/Services/EcommerceRequestService.php:569` · goldfish · propuesta vs cambio

«Se escribe una sola vez y nunca se pisa», y el UPDATE condiciona sobre `origin_channel IS NULL`, así que `no_token` también es definitivo. Si el wizard llama a `create` o `by-reference` una vez sin `appToken` (cookie todavía no leída, SSR, recarga desde otro contexto) y después con el token, el pedido queda como `no_token`. Además, como `create` es un upsert por `order_key` (que no es único), una compra que reutilice el `order_key` de un pedido anterior hereda su canal. La propuesta lo presenta como garantía pero depende de que el frontend mande siempre el token en la primera llamada, y no lo dice.

> Veredicto: Es cierto que la primera marca gana (EcommerceRequestRepository.php, diff:776-781, `whereNull('origin_channel')`) y que `no_token` queda definitivo. Lo de reusar el `order_key` casi no aplica: el `upsert` busca por `order_key` + `order_identifier` + comercio + sucursal (EcommerceRequestRepository.php:18-22 en el PR), así que sólo reusa la fila del MISMO pedido. Hay que comprobar en frontend-monorepo#1409 que el wizard mande el `appToken` (desde la cookie) en la PRIMERA llamada a `create` y a `by-reference`, también si la hace el servidor (SSR). Si no lo manda, la métrica queda sesgada hacia `no_token`. Conviene escribirlo en la descripción como requisito del front.

## PLAUSIBLE · baja — Si `MOBILE_STORE_LINK_RATE_LIMIT_PER_MINUTE` está vacío, se bloquean todos los enlaces

`Modules/MobileV1/config/config.php:715` · goldfish · riesgos

La config hace `(int) env('MOBILE_STORE_LINK_RATE_LIMIT_PER_MINUTE', 30)`. Si la variable existe pero está vacía en algún ambiente, por ejemplo en un task definition o un .env con `KEY=`, `env` devuelve '' y el cast da 0. Con `Limit::perMinute(0)` todas las llamadas a store-link responden 429 MBV12005, y la app no puede abrir ninguna tienda.

> Veredicto: Es cierto en el código: `(int) env('MOBILE_STORE_LINK_RATE_LIMIT_PER_MINUTE', 30)` (Modules/MobileV1/config/config.php, diff:715). Con `KEY=` vacío, env devuelve '' y no usa el default, y `Limit::perMinute(0)` responde 429 a todo (RouteServiceProvider, diff:444). Hay que comprobar que la task definition de cada ambiente no declare la variable vacía. Si se quiere blindar, alcanza con `max(1, …)`.

## FUERA DE ALCANCE · alta — No dice que el backend solo se pueda alcanzar a través del gateway

`Modules/MobileV1/routes/api.php:727` · goldfish · propuesta vs cambio

Toda la autenticación de `store-link` se apoya en el `x-user-id`, que el authorizer del gateway pisa (routes/api.php lo da por hecho "on purpose" y el servicio lo marca como GLOBAE001). El mismo comentario antes decía que ninguna API de la arquitectura nueva se publicaba por el gateway y que MobileV1 lo consume `financial-health-service` desde la red privada. La propuesta no dice si `/api/v1/mobile/...` de legacy-backend se puede alcanzar sin pasar por el gateway: por ALB público, por otra ruta del gateway que haga proxy genérico a `/api/*` o desde la red interna. Si se puede, cualquiera saca tokens a nombre de cualquier usuario y marca pedidos como `mobile_app` con un `app_user_id` ajeno. Además el 403 por header "repetido" solo frena llamadas que no pasaron por el gateway. Es un supuesto de seguridad que vive fuera del diff y no está escrito.

> Veredicto: Confiar en el `x-user-id` que pisa el gateway no es nuevo: es el mismo supuesto de las rutas de cliente que ya existen (`/legacy-api/v1/mobile-onboarding/…`). El gateway llega a legacy-backend por el ALB interno y pisa `x-user-id` con `$context.authorizer.internal_id` (knowledge/infrastructure-changes/rules.md:52-60). El PR deja escrito ese supuesto en Modules/MobileV1/routes/api.php:727-728 (diff) y en el docblock de CreateEcommerceStoreLinkService (diff:526). Que `/api/v1/mobile/*` se pueda alcanzar o no sin pasar por el gateway depende de la infraestructura (infrastructure#245/#246) y vale igual para MobileOnboardingV1. Además, lo peor que pasa si se falsifica es una atribución analítica equivocada: no da acceso a datos.

## FUERA DE ALCANCE · baja — El token se puede reusar con cualquier pedido del comercio durante 2 horas

`Modules/MobileV1/App/Support/AppHandoffToken.php:624` · goldfish · riesgos

El token sólo lleva usuario, comercio y vencimiento. No se ata al pedido ni se gasta al usarlo. Si el enlace `/ecommerce/app/go?t=…` se comparte (WhatsApp, captura de pantalla, historial) o el comprador hace varias compras en esas dos horas, todos esos pedidos se marcan `mobile_app` con el `app_user_id` de quien generó el enlace. Para analítica es una atribución falsa, y además un tercero queda asociado a pedidos que no hizo.

> Veredicto: Es un límite que el diseño acepta: el token lleva sólo `u`, `a` y `e` (diff:626) y no se ata al pedido. Que el comprador haga varias compras en 2 h y todas se atribuyan a él es lo que se quiere. Un enlace compartido es un caso raro y sólo afecta a la analítica. Se puede escribir como límite en la descripción, pero no frena el PR.

## FUERA DE ALCANCE · baja — Al mergear, los temas ecommerce-context y ecommerce-store-api describen otra versión

`Modules/Onboarding/App/Services/EcommerceRequestService.php` · elephant · contexto

`create` y `by-reference` ahora aceptan `appToken` y escriben `origin_channel`/`app_user_id`, y hay una ruta nueva `app-handoff`. Además la rama no está declarada en ninguna tarea del tablero.

> Veredicto: Es lo de la casa de my-tools (knowledge-touch después del merge y la tarea): no es del PR.

## DESCARTADO · media — «El token no llega a logs» no se cumple para la URL `?t=` del wizard

`Modules/MobileV1/App/Services/CreateEcommerceStoreLinkService.php:567` · goldfish · propuesta vs cambio

La propuesta dice que el token no llega a spans, logs ni respuestas. En el backend eso vale para `create`, `by-reference` y `app-handoff`. Pero el propio cambio arma la URL `{FRONTEND_URL}/ecommerce/app/go?t=<token>&a=...`, una petición GET con el token en la query. Esa URL queda en los access logs del frontend y del CDN, en el historial del WebView y en lo que registre la app. El token sirve dos horas para marcar pedidos con ese usuario. Hay que aclarar que la afirmación cubre solo los logs del backend, o decir por qué la exposición en la URL es aceptable.

> Veredicto: La frase de la propuesta habla de los endpoints del backend que reciben el token (`create`, `by-reference`, `app-handoff`), y ahí se cumple: `$request->except('appToken')` (diff:830) y `openAppHandoffFacade` no lo registra (diff:864-906). Que el token viaje en la query de `/ecommerce/app/go` es el diseño del enlace. Además el token sólo sirve para marcar analítica durante 2 h: no autentica nada.

## DESCARTADO · media — `no_token` se escribe en todos los pedidos de todos los comercios, no solo de los que tienen tienda en la app

`Modules/Onboarding/App/Repositories/EcommerceRequestRepository.php:776` · goldfish · propuesta vs cambio

`markAppOrigin` corre en cada `create` y cada `by-reference` sin mirar si el comercio tiene `app_ecommerce_url`. Desde el despliegue todo pedido nuevo de un comercio sin presencia en la app queda en `no_token`. La propuesta presenta `no_token` como «sin dato de app» pero no dice que también abarca a comercios donde la app no puede llegar. Para el reporte "pedidos que nacen en la app" importa: el denominador de `no_token` mezcla los dos casos. Además la propuesta da por hecho que los reportes muestran `no_token` aparte y nunca lo suman a web, pero eso no está en este diff.

> Veredicto: Es el diseño, y la propuesta lo define así: `no_token` es «sin dato de app» y «no afirma que la compra fue web». Para quedarse con los comercios con tienda en la app, el reporte filtra por `allieds.app_ecommerce_url`. Que los reportes muestren `no_token` aparte es del lado del reporte, no de este PR.

## DESCARTADO · media — La primera apertura sin token deja el pedido en `no_token` para siempre

`Modules/Onboarding/App/Repositories/EcommerceRequestRepository.php:776` · goldfish · riesgos

`markOriginChannel` sólo escribe si `origin_channel` es NULL, y `upsert` usa `updateOrCreate` por order_key, order_identifier y comercio, así que reutiliza la fila. Si la primera vez que se llama a `create/{hash}` o a `by-reference` no llega el `appToken`, el pedido queda en `no_token` y ya no cambia. Eso pasa si el comercio o su servidor llaman a `create` antes de que el navegador del comprador abra el wizard, si hay un render del lado del servidor que no reenvía la cookie, o si el comprador abrió el mismo pedido primero en otro navegador. La compra después se hace desde la app, pero no se atribuye. El diseño lo acepta, pero nada en el código ni en las pruebas confirma que la primera llamada sea siempre la del navegador con la cookie, y el sesgo va justo contra lo que se quiere medir.

> Veredicto: duplicado del 5

## DESCARTADO · baja — Supone que `app.frontend_url` apunta al wizard

`Modules/MobileV1/App/Services/CreateEcommerceStoreLinkService.php:567` · goldfish · propuesta vs cambio

El enlace se arma con `config('app.frontend_url')` más `/ecommerce/app/go`. La propuesta lo escribe como `{FRONTEND_URL}` pero no confirma que esa variable ya exista en todos los entornos y que apunte al dominio del wizard que tiene la ruta nueva (y no a otro frontend). Si está vacía, la URL sale relativa y la app no la puede abrir.

> Veredicto: `app.frontend_url` existe en config/app.php:60 (origin/qa), con default `https://originaciones.dev.creditop.com`, el dominio del wizard. Ya lo usan para armar enlaces del wizard EcommercePaymentLinkService, EcommerceContractBuilder, CosignerInvitationLinkBuilder y otros (git grep en origin/qa): está puesto en todos los ambientes y apunta al wizard.

## DESCARTADO · baja — `app-handoff` es público, sin autenticación ni throttle, y consulta la base en cada llamada

`Modules/Onboarding/routes/api.php:1011` · goldfish · riesgos

La ruta nueva no tiene throttle porque la llama el servidor del wizard por todos los compradores. Pero no hay nada que limite a otros llamadores. Cualquiera puede recorrer `alliedId` de 1 en adelante y obtener el `app_ecommerce_url` de cada comercio. Esto incluye a los que tienen `is_available_in_app` apagado, porque ese flag no se revisa. Cada llamada además hace un SELECT sobre `allieds` en la RDS compartida. El HMAC protege el token, pero no protege la carga ni la enumeración.

> Veredicto: `app_ecommerce_url` es la URL pública de la tienda del comercio: se ve en la app y en internet, así que enumerarla no expone nada sensible. Cada llamada es un SELECT por clave primaria sobre `allieds`. `create/{partner_id}`, en el mismo grupo, tampoco tiene throttle (Modules/Onboarding/routes/api.php:235 en origin/qa). Agregar un throttle sería una mejora aparte.

## DESCARTADO · baja — La regla de las descripciones de PR se cumple

elephant · contexto

La descripción no nombra herramientas internas, cita un PR por repo (legacy-backend, frontend-monorepo, infrastructure dev y prod, creditop_mobile) y el diff no corre la suite ni `migrate:fresh`. La migración es aditiva e idempotente (`hasColumn`).

> Veredicto: No hay nada que corregir: se anota sólo para cerrar la parte 2.

---

## La descripción que se revisó

### feat(ecommerce): marcar los pedidos que la app abre en la tienda del comercio

## Contexto

Queremos saber qué pedidos de ecommerce nacen en la app y terminan desembolsados. Hoy no hay forma de distinguirlos. `ecommerce_requests.origin` dice cómo se creó el pedido y `is_app` es el código de cliente canjeado en tienda, ninguno dice por dónde entró el comprador.

## Cambio

La app le pide al backend un enlace a la tienda del comercio. El enlace lleva un token firmado con el usuario, el comercio y un vencimiento de dos horas. El wizard valida ese token, deja una cookie y manda al comprador a la tienda. Cuando el comercio lo devuelve al checkout, por payment link o por la URL construida, el wizard reenvía el token y el backend marca el pedido. El comercio no cambia nada.

Endpoint para la app, en MobileV1. El gateway lo publica como `/legacy-api/v1/mobile/ecommerce/store-link` con el `x-user-id` del authorizer.

| ruta | body | respuesta |
|---|---|---|
| `POST /api/v1/mobile/ecommerce/store-link` | `{"merchantId": 81}` | `MBV12000` con `data.url` y `data.expiresAt` |

| código | HTTP | caso |
|---|---|---|
| MBV12000 | 200 | enlace creado, `url` es `{FRONTEND_URL}/ecommerce/app/go?t=<token>&a=<alliedId>` |
| MBV12002 | 422 | body inválido |
| MBV12003 | 404 | comercio inexistente o sin `app_ecommerce_url` https. `is_available_in_app` no se revisa, merchant-api ya filtra con ese flag y CORE-562 borra la columna |
| MBV12004 | 403 | `x-user-id` ausente, inválido o repetido. Es 403 y no 401 porque con 401 la app refresca la sesión y la cierra si se repite |
| MBV12005 | 429 | más de 30 enlaces por minuto por usuario |

Endpoint para el wizard, en Onboarding, con el mismo prefijo y middleware que `create/{hash}`.

| ruta | body | respuesta |
|---|---|---|
| `POST /api/onboarding/ecommerce-request/app-handoff` | `{"token": "...", "alliedId": 81}` | `ERS006` con `data.storeUrl`, `data.valid` y `data.expiresAt` cuando es válido |
| | | `ERS007` 404 si el comercio no tiene tienda, `ERS001` 422 si `alliedId` es inválido |

Un token desconocido, vencido o de otro comercio responde 200 con `valid false`, así la tienda siempre abre.

El token se firma con HMAC SHA-256 igual que `ResetTicket`, payload base64url, punto y firma, máximo 118 caracteres. Se valida en tiempo constante y sin consultar la base. Sin `APP_KEY` o con una llave corta no se firma nada.

`create/{hash}` y `by-reference/{hash}` aceptan un `appToken` opcional. Si es válido y del comercio del pedido escriben `origin_channel = mobile_app` y `app_user_id`. Si no, `no_token`, que no afirma que la compra fue web, porque la cookie se pierde a las dos horas, al cerrar sesión y en versiones de la app sin store-link. `no_token` se muestra aparte en los reportes y nunca se suma a web. Se escribe una sola vez, la primera que el wizard ve el pedido, y nunca se pisa. Un `appToken` mal formado se ignora y no produce error. El token no llega a spans, logs ni respuestas.

Una migración agrega dos columnas nullable a `ecommerce_requests`, `origin_channel` y `app_user_id`. NULL es sin dato, pedidos anteriores, rutas que no llegan a `create` ni a `by-reference`, hoy Corbeta y el checkout propio del monolito, o una marca que falló y quedó en el log `ecommerce.app_origin.failed`. VTEX en legacy-backend sí queda marcado porque el comprador llega al `create` del wizard. Esta marca no alimenta `is_app`, beneficios ni `users.onboarding_channel`.

## PRs relacionados

- legacy-backend https://github.com/Creditop-SAS/legacy-backend/pull/1910
- frontend-monorepo https://github.com/Creditop-SAS/frontend-monorepo/pull/1409
- infrastructure development https://github.com/Creditop-SAS/infrastructure/pull/245
- infrastructure prod https://github.com/Creditop-SAS/infrastructure/pull/246
- creditop_mobile https://github.com/Creditop-SAS/creditop_mobile/pull/301


