---
id: 131
title: "Ecommerce: marcar los pedidos que salen de la app (revisión del trabajo de Kevin)"
stage: evaluation
created: "2026-11-17T12:00:00-05:00"
knowledge: [ecommerce-context]
canon: []
jira: []
jira_title: "Ecommerce: marcar los pedidos que salen de la app"
---

## Pendientes

- [ ] Mandarle a Kevin la respuesta (borrador abajo, en «Respuesta propuesta») o ajustarla. Termina con el mensaje
      en el hilo de Slack: el texto se confirma antes de mandarlo, sale a nombre de Miguel.
- [ ] Conseguir el ticket de Jira de Kevin y ponerlo en `jira:`.
- [ ] Verificar contra el código lo que afirma Kevin (sin verificar todavía; ver «Afirmaciones de Kevin por verificar»).
      Termina con un veredicto por afirmación (`main-verifier` para `main`, y las ramas de los PRs para lo nuevo).
- [ ] Revisar los PRs cuando Kevin suba `no_token`, el gate y el artifact corregido: correr Goldfish
      (`make goldfish-run PR=<url>`) sobre los tres y anotar el veredicto en la pila.
- [ ] Confirmar quién de producto decide volver a mostrar la tienda virtual quitada en TT-230 y que la decisión quede
      escrita en el hilo o en el ticket. Hasta entonces `ff_virtual_store` sigue apagado y no se carga
      `app_ecommerce_url` de los comercios 81 y 94.

## Objetivo

Kevin construyó la marca de los pedidos de ecommerce que salen de la app: la app pide al backend un enlace firmado a
la tienda, el wizard deja una cookie y, cuando el comprador vuelve al checkout, el pedido queda marcado. Esta tarea es
la parte de Miguel: definir con Kevin para qué sirve la marca, revisar los PRs y dejar escrito qué queda fuera.

**Decisión (Kevin, en Slack, 2026-11-17):** la marca es para **medir**. Más adelante el enlace de la tienda va embebido
en la app y se quiere trackear las compras que salen de ahí. Con la cookie el número es un **piso**: sirve para medir,
**no para comisionar**. El botón queda detrás de `ff_virtual_store`, apagado hasta que producto confirme que vuelve la
entrada que se quitó en TT-230.

## PRs de Kevin

- legacy-backend: https://github.com/Creditop-SAS/legacy-backend/pull/1910 — el endpoint que le da a la app el enlace
  firmado, el que usa el wizard para validarlo y la marca en el pedido (dos columnas nuevas).
- frontend-monorepo#1409 (en su mensaje el link de «Wizard» apuntaba por error al de backend): la ruta de entrada que
  deja la cookie y el reenvío en el checkout.
- infrastructure: https://github.com/Creditop-SAS/infrastructure/pull/245
- El flujo completo, en su artifact: https://claude.ai/artifact/NqzcFuLDNLMwFj7W62Zn73

## Puntos revisados con Kevin y cómo quedan

Las observaciones de Miguel (2026-11-17, 12:10) y lo que contestó Kevin:

1. **Sucursal vs comercio.** Ecommerce va por sucursal (hash, credencial, token de payment-link, ruta del checkout),
   pero el token del enlace y `app_ecommerce_url` son por comercio; Pullman tiene 3 sucursales ecommerce con tres
   tiendas. → Kevin: el wizard no compara, sólo reenvía la cookie; el backend compara el token contra
   `ecommerce_requests.allied_id` (`EcommerceRequestService.php:653`), que sale de la sucursal del hash. Las tres
   tiendas de Pullman son del comercio 94, así que se marcan las tres. Lo que no resuelve es **a cuál tienda entra el
   usuario desde la app**; hacerlo por sucursal toca merchant-api, la app, el token y una columna nueva. **Queda como
   pendiente de producto, no de este PR.**
2. **Dos fuentes para la URL de la tienda** (`merchant_url` en la app, `app_ecommerce_url` en el backend; en prod sólo
   1 de 396 comercios la tiene). → Kevin: son la misma: merchant-api lee `allieds.app_ecommerce_url`
   (`merchant.sql:16`) y con NULL devuelve `physical_only`, así que el botón no aparece y no hay fallback. Cargar la
   URL hace que las versiones < 1.50 manden «Utilizar» directo a la tienda sin token: antes de cargarla mide cuántos
   usuarios siguen ahí. store-link lee `is_available_in_app` de la columna de `allieds` que borra CORE-562 (merchant-api
   en develop ya la lee de `allied_flags`): lo saca de store-link. Los fallbacks por timeout o 404 se ven en
   `virtual_store_opened` con `has_app_link = 0`.
