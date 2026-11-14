# VTEX · tienda de pruebas de CreditOp

Lo que se hizo el 2026-11-06 sobre la tienda VTEX de pruebas (`creditop.myvtex.com`), por qué, qué se trabó y por dónde
seguir. El objetivo de fondo: **probar el checkout de CreditOp de punta a punta en una sola tienda limpia**, y ver si con
los datos que el comprador deja en la tienda CreditOp puede **saltarse su onboarding**.

> Este repo es público. Acá no van tokens, App keys de afiliaciones, cédulas ni teléfonos. Las credenciales viven en el
> admin de VTEX (Pagos → Proveedores) y en los conectores locales.

## Qué hay en esta carpeta

| Ruta | Qué es |
|---|---|
| `manifest.json`, `store/`, `styles/`, `assets/` | El tema `creditop.tienda-simple` (Store Framework): inicio con la grilla de bicicletas, página de producto, carrito |
| `checkout-ui-custom/checkout6-custom.css` | El estilo del checkout de VTEX: logo, colores y tipografía de CreditOp, «Paga a cuotas con CreditOp» |
| `extras/prototipo-campos-creditop.html` | Prototipo (HTML suelto, datos ficticios) del switch «Auto-onboarding con Creditop» en la app, los campos en el checkout y lo que viaja en el payment-link |
| `README.md` | Cómo linkear y publicar el tema |

El repo original del tema, con su historial, sigue en `~/Workspace/Work/creditop/tienda-simple` (local, sin remoto).

## Estado de la cuenta `creditop` al cerrar el día

- **Workspaces:** sólo `master`. Se borraron `develop`, `pruebatema`, `estilos`, `conector` y `autoonb` (los de prueba los
  creamos y borramos nosotros; `develop` era una copia de master sin nada linkeado).
- **Apps en master:** `creditop.creditop` 5.0.3 (el conector, sin tocar) y `creditop.tienda-simple` 0.1.3. Se desinstaló
  el tema anterior `creditop.store-theme` 5.2.0; para volver: `vtex install creditop.store-theme@5.2.0`.
- **Conector (Apps → Creditop BNPL → Configuración):** «Pruebas (develop)» en master → llama a
  `api.dev.creditop.com/legacy-api`.
- **Afiliaciones (Pagos → Proveedores):** «Creditop qa» (modo Test) es la que usa la única condición de pago; su
  **workspace se cambió de `develop` a `master`** (con `develop` borrado, el pago fallaba con `WorkspaceNotFound`). Las
  viejas se renombraron `[NO USAR] Creditop BNPL` y `[NO USAR] Creditop Miguel (dev)` (apuntaban a workspaces que ya no
  existen; el admin no deja borrar afiliaciones).
- **Pedidos:** se cancelaron los de prueba que retenían stock. Cinco quedaron con la etiqueta «Processing» aunque VTEX
  confirmó la cancelación y soltó su reserva; tres pasaron por «Canceling» esperando al conector.
- **Productos:** sólo las 6 bicicletas activas (las 3 de la plantilla ya estaban inactivas; el admin no deja borrarlas).
- **Recorrido verificado:** tienda → checkout → «Comprar ahora» → wizard de CreditOp en `originaciones-qa` con `?ref=`.

> **2026-11-09:** la condición de pago «Creditop qa» ahora usa la afiliación **«Mario Hernández (qa)»** (conector v5,
> sucursal `1126106a`, «PRUEBA AUTO · Mario Hernández» en qa, ya en `auto_onboarding_allied_branches`), para las pruebas
> del equipo de Duncan. Antes usaba «Creditop qa» (`ecf9342be`, «PRUEBA AUTO VTEX»); para volver, se cambia la afiliación
> de la condición de pago. Compra de control: pedido 1675020500458-01, Approved.

