---
id: 131
title: "Ecommerce mobile: medir las compras de la tienda virtual que salen de la app"
stage: work
created: "2026-11-17T12:00:00-05:00"
knowledge: [ecommerce-context]
jira: [CORE-982]
jira_title: "Ecommerce mobile: medir las compras de la tienda virtual que salen de la app"
---

## Pendientes

- [x] ~~Crear el issue en Jira~~ — [CORE-982](jira:CORE-982), sprint activo, en progreso (2026-11-17).
- [x] ~~Verificar contra el código lo que afirma Kevin~~ — confirmado contra la rama de los PRs, merchant-api y prod
      (2026-11-18, bloque de la pila).
- [x] ~~Revisar los PRs con Goldfish cuando Kevin suba `no_token`, el gate y el artifact~~ — backend y frontend
      revisados el 2026-11-18; los informes están en `artifacts/`.
- [ ] Mandarle a Kevin la segunda respuesta (borrador abajo, en «Respuesta propuesta»). Termina con el mensaje en el
      hilo de Slack: el texto se confirma antes de mandarlo, sale a nombre de Miguel.
- [ ] Revisar los PRs cuando Kevin corrija: orden de despliegue escrito, la cookie `ct_app` borrada (o el límite
      escrito), pruebas de `AppHandoffToken::verify` y de la marca, `max(1, …)` en el límite por minuto. Termina con
      los cuatro puntos vistos en el diff. Depende de: Kevin.
- [ ] Actualizar CORE-982 con los valores reales del origen (`mobile_app`, `no_token`, vacío). La publicable ya está
      corregida; falta pasarla a Jira con `make jira-edit`, después de que Miguel la vea.
- [ ] Preguntarle a Kevin si tiene su propio ticket para este trabajo y enlazarlo con CORE-982. Depende de: Kevin.
- [ ] Confirmar quién de producto decide volver a mostrar la tienda virtual quitada en TT-230 y que la decisión quede
      escrita en el hilo o en el ticket. Hasta entonces `ff_virtual_store` sigue apagado y no se carga
      `app_ecommerce_url` de los comercios 81 y 94. Con el flag prendido también aparece el 271 (La Solar), el único
      con URL en prod. Depende de: producto.

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

La primera respuesta (aceptar `no_token`, el gate y el artifact) ya está cubierta por los cambios de Kevin. Ésta es la
segunda, después de revisar los PRs:

> Buenas Kevin, revisé los cuatro PRs con los cambios y quedó muy bien: `no_token`, el gate apagado por defecto y
> store-link sin `is_available_in_app`. También confirmé que la marca compara contra el comercio, lo de VTEX y que la
> app abre el enlace en su WebView, así que la cookie llega al checkout.
>
> Me quedan cuatro cositas antes de aprobar:
> 1. **Orden de despliegue** en las descripciones: migración → backend → gateway → wizard → app. Si el wizard sale
>    antes que el backend, todo enlace cae en «No encontramos la tienda»; si el backend sale antes que la migración,
>    cada pedido deja un `ecommerce.app_origin.failed`.
> 2. **La cookie `ct_app` no se borra al usarla**: durante 2 h, cualquier otro pedido del mismo comercio en ese
>    navegador sale `mobile_app`, y el número deja de ser un piso. Propongo expirarla en el checkout después de mandar
>    el `appToken` (la marca ya quedó con el primer toque).
> 3. **Pruebas** para `AppHandoffToken::verify` (formato, firma, vencimiento, otro comercio) y para `markOriginChannel`
>    (primer toque), sin `RefreshDatabase`.
> 4. `MOBILE_STORE_LINK_RATE_LIMIT_PER_MINUTE` vacío da `perMinute(0)` y un 429 para todo: un `max(1, …)` lo blinda.
>
> Menor: a las tablas de códigos les faltan `MBV12001` y `ERS000`. Y un dato: en prod el único comercio con
> `app_ecommerce_url` es el 271 (La Solar, apunta a `aliados.creditop.com/evento/la-solar`), así que al prender el
> flag es el primero que va a mostrar la tienda virtual.

## Afirmaciones de Kevin (verificadas)

Comprobadas el 2026-11-18 contra la rama de los PRs, merchant-api y prod; el detalle está en la pila. La de
`EcommerceRequestRepository.php:104` (`web`) ya no aplica: ahora escribe `no_token`.

