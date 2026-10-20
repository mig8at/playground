---
id: 102
title: "Integración VTEX: generar la URL de checkout y saber de qué sucursal viene el pedido"
stage: evaluation
created: "2026-10-19T12:00:00-05:00"
knowledge: [ecommerce-context]
canon: []
jira: [CORE-638]
jira_title: ""
ramas: payment-link
---

## Pendientes

- [x] ~~El conector pide la URL a `payment-link`~~ — rama `payment-link` del repo `vtex` (6eeeb83, local, sin push):
      `authorize` llama con AppKey = hash y AppToken = Bearer, redirige al `?ref=` y niega si falla; host por
      configuración de la app (producción o develop). Probado con el conector real en local contra el mock.
- [ ] Confirmar con infra la ruta de `payment-link` en el gateway de producción y dónde queda `/vtex/settel`. Los dos
      gateways publican legacy-backend bajo `/legacy-api` (dev: `leg-qa`; prod: `legacy-backend.production`), y el
      conector ya usa `https://v2.api.creditop.com/legacy-api` en producción (b8f2750). Pero el gateway de prod no tiene
      la ruta de `payment-link`, y `/vtex/settel` es de application (`VtexController`): hay que migrarlo a legacy-backend
      (`VtexService`). Termina con la ruta de prod publicada y el settle en legacy-backend.
      Depende de: Infra — el ruteo de los dos paths.
- [ ] Probar el conector en una cuenta VTEX (workspace de prueba y Test Suite); termina con un `authorize` real que
      redirige al wizard de qa.
      Depende de: Miguel — si hay cuenta VTEX con permisos de payment provider.
