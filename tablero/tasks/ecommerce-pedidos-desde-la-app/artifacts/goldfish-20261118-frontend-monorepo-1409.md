# Goldfish · Creditop-SAS/frontend-monorepo #1409 · feat(wizard): entrada desde la app con cookie ct_app y marca en el checkout

- PR: https://github.com/Creditop-SAS/frontend-monorepo/pull/1409 (de kevingamez, rama `feat/ecommerce-app-origin`)
- Commit validado: `d374f564d8` contra `origin/qa`
- Corrida: 2026-11-18T15:11:18-05:00 → 2026-11-18T15:15:28-05:00 · costo equivalente: US$2.23

**14 hallazgos**: 2 confirmados · 1 plausibles · 9 descartados · 0 sin veredicto

## Impacto: MEDIO

Sin modelo: sale del diff, de la historia de la base y de lo que my-tools ya sabe. 8 archivos, +163 −7 · apps/loan-request-wizard.

- `apps/loan-request-wizard/app/routes.ts` viene con 16 arreglos en 90 días
- toca archivos de 1 trampa(s) ya vividas: mirá si este cambio las arregla o las vuelve a pisar
- toca lo que explican 6 sección(es) de knowledge

**Trampas ya vividas en estos archivos** (`knowledge/traps/traps.md`):

- F-54 · La entrada por ecommerce existe y funciona — pero hoy solo resuelve Bancolombia — apps/loan-request-wizard/app/routes/ecommerce/checkout.tsx

**Lo que explica knowledge de estos archivos**:

- `ecommerce-context#el-contrato-se-deserializa-antes-de-validar-la-credencial` · El contrato se deserializa antes de validar la credencial
- `ecommerce-context#el-link-volver-a-la-tienda-prefiere-backurl` · El link «Volver a la tienda» prefiere backUrl
- `ecommerce-context#el-pedido-se-relee-por-id-antes-y-despues-del-otp` · El pedido se relee por id antes y después del OTP
- `origination-paths#canal-por-donde-entra-la-solicitud` · Canal: por dónde entra la solicitud
- `origination-paths#tramo-comun-hasta-el-listado` · Tramo común: hasta el listado
- `purchase-code-lifecycle#entrada-y-emisor` · Entrada y emisor

**Los archivos que más pesan** (dependen de ellos · commits y arreglos en 90 días):

- `apps/loan-request-wizard/app/routes.ts` · lo nombran 3 · 45 commits, 16 arreglos
- `apps/loan-request-wizard/app/routes/ecommerce/checkout.tsx` · 9 commits, 4 arreglos
- `apps/loan-request-wizard/app/utils/posthog-logging.ts` · lo nombran 5
- `apps/loan-request-wizard/app/entry.server.tsx` · 2 commits, 1 arreglos
- `apps/loan-request-wizard/app/utils/debug-log-context.server.ts` · lo nombran 3

«Lo nombran» cuenta archivos de la base, sin pruebas ni migraciones, que mencionan el nombre de la clase o lo importan: una aproximación.

**Después de mergear**:

- releer las secciones de knowledge que toca y actualizarlas si cambió la regla (`make knowledge-touch F='frontend-monorepo:origin/qa..<merge>'`)
- después del despliegue, `bin/sentinel deploy frontend-monorepo`: las señales antes y después contra lo normal de esa franja

---

## CONFIRMADO · media — La cookie ct_app no se borra al usarla y puede marcar varios pedidos

`apps/loan-request-wizard/app/routes/ecommerce/checkout.tsx:174` · goldfish · propuesta vs cambio

El checkout lee `ct_app` y la manda como `appToken`, pero no la expira después. Durante su vida (hasta dos horas) cualquier pedido hecho en ese navegador, incluso de otro comercio o sin pasar por la app, sale con el `appToken`. La propuesta sólo cuenta que se borra cuando llega un link nuevo sin marca válida. No dice que el token se puede reusar ni que legacy tiene que rechazarlo si el `partner_hash` es de otro comercio o si el token ya se usó. Si legacy no lo controla, se marcan como abiertos desde la app pedidos que no lo fueron.

