---
id: 102
title: "Integración VTEX: generar la URL de checkout y saber de qué sucursal viene el pedido"
stage: evaluation
created: "2026-10-19T12:00:00-05:00"
knowledge: [ecommerce-context]
canon: []
jira: [CORE-638]
jira_title: ""
---

## Pendientes

- [ ] `VtexService::init` guarda el pedido con `origin=payment_link`, `checkout_reference` aleatoria y vencimiento,
      con un método propio del repositorio (`createWithCheckoutReference`), y devuelve
      `redirectUrl = {front}/ecommerce/{hash}/checkout?ref=<referencia>`, sin `o/p/t/u/ps/config`; termina con su
      prueba unitaria y con el caso VTEX del harness llegando a `/lenders` en local.
- [ ] Avisarle a Oscar que ese método existe para que CORE-746 lo reuse; no bloquea esta tarea.
      Depende de: Oscar — si `payment-link` crea el pedido por el mismo método.
- [ ] Llevar a `main` la apertura por referencia (`by-reference` en legacy-backend y `checkout.tsx` en
      frontend-monorepo), hoy sólo en `qa`; termina cuando `git grep checkout_reference origin/main` la encuentra.
      Depende de: Miguel — si sale separada del auto-onboarding de Refurbi, que se sacó de `main` a propósito.
- [ ] Decidir el vencimiento de la referencia para VTEX y si una referencia vencida o usada sigue abriendo el
      pedido con OTP (hoy sí, para siempre, si el pedido no trae aceptación); termina con la regla escrita acá.
      Depende de: Producto — cuánto puede tardar el comprador entre la tienda y CreditOp (VTEX cancela a las 6 h).
- [ ] Dar de alta la sucursal ecommerce de Mario Hernández (comercio 350) con credencial `ecommerce_type_id=3`;
      termina cuando `/vtex/init` responde 200 con su hash en qa.
      Depende de: Comercial / Operaciones — si la tienda VTEX vende por UNA sucursal y cuál es su cuenta VTEX.
- [ ] Probar en `qa` el recorrido VTEX completo por referencia: init → `?ref=` → OTP → entidades → notificación
      a VTEX; termina con la solicitud en estado final y el pedido con `allied_branch_id` de la sucursal VTEX.

## Objetivo

Que el conector VTEX no exponga nada en la URL del comprador y que cada solicitud que entra por VTEX se pueda
atribuir a su sucursal y a su plataforma sin heurísticas:

1. **URL**: el conector ya no arma nada; `/vtex/init` guarda el pedido y devuelve una URL que sólo lleva `?ref=`.
   El token del comercio (que en VTEX es además el AppToken de la afiliación) y los datos del comprador dejan de
   viajar por el navegador.
2. **Origen**: una tienda VTEX = una sucursal. La sucursal sale del `hash` (AppKey de la afiliación) y la
   plataforma de la credencial. Tres columnas lo contestan: `ecommerce_requests.allied_branch_id` (sucursal),
   `ecommerce_requests.ecommerce_id` (plataforma: 3 = VTEX) y `ecommerce_requests.origin` (cómo se armó la URL:
   `payment_link` = la pidió la tienda por API).

## Dónde se toca

**legacy-backend**
- `Modules/Onboarding/App/Services/VtexService.php` (`init`): hoy arma la URL base64 con
  `EcommerceContractBuilder::buildCheckoutUrl`, con `t` = la credencial. Pasa a guardar referencia y vencimiento y a
  devolver `?ref=`. El `partnerKey` es el `hash` de la sucursal y el `secretToken` la credencial: siguen llegando
  servidor a servidor en el body y no cambian.
- `Modules/Onboarding/App/Repositories/EcommerceRequestRepository.php` (`upsert`): la llave de `updateOrCreate` es
  `order_key + order_identifier + allied_id + allied_branch_id`. Un reintento de `authorize` de VTEX con el mismo
  `paymentId` reusa la fila; hay que decidir si renueva la referencia o devuelve la misma.
