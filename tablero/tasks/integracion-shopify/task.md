---
id: 103
title: "Integración Shopify: generar la URL de checkout y saber de qué sucursal viene el pedido"
stage: evaluation
created: "2026-10-19T12:00:00-05:00"
knowledge: [ecommerce-context]
canon: []
jira: [CORE-689]
jira_title: ""
---

## Pendientes

- [ ] Revocar el Bearer de Sanctum escrito en el repo `shopify` y sacar el token, la PII y los artefactos
      versionados (`dist/`, `logs/cli-trace.log`, `prisma/dev.sqlite`, `shopify-app-info.json`); termina cuando
      el token ya no autentica y un escáner de secretos sobre el historial no encuentra nada vigente.
      Depende de: Infra — dónde se emitió el token y quién lo revoca.
- [ ] Confirmar que Shopify admite una Payments App offsite para tiendas en Colombia con COP y que CreditOp es (o
      puede ser) Payments Partner; termina con la respuesta escrita acá.
      Depende de: Merchants — lo que respondió Shopify en MER-2, MER-54 y MER-96.
- [ ] Agregar Shopify al catálogo `ecommerces` (id 4) y poder marcar una credencial con `ecommerce_type_id=4`;
      termina con la migración de siembra y una credencial de prueba en local.
- [ ] Crear en legacy-backend `POST /shopify/init` (adaptador como `/vtex/init`): valida `hash` + credencial, guarda el
      pedido con `origin=payment_link` y `checkout_reference`, y devuelve `redirect_url = …/checkout?ref=`;
      termina con su prueba unitaria y una URL que abre el pedido en local.
- [ ] En la app de Shopify, atender `payment_session_url`: leer la sesión de pago, buscar la sucursal de la tienda,
      llamar a `/shopify/init` y responder a Shopify el `redirect_url`; termina con una sesión de una tienda de
      desarrollo que redirige al wizard con `?ref=`.
- [ ] Guardar en la app, por tienda (`myshopify` domain), el `hash` de la sucursal y la credencial (cifrada), que el
      comercio carga al configurar la app (`paymentsAppConfigure`); termina cuando dos tiendas de desarrollo abren
      pedidos en sucursales distintas.

## Objetivo

Que una compra en una tienda Shopify llegue a CreditOp por la misma puerta que VTEX y quede atribuida a su sucursal:

1. **URL**: Shopify llama a la app (payment session); la app pide la URL a CreditOp servidor a servidor y responde
   un `redirect_url` que sólo lleva `?ref=`. Ni la credencial del comercio ni los datos del comprador pasan por el
   navegador.
2. **Origen**: una tienda Shopify = una sucursal. La app guarda, por tienda, el `hash` de la sucursal; el pedido queda
   con `allied_branch_id` (sucursal), `ecommerce_id=4` (Shopify) y `origin=payment_link`.

## Dónde se toca

**shopify** (app React Router, plantilla oficial; sin backend de pagos hoy)
- `extensions/creditop-ext-offside/shopify.extension.toml`: `payment_session_url` y `refund_session_url` apuntan a
  `api.2272.canary.creditop.com/shopify/*`, que ningún repo implementa; `supported_countries = ["US"]` y
  `supported_payment_methods = ["visa"]`. En `origin/feature/init_project` ya hay una `creditop-offsite` con
  `["CO","US"]` y scopes `write_payment_gateways,write_payment_sessions`, sin mergear.
- `app/shopify.server.ts`: OAuth y sesiones en Prisma (`prisma/schema.prisma`, sólo el modelo `Session`, en SQLite).
  Falta un modelo por tienda con `hash` y credencial, y otro para deduplicar las sesiones de pago por su id.
- `extensions/creditop-checkout/src/Checkout.jsx` y `app/routes/app._index.tsx`: simuladores con un Bearer, PII
  y un endpoint de ngrok escritos en el código. Se borran.
- Rutas nuevas: `app/routes/payments.session.tsx` (o equivalente) para `payment_session_url`.

**legacy-backend**
- `Modules/Onboarding/routes/webhooks.php`: junto a `vtex/init`, una ruta pública `shopify/init`.
- Un `ShopifyService` como `Modules/Onboarding/App/Services/VtexService.php`, que reusa
  `createWithCheckoutReference` de la tarea VTEX si ya existe (si no, lo crea esta tarea).
- `config/ecommerce.php`: el notificador de Shopify (id 4) queda para la tarea de resolución.
- Siembra del catálogo, como `database/migrations/2026_06_17_100000_seed_vtex_ecommerce.php`.

**frontend-monorepo**
- Sin cambios: el wizard ya abre `?ref=` en `qa` (`apps/loan-request-wizard/app/routes/ecommerce/checkout.tsx`).

## Cómo se ataca

1. Limpieza de seguridad del repo (no depende de nada).
2. Catálogo id 4 y `/shopify/init` en legacy-backend, probado con `curl` en local.
3. La app: configuración por tienda (hash + credencial) y la ruta de `payment_session_url` que llama a
   `/shopify/init`. Se prueba con una tienda de desarrollo y `shopify app dev`.
4. La resolución hacia Shopify (`paymentSessionResolve` / `Reject` por GraphQL, refund, GDPR) va en otra tarea.

## Lo que se evaluó y NO se eligió

- **Que la app arme la URL base64 del contrato unificado**: pone la credencial del comercio en el navegador y
  duplica en TypeScript la serialización PHP.
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
Con la API de verdad: `make harness-store A=restart PAYMENT_LINK_URL=http://localhost/api/ecommerce/payment-link
PAYMENT_LINK_TOKEN=<token de ecommerce:issue-token>`.


En local, legacy-backend con la siembra del catálogo y una credencial de prueba con `ecommerce_type_id=4`:

```sh
curl -s -X POST http://localhost:8080/shopify/init -H 'Content-Type: application/json' \
  -d '{"sessionId":"shp-<único>","orderId":"o-<único>","amount":600000,"currency":"COP","hash":"<hash>","credential":"<credencial>","cancelUrl":"https://tienda.example/cancel"}'
```

```sql
SELECT id, allied_branch_id, ecommerce_id, origin, checkout_reference IS NOT NULL AS con_ref
FROM ecommerce_requests WHERE order_key = 'shp-<único>';
```

Con la app: `shopify app dev --config shopify.app.creditop-ecommerce-payments.toml` sobre una tienda de desarrollo,
pagar con CreditOp y comprobar que el navegador termina en `/ecommerce/<hash>/checkout?ref=`.

## Referencias

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

## Alcance
- Una tienda Shopify corresponde a una sola sucursal del comercio.
- No incluye devolver el resultado del crédito a Shopify, reembolsos ni la publicación de la app.

## Dónde probar
QA, con una tienda de desarrollo de Shopify y una sucursal ecommerce configurada como Shopify.

## Cómo validar
- Pagar con CreditOp en la tienda de desarrollo: el comprador llega a CreditOp con el monto precargado.
- El enlace no trae datos del pedido ni la credencial del comercio.
- Dos tiendas configuradas con sucursales distintas generan pedidos en sus sucursales.

## Cambios en datos
- Shopify como plataforma en el catálogo de ecommerce.
- Alta de la sucursal ecommerce de la tienda con su credencial marcada como Shopify.

## Criterios de aceptación
- Todo pedido que entra por Shopify tiene sucursal y plataforma Shopify registradas.
- Ninguna credencial ni dato personal queda escrito en el código de la integración.

## Dependencias / contraparte
- Shopify: que admita la app de pagos para Colombia y la aprobación de CreditOp como socio de pagos.
- Infra: revocar el token expuesto.