> Veredicto: Lo que falta es contarlo en la descripción, no cambiar el código. checkout.tsx:158 y :174 reenvían `ct_app` en cada pedido y no la borran. Legacy (PR 1910) acota el daño: `AppHandoffToken::verify` revisa la firma, que el token sea del aliado del pedido y que no esté vencido (Modules/MobileV1/App/Support/AppHandoffToken.php:32,40-41). Un pedido de OTRO comercio lo ignora en silencio y queda `no_token`. Pero el token NO es de un solo uso: no hay tabla de consumo desde 2e04b8bf8. Entonces, mientras viva la cookie, cualquier otro pedido del MISMO aliado en ese navegador sale marcado como de la app. La marca es first-touch (EcommerceRequestRepository.php:98-107). Si esa atribución está bien para producto, hay que escribirlo. Si no, el checkout debería borrar la cookie al usarla.

## CONFIRMADO · media — No dice en qué orden se despliega ni qué hacen los PRs de infraestructura

goldfish · propuesta vs cambio

`go` llama a `ecommerce-request/app-handoff`. Si legacy (PR 1910) no está desplegado, ese endpoint responde 404 y todo link de la app cae en la página «No encontramos la tienda». Además, `create` y `by-reference` empiezan a recibir el campo `appToken`. La propuesta lista dos PRs de infraestructura (development y prod) sin contar qué cambian (¿rutas, ingress, variables?) ni si este PR depende de ellos. Quien despliegue no sabe en qué orden hacerlo.

> Veredicto: Lo que falta es contarlo en la descripción. Si este PR se despliega antes que legacy#1910, app-handoff no existe y responde 404. go.tsx (`if (response.status === 404) return null`) lo convierte en no-store, así que todo link de la app muestra «No encontramos la tienda». En la otra dirección no hay problema: `appToken` en create/by-reference es un campo extra que el legacy viejo no lee. Orden: legacy#1910 primero, después este. También hay que decir qué cambian infrastructure#245/#246 y si este PR depende de ellos.

## PLAUSIBLE · media — Supuesto no escrito: la app y el checkout tienen que compartir las cookies del navegador

`apps/loan-request-wizard/app/routes/ecommerce/go.tsx:126` · goldfish · propuesta vs cambio

La cookie la deja `go` y la lee el checkout, que llega desde la tienda del comercio. Eso sólo sirve si la app abre `/ecommerce/app/go` en el mismo navegador donde el comprador después compra. Si la app usa un webview o una pestaña con otro almacén de cookies, la cookie no llega al checkout. También tiene que ser una navegación de primer nivel (SameSite=Lax): si el checkout se carga en un iframe, la cookie no viaja. Ninguna de las dos condiciones está escrita y el PR de `creditop_mobile` aparece listado sin explicar cómo abre el link.

> Veredicto: Es cierto que la marca sólo llega si la app abre `/ecommerce/app/go` en el mismo almacén de cookies donde después se compra: go.tsx deja la cookie en el host del wizard y checkout.tsx:174 la lee de ese request. Para saberlo hay que ver el PR creditop_mobile#301: ¿abre el link en el navegador del sistema o en una pestaña compartida (SFSafariViewController / Custom Tabs), o en un WebView aislado? Con un WebView propio, la tienda y el checkout tienen que pasar por ese mismo WebView. Conviene escribir ese supuesto en la descripción.

## FUERA DE ALCANCE · baja — El parámetro t del checkout se sigue mandando a PostHog desde el navegador

`apps/loan-request-wizard/app/routes/ecommerce/checkout.tsx:135` · goldfish · propuesta vs cambio

La propuesta dice que `t` «se redacta en los logs de error del servidor y en PostHog». Pero si `fetchCheckout` falla, el checkout lanza un 502 y la página de error se pinta en la URL con `?t=<credencial del comercio>`. Ahí posthog-js manda el `$pageview` con la URL completa, el mismo problema que en `go` se resolvió redirigiendo a no-store. La redacción sólo cubre los logs del servidor, así que la frase promete más de lo que el cambio hace.