> **Ambientes del conector (verificado el 2026-11-09 en `infrastructure` `main`):** el setting `environment` del
> conector elige el host. `develop` (desde la 5.1.3 se muestra «Pruebas · QA de Creditop») →
> `api.dev.creditop.com/legacy-api`, y el API Gateway de desarrollo manda `ecommerce/payment-link` y `ecommerce/status`
> al backend de la rama **qa** (`leg-qa.develop.internal`), no al de develop
> (`environments/development/api-gateway/terragrunt.hcl:241-255`); el resto de `api.dev/legacy-api` sí va a develop.
> `production` → `v2.api.creditop.com/legacy-api` → `legacy-backend.production.internal`. Por eso las compras de
> esta tienda se prueban con el target `qa` del harness.
>
> **Versiones del conector:** 5.1.1 (ícono y textos de la ficha), 5.1.2 (documentación en español, captura, soporte en
> creditop.com) y 5.1.3 (nombres de los ambientes) están publicadas; instalada en master sigue la 5.1.0 hasta correr
> `vtex deploy creditop.creditop@5.1.3 && vtex install creditop.creditop@5.1.3`. Rama `feat/app-store-icon` del repo
> `vtex`, sin push.

## El tema (`creditop.tienda-simple`)

Tienda mínima: logo y carrito arriba, título, grilla de bicicletas, página de producto, pie de una línea. El checkout es
el de VTEX (no lo controla el tema), con estilo propio por `checkout-ui-custom`.

Versiones publicadas: 0.1.0 (tema), 0.1.1 (estilo del checkout), 0.1.2 (franja del carrito vacío), 0.1.3 («Paga a cuotas
con CreditOp» en vez de «Pago al contado»; candado del correo), 0.2.0 y 0.2.1 (bloque de auto-onboarding del checkout) y
0.2.2 (la página de pedido realizado, `vtex.order-placed`: sin ella «Volver a la tienda» quedaba en blanco).
Instalada: 0.2.2 (2026-11-09).

- **La tienda entera pide el login del admin de VTEX** a quien no lo tiene (el inicio y `checkout/orderPlaced` redirigen
  a `_v/segment/admin-login`; sólo `/checkout/` abre sin sesión). Las pruebas se hacen desde un navegador con esa sesión.

### Lo que costó (y se resolvió)

- **El inicio usa `header.full`, no `header`**: con sólo `header`, VTEX pone su encabezado por defecto.
- **La galería va dentro de `search-content`**: directa en el layout, la consulta trae los productos y no pinta ninguno.
- **Con Intelligent Search, `customQuery` va por el slug** de la categoría (`bicicletas`), no por su id.
- **Con dos temas instalados, el viejo gana la página de inicio**: hay que desinstalar el anterior.
- **El admin del checkout está bloqueado por facturas impagas de VTEX** (también Price List y Shipping Rates): el logo y
  el estilo del checkout se hicieron desde el tema con el builder `checkout-ui-custom`.
- **«Pago al contado - $…»**: VTEX lo escribe porque la condición de pago tiene una sola cuota; las cuotas las define
  CreditOp. Se reemplazó el texto por CSS (`.CreditopGroupPaymentGroup .installments p.sight`).
- **VTEX exige 7 minutos entre `vtex publish` y `vtex deploy`**, aunque se use `--force`.
- **Un workspace de desarrollo pide login del admin** en su host (`<ws>--creditop.myvtex.com`), salvo el checkout.
- **`vtex publish` puede devolver error y haber publicado igual**: confirmarlo con `vtex install` o un segundo publish.

## Saltarse el onboarding de CreditOp desde la tienda

### Lo que dice el código (legacy-backend `main` c470cf45, verificado 2026-11-06)

- `POST /api/ecommerce/payment-link` (`Modules/Onboarding/App/Http/Requests/CreatePaymentLinkRequest.php:26-50`) acepta,
  además de lo que el conector ya manda (monto, nombres, correo, celular, tipo y número de documento):
  `billing.birth_date`, `billing.document_expedition_date` (`Y-m-d`), `termAccepted` y `policyAccepted`
  (`Y-m-d\TH:i:sP`). Se guarda en `ecommerce_requests.data` y el wizard lo recibe como prellenado al abrir `?ref=`.
- **Salta el código por SMS** si la sucursal está en el setting `auto_onboarding_allied_branches` **y** el pedido trae
  celular, `termAccepted` y `policyAccepted` (`EcommerceRequestService.php:344-373, 563-574`).
- **Salta el formulario de datos** si además trae documento, nombre, apellido, correo y fecha de expedición
  (`auto-onboarding.server.ts:65-82` en el frontend). La de nacimiento es opcional, salvo que la sucursal la exija (ONB005).