- [ ] Que `payment-link` (legacy-backend#1682, de Oscar) llegue a `qa` rebasado sobre `qa` y probar la tienda demo
      contra él en local; termina con el conector real recibiendo una URL de la API de verdad.
      Depende de: Oscar — el rebase sobre `qa` (sin él, el camino feliz da 500).
- [ ] Llevar a `main` la apertura por referencia (`by-reference` en legacy-backend y `checkout.tsx` en
      frontend-monorepo), hoy sólo en `qa`; termina cuando `git grep checkout_reference origin/main` la encuentra.
      Depende de: Miguel — si sale separada del auto-onboarding de Refurbi, que se sacó de `main` a propósito.
- [ ] Decidir el vencimiento de la referencia para VTEX y si una referencia vencida o usada sigue abriendo el
      pedido con OTP (hoy sí, para siempre, si el pedido no trae aceptación); termina con la regla escrita acá.
      Depende de: Producto — cuánto puede tardar el comprador entre la tienda y CreditOp (VTEX cancela a las 6 h).
- [ ] Dar de alta la sucursal ecommerce de Mario Hernández (comercio 350) con credencial `ecommerce_type_id=3` y su
      token de ecommerce (`ecommerce:issue-token`); termina cuando `payment-link` responde 200 con su hash en qa.
      Depende de: Comercial / Operaciones — si la tienda VTEX vende por UNA sucursal y cuál es su cuenta VTEX.
- [x] ~~Probar en `qa` el recorrido VTEX completo por referencia~~ — con el conector real en local y un comercio propio
      (363, sucursal `530aa4f7`, credencial tipo 3): pedido 7966 con `ecommerce_id=3` → solicitud 503800 en 11 → el
      `VtexNotifier` avisó `approved` al `callbackUrl`. Falta el `settle` (ver abajo).
- [ ] Que el `settle` del conector deje `/vtex/settel` (de application, 404 en el gateway de dev) y use
      `GET /ecommerce/status/{paymentId}` de legacy-backend, con el mismo token de la sucursal: aprueba con `completed`.
      Termina con un settle aprobado en qa por el conector local.

## Objetivo

Que el conector VTEX no exponga nada en la URL del comprador y que cada solicitud que entra por VTEX se pueda
atribuir a su sucursal y a su plataforma sin heurísticas:

1. **URL**: en `authorize`, el conector le pide la URL a `POST /api/ecommerce/payment-link` (CORE-746), que guarda
   el pedido y devuelve una URL que sólo lleva `?ref=`. El token de la sucursal (el AppToken de la afiliación, que
   es el Bearer) y los datos del comprador dejan de viajar por el navegador.
2. **Origen**: una tienda VTEX = una sucursal. La sucursal sale del `hash` (AppKey de la afiliación) y la
   plataforma de la credencial. Tres columnas lo contestan: `ecommerce_requests.allied_branch_id` (sucursal),
   `ecommerce_requests.ecommerce_id` (plataforma: 3 = VTEX) y `ecommerce_requests.origin` (cómo se armó la URL:
   `payment_link` = la pidió la tienda por API).

## Dónde se toca

**vtex** (el conector VTEX IO; rama `payment-link`, desde `main`)
- `node/creditop`: el mapeo `AuthorizationRequest → payment-link` (`paymentId → order_key`, `orderId → id`,
  `value → total`, `miniCart.buyer → billing`, `returnUrl → return_url`, `callbackUrl → webhook_url`) y el host por
  ambiente (`production` o `develop`, de la configuración de la app; `CREDITOP_API_URL` fuera de IO).
- `node/connector` (`authorize`): llama a `payment-link` con `Authorization: Bearer <AppToken>` y responde
  `Authorizations.redirect` con el `?ref=`; si falla, `deny` (antes quedaba `pending`). `authorizationId` es el
  `order_key`, porque la API no devuelve un id propio. `settle` sigue en `/vtex/settel`.
- `manifest.json`: `settingsSchema` con el ambiente y `outbound-access` para los dos hosts de la doc v1.0.2.
- `local/server`: corre el conector real fuera de IO con un contexto de VTEX falso (`yarn --cwd node local`, :8114).

**legacy-backend**
- `POST /api/ecommerce/payment-link` es de Oscar ([#1682](https://github.com/Creditop-SAS/legacy-backend/pull/1682),
  borrador). Lo que toca a VTEX: el `ecommerce_id` sale de la credencial (3 → `VtexNotifier`), y
  `VtexService::settle` busca por `order_key` sin filtrar por sucursal (riesgo marcado en el PR).
- En `qa` (no en `main`): la apertura por referencia (`by-reference`, `findByCheckoutReference`, la migración de las
  4 columnas). Sin aceptación de términos en el pedido, la referencia abre el pedido y el comprador sigue por OTP.
- `/vtex/init` ya no se usa para la URL; queda para el conector viejo hasta que se reemplace.

**frontend-monorepo**
- `apps/loan-request-wizard/app/routes/ecommerce/checkout.tsx`: en `qa` ya resuelve `?ref=` contra `by-reference`.

## Cómo se ataca

1. El conector llama directo a `payment-link` (hecho en la rama `payment-link`, probado en local contra el mock).
2. Cuando #1682 esté sobre `qa`, repetir la tienda demo contra la API de verdad en el backend local.
3. Con cuenta VTEX: instalar la versión en un workspace de prueba y correr la Test Suite.
4. Para producción: la apertura por referencia y `payment-link` en `main`, la migración en prod, el token de la
   sucursal de Mario y la versión nueva del conector publicada.

## Lo que se evaluó y NO se eligió

- **Que `/vtex/init` use por dentro el servicio de `payment-link`** (el conector sin cambios): descartado por
  decisión de Miguel (2026-10-19): todas las tiendas pasan por la misma API, y el AppToken pasa a ser el token de
  ecommerce de la sucursal.
- **Que el conector arme la URL base64 en VTEX IO**: mete la credencial del comercio en el navegador del comprador,
  y en VTEX esa credencial es el AppToken de la afiliación. Además duplicaría en TypeScript la serialización PHP.
- **Una columna nueva para la plataforma**: ya la da `ecommerce_id`, que sale de `ecommerce_type_id` de la
  credencial desde la unificación. `origin` se queda con «cómo se armó la URL», no con la plataforma.
- **`origin=vtex`**: rompería `findByCheckoutReference`, que filtra `payment_link`, y mezclaría dos preguntas en
  una columna.
- **Mandar la sucursal en cada pedido** (para tiendas con varias sucursales): descartado por decisión de Miguel
  (2026-10-19): una tienda = una sucursal, y en VTEX la afiliación ya fija `AppKey = hash`.

## Lo que NO entra

- Shopify (queda para después, sobre el mismo endpoint).
- El resto de las brechas de CORE-689 para el go-live: confirmación a VTEX (callback o retry), cancel y refund,
  autenticación de `/vtex/settel`, Test Suite y homologación.
- La entrada sin OTP para VTEX: VTEX no manda aceptación de términos.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

**La tienda demo (verificado el 2026-10-19).** Mientras `payment-link` no esté en el backend local, un mock de su
contrato (el de legacy-backend#1682) más el plugin de VTEX simulado, con el wizard en :5174 y legacy-backend local:

```sh
make harness-store            # http://localhost:8113/ · elegir «VTEX» y la sucursal e9409aff, «Pagar con CreditOp»
```

La página muestra los cuatro saltos (plataforma → plugin → `payment-link` → plugin → comprador) y «Ir a CreditOp»
abre el wizard con `?ref=`. El webhook del backend llega a `/webhook/vtex` y se ve en la misma página.
Con el conector REAL (repo `vtex`, rama `payment-link`): `yarn --cwd node local` lo compila y lo levanta en :8114
con un contexto de VTEX falso; la tienda lo detecta y le manda el `authorize` a `POST /payments` (la barra dice
«plugin: real»). Sin él, usa el simulado.

Con la API de verdad: `make harness-store A=restart PAYMENT_LINK_URL=http://localhost/api/ecommerce/payment-link
PAYMENT_LINK_TOKEN=<token de ecommerce:issue-token>`.


Y en la base, la fila con la sucursal, la plataforma y el origen:

```sql
SELECT id, allied_branch_id, ecommerce_id, origin, checkout_reference IS NOT NULL AS con_ref, reference_expires_at
FROM ecommerce_requests WHERE order_key = 'vtx-<único>';
```

## Referencias

- [CORE-689](https://creditop.atlassian.net/browse/CORE-689): «Análisis técnico de las integraciones VTEX y Shopify
  para producción» (Confluence, página 698580994), con las brechas VTX-xx y el checklist de go-live.
- [CORE-746](https://creditop.atlassian.net/browse/CORE-746): `POST /api/ecommerce/payment-link` (Oscar).
- «Documentación de integración ecommerce v1.0.2 (ajustes Refurbi)» (Confluence, página 699138049).
- Tarea #99 (`auto-ecommerce`): la apertura por referencia nació ahí, para Refurbi.

## Tarea (publicable)

## En una línea
La tienda VTEX pide a CreditOp el enlace de pago y cada solicitud queda atribuida a la sucursal de esa tienda.

## Por qué
Hoy el enlace al que llega el comprador desde VTEX lleva los datos del pedido y la credencial del comercio a la
vista, y cualquiera que lo vea puede reusarla. Además Mario Hernández necesita salir con su tienda VTEX y las
ventas tienen que poder reportarse por sucursal.

## Qué cambia
- Al elegir CreditOp en el checkout de VTEX, el comprador llega a CreditOp con un enlace que sólo lleva una
  referencia; los datos del pedido los guarda CreditOp.
- Cada pedido de VTEX queda registrado con la sucursal de la tienda y con VTEX como plataforma.

## Alcance
- Una tienda VTEX corresponde a una sola sucursal del comercio.
- No incluye Shopify ni el resto de la salida a producción de VTEX (cancelaciones, reembolsos, homologación).

## Dónde probar
QA, con una sucursal ecommerce configurada como VTEX.

## Cómo validar
- Iniciar un pago desde la tienda (o simular el inicio del conector): el enlace devuelto no trae datos del pedido
  ni la credencial, sólo la referencia.
- Abrir el enlace: el monto y los datos del comprador aparecen precargados y el comprador valida su celular.
- Llegar a un estado final: la solicitud y el pedido quedan con la sucursal VTEX y la tienda recibe la notificación.

## Cambios en datos
- Las columnas de la referencia en los pedidos de ecommerce (ya aplicadas en la base de dev, qa y staging; falta
  producción).
- Alta de la sucursal ecommerce de la tienda con su credencial marcada como VTEX.

## Criterios de aceptación
- El enlace que devuelve el inicio de VTEX no contiene la credencial ni los datos del pedido.
- Todo pedido VTEX tiene sucursal y plataforma VTEX registradas, y la solicitud que genera queda en esa sucursal.

## Dependencias / contraparte
- Comercial / Operaciones: cuenta VTEX y sucursal de la tienda de Mario Hernández.
- Producto: cuánto dura vigente el enlace.
