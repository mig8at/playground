---
id: 103
title: "Integración Shopify: generar la URL de checkout y saber de qué sucursal viene el pedido"
stage: evaluation
created: "2026-10-19T12:00:00-05:00"
knowledge: [ecommerce-context]
canon: []
jira: [CORE-801, CORE-689]
jira_title: "Integración Shopify: app de pagos con enlace de pago y pedidos atribuidos a la sucursal"
ramas: core-801-shopify-payment-link, core-689-shopify-platform
---

## Pendientes

- [x] ~~La app atiende la sesión de pago y pide la URL a `payment-link`~~ — rama `payment-link` del repo `shopify`
      (23a7845, desde `develop` con `feature/init_project`, local, sin push): `/payments/session`, la configuración
      por tienda (hash + token cifrado, `paymentsAppConfigure`), la vuelta y el webhook. Probado con la app real en
      local contra el mock; la idempotencia está atada a la tienda.
- [x] ~~Probar la app en la tienda de desarrollo con el checkout real~~ — `creditop-dev-store.myshopify.com`, con
      `shopify app dev`: la compra llega a `payment-link` y el comprador cae en el wizard (pedido 7407).
- [x] ~~Resolver la sesión de pago en Shopify cuando llega el webhook de CreditOp~~ — resolve, reject y pending por
      la Payments Apps API, con el webhook firmado por sesión (HMAC). Aprobada → pedido #1009 «Pagado»; negada →
      vuelve al checkout. Probado con el checkout real y el simulador de resultado del backend local.
- [x] ~~Probar el cierre con una solicitud real, sin atarla a mano~~ — en qa, con el `payment-link` de dev: la solicitud
      503726 se ató sola al pedido 7943 y, autorizada con el simulador de qa, la sesión de Shopify quedó resuelta.
- [ ] Pedirle a Oscar que revoque el token de ecommerce de `c390eed9` que se pegó en el chat y emita otro; termina
      cuando el viejo responde 401.
      Depende de: Oscar.
- [ ] Antes de publicar la app: sacar de `shopify.app.creditop-ecommerce-payments.toml` los permisos de prueba
      (`write_products`, `write_publications`, `write_locations`, `write_inventory`, `write_markets`, `write_themes`,
      `write_shipping`; hoy sólo en la copia local) y declarar `supported_payment_methods` acordes a un BNPL.
      Hecho en la rama: la config publicable pide sólo pagos (la de prueba es `…-local.toml`) y la extensión declara
      `generalfinancing` con «Financia tu compra con Creditop», sólo Colombia.
- [ ] Pedir el ícono propio de Creditop en la lista de medios de pago de Shopify (repo público
      `activemerchant/payment_icons`); termina cuando la extensión puede declarar `creditop` en vez de
      `generalfinancing`.
- [ ] Que el webhook de CreditOp a las tiendas traiga autenticación propia (hoy, para «Desarrollo propio», va sin
      nada y la app se protege con la firma en la URL); termina con una decisión escrita acá.
      Depende de: Oscar — el contrato del webhook de la doc v1.0.2.
- [x] ~~Sacar de la tienda de desarrollo el método manual «creditop» y pasar la moneda base a COP~~ — hecho el
      2026-10-19: la tienda quedó sólo con Colombia, en COP, y con «Creditop» como único medio de pago.
- [ ] Revocar el Bearer de Sanctum que estuvo escrito en el repo `shopify`; termina cuando ya no autentica. En la
      rama `payment-link` salió del árbol junto con la PII y los artefactos (`dist/`, logs, `dev.sqlite`,
      `shopify-app-info.json`), pero sigue en 2 commits de la historia.
      Depende de: Infra — dónde se emitió el token y quién lo revoca.
- [ ] Confirmar que Shopify admite una Payments App offsite para tiendas en Colombia con COP y que CreditOp es (o
      puede ser) Payments Partner; termina con la respuesta escrita acá.
      Depende de: Merchants — lo que respondió Shopify en MER-2, MER-54 y MER-96.
- [x] ~~Probar contra el `payment-link` de verdad~~ — #1682 mergeado a `qa` el 2026-10-19; todo el recorrido en qa
      (aprobado, pendiente, negado, reembolso rechazado y la plataforma 4) corrió contra él.