> Veredicto: El checkout ya recibía la credencial del comercio en `?t=` antes de este PR (`token: q.get("t")`, igual en origin/qa). El `$pageview` de la página de error 502 con esa URL tampoco es nuevo. Este cambio sólo agrega la redacción en el servidor. Si se quiere, se puede precisar la frase de la descripción («en los logs del servidor que van a PostHog»).

## FUERA DE ALCANCE · baja — Los tests se sacaron en un commit del PR y la propuesta no lo dice

goldfish · propuesta vs cambio

El commit 636e5c634 dice «drop its tests» y el PR queda sin tests para la ruta `go`, para `appTokenOf` ni para la redacción. Esto importa porque `go` tiene varias ramas de seguridad (open redirect, borrado de la cookie, cookies duplicadas) que la propuesta presenta como garantías. La descripción no menciona que no tienen cobertura.

> Veredicto: Es cierto que 636e5c634 sacó los tests y que el PR no tiene cobertura para go, appTokenOf ni redactUrl/redactJsonBody. Pero nadie pidió agregar tests y no es condición para publicar. Es una mejora y no frena el PR.

## DESCARTADO · media — La cookie ct_app no se borra al usarse en el checkout

`apps/loan-request-wizard/app/routes/ecommerce/checkout.tsx:171` · goldfish · riesgos

`go.tsx` deja `ct_app` con hasta 2 horas de vida, pero `checkout.tsx` sólo la lee con `appTokenOf(request)` y nunca la borra. Durante esa ventana, cualquier otro checkout en el mismo navegador manda el mismo `appToken`: una segunda compra en el mismo comercio hecha sin pasar por la app, o una compra en otro comercio que use el mismo wizard. Todos esos pedidos quedarían marcados como abiertos desde la app. El borrado de "cada salida sin marca nueva" sólo pasa en `go`. Que el pedido no quede mal marcado depende de que legacy rechace el token cuando el comercio no coincide o cuando ya se usó, y este PR no lo garantiza.

> Veredicto: Duplicado del 2.

## DESCARTADO · media — SameSite=Lax no viaja si el checkout llega por POST o dentro de un iframe

`apps/loan-request-wizard/app/routes/ecommerce/go.tsx:126` · goldfish · riesgos

Con `SameSite=Lax`, el navegador sólo manda la cookie en navegaciones top-level con GET desde otro sitio. Hay casos en que la plataforma no llega así: un formulario POST del gateway, un iframe o modal del checkout (VTEX o Shopify), o un fetch del lado del comercio. En esos casos `ct_app` no llega, `appTokenOf` devuelve `{}` y el pedido queda sin marca, sin ningún error ni log que lo muestre. Hay que confirmar en cada plataforma cómo se carga `create/{hash}` y `by-reference/{hash}`.

> Veredicto: checkout.tsx sólo exporta `loader`, así que se llega por un GET de primer nivel. Un POST daría 405 y no crearía el pedido; no es que lo cree sin marca. Meter el wizard en un iframe dentro de la tienda no funciona por diseño, así que las plataformas redirigen con un GET de primer nivel, y ahí SameSite=Lax sí manda la cookie. Lo que queda (webview o almacén de cookies) es el 3.

## DESCARTADO · baja — Las URLs http://localhost no terminan en no-store, aunque la descripción dice que sí

`apps/loan-request-wizard/app/routes/ecommerce/go.tsx:151` · goldfish · propuesta vs cambio

La tabla dice que una `storeUrl` que no es https manda a `/ecommerce/app/no-store`. El código también acepta `http:` cuando el host es `localhost` (`isSafeStore`) y en ese caso deja la cookie y redirige. Esto no depende de `APP_ENV`, así que también pasa en producción si el backend devuelve una tienda así. El riesgo es bajo, pero la descripción no cuenta la excepción.

