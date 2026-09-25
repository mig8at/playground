---
name: harness-canal-ecommerce
description: Probar la entrada por tienda (ecommerce) en el harness harness - la URL base64 que serializa el pedido, el contrato con el plugin de WooCommerce/VTEX, y el techo actual del canal. Usala cuando la tarea toque el checkout de un ecommerce, pkg/checkout-b64.ts, bin/ecommerce, mock-redirect (:8096) o las suites channel/ecommerce-*.spec.ts.
---

# Canal ecommerce · la entrada por tienda

La tienda serializa el pedido en una **URL base64**; el backend la decodifica, **crea la solicitud** y
redirige al cliente al wizard. Sin asesor: el cliente aterriza ya redirigido.

**Cómo se lanza:** `bin/ecommerce` + `E2E_ENTRY=ecommerce`. El spec arma la URL con
`pkg/checkout-b64.ts`, y `mock-redirect` (**:8096**) lo levanta `bin/ecommerce` (`bin/advisor:56`).

**El contrato vive en `pkg/ecommerce.ts`** (`contractForSpec`), reconciliado contra el plugin de
WooCommerce que instala el comercio (`class-creditop-gateway.php:470-512`); el mapa de cada parámetro
está en la cabecera de `pkg/checkout-b64.ts`. Para armar una URL a mano está el artefacto «contrato de
checkout» de la tarea #95. La copia del plugin se borró del playground el 2026-09-24 y sigue en la
historia: `git show 2b9d13be:creditop-woocommerce/class-creditop-gateway.php`.

## El techo del canal: ya NO es el de F-54

*(Acá decía que el canal ecommerce no cierra un crédito CreditopX (F-54): aterrizaba en el resolvedor de
Bancolombia y cancelaba la solicitud. Ya no es así: medido el 2026-09-25 en local, CrediPullman cerró en
estado 11 entrando por la tienda tres veces —dos por el caminador con navegador (uReq 467013 y 467026) y
una por el camino visual del panel (467012)—, con la solicitud atada al pedido.)*

Lo que frena hoy una compra por la tienda, medido ese día con varios comercios, y ninguno es del canal:

| | |
|---|---|
| una entidad que pide su propio OTP (Sistecrédito) | el wizard manda a `/ecommerce/…/validate-lender-otp`, que en `main` sólo está montada bajo `/merchant/…`: «Página no encontrada» |
| el comercio «Creditop» (`bb534d6a`, `eeddcc1c`) | el backend lo lleva por el onboarding de Corbeta (sin personal-info) y la confirmación falla después |
| una CreditopX sin `pdf_mapper_project_slug` en local | con los documentos por el microservicio, `sign-documents` da 500. En local sólo CrediPullman tiene el slug |

## Lo que sí se puede probar hoy

- **La misma identidad por dos puertas.** El usuario sintético viaja **adentro** de la URL base64, así que
  podés correr la misma identidad entrando por asesor y por tienda y comparar. Eso es lo que el canal
  cambia: la PUERTA, no el caso.
- **El contrato de decodificación**: que el backend acepte la URL y cree la solicitud con los datos del
  pedido (monto, items, comercio).
- **VTEX** tiene su propia suite: `channel/vtex-checkout.spec.ts`. El conector VTEX se está migrando a
  `legacy-backend` con base64 unificado (rama `feature/onboarding/ecommerce-unify-base64-vtex`).

## Gate del panel

**El arranque «saltar a Lenders» NO aplica** en este canal: `DIRECT_LENDERS` exige
`ENTRY !== 'ecommerce'`, así que elegirlo no haría nada. «Inicio» (monto) sí aplica. El panel lo deshabilita
en vez de esconderlo — ver skill `harness-panel`.

El canal se ofrece en **cualquier comercio que no sea Corbeta**; en Corbeta el panel solo ofrece `qr`.

## Suites

`channel/ecommerce-local-real.spec.ts` · `ecommerce-no-cookie.spec.ts` · `ecommerce-notify.spec.ts` ·
`ecommerce-prefill-demo.spec.ts` · `ecommerce-ui.spec.ts` · `vtex-checkout.spec.ts`

⚠ Varias son anteriores al hallazgo del techo (F-54). Si una da 404 en el aterrizaje, **verificá contra
F-54 antes de "arreglarla"**: puede estar describiendo un camino que hoy no existe.