- En `qa` (no en `main`): `EcommerceRequestService::openByCheckoutReferenceOrchestrator`,
  `EcommerceRequestRepository::findByCheckoutReference` (filtra `origin = payment_link`) y
  `consumeCheckoutReference`, `EcommerceRequest::ORIGIN_PAYMENT_LINK`, la ruta
  `POST ecommerce-request/by-reference/{partner_id}` y la migración
  `2026_10_14_120000_add_checkout_reference_to_ecommerce_requests`. Sin aceptación de términos en el pedido, la
  referencia abre el pedido y el comprador sigue por OTP; no la gasta.
- `config/ecommerce.php` (`frontend_url`) y `Modules/Onboarding/App/Services/Ecommerce/VtexNotifier.php`: no cambian.

**frontend-monorepo**
- `apps/loan-request-wizard/app/routes/ecommerce/checkout.tsx`: en `qa` ya resuelve `?ref=` contra `by-reference`.
  Sin cambios para VTEX, sólo llevarlo a `main`.

**vtex** (conector)
- `node/connector.ts` (`authorize`): ya sólo usa `creditopResponse.redirectUrl`; no cambia para la URL. El host
  `https://api.creditop.com` está fijo: probar en qa exige llamar `/vtex/init` directo o parametrizar el host
  (brecha del análisis de CORE-689, fuera de esta tarea).

## Cómo se ataca

1. Un método del repositorio, `createWithCheckoutReference` (sucursal, credencial, pedido, productos, URLs → fila
   con `origin=payment_link`, `checkout_reference`, `reference_expires_at`). Se escribe acá, sin esperar a
   CORE-746; `payment-link` lo puede reusar después.
2. `VtexService::init` lo llama y devuelve `?ref=`. El mapeo del body de VTEX al pedido (`paymentId → order_key`,
   `orderId → id`, `value → total`, `callbackUrl → process_url`) se queda en el adaptador.
3. Probar en local con el caso VTEX del harness (`vtexInit` ya llama al `/vtex/init` real) y después en `qa`.
4. Para producción: la apertura por referencia en `main`, la migración aplicada en prod y la sucursal de Mario.

## Lo que se evaluó y NO se eligió

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
  host por ambiente del conector, autenticación de `/vtex/settel`, Test Suite y homologación.
- La entrada sin OTP para VTEX: VTEX no manda aceptación de términos.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

**La tienda demo (verificado el 2026-10-19).** Mientras `payment-link` no esté en el backend local, un mock de su
contrato (el de legacy-backend#1682) más el plugin de VTEX simulado, con el wizard en :5174 y legacy-backend local:

```sh
make harness-store            # http://localhost:8113/ · elegir «VTEX» y la sucursal e9409aff, «Pagar con CreditOp»
```

La página muestra los cuatro saltos (plataforma → plugin → `payment-link` → plugin → comprador) y «Ir a CreditOp»
abre el wizard con `?ref=`. El webhook del backend llega a `/webhook/vtex` y se ve en la misma página.
Con la API de verdad: `make harness-store A=restart PAYMENT_LINK_URL=http://localhost/api/ecommerce/payment-link
PAYMENT_LINK_TOKEN=<token de ecommerce:issue-token>`.


En local, con legacy-backend y el wizard (:5174) en la rama, y la migración de la referencia aplicada:

```sh
# la URL que devuelve /vtex/init no lleva o/p/t, sólo ?ref=
curl -s -X POST http://localhost:8080/vtex/init -H 'Content-Type: application/json' \
  -d '{"paymentId":"vtx-<único>","orderId":"o-<único>","value":600000,"partnerKey":"<hash>","secretToken":"<credencial>","returnUrl":"https://tienda.example/ok","callbackUrl":"https://webhook.site/<id>"}'
```

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
