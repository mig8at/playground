---
id: 102
title: "Integración VTEX: generar la URL de checkout y saber de qué sucursal viene el pedido"
stage: evaluation
created: "2026-10-19T12:00:00-05:00"
knowledge: [ecommerce-context]
canon: []
jira: [CORE-800, CORE-638]
jira_title: "Integración VTEX: enlace de pago con referencia y pedidos atribuidos a la sucursal"
chat: [duncan]
ramas: core-800-vtex-payment-link, vtex:core-800-vtex-5-0-1, vtex:core-800-vtex-5-0-2, vtex:ci/connector-smoke, legacy-backend:rotativo-cuota-inicial-tras-autorizar, vtex:auto-onboarding-switch
---

## Pendientes

- [x] ~~Apagar «Auto-onboarding con Creditop» en la app de `master` antes de la prueba en producción~~ — 2026-11-11,
      con Jarvis: apagado y guardado (sigue apagado al recargar; el ambiente sigue en Producción). Con él prendido el
      wizard saltaba el SMS y el formulario hasta «validando», más allá del formulario de perfil.
- [ ] Mandarle a Duncan (como Luigi) las tres capturas de cómo quedó la tienda en producción (en `artifacts/`,
      `prod-2026-11-11-*`) y que pruebe en `creditop.myvtex.com`: comprar con Creditop, llegar a
      `originaciones.creditop.com/ecommerce/84297564/…` y parar en el formulario de perfil, con sus propios datos.
      El auto-onboarding está apagado: la compra entra por celular → SMS → formulario. Si Duncan no conoce cómo funciona
      el auto-onboarding, explicárselo en detalle. Termina con su número de pedido, la hora y capturas.
      Depende de: Duncan — la prueba.
- [ ] Devolver la tienda a qa al terminar la prueba: la regla «Creditop qa» a la afiliación de Mario
      (`facb0b0a…`) y la app de `master` a QA, con el auto-onboarding otra vez prendido (estaba prendido). Termina con
      `make jarvis-recipe APP=vtex RECIPE=creditop-payment` diciendo «Mario Hernández (qa)» y un pedido que cae en
      `originaciones-qa`.
- [ ] Definir qué van en «Customer Key/Secret» de la credencial VTEX de la sucursal 2584 (Creditop los manda como
      `X-VTEX-API-AppKey/AppToken` al avisarle a VTEX el resultado; hoy sólo tiene el header de relleno
      `x-creditop-prueba`). Termina con los valores puestos por «Editar» antes de la prueba con entidades.
- [ ] Limpiar en el admin de producción la sucursal 2583 (punto de venta común creado por error, sin entidades ni
      credencial) y corregir el nombre duplicado de la 2584 («Ecommerce-Ecommerce-VTEX prueba»).
- [x] ~~Repetir la compra VTEX en un perfil limpio de Chrome, tocando a mano «Validar Pre aprobado»~~ — 2026-11-10:
      no había defecto. Los clics que no avanzaban los hacía el agente de Duncan por coordenadas sobre una página con
      zoom y caían fuera del botón; a mano, en Chrome invitado y en Brave, avanzó siempre al primer clic (pila).
