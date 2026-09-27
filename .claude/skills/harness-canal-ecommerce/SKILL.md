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
| ~~una CreditopX sin `pdf_mapper_project_slug` en local~~ | **resuelto**: con los PDF por el mock, los runners le ponen `harness-local` a toda entidad sin proyecto (`wireMockDocProjects`, `pkg/config.ts`). Compucredit cerró en 11 con cuota inicial (467033) |

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

## El runner por API, en detalle

- `dev/ecommerce.ts` — **¿el CANAL ecommerce entrega lo que promete?** el carrito de una tienda de punta a punta, declarado en JSON y sin navegador (`make harness-ecommerce [SUITE=…]`). Contesta lo que `case.ts` no sabe contestar —`grep -c ecommerce dev/case.ts` da **0**, ese runner empieza DESPUÉS y no conoce canales—: si el contrato base64 se decodifica, si los seis campos del billing llegan como `prefill`, si el contexto se relee por `erId` **sin cookie**, y si la solicitud queda **atada al pedido** en la fila y en el puente. ⚠ Ese último chequeo no es decorativo: con el nombre viejo `ecommerce_request_id` (snake, el del v1) el backend **ignora el campo**, la solicitud nace sin vincular y **el comercio nunca recibe el veredicto de su compra**, sin ningún error. Probado rompiéndolo a propósito: da `fila=0 puente=0`. ⚠ La suite de la **sala de espera** va aparte (`suites/ecommerce-sala-de-espera.json`) porque depende de un PR sin mergear — separada y no «salteada», que un caso que se saltea se lee como verde. ⚠⚠ **SOLAPA con `channel/ecommerce-*.spec.ts`, y eso hay que decidirlo**: `ecommerce-no-cookie.spec.ts` ya fija el `erId`-en-URL y el vínculo, y `ecommerce-local-real.spec.ts` camina el flujo entero. La diferencia es el transporte —aquéllos van por **navegador** (Playwright, wizard corriendo, un `generate_checkout_url.php` que vive FUERA del repo y el perfil `.env.mock` de legacy) y éste va por **API en segundos, declarado en JSON**—, pero la cobertura se pisa. **No verifiqué si esos specs siguen pasando hoy**: nombran la rama de abril (`feature/onboarding/ecommerce-web-origination`) y el canal migró a OnboardingV2 desde entonces. Antes de agregar más casos acá, mirar si el lugar correcto es aquéllos

## Los specs de `channel/` corrían contra DEV, no contra local (2026-09-14)

> **MEDICIÓN · 2026-09-14** — ⚠⚠ **Sin `E2E_TARGET`, TODOS los specs de `channel/` escribían en el
> ambiente COMPARTIDO.** `pkg/config.ts` arma `mockUrl` leyendo `.env.<target>` y `TARGET` por defecto
> es **dev**, así que `config.mockUrl` resolvía a `http://legacy-backend.inertia-develop` — aunque el
> docblock de `playwright.config.ts` dijera «el backend corre en localhost». Medido: una corrida de
> `ecommerce-notify` creó allá el `ecommerce_request` **7331** mientras la base local iba por **6907**.
> **Cómo se vuelve a comprobar:** `node -e "const {config}=await import('./pkg/config.ts'); console.log(config.mockUrl)"`
> sin `E2E_TARGET` puesto.

⚠ **Y ahí no había red que lo frenara:** el guard `I_KNOW_THIS_TOUCHES_SHARED_DEV` (F-53) protege las
escrituras que pasan por `pkg/db.ts`, **no las que van por la API** — que son justo las de estos specs.

**Arreglado** fijando `process.env.E2E_TARGET ||= 'local'` en `playwright.config.ts`, que carga antes
que cualquier spec. Con `||=` para poder apuntar a otro ambiente a propósito
(`E2E_TARGET=qa npx playwright test …`).

**Y los specs del canal quedaron sanos.** Estaban rotos por tres cosas distintas, ninguna de negocio:

| spec | qué tenía | estado |
|---|---|---|
| `ecommerce-ui` | nada | ✅ pasa |
| `ecommerce-notify` | usaba `resolve`/`dirname`/`fileURLToPath` **sin importarlos** → `ReferenceError` al cargar, y Playwright reportaba «No tests found», que se lee como «no hay pruebas» en vez de «están rotas» | ✅ pasa |
| `ecommerce-no-cookie` | ruta ABSOLUTA a un `generate_checkout_url.php` que se movió al repo el 2026-07-19 | ✅ carga y corre; el paso del navegador pide la ruta nueva del front |
| `ecommerce-local-real` | ídem + hash quemado (`17f7b360`) | ✅ ídem |
| `ecommerce-prefill-demo` | — | ⚪ es una DEMO visual, lo dice su encabezado |

**Los tres dejaron de depender del script PHP externo**: ahora arman el contrato con
`contractForSpec()` de `pkg/ecommerce.ts`, que vive en el repo, resuelve el comercio contra la BASE
—nada de hashes quemados— y usa un **`order_key` único por corrida**. Eso último no es cosmético: con
la clave fija del script, el `upsert` caía siempre en la MISMA fila y, una vez `processed = 1`, la
notificación al comercio **ya no se disparaba**. Es la misma lección que `ecommerceContract` había
aprendido y que estos specs no tenían.

⚠ **Lo que NO se pudo evaluar:** los dos specs de navegador necesitan `/ecommerce/{hash}/checkout`, que
**sólo existe en `develop` y en la rama del PR** — en cualquier otra el wizard de `:5174` devuelve 404.
Su lógica sigue sin ejercitarse hasta levantar el front correcto.
