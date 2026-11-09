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

- [ ] Dar al comprador cómo cancelar y volver al checkout (requisito 5.2.6 de la App Store): la app manda `back_url`
      a payment-link y rechaza la sesión al volver. Es la pieza A del estándar de la tarea #112
      (`ecommerce-cancelacion-de-pedidos`); el link en todas las pantallas del wizard es su pieza B. Termina con una
      compra en `creditop-dev-store` cancelada desde el wizard que vuelve al checkout.
- [ ] En `creditop-dev-store`, sin código: teléfono de la dirección de envío en «Obligatorio» y la pantalla de pago con
      el logo y los colores de Creditop; termina con una compra de qa que llega con `billing.phone`.
- [ ] Armar la tienda simple de Shopify: un tema Liquid mínimo (portada con las bicicletas, producto, carrito)
      versionado en el playground junto a `tienda-simple` y subido sin publicar con `shopify theme push`; termina
      publicado en `creditop-dev-store` en lugar de `test-data`. El checkout no es parte del tema (ver bloque del
      2026-11-06).
- [ ] Decidir y armar el auto-onboarding de Shopify como una página propia de la app (nacimiento, expedición y
      aceptación antes de pedir el payment-link); termina con una compra en `creditop-dev-store` que entra por
      «validando» sin SMS.
      Depende de: Miguel / Producto — si se hace, y con qué textos de aceptación.

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
- [ ] Confirmar con Shopify que la app offsite sirve para tiendas en Colombia con COP y en qué estado está hoy la cuenta
      Partner 4296643. Ya se sabe, por el hilo con paymentspartners@shopify.com (bloque del 2026-11-02): Creditop fue
      aprobado como Payments Partner (2025-06), el acuerdo de reparto se firmó (2026-01-21, según María Fernanda), la
      app la pueden instalar todos los planes y sólo puede tener UNA extensión de pago. Retomar ese hilo, no empezar
      otro. Termina con la respuesta escrita acá.
      Depende de: María Fernanda / Manuela — el hilo con Shopify, que quedó sin respuesta desde el 2026-04-01.