> Veredicto: La rama http://localhost de `isSafeStore` (go.tsx, loader) nunca se usa: legacy (PR 1910 @92a3b2274) sólo devuelve una tienda https. `ALLOWED_SCHEME = 'https'` es una constante y no se puede cambiar por config (Modules/AlliedV1/App/Constants/GetAlliedAppStoreServiceConstants.php; GetAlliedAppStoreService.php:55-70). Con http, app-handoff responde 404 ERS007 (EcommerceRequestService.php:228-229), y go.tsx lo convierte en `null` y manda a no-store. En producción no puede pasar. Como mucho, es una tolerancia local que se podría quitar.

## DESCARTADO · baja — El cambio de logs afecta a todas las llamadas al backend y descarta los bodies que no son JSON

`apps/loan-request-wizard/app/utils/debug-log-context.server.ts:79` · goldfish · propuesta vs cambio

`getBackendRequestDebugMetadata` ahora pasa por `redactJsonBody` todos los bodies de las llamadas al backend que fallan, no sólo los del handoff. Si el body no es JSON, o se cortó en 10.000 caracteres, ya no se loguea nada. Además se redactan claves como email, phone, document y address donde antes se veía el valor. La propuesta sólo dice que los bodies se redactan; no avisa que se pierde información de depuración en llamadas que no tienen nada que ver con este cambio.

> Veredicto: Es una decisión hecha a propósito y está escrita en el código (debug-log-context.server.ts, comentario de `redactJsonBody`: «Un body no JSON, o cortado… se descarta entero»). Antes, `getBackendRequestDebugMetadata` mandaba a PostHog los bodies SIN redactar, con token, teléfono y documento: `flattenAttributes` (posthog-logging.ts) redacta por clave, no dentro de un string. Perder los bodies que no son JSON o los mayores de 10k es el costo de dejar de filtrar datos personales. Las llamadas del wizard al backend son JSON. No frena el PR.

## DESCARTADO · baja — `expiresAt` sin zona horaria da un Max-Age incorrecto

`apps/loan-request-wizard/app/routes/ecommerce/go.tsx:157` · goldfish · riesgos

`Date.parse(handoff.expiresAt)` toma una fecha sin offset (por ejemplo `2026-11-18 15:00:00`) como hora local del servidor. Si legacy la manda en hora de Colombia y el servidor corre en UTC, el resultado se corre 5 horas en un sentido o en el otro. Si queda en el pasado, `maxAge <= 0` y el token válido no deja cookie, así que el pedido sale sin marca. Si queda en el futuro, la cookie dura las 2 horas del tope aunque el token venza antes. El esquema zod sólo pide `z.string()` y no valida el formato.

> Veredicto: Legacy manda `expiresAt` con `gmdate('Y-m-d\TH:i:s\Z', …)`, en ISO 8601 UTC con `Z` (EcommerceRequestService.php:243 en PR 1910). `Date.parse` lo lee bien sin importar la zona del servidor.

## DESCARTADO · baja — Los bodies a backend que no son JSON ya no se registran

`apps/loan-request-wizard/app/utils/debug-log-context.server.ts:189` · goldfish · riesgos

`redactJsonBody` devuelve `undefined` cuando el body no es JSON o cuando quedó truncado por el tope de 10.000 caracteres. Antes esos bodies se registraban, aunque sin redactar. Ahora un fallo con un body form-encoded o muy grande llega a PostHog sin body. Además, el patrón sensible incluye `pin` y `address`, que también tapan llaves como `shipping` o `shippingAddress`. Ninguna de las dos cosas rompe nada, pero se pierde información para depurar sin que nadie lo note.

> Veredicto: Duplicado del 5. Sobre que `pin` tape `shipping`: es el patrón que ya existía (SENSITIVE_ATTRIBUTE_KEY_PATTERN en posthog-logging.ts) y se aplica igual en todos los atributos de log.

## DESCARTADO · baja — Nada de lo nuevo tiene pruebas

`apps/loan-request-wizard/app/server/services/ecommerce-app-handoff.server.ts:205` · goldfish · riesgos