- `EcommerceRequestService.php:653` compara el token contra `ecommerce_requests.allied_id` (rama del PR).
- merchant-api `merchant.sql:16` lee `allieds.app_ecommerce_url` y con NULL devuelve `physical_only`.
- `EcommerceRequestRepository.php:104` escribe `web` en el primer toque sin token.
- `VtexService::init` crea la fila de `ecommerce_requests` y el create del wizard la actualiza por `order_key` (:569).
- Las tres credenciales VTEX son sucursales de prueba del comercio 24 (`bin/pg sql --target prod`).
- Pullman: las tres sucursales ecommerce son del comercio 94; sólo 1 de 396 comercios tiene `app_ecommerce_url` en prod.
- `virtual_store_opened` no se dispara desde TT-230 (`creditop_mobile`, `app_router.dart:2173`, 1.57.3).

## Tarea (publicable)

## En una línea

Marcar los pedidos de ecommerce que salen de la app de CreditOp, para medir cuántas compras de la tienda virtual
vienen de la app.

## Por qué

Más adelante la tienda del comercio va a ir embebida en la app y hay que saber qué compras salen de ahí. Hoy un pedido
que entra por la tienda no dice si el comprador llegó desde la app o desde la web. El número que se obtenga es un piso:
sirve para medir, no para comisionar ni para atribuir ventas a un comercio.

## Qué cambia

- La app pide un enlace firmado a la tienda del comercio. Al abrirlo, el flujo de financiación guarda una marca en el
  navegador del comprador (cookie, válida 2 horas).
- Cuando el comprador vuelve al checkout de la tienda y entra al flujo de financiación, el pedido queda marcado con su
  origen.
- Valores del origen: `mobile_app` (llegó con el enlace de la app), `no_token` (abrió el flujo sin la marca; no se
  afirma que sea web) y vacío para los pedidos que no pasan por el flujo nuevo.
- La entrada a la tienda virtual en la app queda detrás del flag `ff_virtual_store`, apagado hasta que producto
  confirme volver a mostrarla (se había quitado en TT-230).

## Alcance

- Entra: pedidos que pasan por el flujo de financiación nuevo (tiendas por enlace de pago, VTEX y Shopify).
- No entra: los comercios que siguen en el checkout anterior ni la entrada por QR de Corbeta (quedan vacíos).
- No entra: elegir a cuál tienda entra el usuario cuando un comercio tiene varias (Pullman tiene tres). Queda como
  decisión de producto.
- No se usa para comisionar.
- Se pierde la marca: si pasan más de 2 horas entre el enlace y el checkout, si se cierra sesión, si se abre otro
  enlace después, si la tienda abre el checkout en otra ventana o en el navegador del sistema, o con versiones de la
  app sin el enlace firmado.

## Dónde probar

QA: app apuntando a QA, con un comercio que tenga cargada la URL de su tienda en la app y el flag encendido sólo para
la prueba.

## Cómo validar

1. Desde la app, abrir la tienda del comercio y comprar financiando con CreditOp: el pedido queda marcado `mobile_app`.
2. Abrir el mismo checkout desde la web, sin pasar por la app: el pedido queda `no_token`.
3. Abrir el enlace desde la app y esperar más de 2 horas antes de pagar: el pedido queda `no_token`.
4. Un pedido de un comercio en el checkout anterior: el origen queda vacío.
5. El reporte de compras desde la app cuenta por solicitud original, solicitud actual y solicitudes recreadas, y no
   suma `no_token` a web.

## Cambios en datos

Dos columnas nuevas en los pedidos de ecommerce: el origen y cuándo se marcó.

## Criterios de aceptación

- Un pedido iniciado desde la app queda marcado `mobile_app`; uno sin la marca queda `no_token`, nunca `web`.
- Con el flag apagado la app no muestra la entrada a la tienda virtual.
- El flag no se enciende en producción ni se carga la URL de la tienda de los comercios 81 y 94 hasta que producto lo
  confirme y se mida cuántos usuarios siguen en versiones de la app anteriores a la 1.50.
- La definición de cada valor del origen y los casos en que se pierde la marca quedan escritos en la documentación del
  flujo.

## Dependencias / contraparte

- Kevin Gamez: desarrollo en backend, flujo de financiación e infraestructura.
- Producto: confirmar si vuelve la entrada a la tienda virtual en la app y cómo se elige la tienda cuando un comercio
  tiene varias.