- [ ] Desplegar la app (`shopify app deploy`) cuando exista el host de qa, no antes: hoy la configuración publicable
      apunta a `api.2272.canary.creditop.com`, que no resuelve, y lo activo en Shopify sigue siendo la versión 7 de Juan
      (2026-03-03). Antes: avisarle a Juan (las versiones son suyas) y pasar las URLs al dominio de qa
      (`npm run extension:url`). Al desplegar, aceptar que se borren las extensiones que no están en el código. Termina
      con una versión nueva activa, con una sola extensión de pago (en
      https://dev.shopify.com/dashboard/167881494/apps/317076176897/versions), y una compra en `creditop-dev-store` sin
      `shopify app dev`.
      Depende de: Dani — el host de qa.
- [x] ~~Probar contra el `payment-link` de verdad~~ — #1682 mergeado a `qa` el 2026-10-19; todo el recorrido en qa
      (aprobado, pendiente, negado, reembolso rechazado y la plataforma 4) corrió contra él.
- [x] ~~Agregar Shopify al catálogo `ecommerces` (id 4) y poder marcar una credencial con `ecommerce_type_id=4`~~ —
      rama `feat/core-689-shopify-platform` de legacy-backend (desde `main`, local, sin push, worktree
      `legacy-backend-shopify`): siembra, `ShopifyNotifier` y `ecommerce_type` en el alta de la Partner API. Credencial de
      prueba local: sucursal `f1681537`, tipo 4.
- [x] ~~Marcar la plataforma de una sucursal sin el admin de application~~ — `php artisan ecommerce:platform <hash>
      [shopify]` en la misma rama (c5250f71), probado en local. application va a desaparecer: su admin no se toca.
- [x] ~~Publicar `POST /legacy-api/ecommerce/payment-link` (y `/status`) en el gateway de producción~~ — medido el
      2026-10-21 (tarea #102): las dos rutas responden 401 sin token en `v2.api.creditop.com/legacy-api`.
- [ ] Que la app tome el celular y el nombre de las direcciones cuando la sesión no los trae en `customer`: en qa
      los cuatro pedidos de Shopify (7943, 7947, 7963, 7965) llegaron sin celular. Shopify manda
      `customer.phone_number` sólo si el comprador eligió contacto por celular; las direcciones (`billing_address`,
      `shipping_address`) traen su propio `phone_number`, opcional. Termina con `paymentLinkBody` cayendo a esos
      campos y un pedido de qa con `billing.phone`. El código está (hoy en el commit único del PR #22, 2b14e52, con
      tests); falta el pedido de qa: pide la app corriendo con `npm run dev` y una compra en `creditop-dev-store` con
      contacto por correo y celular en la dirección.
- [ ] Revisar y mergear `Creditop-SAS/shopify#22` (la app, `feat/core-801-shopify-payment-link` → `develop`; reemplaza
      al #21, cerrado al renombrar la rama). Termina mergeado. La plataforma 4 de legacy-backend ya no espera a
      `Creditop-SAS/legacy-backend#1693`: entró a `main` por 51181aaf3 y está en prod desde v0.6.29 (`ecommerces` id 4 =
      Shopify). El #1693 quedó en conflicto con esa misma migración y sólo agregaría el `unguarded` de la siembra, que
      en prod no hizo falta porque el autoincremental ya daba 4.
- [x] ~~Que los pedidos de la tienda de prueba salgan atribuidos a Shopify en qa~~ — con un comercio propio (362,
      sucursal ecommerce `8ffe96e2`, credencial tipo 4) en vez de pasar `c390eed9`, que usa también VTEX. Pedido 7963
      con `ecommerce_id=4` → #1012 `PAID`.

- [ ] Definir con Producto el reembolso manual. Shopify sólo deja aprobar o rechazar un reembolso: no tiene el «hacelo
      a mano» de VTEX (`refund-manually`), y rechazarlos todos (lo de hoy) choca con su requisito de que el comercio
      pueda reembolsar. La propuesta: la app aprueba la sesión (`refundSessionResolve`) y avisa a Creditop con el pedido
      y el monto, y operaciones cancela o ajusta el crédito aparte. Producto decide si la tienda puede mostrar
      «reembolsado» antes de que se cancele el crédito y quién devuelve la plata (¿el comercio a la entidad?).
      Depende de: Producto. Termina con la regla escrita acá y la app aprobando y avisando.
- [ ] Alojar la app con URL fija (QA y después producción): en pausa hasta que Shopify apruebe a Creditop como Payments
      Partner; el plan y las variables están en `artifacts/creditop-para-shopify.html`. Ojo: desde el cambio a Postgres,
      `shopify app dev` en local necesita `DATABASE_URL`.
- [ ] Que el backend de qa llegue a `playground.creditop.com`, para que el aviso de fin de solicitud le llegue solo al host
      que se sirve por el playground (`/s/shopify.app.miguel.com`). Hoy el balanceador `alb-internal-tools` (cuenta de
      producción, grupo `sg-000e5f43000d3c97d`) sólo deja entrar 3 IPs en el 443 —las de la VPN— y qa sale por otra: el
      aviso de la solicitud 504501 dio `cURL error 28` a los 10 s y no se reintenta. Mientras tanto, la Store demo de
      ecommerce-v2 lo manda con «Avisar como Creditop». Termina con un aviso de qa que llega al host (pedido en `paid`
      sin el botón). Depende de: Infra — sumar la IP de salida de qa/dev a ese grupo, o decidir otra forma.

- [ ] Versión posterior · un aviso «Paga con Creditop» en la página del producto, antes del checkout, como el de Addi
      (texto con cuotas y un modal que explica cómo comprar). En Shopify sería un bloque de tema de la app (theme app
      extension). Termina con el aviso instalado en una tienda. Depende de: Producto — qué cuotas o monto mostrar.
- [ ] Versión posterior · un formulario para pedir los datos que la tienda no trae (tipo y número de documento, fecha
      de expedición), como el del pago con tarjeta, para que el wizard no los vuelva a pedir. Ojo: una extensión de
      pago offsite no dibuja campos en el checkout (los campos de tarjeta son de otro tipo de extensión); habría que
      ver si alcanza con una extensión de UI del checkout y en qué planes de Shopify existe. Termina con la forma
      decidida. Depende de: Producto — qué datos se piden y si el wizard confía en ellos.

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
`<túnel>/payments/session` y `<túnel>/payments/refund` (no se commitea; `shopify app dev` lo toma solo), cargar la sucursal con
`POST <túnel>/local/shop-config`, tocar «Guardar» en la app del admin, activar «Creditop - Pago Seguro» en modo de
prueba (Configuración → Pagos) y comprar en el mercado Colombia eligiendo esa opción (no el método manual «creditop»).

**Contra qa, con la tienda de desarrollo (verificado el 2026-10-22: el pedido llega a qa con los datos del contacto).**
Pide la VPN de dev para el simulador y la base de qa.

| para qué | dirección |
|---|---|
| la tienda donde se compra | https://creditop-dev-store.myshopify.com |
| el admin de la tienda (la app, pagos, pedidos, pantalla de pago) | https://admin.shopify.com/store/creditop-dev-store |
| la app en tu máquina (cambia en cada arranque) | `https://<túnel>.trycloudflare.com`, el que imprime `shopify app dev` |
| el wizard al que llega el comprador | `https://originaciones-qa.dev.creditop.com/ecommerce/e4a51ff3f/checkout?ref=<ref>` |
| payment-link de qa (lo llama la app) | https://api.dev.creditop.com/legacy-api/ecommerce/payment-link |
| aprobar la solicitud (simulador; sólo por la dirección interna) | `POST http://legacy-backend-qa.inertia-develop/simulator/aggregator-result` |
| qué recibe el wizard para prellenar | `GET http://legacy-backend-qa.inertia-develop/api/onboarding/ecommerce-request/by-user-request/<solicitud>` |

La sucursal de prueba es `e4a51ff3f` (`e4a51ff3f-fake`, id 2227, del comercio 362 «PRUEBA AUTO Shopify», propio de
estas pruebas), con la credencial tipo 4 (Shopify) y el token 28 en `personal_access_tokens`. La anterior, `8ffe96e2`
(id 2219), está deshabilitada y sin token: el `ECOMMERCE_TOKEN_8ffe96e2` de `harness/.env.qa` (id 17) ya no existe en
qa y no sirve. Un token se ve una sola vez al emitirlo: la base guarda sólo su sha256 y no se recupera.

El token 28 no está en ningún `.env`: vive cifrado en la base local de la app (`creditop-shopify-pg`, tabla
`CreditopShop`, tienda `creditop-dev-store.myshopify.com`), con la llave que la app deriva de `SHOPIFY_API_SECRET`.
Ese secreto no está en `.env`: lo pasa `shopify app dev` y se lee con
`cd ~/Desktop/CREDITOP/github/shopify && npx shopify app env show --config shopify.app.creditop-ecommerce-payments.toml`.
Para llevarlo a otra base (el `docker/` del repo shopify, por ejemplo) se descifra con esa llave y se vuelve a cifrar con la
del destino, sin imprimirlo.

1. **Levantar la app** (la rama de #22), en una terminal propia porque es interactiva:
   ```sh
   cd ~/Desktop/CREDITOP/github/shopify && CREDITOP_ENVIRONMENT=develop npx shopify app dev --config shopify.app.creditop-ecommerce-payments.toml --store creditop-dev-store.myshopify.com
   ```
   Imprime `Using URL: https://<túnel>.trycloudflare.com`. Si el pago falla con «There was an issue processing your
   payment», casi siempre es esto: la app no corre o la extensión apunta a un túnel viejo.
2. **Apuntar la extensión al túnel:** `payment_session_url` y `refund_session_url` de
   `extensions/creditop-offsite/shopify.extension.toml` → `<túnel>/payments/session` y `<túnel>/payments/refund`. No se
   commitea; `shopify app dev` lo toma solo (`creditop-offsite │ Configuration accepted`).
3. **Revisar la sucursal en la app** (admin → Apps → CREDITOP-ECOMMERCE-PAYMENTS, o la tecla `p` en la terminal): ya
   está cargada con `e4a51ff3f` y el token 28, guardados en su Postgres local (`creditop-shopify-pg`, tabla
   `CreditopShop`). La pantalla muestra el final del token; si dice que no se puede leer (cambió la llave) o el pago
   responde 401, hay que emitir un token nuevo para `e4a51ff3f` en qa (`ecommerce:issue-token`), pegarlo y «Guardar».
4. **Comprar** en la tienda, mercado Colombia, eligiendo «Creditop» (no el método manual «creditop»). El contacto es
   «correo o celular»: llega a Creditop sólo el que se dé. Para que llegue el celular con contacto por correo, la tienda
   tiene que pedir el teléfono en la dirección (Configuración → Pantalla de pago).
5. **Revisar qué llegó** (sucursal, plataforma Shopify = 4 y datos del comprador):
   ```sql qa
   SELECT er.id, er.ecommerce_id, er.allied_branch_id, er.origin, er.data FROM ecommerce_requests er JOIN user_requests_by_ecommerce_request l ON l.ecommerce_request_id=er.id WHERE l.user_request_id=<solicitud>
   ```
6. **Aprobar** con el simulador, como en VTEX:
   `curl -X POST http://legacy-backend-qa.inertia-develop/simulator/aggregator-result -H 'Content-Type: application/json' -d '{"user_request_id":<solicitud>,"status":11}'`.
   qa avisa a la app por el webhook firmado y la sesión de Shopify queda resuelta (pagada).

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
