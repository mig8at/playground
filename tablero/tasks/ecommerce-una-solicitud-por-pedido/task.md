---
id: 106
title: "Una solicitud por pedido de tienda"
stage: work
created: "2026-10-27T10:30:00-05:00"
knowledge: [ecommerce-context]
canon: []
jira: [CORE-819]
jira_title: "Ecommerce: una compra nueva no debe reabrir la solicitud de un pedido anterior"
ramas: legacy-backend:una-solicitud-por-pedido
---

## Pendientes

- [x] ~~Abrir el PR a `qa`~~ — [legacy-backend#1783](https://github.com/Creditop-SAS/legacy-backend/pull/1783), desde
      `fix/ecommerce-una-solicitud-por-pedido-qa` (tomada de `qa` al día), con pruebas unitarias en los dos módulos.
- [x] ~~Probar en local el reintento~~ — 2026-10-27, Amoblar: 7437 → 467514 negada; 7438 → 467515 nueva; un segundo
      OTP sobre 7438 retoma la 467515.
- [ ] Probar lo mismo en `qa` cuando #1783 esté mergeado y desplegado.
- [x] ~~Crear el issue de Jira~~ — [CORE-819](https://creditop.atlassian.net/browse/CORE-819), en CORE Sprint 21.
- [ ] Decidir cómo llega a `main`: PR propio desde `main` o junto a otro de ecommerce. Termina con el PR abierto.

## Objetivo

Cada pedido de tienda tiene su propia solicitud. Un comprador que vuelve al MISMO pedido retoma su solicitud
abierta (1, 3, 9); cualquier otro caso —pedido nuevo, o la solicitud de ese pedido ya terminó— crea una solicitud
nueva. Nunca se reutiliza la solicitud de otro pedido ni se reabre un estado final.

## Dónde se toca

**legacy-backend** (lo mismo en `main` y `qa`; rama `fix/ecommerce-una-solicitud-por-pedido-qa`)
- `Modules/Onboarding/App/Services/UserRequestService.php` · `handleEcommerceUserRequest`: el camino del OTP que usa
  hoy el wizard (`OnboardingController::validateOtpCodeAndRedirectOrchestrator` → `createUserRequest`).
- `Modules/Onboarding/App/Repositories/UserRequestRepository.php` · `findEditableForEcommerceRequest` (nuevo) y su
  interfaz.
- `Modules/UserRequestV1/App/Services/FindOrCreateService.php` · `handleEcommerceUserRequest`: el camino de
  OnboardingV2 (`ValidateOtpAuthService`). Repositorio e interfaz con el mismo método nuevo.
- Sin tocar: `handleEcommerceUpdateRequest` (elegir entidad crea o actualiza una solicitud con la entidad; un pedido
  con varias entidades es legítimo) y `ShouldCreateSeparateUserRequestService`, que queda sólo para el camino sin
  pedido.

**El defecto:** la búsqueda vieja (`getLastRequestsByUserAndAmount`) pide `lender_id = 0` en `Onboarding` y el
monto de la sesión, que en el flujo actual llega vacío y se pasa a entero. Las solicitudes nacen con `lender_id`
NULL desde julio de 2025, así que nunca separa los pedidos y el `updateOrCreate` por usuario, sucursal, entidad
vacía y monto encuentra la solicitud vieja sin mirar su estado.

## Cómo se ataca

1. Con `ecommerce_request_id`: buscar la solicitud del usuario ligada a ESE pedido
   (`user_requests_by_ecommerce_request`) en 1, 3 o 9; si no hay, `create` (nunca `updateOrCreate`).
2. Sin pedido identificado: el camino viejo, igual.
3. PR a `qa` para probar; después a `main`.

## Lo que se evaluó y NO se eligió

- **Corregir sólo `lender_id = 0` → `NULL`.** `UserRequestV1` ya busca `NULL o 0` y aun así reutiliza por monto; en
  `Onboarding` el monto de la sesión llega vacío y los centavos de VTEX no coinciden al pasarlo a entero. Remendar la
  heurística dejaba el problema de fondo: la llave tiene que ser el pedido, que es lo que el comercio conoce.
- **Reemplazar `user_requests_by_ecommerce_request` por una columna en `user_requests`.** Un pedido pasa por varias
  solicitudes de verdad (499 pedidos en prod probaron otra entidad) y la tabla la usan unos 74 archivos de los dos
  monolitos, con `legacy-application` todavía escribiéndola. Quedó como pendiente en Incidencias (restricción única).

## Lo que NO entra

- La selección de entidad (`handleEcommerceUpdateRequest`).
- Corregir las solicitudes históricas ligadas a varios pedidos.
- La restricción única de la tabla (Incidencias).

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

Pruebas unitarias (dobles, sin base), corridas con un `vendor` clonado en el worktree (`cp -c -R`):

```sh
DB_HOST=127.0.0.1 OTEL_SDK_DISABLED=true php vendor/bin/pest Modules/UserRequestV1/tests/Unit/FindOrCreateEcommerceOrderTest.php Modules/UserRequestV1/tests/Unit/FindOrCreateSalesRepTest.php Modules/Onboarding/tests/Unit/EcommerceOneRequestPerOrderTest.php
```

De punta a punta (local o qa): comprar en la tienda de prueba hasta el listado; negar con el simulador
(`POST /simulator/aggregator-result {user_request_id, status: 6}`); volver a comprar el mismo carrito con el mismo
celular. Esperado: solicitud nueva; la anterior en 6 con un solo pedido.

```sql qa
SELECT l.user_request_id, ur.user_request_status_id, l.ecommerce_request_id FROM user_requests_by_ecommerce_request l JOIN user_requests ur ON ur.id=l.user_request_id WHERE ur.user_id = <usuario> ORDER BY l.id DESC LIMIT 6
```

## Referencias

- PR [legacy-backend#1783](https://github.com/Creditop-SAS/legacy-backend/pull/1783) (a `qa`).
- La tabla nació en `legacy-application` afc7cf9b1 (2025-01-03, «reorder requests for ecommerce»).
- Encontrado en la tarea de VTEX (#102) con la solicitud 504084 de qa.

## Tarea (publicable)

## En una línea
Cada compra en una tienda tiene su propia solicitud de crédito: una compra nueva ya no reabre la solicitud de una compra anterior.

## Por qué
Cuando un comprador vuelve a comprar en la misma tienda, por el mismo monto, el sistema reutiliza la solicitud de su compra anterior aunque ya haya sido negada o cancelada y la tienda ya haya recibido ese resultado. La solicitud vuelve al formulario de perfil y queda ligada a las dos compras: la decisión de la primera se pierde y el historial de estados no la muestra. En producción, 416 solicitudes creadas en octubre quedaron ligadas a más de una compra.

## Qué cambia
- Si el comprador vuelve a la MISMA compra y su solicitud sigue abierta, la retoma.
- Una compra nueva, o una compra cuya solicitud ya terminó, crea una solicitud nueva.
- Una solicitud negada, cancelada o autorizada no se vuelve a abrir.

## Alcance
No cambia la elección de entidad ni corrige las solicitudes antiguas que ya quedaron ligadas a varias compras.

## Dónde probar
qa, con la tienda de prueba de VTEX o Shopify de Creditop.

## Cómo validar
1. Comprar en la tienda de prueba y llegar al listado de entidades.
2. Negar la solicitud con el simulador de resultado.
3. Volver a comprar el mismo carrito con el mismo celular y pasar el código de verificación.
4. Revisar que nace una solicitud nueva y que la anterior sigue negada, ligada sólo a su compra.
5. Recargar el formulario de la compra nueva: debe seguir en la misma solicitud nueva.

## Criterios de aceptación
- Una compra nueva crea una solicitud nueva aunque el comprador, la sucursal y el monto coincidan con una anterior.
- Una solicitud en estado final no cambia de estado por una compra nueva.
- Volver a la misma compra retoma su solicitud abierta, sin duplicarla.

## Dependencias / contraparte
Revisión del cambio por el equipo de backend.
