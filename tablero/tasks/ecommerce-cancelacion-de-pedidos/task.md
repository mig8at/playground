---
id: 112
title: "Ecommerce: cancelación de pedidos, el estándar para todas las tiendas"
stage: evaluation
created: "2026-11-09T10:00:00-05:00"
knowledge: [ecommerce-context]
canon: []
chat: [duncan]
jira: [CORE-932]
ramas: "vtex:ecommerce-cancel, legacy-backend:ecommerce-cancelar-pedido, frontend-monorepo:ecommerce-cancelacion, infrastructure:api-gateway-ecommerce-cancel"
jira_title: "Ecommerce: cancelar un pedido de tienda pagado con Creditop, desde la tienda o desde el comprador"
---

## Pendientes

- [ ] Verificar en `main` de los dos monolitos qué código pone hoy una solicitud en 8 «Cancelado» y si ese cambio
      dispara el aviso a la tienda (`webhook_url`); termina con archivo:línea en la pila (subagente `main-verifier`).
- [ ] Decidir hasta qué punto del flujo se puede cancelar: antes de 11 seguro; ¿y con el pagaré ya firmado o la
      entidad ya consultada (rt=1, rt=0 esperando su webhook)? Termina con la regla escrita en «Cómo se ataca».
      Depende de: Producto — el punto sin vuelta.
- [ ] Decidir qué ve el comprador cuando la tienda cancela: el motivo que mande la tienda o un texto nuestro por
      código de motivo. Depende de: Producto — el texto.