- [x] ~~Enlazar el conector 5.1.0 (vtex#25) en `autoonb` y comprar con el switch prendido~~ — 2026-11-06: el checkout
      real saltó celular, código y formulario (solicitud 504704 al listado, sin OTP), tras corregir la ruta del switch y
      el `Proxy-Authorization` de la lectura del pedido (6b1cc44, local).
- [x] ~~Subir a vtex#25 la ruta del switch y sus correcciones~~ — 2026-11-06: 2a939c1 y 6b1cc44 en la rama del PR, con
      la evidencia de punta a punta en la descripción.
- [x] ~~Publicar e instalar la 5.1.0 en `master`~~ — 2026-11-06: vtex#25 mergeado (8757569), tag `v5.1.0`, publicada
      y desplegada a las 17:27 (Bogotá); instalada en `master` con el tema 0.2.0. El switch quedó apagado en `master`.
- [x] ~~Correr `make harness-vtex TARGET=qa CASES=rotativo` cuando legacy-backend#1881 entre a `qa`~~ — 2026-11-09:
      #1881 mergeado y desplegado en `qa`; la compra rotativa llegó a `loan-approved`, solicitud 504766 en 11, VTEX Approved.
- [x] ~~Ver el switch en el admin de la tienda~~ — 2026-11-06: Apps → Creditop BNPL en `master` muestra «Auto-onboarding
      con Creditop», apagado, debajo de «Ambiente de Creditop» (captura en `artifacts/2026-11-06-vtex/`).
- [ ] Dejar lista la tienda de Mario para el auto-onboarding: el script del checkout, la app `creditop` en la
      configuración del checkout, su sucursal en `auto_onboarding_allied_branches` y los enlaces de términos y
      política de producción (hoy apuntan a los PDF del bucket de dev); termina con una compra suya sin SMS.
      Depende de: Comercial / Operaciones — la sucursal y el token de Mario en prod.

- [ ] Si vuelve a caerse un cobro sin respuesta del conector (pasó una vez, 2026-11-06 18:01 UTC; no se reprodujo en
      dos cobros nuevos, también tras 7 minutos sin tráfico): leer `vtex logs --past` del conector en `master` en el
      momento, con la sesión de una persona. VTEX lo reintenta solo hasta un día; termina cuando se sabe la causa o
      cuando ningún cobro se cae durante el piloto.
- [ ] Definir quién recibe en la cuenta VTEX de la tienda el correo de «error de captura» que VTEX manda cuando un cobro
      falla; termina cuando la cuenta de Mario tiene ese correo puesto.
      Depende de: Comercial / Operaciones — a quién le llega en la tienda.
- [x] ~~Separar el arreglo de «una solicitud por pedido»~~ — pasó a su propia tarea (CORE-819), con su rama y su PR.

- [x] ~~El conector pide la URL a `payment-link`~~ — rama `payment-link` del repo `vtex` (6eeeb83, local, sin push):
      `authorize` llama con AppKey = hash y AppToken = Bearer, redirige al `?ref=` y niega si falla; host por
      configuración de la app (producción o develop). Probado con el conector real en local contra el mock.
- [x] ~~`payment-link` y `ecommerce/status` publicados en el gateway de producción~~ — medido el 2026-10-21:
      `https://v2.api.creditop.com/legacy-api/ecommerce/payment-link` y `…/ecommerce/status/{id}` responden 401 sin
      token (una ruta inexistente da 404). `/vtex/settel` ya no hace falta (d24c10e).
- [x] ~~Llevar `payment-link` a `main` y a producción~~ — legacy-backend#1682 entró a `main` el 2026-10-20 (c566e444)
      y va en los tags v0.6.21 y v0.6.22. En la base de prod hay 101 pedidos `origin=payment_link` (sucursal 2017,
      `ecommerce_id=2`) desde el 2026-10-20 21:32: la migración de la referencia está aplicada.
- [x] ~~Probar el conector en una cuenta VTEX (workspace de prueba y Test Suite)~~ — cuenta `creditop`, workspace de
      desarrollo `migueldev` (`master` sin tocar): compra real en el checkout aprobada (pedido VTEX
      `1670270500201-01`, transacción `Approved`) y **Test Suite 7 de 7**. Afiliación «Creditop Miguel (dev)» y
      condición de pago «CREDITOP DEV» activas; la de Oscar («Creditop BNPL» → `oscarrinc`) apagada, sin borrar.
- [x] ~~Que `payment-link` (legacy-backend#1682, de Oscar) llegue a `qa`~~ — mergeado a `qa` el 2026-10-19; todo el
      recorrido de hoy corrió contra él.
- [x] ~~Llevar a `main` la apertura por referencia~~ — en `main` de legacy-backend (`by-reference`,
      `findByCheckoutReference`) y de frontend-monorepo (`checkout.tsx` lee `?ref=`, ee24bbe8, frontend-monorepo#1178,
      tag v1.10.36).
- [ ] Decidir el vencimiento de la referencia para VTEX y si una referencia vencida o usada sigue abriendo el
      pedido con OTP (hoy sí, para siempre, si el pedido no trae aceptación); termina con la regla escrita acá.
      Depende de: Producto — cuánto puede tardar el comprador entre la tienda y CreditOp (VTEX cancela a las 6 h).
- [ ] Dar de alta la sucursal ecommerce de Mario Hernández (comercio 350) con credencial `ecommerce_type_id=3` y su
      token de ecommerce (`ecommerce:issue-token`); termina cuando `payment-link` responde 200 con su hash en qa.
      Depende de: Comercial / Operaciones — si la tienda VTEX vende por UNA sucursal y cuál es su cuenta VTEX.
- [x] ~~Probar en `qa` el recorrido VTEX completo por referencia~~ — con el conector real en local y un comercio propio
      (363, sucursal `530aa4f7`, credencial tipo 3): pedido 7966 con `ecommerce_id=3` → solicitud 503800 en 11 → el
      `VtexNotifier` avisó `approved` al `callbackUrl`. Falta el `settle` (ver abajo).
- [x] ~~Que el `settle` del conector deje `/vtex/settel` y use `GET /ecommerce/status/{paymentId}`~~ — d24c10e: aprobado
      en qa para 7966, `ORDER_NOT_FOUND` para un pedido ajeno y `NOT_READY_TO_SETTLE` para uno sin solicitud. El
      conector ya no depende de application.

- [x] ~~Mergear `Creditop-SAS/vtex#21`~~ — mergeado a `main` el 2026-10-28 (61e8995, tag `v5.0.0`) con el visto bueno de
      Oscar. El alta de sucursales VTEX por la Partner API (legacy-backend#1693) ya estaba en `main` por 51181aaf3 y en
      prod desde v0.6.29: prod tiene `ecommerces` id 4 = Shopify.

- [x] ~~Confirmar el cobro real de un pedido VTEX~~ — 2026-10-22: el pedido `1670710500205-01`, facturado a mano por
      la API de OMS, cobró por el conector (`settlements` 200 con `settleId`) y la transacción quedó `Finished`. VTEX
      cobra al FACTURAR, no a las 6 h: el pedido del 2026-10-20 (`1670270500201-01`) sigue aprobado sin cobrar.
- [x] ~~Que el conector traduzca el tipo de documento de VTEX~~ — hoy en el commit único del PR #21 (182943a, junto con el conector):
      `cedulaCOL` → `CC` en `paymentLinkBody`; en qa el pedido 7983 guardó `CC` y su contexto lo devuelve como `CC`.
      Otros tipos de Colombia que VTEX pueda mandar (extranjería, pasaporte) no se vieron todavía: pasan tal cual.
- [x] ~~Decidir si se restringe el modo Test Suite~~ — decidido el 2026-10-29: no. El modo prueba lo activa el header
      `X-VTEX-API-Is-TestSuite` (framework `@vtex/payment-provider`, estándar) que manda VTEX al correr su Test Suite; una
      llamada directa con el header no aprueba ningún pedido real, y la Test Suite hace falta para homologar.
- [ ] Definir con Producto el reembolso manual, el mismo para VTEX y Shopify. VTEX no lo frena: el conector contesta
      `refund-manually` y VTEX lo acepta. Pero con eso nadie en Creditop se entera y el crédito sigue vivo aunque la
      tienda lo dé por reembolsado. La propuesta: el conector sigue contestando `refund-manually` y además avisa a
      Creditop con el pedido y el monto; operaciones cancela o ajusta el crédito y le dice al comprador en cuántos días.
      Ojo: VTEX tiene una falla conocida («No Fix») que puede registrar dos veces un reembolso con `refund-manually`;
      probar una devolución en `migueldev` y ver cómo queda el pedido. Depende de: Producto — quién devuelve la plata,
      el plazo y el canal para el comprador. Termina con la regla escrita acá y el conector avisando.
- [ ] Revocar el token de `payment-link` de la sucursal de prueba `530aa4f7` (quedó visible en capturas y en logs de
      `vtex link`) y emitir otro; termina cuando el viejo responde 401.
- [ ] Al terminar las pruebas en la cuenta, devolver la condición de pago: activar la de Oscar y apagar «CREDITOP DEV»
      (o acordarlo con él). Depende de: Miguel — hablar con Oscar.
- [ ] Saber qué cuentas VTEX tienen instalada hoy `creditop.creditop` (la 4.x, con `/vtex/init`). En la base de prod
      el único `ecommerce_id=3` es la sucursal de prueba 1440, con el último pedido en marzo; termina con la lista de
      cuentas. Depende de: Oscar / Comercial — quién la instaló.
- [ ] Instalar la 5.1.0 en la cuenta VTEX de Mario y hacer la primera compra, siguiendo
      `artifacts/guia-tienda-mario-5.1.0.html`; termina con una compra suya aprobada en VTEX. Antes, confirmar que la 5
      (conector `creditop-creditop-v5`) está habilitada para otras cuentas: no está comprobado.
      Depende de: Comercial / Operaciones — la sucursal y el token de Mario en producción, y el acceso a su cuenta VTEX.
- [x] ~~Publicar la 5.0.1~~ — 2026-11-05: vtex#22 mergeado (f4e2896), tag `v5.0.1`, publicada, desplegada e instalada en
      `master` y `develop`. Contra la publicada: 4/4 con instancias arriba y 0,8 s una compra sola.
- [x] ~~Publicar la 5.0.2~~ — 2026-11-05: vtex#23 mergeado (97f4f6e), tag `v5.0.2`, instalada en `master` y `develop`;
      recién instalada ya no hubo 401.
- [x] ~~Publicar la 5.0.3~~ — 2026-11-05: vtex#24 mergeado (6a661a1, con la CI), `v5.0.3` publicada e instalada en
      `master` y `develop` a las 16:02; los cuatro desenlaces bien en qa.
- [x] ~~Ver que la primera compra tras una hora sin compras no tarde ni dé `ProxyTimeout`~~ — 2026-11-05 17:50, con la
      5.0.3: aprobada en 1,3 s tras hora y media quieta; y el cobro al facturar quedó Finished.
- [ ] Qué hace Creditop cuando VTEX cancela un pedido cuya solicitud sigue viva: se resuelve con el estándar de la
      tarea #112 (`ecommerce-cancelacion-de-pedidos`), igual para todas las tiendas. Del lado de VTEX es su pieza E (el
      conector llama al endpoint de cancelar y devuelve el `requestId`). Termina cuando la #112 cierra esa pieza.
- [ ] ¿Una solicitud puede salir de un estado final por el webhook de una entidad real? (Duncan lo vio sólo con el
      simulador, que lo permite a propósito). Termina reproducido —y entonces una guarda en legacy-backend— o descartado.
- [ ] Homologar con VTEX la versión nueva de `creditop.creditop` (el modo Test Suite y cancelaciones/reembolsos
      resueltos antes): termina con VTEX aprobándola.

- [ ] Versión posterior · un aviso «Paga con Creditop» en la página del producto, antes del checkout, como el de Addi
      (texto con cuotas y un modal que explica cómo comprar). En VTEX sería un bloque del tema de la tienda. Termina
      con el aviso instalado en una tienda. Depende de: Producto — qué cuotas o monto mostrar, si Creditop no sabe
      todavía qué entidad le sale al comprador.
- [ ] Versión posterior · que Creditop sepa cuándo el comercio facturó el pedido. Hoy el conector recibe el `settle`
      de VTEX (llega al facturar), consulta el estado y confirma, pero no se lo cuenta a Creditop: Creditop sabe si
      aprobó, no si el comercio facturó. Ojo: facturar no es entregar; la entrega va por el seguimiento del envío del
      pedido en VTEX, que hoy tampoco miramos. Termina con la decisión escrita y, si sirve, el aviso guardado en la
      solicitud. Depende de: Producto — si a Creditop o a las entidades les sirve (p. ej. desembolsar contra despacho).
- [ ] Versión posterior · un formulario en el checkout para pedir los datos que la tienda no trae (tipo y número de
      documento, fecha de expedición), como el que trae el pago con tarjeta, para que el wizard no los vuelva a pedir.
      En VTEX sería una Payment App del checkout. Termina con los datos llegando a `payment-link` y el wizard
      saltando esas preguntas. Depende de: Producto — qué datos se piden y si el wizard confía en ellos.

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
4. Para producción: el backend ya está (`payment-link`, `ecommerce/status`, `by-reference` y la migración, desde el
   2026-10-20). Falta el conector: mergear #21, homologar, publicarlo como mayor nueva y probarlo con UN comercio
   piloto (la sucursal de Mario, su token) antes de ofrecerlo a otras tiendas.

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

**La tienda VTEX de verdad, sin nadie en el checkout (verificado el 2026-11-05).** Compra en la tienda de pruebas por
la API de Checkout con la identidad de cada caso, entra al wizard de qa por el `?ref=`, le da el desenlace y espera a
VTEX. Pide la VPN de dev (simulador y base de qa) y la llave de `harness/.env.vtex`. La versión del conector que atendió
sale en la primera línea; en ecommerce se ve en el bloque VTEX del sidebar.

```sh
make harness-vtex TARGET=qa                       # aprobada, negada, cancelada y tienda-cancela, en paralelo (~90 s)
make harness-vtex TARGET=qa CASES=tienda-cancela VERBOSE=1
```

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

**El piloto (la 5.0.0 publicada) contra qa, y después contra prod.** El workspace `piloto` (production=true) tiene
instalada `creditop.creditop@5.x`; `migueldev` y `master` siguen en la 4. Una compra la atiende el conector que diga la
AFILIACIÓN, no el workspace de la tienda: cada versión mayor tiene la suya (`creditop-creditop-v4`, `-v5`), y en modo
*Test* lleva el campo `workspace` (README del conector, «Testing in production»). Afiliaciones y condiciones de pago
son de toda la cuenta: también las ve master.

| | contra qa (ahora) | contra prod (con la sucursal de Oscar) |
|---|---|---|
| afiliación | nueva, del conector v5, modo *Test*, workspace `piloto` | la misma |
| AppKey / AppToken | `530aa4f7` y su token de qa | hash y token de la sucursal de prod |
| `environment` de la app en `piloto` | develop | production |
| condición de pago «Creditop» | apunta a la afiliación v5 | la misma |

Pasar de qa a prod son DOS campos: AppKey/AppToken de la afiliación y `environment`. Volver a probar con `vtex link`
en `migueldev` es devolver la condición a «Creditop Miguel (dev)» (v4).

```sh
curl -s -o /dev/null -w '%{http_code}' https://piloto--creditop.myvtex.com/_v/creditop.creditop/v5/manifest
```
Resultado: 200 (2026-10-28); `migueldev` y `master` contestan en `/v4/manifest`.

**En la cuenta VTEX `creditop`, de punta a punta contra qa (verificado el 2026-10-22: compra, aprobación y cobro).**
Sólo en el workspace de desarrollo `migueldev`; nada en `master`. Pide la VPN de dev (simulador y base de qa).

| para qué | dirección |
|---|---|
| la tienda donde se compra | https://migueldev--creditop.myvtex.com |
| ver pedidos y pagos (admin) | https://creditop.myvtex.com/admin/orders · https://creditop.myvtex.com/admin/pci-gateway/#/transactions |
| Test Suite de VTEX | https://migueldev--creditop.myvtex.com/admin/test-suite/payment-provider |
| el conector (Service URL; `/manifest` responde si está linkeado) | https://migueldev--creditop.myvtex.com/_v/creditop.creditop/v4 |
| el wizard al que llega el comprador | `https://originaciones-qa.dev.creditop.com/ecommerce/530aa4f7/<solicitud>/lenders` |
| payment-link de qa (lo llama el conector) | https://api.dev.creditop.com/legacy-api/ecommerce/payment-link |
| aprobar la solicitud (simulador; sólo por la dirección interna) | `POST http://legacy-backend-qa.inertia-develop/simulator/aggregator-result` |
| qué recibe el wizard para prellenar | `GET http://legacy-backend-qa.inertia-develop/api/onboarding/ecommerce-request/by-user-request/<solicitud>` |
| la transacción en VTEX (estado e historial) | `https://creditop.vtexpayments.com.br/api/pvt/transactions/<transacción>` y `…/interactions` |
| el pedido en VTEX (estado, pasar a manejo, facturar) | `https://creditop.vtexcommercestable.com.br/api/oms/pvt/orders/<pedido>` · `…/start-handling` · `…/invoice` |

Las dos APIs de VTEX se llaman con `-H "VtexIdclientAutCookie: $(vtex local token | tail -1)"`.

1. **Subir el conector** (la rama de #21) a `migueldev`:
   ```sh
   vtex login creditop          # interactivo; deja en master
   vtex use migueldev           # SIEMPRE antes de linkear
   cd ~/Desktop/CREDITOP/github/vtex && vtex link
   ```
   `/manifest` responde 200 cuando quedó. La app de `migueldev` tiene `{"environment":"develop"}` (sin eso usa
   producción). `vtex link` reescribe `node/package.json` y `node/yarn.lock`: no se commitean. La afiliación
   «Creditop Miguel (dev)» apunta a `migueldev` con la sucursal `530aa4f7` y la condición de pago «CREDITOP DEV» está
   activa (es de toda la cuenta).
2. **Comprar** en la tienda con Creditop. El conector pide el enlace a payment-link y el comprador cae en el wizard de qa
   (`?ref=`); con OTP llega al listado. El número de solicitud está en la URL del wizard.
3. **Revisar qué llegó** (sucursal, plataforma VTEX = 3 y datos del comprador):
   ```sql qa
   SELECT er.id, er.ecommerce_id, er.allied_branch_id, er.origin, er.data FROM ecommerce_requests er JOIN user_requests_by_ecommerce_request l ON l.ecommerce_request_id=er.id WHERE l.user_request_id=<solicitud>
   ```
4. **Aprobar** con el simulador (por la dirección interna; el gateway público da `Not Found`):
   `curl -X POST http://legacy-backend-qa.inertia-develop/simulator/aggregator-result -H 'Content-Type: application/json' -d '{"user_request_id":<solicitud>,"status":11}'`.
   En segundos la transacción de VTEX pasa a `Approved` y el pedido a `window-to-cancel`.
5. **Cobrar:** el pedido queda 30 minutos en `window-to-cancel`; después, `POST …/start-handling` y `POST …/invoice`
   con `{"type":"Output","invoiceNumber":"PRUEBA-…","invoiceValue":<valor en centavos>,"issuanceDate":"<ISO>","items":[{"id":"<sku>","quantity":<n>,"price":<precio en centavos>}]}`.
   VTEX manda el settle al conector y la transacción queda `Finished`. Sin factura no cobra nunca.

- La Test Suite se corre desde el admin con Service URL de arriba, AppKey `530aa4f7` y AppToken = el token de esa
  sucursal (está cargado en la afiliación de VTEX; en el playground no hay copia).
- Sin cuenta VTEX: la tienda demo hace de VTEX completo, en local o contra qa (`make harness-store`, modo qa en
  harness/CLAUDE.md).

## Referencias

- Estado para el equipo: `artifacts/creditop-para-vtex.html` (publicado como «Creditop para VTEX»,
  https://claude.ai/artifact/UQYDZAVGBGgkvMMMEaGKxB, privado hasta compartirlo).

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
- El cobro que hace VTEX después de aprobado se confirma contra el estado del pedido en CreditOp: sólo se cobra una
  solicitud autorizada.

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
- Cobrar el pago aprobado: se aprueba; uno sin solicitud autorizada se rechaza.

## Cambios en datos
- Las columnas de la referencia en los pedidos de ecommerce (ya aplicadas en dev, qa, staging y
  producción).
- Alta de la sucursal ecommerce de la tienda con su credencial marcada como VTEX.

## Criterios de aceptación
- El enlace que devuelve el inicio de VTEX no contiene la credencial ni los datos del pedido.
- Todo pedido VTEX tiene sucursal y plataforma VTEX registradas, y la solicitud que genera queda en esa sucursal.

## Dependencias / contraparte
- Comercial / Operaciones: cuenta VTEX y sucursal de la tienda de Mario Hernández.
- Producto: cuánto dura vigente el enlace.