3. **Cookie perdida** (la tienda abre el checkout en otra ventana o en el navegador del sistema → el pedido queda como
   web). → Kevin: cierto, `EcommerceRequestRepository.php:104` escribe `web` en el primer toque sin token y no se
   corrige. Propone **`no_token`** en vez de `web`: no afirma web y conserva el denominador (con NULL no se reconstruye,
   porque el wizard no escribe `original_user_request_id`). Se pierde la marca con más de 2 h entre enlace y checkout,
   al cerrar sesión, con otro enlace abierto después y en versiones sin store-link.
4. **Cobertura.** → Kevin: sólo lo que pasa por el wizard. Corbeta (resolve-checkout) y el checkout del monolito quedan
   NULL. VTEX sí queda marcado: `VtexService::init` crea la fila y el create del wizard la actualiza por `order_key` y
   la marca (:569); hoy las tres credenciales VTEX son sucursales de prueba del comercio 24. Shopify Payments App iría
   por payment-link. Corrige el artifact, que decía que no.
5. **Unión por tres lados** para contar desembolsos. → Kevin: su consulta ya une `user_request_id`,
   `original_user_request_id` y la tabla puente (`impl/reporting-query.sql:33-50`). La tarjeta de ventas por canal de
   Metabase sólo une por uno: es de antes.
6. **Alternativa liviana con GA4** (cruzar `virtual_store_opened` con el usuario del pedido). → Kevin: desde la 1.56 la
   app manda `users.id` como `user_id` y hay export a BigQuery, pero `virtual_store_opened` no se dispara en ninguna
   versión con `user_id`: desde TT-230 nada navega a la tienda (`app_router.dart:2173`, 1.57.3). GA4 también necesita
   el PR de la app y cuenta como app a quien abrió en la app y compró por web. Sirve como control mensual.
7. `is_app` vive en `creditop_x_requests_history` y la marca no lo toca. El link del wizard es frontend-monorepo#1409.

Kevin cierra con: «Si están de acuerdo hago no_token, el gate y el artifact».

## Respuesta propuesta (sin mandar)

> Buenas Kevin, gracias, quedó claro. Con el objetivo así (medir, el número es un piso y no se usa para comisionar)
> estamos de acuerdo, dale con los tres: `no_token`, el gate y el artifact.
>
> Dos cosas para que queden escritas en el ticket:
> - **`no_token` no se suma a web** en ningún reporte. Que el artifact diga qué significa cada valor (`app`, `web`,
>   `no_token`, `NULL`) y en qué casos se pierde la marca: más de 2 h, cierre de sesión, otro enlace abierto después,
>   versiones sin store-link, Corbeta y el checkout del monolito.
> - **El flag no se prende ni se carga `app_ecommerce_url` de 81 y 94** hasta que producto confirme que vuelve la
>   entrada que se quitó en TT-230, y después de que midas cuántos usuarios siguen por debajo de la 1.50. Lo de a qué
>   tienda entra el usuario cuando el comercio tiene varias (Pullman) queda como pendiente de producto, no de este PR.
>
> Si la tarjeta de Metabase de ventas por canal se va a usar para este número, toca pasarla a la unión por los tres
> lados como en `reporting-query.sql`. Si no, que quede anotado que esa tarjeta subcuenta.
>
> Cuando subas los cambios, avisame y revisamos los PRs (backend, frontend-monorepo#1409 e infra#245).

## Afirmaciones de Kevin por verificar

Ninguna está verificada todavía; las de `main` van a `main-verifier`, las nuevas contra la rama del PR.

- `EcommerceRequestService.php:653` compara el token contra `ecommerce_requests.allied_id` (rama del PR).
- merchant-api `merchant.sql:16` lee `allieds.app_ecommerce_url` y con NULL devuelve `physical_only`.
- `EcommerceRequestRepository.php:104` escribe `web` en el primer toque sin token.
- `VtexService::init` crea la fila de `ecommerce_requests` y el create del wizard la actualiza por `order_key` (:569).
- Las tres credenciales VTEX son sucursales de prueba del comercio 24 (`bin/pg sql --target prod`).
- Pullman: las tres sucursales ecommerce son del comercio 94; sólo 1 de 396 comercios tiene `app_ecommerce_url` en prod.
- `virtual_store_opened` no se dispara desde TT-230 (`creditop_mobile`, `app_router.dart:2173`, 1.57.3).