El diff no agrega pruebas para el loader de `go`: parámetros repetidos, `alliedId` fuera de rango, `storeUrl` http o mal formada, token válido o inválido y cálculo de `Max-Age`. Tampoco para `appTokenOf` con cookies duplicadas o mal formadas, ni para `redactUrl` y `redactJsonBody`. Son las piezas que deciden si el token se escapa a los logs o si la cookie queda puesta, y una regresión ahí pasaría sin que nada falle.

> Veredicto: Duplicado del 7.

## DESCARTADO · baja — La trampa F-54 que marca el mapa no aplica

`apps/loan-request-wizard/app/routes/ecommerce/checkout.tsx:174` · elephant · contexto

F-54 habla de la entrada por ecommerce de Corbeta, que sólo resuelve Bancolombia. Este cambio no toca cómo se resuelve la entidad: sólo agrega `appToken` al body de create/by-reference (checkout.tsx:158,174) y deja intacto el resto del loader. No la pisa ni la arregla.

> Veredicto: El diff no toca la puerta de Corbeta ni el listado de entidades.

## DESCARTADO · baja — La descripción cumple las reglas de PR

elephant · contexto

No nombra herramientas internas, deja un PR por repo y lista los relacionados (legacy#1910, infrastructure#245/#246, creditop_mobile#301). Lo único que falta es el orden de despliegue, que ya está en el hallazgo 4.

> Veredicto: Las reglas se cumplen. Se anota sólo para cerrar la parte 2.

---

## La descripción que se revisó

### feat(wizard): entrada desde la app con cookie ct_app y marca en el checkout

## Contexto

La app necesita mandar al comprador a la tienda del comercio y que, cuando vuelva al checkout, el pedido quede marcado como abierto desde la app. El comercio no puede llevar parámetros y el checkout descarta los que no conoce. Lo único que sobrevive al paso por la tienda es una cookie del host del wizard.

## Cambio

Ruta nueva `GET /ecommerce/app/go?t=<token>&a=<alliedId>`, registrada a nivel raíz para que `:flow/:partner_hash` no la capture. Manda el token y el comercio a `ecommerce-request/app-handoff` en legacy, deja la cookie `ct_app` y responde 302 a la `storeUrl` que devuelve el backend. El token viaja solo en la cookie, el comercio nunca lo ve. El destino nunca sale del query, así que no hay open redirect.

| caso | respuesta |
|---|---|
| token válido | 302 a la tienda, cookie `ct_app` HttpOnly, SameSite Lax, Path /, Max-Age hasta `expiresAt` con tope de dos horas, Secure fuera de `APP_ENV` local |
| token vencido, desconocido o de otro comercio | 302 a la tienda y cookie borrada |
| parámetros mal formados, comercio sin tienda, backend caído o `storeUrl` que no es https | 302 a `/ecommerce/app/no-store`, página 404 sin el token en la URL, cookie borrada |

El checkout lee `ct_app`, valida la forma del token y lo reenvía como `appToken` en los bodies de `create/{hash}` y `by-reference/{hash}`. Sin cookie, o con una mal formada o duplicada con valores distintos, no manda nada. La lógica de `_session` y de `erId` no cambia.

Los bodies que van a PostHog en respuestas fallidas se redactan con la lista de llaves sensibles que ya existía, así el token y el `token` del comercio dejan de llegar a los logs.

El parámetro `t` de la URL se redacta en los logs de error del servidor y en PostHog. En `go` lleva el token firmado y en el checkout la credencial del comercio, y un POST a `go` terminaba en un 405 que registraba la URL completa.

## PRs relacionados

- legacy-backend https://github.com/Creditop-SAS/legacy-backend/pull/1910
- frontend-monorepo https://github.com/Creditop-SAS/frontend-monorepo/pull/1409
- infrastructure development https://github.com/Creditop-SAS/infrastructure/pull/245
- infrastructure prod https://github.com/Creditop-SAS/infrastructure/pull/246
- creditop_mobile https://github.com/Creditop-SAS/creditop_mobile/pull/301