- **La validación de identidad (burós) corre siempre.**
- No hay endpoint para que un comercio mande/verifique un OTP: bajo `api/ecommerce/*` sólo están `payment-link` y
  `status`. Por eso el OTP en la tienda se descartó: con el setting y las aceptaciones alcanza.

> ⚠ **Resuelto el mismo 2026-11-06 por la tarde; lo que sigue en esta sección y las dos siguientes es historia.** El
> conector 5.1.0 ([vtex#25](https://github.com/Creditop-SAS/vtex/pull/25), switch `autoOnboarding` apagado por
> defecto, lee los datos del pedido) quedó mergeado, publicado, desplegado e instalado en `master`, con el tema
> `tienda-simple` 0.2.0 (el bloque de Creditop en el checkout). Probado en qa con la copia de Mario: cierra en 11 y VTEX
> Approved con y sin el auto-onboarding, y prendido salta SMS y formulario. Las mediciones, en la pila de la tarea
> `integracion-vtex` (bloques del 2026-11-06 desde las 15:46); la guía para la tienda de Mario, en sus `artifacts/`.

### Lo que falta en VTEX

1. **El checkout no pide** fecha de nacimiento, fecha de expedición ni aceptación de términos (VTEX no tiene esos campos).
   Van como campos propios del pedido (`customData`) + un `checkout6-custom.js`.
2. **El conector no los manda** (`node/creditop.ts`, `paymentLinkBody`). Y el pedido de pago que VTEX le pasa al conector
   **no trae `customData`**: el conector tendría que leer el pedido (una llamada más y un permiso en el manifest).
3. Diseño acordado (ver el prototipo): en la app, **un switch «Auto-onboarding con Creditop»**; encendido, el checkout
   pide los tres datos como obligatorios y el conector los manda. Apagado, todo como hoy.

### El experimento que quedó a medias

- Setting de QA: se agregó la sucursal de «Creditop qa» a `auto_onboarding_allied_branches`
  (quedó con dos hashes, el que ya estaba y el de «Creditop qa», 2026-11-06 17:01). **Sacarla al terminar** si no se sigue probando.
- Rama local del conector (repo privado `Creditop-SAS/vtex`, en `~/Workspace/Work/creditop/vtex`):
  `exp/payment-link-auto-onboarding`, versión `5.0.4-beta.0`, **sin push y para no publicar**. Manda fechas fijas de
  prueba y las dos aceptaciones con la hora del pago, y va siempre contra develop.
- **No se pudo subir a VTEX**: `vtex link` y `vtex publish` del conector devolvieron **504 del builder** (CloudFront, ~30 s)
  en todos los intentos (11:14, 11:26, 12:02, 12:06). El tema sí se publica. Descartado: las dependencias raras del
  conector (`@types/ramda` de GitHub, los tipos de `vtexassets`) responden. Siguiente paso: ticket a VTEX con los ErrorID,
  o probar la llamada directa al payment-link de QA con el token de la sucursal (no depende de VTEX).

### Cómo seguir desde el PC con VPN

1. Probar el salto sin VTEX: `POST https://api.dev.creditop.com/legacy-api/ecommerce/payment-link` con el Bearer de la
   sucursal (token de ecommerce, `allied_ecommerce_credentials`) y el cuerpo completo (con fechas y aceptaciones);
   abrir la `redirect_url` y ver si va directo a validar identidad.
2. Si salta: implementar en `Creditop-SAS/vtex` el switch en `settingsSchema`, el envío en `paymentLinkBody` y la lectura
   del pedido; y en este tema, el `checkout6-custom.js` con los campos.
3. Pendientes menores: ticket a VTEX por el 504 del builder; las facturas impagas que bloquean partes del admin.

## Herramientas que se tocaron en my-tools

- `jarvis/`: subir archivos desde un botón que abre el selector (`upload`), y escritorio a 1440×900 con densidad 2.
- `harness/dev/setting.ts`: `add|remove` con **hash de sucursal** (antes convertía un hash como `"a1b2c3d4"` a `NaN` y rompía
  `auto_onboarding_allied_branches.hashes`). En la base compartida sigue exigiendo comercio «PRUEBA AUTO…».