- [ ] Decidir cuánto vive un pedido sin terminar (la referencia del link) y alinearlo con las tiendas: VTEX cancela
      el pago a las 6 h (`delayToCancel` del conector), Shopify vence la sesión pendiente a los 3 días.
      Depende de: Producto — el plazo (es el mismo pendiente de la tarea #102).
- [ ] Pieza A · Shopify: la app manda `back_url` a payment-link apuntando a una ruta propia que rechaza la sesión
      (`CANCELLED_PAYMENT`) y devuelve al comprador al `cancel_url` de Shopify. No espera a Producto; termina con
      una compra en `creditop-dev-store` que se cancela desde el wizard y vuelve al checkout. (Va en la #103.)
- [ ] Llevar a `main` las piezas B y D del wizard: «Volver a la tienda» discreto al final de cada pantalla de tienda
      (menos el listado y la de aprobado) y la pantalla «La tienda canceló tu compra», por Pusher y al cargar.
      [frontend-monorepo#1368](https://github.com/Creditop-SAS/frontend-monorepo/pull/1368) está mergeado a `qa`
      (2026-11-09) y Duncan lo validó ahí, también el aviso en vivo; no está en `main`. Termina con el cambio en `main`.
- [ ] Decidir si «Volver a la tienda» CANCELA la solicitud (la deja en 8 y la tienda se entera por el aviso) o sólo
      saca al comprador (la solicitud queda abierta hasta que venza). Termina con la regla en «Cómo se ataca».
      Depende de: Producto — si salir es arrepentirse.
- [ ] Decidir el catálogo de `reason_code` (sin inventario, cancelado por el comercio, vencido, otro) y dónde se guarda
      el motivo en el pedido (columna nueva o clave de `data`). Termina con el catálogo y la migración, si hace falta,
      escritos en «Cómo se ataca».
- [ ] Decidir qué pasa si llega el webhook de una entidad sobre una solicitud ya en 8 (rt=0 o rt=1 que decidió afuera):
      se ignora y se registra, o se reabre. Termina con la regla escrita. Depende de: Producto — junto con el punto sin
      vuelta (es la misma pregunta abierta en la #102 sobre salir de un estado final por webhook).
- [ ] Llevar a `main` la pieza C del backend (`POST /api/ecommerce/orders/{orderKey}/cancel`), con las decisiones de
      Producto aplicadas: [legacy-backend#1888](https://github.com/Creditop-SAS/legacy-backend/pull/1888) está mergeado a
      `qa` (2026-11-09), con el punto sin vuelta provisional en 10 y el catálogo provisional
      `store_cancelled · out_of_stock · expired · other`; no está en `main`. Termina con el cambio en `main` y su
      migración aplicada en producción (a mano, Oscar o Laura).
- [ ] Pieza E · conector VTEX: mergear [vtex#26](https://github.com/Creditop-SAS/vtex/pull/26) (rama `feat/ecommerce-cancel`, subida el 2026-11-09). La 5.2.0
      (con las 5.1.1-5.1.4) está publicada e instalada en `master` de la cuenta `creditop` y Duncan la validó en qa,
      y su código ya está en GitHub. Termina con el PR mergeado y el tag `v5.2.0`.
- [ ] Publicar en el API Gateway de PRODUCCIÓN la ruta `POST /legacy-api/ecommerce/orders/{order_key}/cancel` (desarrollo → el
      backend de qa, `leg-qa`; producción → `legacy-backend.production`), como `payment-link` y `status` en el repo
      `infrastructure`: [infrastructure#213](https://github.com/Creditop-SAS/infrastructure/pull/213). Sin ella el gateway
      contesta 404 aunque el backend la tenga. Desarrollo hecho: #213 mergeado y aplicado el 2026-11-09 (la ruta responde 401
      sin token). Falta producción, cuando la pieza C llegue a `main`. Depende de: Dani — infra, en [CORE-932](jira:CORE-932)
- [ ] Pieza F · app de Shopify: `orders/cancelled` de un pedido pendiente llama a la pieza C. Antes, confirmar que
      una app de pagos puede suscribirse a ese webhook sin otra revisión de Shopify.

## Objetivo

Una sola forma de cancelar un pedido de tienda pagado con Creditop, igual para VTEX, Shopify, WooCommerce y las que
vengan, en las dos direcciones: **el comprador se arrepiente** en el wizard y vuelve a la tienda, y **la tienda
cancela** (sin inventario, desde su admin o porque venció su plazo) y el comprador lo ve en el wizard. Mientras la
solicitud no llegó a 11, cancelar la cierra en Creditop y en la tienda; desde 11 ya no es una cancelación sino un
reembolso, que va por otro camino.

Todo vive en el canal ecommerce: el asesor, la autogestión y el QR no cambian.

## Dónde se toca

| pieza | repo | qué |
|---|---|---|
| A | shopify | `back_url` en el pedido de payment-link y la ruta que rechaza la sesión (`app/creditop.server.ts`, `app/routes/`) |
| B, D | frontend-monorepo | el link de salida y el aviso de cancelación en las pantallas de tienda (`storeBackUrlOf`, `getEcommerceContextByLoanRequest`) |
| C | legacy-backend | el endpoint junto a `payment-link` y `status` (`Modules/Onboarding/routes/webhooks.php`), un evento de broadcast |
| E | vtex | `cancel` del conector (`node/connector.ts`) |
| F | shopify | el webhook de pedidos |

## Cómo se ataca

**El contrato (lo mismo para todas las tiendas):**

1. **El comprador cancela.** La tienda manda `back_url` en payment-link (ya lo acepta `main`, desde la #104). El
   wizard muestra «Volver a la tienda» y lleva ahí. La tienda se entera por su propio camino (Shopify por la ruta
   que rechaza la sesión; VTEX y las demás por su vencimiento o por el aviso de Creditop si la solicitud se cierra).
2. **La tienda cancela.** `POST /api/ecommerce/orders/{order_key}/cancel` con el mismo token de sucursal que
   payment-link y `{ reason_code, reason_message? }`:
   - `{order_key}` es el mismo que la tienda mandó en payment-link y usa en `status` (en VTEX el `paymentId`; en
     Shopify el id de la sesión de pago);
   - sin solicitud todavía → marca el pedido como cancelado (no hay canal de Pusher: el wizard lo ve al cargar);
   - solicitud abierta antes del punto sin vuelta → la cierra en 8 «Cancelado», guarda el motivo en el pedido, emite
     el evento y responde 200. Si pasar a 8 dispara el aviso a la tienda, en una cancelación que pidió la tienda se
     suprime: ella ya lo sabe, y en VTEX se cruzaría con su propio `cancel` en curso;
   - pasado el punto sin vuelta pero antes de 11 → 409 `not_cancellable` (la regla exacta, pendiente de Producto);
   - ya en 11 → 409 `already_authorized` (es un reembolso);
   - ya cerrada (6, 7, 8) → 200 con el estado que tiene (idempotente);
   - otra sucursal o pedido inexistente → 404, como `status`.
3. **El wizard se entera.** Un evento por Pusher en el canal que ya usa (`App.Models.UserRequest.<user_id>`) y, por
   si no llega, cada pantalla de tienda revisa el pedido al cargar. Muestra «La tienda canceló la compra» con el
   motivo y el link a la tienda.
4. **Vencimiento.** Es el caso 2 disparado por la tienda (VTEX a las 6 h) o por Creditop al vencer la referencia.

**Aislamiento.** El endpoint está en el grupo de ecommerce y actúa sobre `ecommerce_requests`; la solicitud pasa a
un estado que ya existe (8) por la transición que ya exista para eso (pendiente de verificar), sin estados nuevos.
El wizard revisa la cancelación sólo cuando la solicitud tiene contexto de tienda.

**Lo que ya hay en `main`:**
- `back_url` en payment-link (`CreatePaymentLinkRequest.php:49`) y el link «Volver a la tienda» en el listado vacío.
- `GET /api/ecommerce/status/{orderId}` traduce el estado con `woocommerce_statuses`: 7 «No terminó proceso» y
  8 «Cancelado» → `cancelled`; 6 → `failed`; 11 → `completed`; 10 → `pending payment`.
- Broadcast por Pusher (`ValidationStatusChanged`, `Wompi/PaymentLinkReady`) y el wizard escuchándolo.
- El conector VTEX 5.0.3+ aprueba la cancelación si la solicitud no está autorizada, pero no le avisa a Creditop.
- El monolito viejo tenía `POST /checkout/cancelar` para WooCommerce (`WoocommerceController::cancel`).

## Lo que se evaluó y NO se eligió

- **SSE desde el backend**: cada comprador con el wizard abierto ocupa un worker de PHP y el balanceador corta las
  conexiones largas. Pusher ya está y el wizard ya lo escucha.
- **Una cancelación por tienda** (un endpoint de VTEX, otro de Shopify): las tiendas sólo difieren en quién la
  dispara; lo que hace Creditop es lo mismo.
- **Un estado nuevo de solicitud** para «cancelada por la tienda»: tocaría la máquina de estados de todos los
  canales. El motivo va en el pedido de tienda.

## Lo que NO entra

- Reembolsos y devoluciones de un crédito ya autorizado (11): siguen en las tareas de cada tienda.
- Los canales de asesor, autogestión y QR.

## Cómo se comprueba

- Por tienda, en qa: una compra que se cancela desde el wizard (vuelve al checkout, la tienda la da por cancelada)
  y otra que la tienda cancela con el wizard abierto (el wizard lo muestra sin recargar, y al recargar también).
- VTEX: `make harness-vtex TARGET=qa CASES=tienda-cancela` ya arma el caso de la tienda que cancela.
- El endpoint con una solicitud en 11 responde 409 y no la toca: una compra aprobada con `make harness-vtex TARGET=qa`
  y después la llamada de cancelar con el token de su sucursal; se comparan estado y `updated_at` antes y después.
- `make harness-vtex TARGET=qa CASES=tienda-cancela` después de la pieza E tiene que dejar la solicitud en 8, el
  motivo guardado y la respuesta del conector con `requestId`.

## Referencias

- Tarea #102 (`integracion-vtex`): el pendiente «Qué hace Creditop cuando VTEX cancela un pedido cuya solicitud
  sigue viva».
- Tarea #103 (`integracion-shopify`): el requisito 5.2.6 de la App Store (cancelar y volver al checkout).
- Tarea #104 (`ecommerce-volver-a-la-tienda`): el link y el `back_url`.
- Tarea #106 (`ecommerce-una-solicitud-por-pedido`): una solicitud cancelada no se vuelve a abrir.

## Tarea (publicable)

## En una línea

Un pedido de tienda pagado con Creditop se puede cancelar de las dos puntas: el comprador desde la solicitud y la
tienda desde su sistema, con el mismo resultado en las dos.

## Por qué

Hoy, si la tienda cancela un pedido (por ejemplo, porque se quedó sin inventario), Creditop no se entera y el
comprador puede terminar un crédito para una venta que ya no existe. Y el comprador que se arrepiente no tiene
cómo volver a la tienda salvo cuando no hay opciones de financiamiento. Shopify, además, exige la opción de
cancelar para aprobar la app.

## Qué cambia

- El comprador ve «Volver a la tienda» durante la solicitud y puede cancelar.
- La tienda puede cancelar un pedido mientras el crédito no esté autorizado; la solicitud queda cancelada.
- Si el comprador tiene la solicitud abierta cuando la tienda cancela, lo ve en el momento, con el motivo.
- Con el crédito ya autorizado, la tienda recibe un rechazo: eso es una devolución.

## Alcance

Sólo pedidos que vienen de una tienda en línea. Asesor, autogestión y QR no cambian. No incluye devoluciones.

## Dónde probar

QA, con la tienda VTEX y la tienda Shopify de pruebas.

## Cómo validar

- Comprar, abrir la solicitud y cancelar desde ella: vuelve a la tienda y el pedido queda cancelado.
- Comprar, dejar la solicitud abierta y cancelar el pedido desde la tienda: la solicitud muestra la cancelación.
- Cancelar desde la tienda un pedido con crédito autorizado: se rechaza.

## Criterios de aceptación

- La cancelación desde la tienda cierra la solicitud si no está autorizada y responde igual si se repite.
- Una solicitud autorizada no se cancela.
- El comprador ve la cancelación sin recargar y también al recargar.
- Los canales que no son tienda en línea no cambian.

## Dependencias / contraparte

Producto: hasta qué punto se puede cancelar, el texto para el comprador y cuánto vive un pedido sin terminar.
