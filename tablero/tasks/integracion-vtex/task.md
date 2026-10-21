---
id: 102
title: "Integración VTEX: generar la URL de checkout y saber de qué sucursal viene el pedido"
stage: evaluation
created: "2026-10-19T12:00:00-05:00"
knowledge: [ecommerce-context]
canon: []
jira: [CORE-800, CORE-638]
jira_title: "Integración VTEX: enlace de pago con referencia y pedidos atribuidos a la sucursal"
ramas: core-800-vtex-payment-link
---

## Pendientes

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

- [ ] Revisar y mergear `Creditop-SAS/vtex#21` (el conector, `feat/core-800-vtex-payment-link` → `main`; reemplaza al #20, cerrado al renombrar la rama). Depende de
      `Creditop-SAS/legacy-backend#1693` para dar de alta sucursales VTEX por la Partner API. Termina mergeado.

- [ ] Confirmar el cobro real del pedido VTEX `1670270500201-01` (VTEX lo hace al facturar o a las 6 h): termina
      con la transacción en `Finished` y el settle aprobado en el log del conector.
- [ ] Decidir si se restringe el modo Test Suite antes de producción (hoy cualquier llamada con
      `X-VTEX-API-Is-TestSuite: true` recibe respuestas de prueba); termina con la regla escrita y probada.
- [ ] Cancelaciones y reembolsos reales: hoy el conector los niega. Depende de: Producto — qué es cancelar y reembolsar
      una compra financiada. Termina con la regla escrita y el conector cumpliéndola.
- [ ] Revocar el token de `payment-link` de la sucursal de prueba `530aa4f7` (quedó visible en capturas y en logs de
      `vtex link`) y emitir otro; termina cuando el viejo responde 401.
- [ ] Al terminar las pruebas en la cuenta, devolver la condición de pago: activar la de Oscar y apagar «CREDITOP DEV»
      (o acordarlo con él). Depende de: Miguel — hablar con Oscar.
- [ ] Homologar con VTEX y publicar la versión nueva de `creditop.creditop` (llega a todas las tiendas que la tienen):
      termina con la versión publicada. Sólo después de los PRs y de producción.

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

**En la cuenta VTEX `creditop` (sólo el workspace de desarrollo `migueldev`; nada en `master`):**

```sh
vtex login creditop          # interactivo; deja en master
vtex use migueldev           # SIEMPRE antes de linkear
cd ~/Desktop/CREDITOP/github/vtex && vtex link
```
- Ambiente del conector: `{"environment":"develop"}` en la configuración de la app de `migueldev` (sin ella usa
  producción). `vtex link` reescribe `node/package.json` y `node/yarn.lock`: no se commitean.
- Test Suite: `https://migueldev--creditop.myvtex.com/admin/test-suite/payment-provider`, Service URL
  `https://migueldev--creditop.myvtex.com/_v/creditop.creditop/v4`, AppKey `530aa4f7`, AppToken = el token de esa sucursal.
- Compra real: `https://migueldev--creditop.myvtex.com`, pagar con Creditop → wizard de qa → simulador de qa (estado 11)
  → la transacción pasa a `Approved`.
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