- [x] ~~Agregar Shopify al catálogo `ecommerces` (id 4) y poder marcar una credencial con `ecommerce_type_id=4`~~ —
      rama `feat/core-689-shopify-platform` de legacy-backend (desde `main`, local, sin push, worktree
      `legacy-backend-shopify`): siembra, `ShopifyNotifier` y `ecommerce_type` en el alta de la Partner API. Credencial de
      prueba local: sucursal `f1681537`, tipo 4.
- [x] ~~Marcar la plataforma de una sucursal sin el admin de application~~ — `php artisan ecommerce:platform <hash>
      [shopify]` en la misma rama (c5250f71), probado en local. application va a desaparecer: su admin no se toca.
- [ ] Publicar `POST /legacy-api/ecommerce/payment-link` (y `/status`) en el gateway de producción
      (`v2.api.creditop.com`): hoy sólo existe en el de dev. La app ya apunta ahí en producción (c69e948). Lo hace
      infra; termina con un 401 sin token contra prod.
- [ ] Revisar y mergear los PRs abiertos: `Creditop-SAS/shopify#22` (la app, `feat/core-801-shopify-payment-link` → `develop`; reemplaza al #21, cerrado al renombrar la rama) y
      `Creditop-SAS/legacy-backend#1693` (plataforma 4 → `main`; #1689 ya está en `qa`). El arreglo de la siembra
      también está en la rama `-qa` (16ff8890, sin push), para un PR a `qa` cuando haga falta. Termina con los dos
      mergeados.
- [x] ~~Que los pedidos de la tienda de prueba salgan atribuidos a Shopify en qa~~ — con un comercio propio (362,
      sucursal ecommerce `8ffe96e2`, credencial tipo 4) en vez de pasar `c390eed9`, que usa también VTEX. Pedido 7963
      con `ecommerce_id=4` → #1012 `PAID`.

- [ ] Reembolsos: Shopify los exige para aprobar la app y hoy la app los rechaza. Depende de: Producto — qué es
      reembolsar una compra financiada (CreditopX y entidades externas, parciales, plazos). Termina con la regla escrita
      y la app resolviendo el reembolso.
- [ ] Alojar la app con URL fija (QA y después producción): en pausa hasta que Shopify apruebe a Creditop como Payments
      Partner; el plan y las variables están en `artifacts/creditop-para-shopify.html`. Ojo: desde el cambio a Postgres,
      `shopify app dev` en local necesita `DATABASE_URL`.

## Objetivo

Que una compra en una tienda Shopify llegue a CreditOp por la misma puerta que VTEX y quede atribuida a su sucursal:

1. **URL**: Shopify llama a la app (sesión de pago offsite); la app le pide la URL a `POST /api/ecommerce/payment-link`
   (CORE-746) servidor a servidor y responde un `redirect_url` que sólo lleva `?ref=`. Ni el token de la sucursal ni
   los datos del comprador pasan por el navegador.
2. **Origen**: una tienda Shopify = una sucursal. La app guarda, por tienda, el `hash` de la sucursal y su token; el
   pedido queda con `allied_branch_id` (sucursal) y `origin=payment_link`. La plataforma (`ecommerce_id=4`) pide
   sumar Shopify al catálogo: hoy queda con el tipo de la credencial.

## Dónde se toca

**shopify** (app React Router; rama `payment-link`, desde `develop` con `feature/init_project`: `main` sólo tiene el
commit inicial)
- `app/creditop.server`: el mapeo de la sesión de pago a `payment-link` (`id → order_key`, `group → id`,
  `amount → total`, `customer → billing`; Shopify no trae documento), el host por ambiente (`CREDITOP_API_URL` lo
  pisa en local) y el cifrado del token (AES-GCM con `CREDITOP_TOKEN_KEY` o el secreto de la app).
- `app/routes/payments.session`: el `payment_session_url`. Deduplica por id de sesión y tienda (otra tienda con el
  mismo id recibe 409), 422 si la tienda no está configurada. La autenticación de Shopify (mTLS) se termina en infra.
- `app/routes/app._index`: la configuración de la tienda (código de la sucursal, token, ambiente) y
  `paymentsAppConfigure`. Reemplaza la pantalla que tenía el Bearer y la PII escritos.
- `app/payments-apps.server`: el cliente de la Payments Apps API (`paymentsAppConfigure`, `paymentSessionResolve`,
  `Reject`, `Pending`), con la sesión offline de la tienda.
- `app/routes/webhooks.creditop`: valida la firma de la URL (`?s=&sig=`), traduce el `status` de CreditOp
  (`completed` / `failed` / `cancelled` / `pending payment`) y resuelve, rechaza o deja pendiente la sesión.
- `app/routes/payments.return.$sessionId`: devuelve al comprador a donde dijo Shopify; si el resultado todavía no
  llegó, deja la sesión pendiente. `app/routes/payments.go.$sessionId`: el salto HTTPS al wizard.
- `app/routes/local.shop-config`: sólo con `CREDITOP_LOCAL=1`, carga una tienda sin el admin de Shopify.
- `prisma/schema.prisma` + migración: `CreditopShop` y `CreditopPaymentSession`.
- `extensions/creditop-offsite/shopify.extension.toml`: `payment_session_url` apunta a la app (`/payments/session`).

**legacy-backend**
- `POST /api/ecommerce/payment-link` es de Oscar (legacy-backend#1682, borrador). Para la plataforma: sembrar Shopify
  (4) en `ecommerces` y su notificador en `config/ecommerce.php`, como el de VTEX.

**frontend-monorepo**
- Sin cambios: el wizard abre `?ref=` en `qa` (`apps/loan-request-wizard/app/routes/ecommerce/checkout.tsx`).

## Cómo se ataca

1. Limpieza del repo y la app pidiendo la URL a `payment-link` (hecho en la rama `payment-link`, probado en local
   contra el mock).
2. Cuando #1682 esté sobre `qa`, repetir la tienda demo contra la API de verdad.
3. Con cuenta Partner: `shopify app dev` sobre una tienda de desarrollo.
4. La resolución hacia Shopify (`paymentSessionResolve` / `Reject`), refund, GDPR y el catálogo id 4, en otra tarea.

## Lo que se evaluó y NO se eligió

- **Que la app arme la URL base64 del contrato unificado**: pone la credencial del comercio en el navegador y
  duplica en TypeScript la serialización PHP.
- **Un adaptador `/shopify/init` en legacy-backend**: descartado por decisión de Miguel (2026-10-19): la app llama
  directo a `payment-link`, la misma API que usan todas las tiendas.
- **Todo en legacy-backend (sin app)**: habría que replicar en PHP el OAuth de Shopify, el guardado de tokens por
  tienda y la autenticación de cada request de Shopify. El análisis de CORE-689 recomienda la app.
- **Un checkout UI extension (`purchase.checkout.block.render`) con un botón «Pagar con CreditOp»**: depende del plan
  de la tienda y no es el flujo de Payments Apps; Shopify no lo reconoce como medio de pago.
- **Mandar la sucursal en cada sesión**: una tienda = una sucursal (decisión de Miguel, 2026-10-19).

## Lo que NO entra

- Resolver la sesión hacia Shopify (aprobado/negado), capture, void, refund y webhooks GDPR.
- Homologación como Payments Partner y publicación de la app.
- Despliegue de la app (hosting, base de datos que no sea SQLite, un `client_id` por ambiente).

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

**La tienda demo (verificado el 2026-10-19).** Mientras `payment-link` no esté en el backend local, un mock de su
contrato (el de legacy-backend#1682) más el plugin de Shopify simulado, con el wizard en :5174 y legacy-backend local:

```sh
make harness-store            # http://localhost:8113/ · elegir «Shopify» y la sucursal c390eed9, «Pagar con CreditOp»
```

La página muestra los cuatro saltos (plataforma → plugin → `payment-link` → plugin → comprador) y «Ir a CreditOp»
abre el wizard con `?ref=`. El webhook del backend llega a `/webhook/shopify` y se ve en la misma página.
Con la app REAL (repo `shopify`, rama `payment-link`): `npm ci && npx prisma generate && npx prisma migrate deploy`
y `npm run local` la levanta en :8115 sin Shopify; la tienda carga la sucursal por `POST /local/shop-config` (sólo
con `CREDITOP_LOCAL=1`) y le manda la sesión a `/payments/session` (la barra dice «plugin: real»).

**Con el checkout real de Shopify (verificado el 2026-10-19).** En el repo `shopify`, rama `payment-link`:
`CREDITOP_API_URL=http://localhost:8113 CREDITOP_LOCAL=1 npx shopify app dev --config
shopify.app.creditop-ecommerce-payments.toml --store creditop-dev-store.myshopify.com`. Con el túnel que imprime, poner
`payment_session_url` y `refund_session_url` de `extensions/creditop-offsite/shopify.extension.toml` en
`<túnel>/payments/session` y `<túnel>/payments/refund` (no se commitea), cargar la sucursal con
`POST <túnel>/local/shop-config`, tocar «Guardar» en la app del admin, activar «Creditop - Pago Seguro» en modo de
prueba (Configuración → Pagos) y comprar en el mercado Colombia eligiendo esa opción (no el método manual «creditop»).

Con la API de verdad: `make harness-store A=restart PAYMENT_LINK_URL=http://localhost/api/ecommerce/payment-link
PAYMENT_LINK_TOKEN=<token de ecommerce:issue-token>`.


## Referencias

- Estado para el equipo: `artifacts/creditop-para-shopify.html` (publicado como «Creditop para Shopify»,
  https://claude.ai/artifact/EEAZoVAyBTTmxogHyesqbK, privado hasta compartirlo).

- CORE-689: «Análisis técnico de las integraciones VTEX y Shopify para producción» (Confluence, página 698580994),
  secciones 8 a 11 y 15.3 (brechas SHP-xx).
- Tarea #102 (`integracion-vtex`): la misma puerta para VTEX.
- Tarea #99 (`auto-ecommerce`): la apertura por referencia.

## Tarea (publicable)

## En una línea
Una tienda Shopify puede ofrecer CreditOp como medio de pago y cada solicitud queda atribuida a la sucursal de esa
tienda.

## Por qué
Hoy no existe una integración de Shopify que funcione: la app es un prototipo sin el servicio que atiende el pago, y
contiene credenciales y datos personales que no deberían estar ahí.

## Qué cambia
- Al elegir CreditOp en el checkout de Shopify, el comprador llega a CreditOp con un enlace que sólo lleva una
  referencia; los datos del pedido los guarda CreditOp.
- El comercio configura en la app la sucursal a la que pertenece su tienda, y cada pedido queda registrado con esa
  sucursal y con Shopify como plataforma.
- Cuando la solicitud termina, el pago se cierra solo en Shopify: aprobada queda pagada, negada o cancelada vuelve
  el comprador al checkout, y si el comprador vuelve antes, el pedido queda pendiente hasta el resultado.

## Alcance
- Una tienda Shopify corresponde a una sola sucursal del comercio.
- No incluye reembolsos (hoy se rechazan con un mensaje para el comercio), el alojamiento con URL fija ni la
  publicación de la app.

## Dónde probar
QA, con una tienda de desarrollo de Shopify y una sucursal ecommerce configurada como Shopify.

## Cómo validar
- Pagar con CreditOp en la tienda de desarrollo: el comprador llega a CreditOp con el monto precargado.
- El enlace no trae datos del pedido ni la credencial del comercio.
- Dos tiendas configuradas con sucursales distintas generan pedidos en sus sucursales.
- Aprobar la solicitud: el pedido en Shopify queda pagado. Negarla: el pago queda fallido.

## Cambios en datos
- Shopify como plataforma en el catálogo de ecommerce.
- Alta de la sucursal ecommerce de la tienda con su credencial marcada como Shopify.

## Criterios de aceptación
- Todo pedido que entra por Shopify tiene sucursal y plataforma Shopify registradas.
- Ninguna credencial ni dato personal queda escrito en el código de la integración.

## Dependencias / contraparte
- Shopify: que admita la app de pagos para Colombia y la aprobación de CreditOp como socio de pagos.
- Infra: revocar el token expuesto.
