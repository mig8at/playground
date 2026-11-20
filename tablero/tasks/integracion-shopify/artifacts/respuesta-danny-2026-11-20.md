# Respuesta a Danny (Shopify Support, ticket 72090155) — borrador del 2026-11-20

Lo envía Miguel en el hilo del ticket. Sale de la prueba de punta a punta del 2026-11-20 (bloques de ese día en la pila).

## En inglés (para enviar)

Hi Danny,

Thank you for your guidance. Your diagnosis was right: the development preview caused the routing problem. Here is where we are.

**1. Routing is fixed: the public app now processes its own payments**
- We stopped `shopify app dev` and ran `npx shopify app dev clean --config shopify.app.production.toml --store creditop-dev-store.myshopify.com` (Shopify CLI 5.0.2). The preview was removed and the active version (creditop-3) was restored.
- Checkout now shows "Creditop" (no longer "Creditop (anterior)"). Payment sessions from the public app reach the creditop-3 URL, `https://shopify-app.creditop.com:8443/payments/session`, and no longer go to the previous custom app.
- The error buyers saw in checkout in our first test came from our side: our production server was not configured for the public app yet. We have fixed it.

**2. End-to-end test in production (test mode, creditop-dev-store)**
- **Approved payment:** payment session `r26QG78ZL8Ts1PPdj72kovY6O`, received at 2026-11-20 13:57:00 UTC on `https://shopify-app.creditop.com:8443/payments/session`. We approved it and the order was confirmed (confirmation **X3RMQ3R82**, COP 800,000).
- **Declined payment:** payment session `rpS1R3eQPh8rXCTihiH4oOwbR`, received at 2026-11-20 14:16:15 UTC. We declined it and the buyer returned to checkout with a payment error, and could choose another payment method.

**3. How to test Creditop (for the review)**
A Creditop payment normally sends the buyer to our credit application, which needs a real customer and a credit decision. When the payment session is a test (`test: true`), we skip that flow. Instead, the buyer sees a Creditop test page with three options:
- **Approve credit**: the session is resolved and the order is paid.
- **Decline credit**: the session is rejected and the buyer returns to checkout to pay another way.
- **Cancel**: the buyer returns to the store.

The page reports the result to Shopify through the Payments Apps API. Test refunds are approved automatically. No real credit is requested and no money moves in test mode. To configure the app, a merchant enters a Creditop branch code and token in the app's admin page. We can provide test credentials for the reviewers.

**4. What we kept, as you asked**
We kept public app 447249776641 with the creditop-3 extension UID. Creditop-4 was never released, the previous custom app is still uninstalled, and both app records are kept.

Since routing works, we don't need the engineering review or a call. **We would like to start the approval and publication of the public app.** Could you confirm the next steps for submitting it for review, and whether anything is missing on our side (listing, test credentials, documentation)?

Thanks,
Miguel

## En español (para revisarlo)

1. **El enrutamiento quedó arreglado.** Hicimos la limpieza de la vista previa y volvió la versión activa, creditop-3. El checkout muestra «Creditop» y los pagos llegan a nuestra URL, ya no a la app personalizada anterior. El error que vimos en el checkout en la primera prueba venía de nuestro servidor de producción, al que le faltaba configuración, y ya lo arreglamos.
2. **Prueba de punta a punta en producción (modo de prueba):** el pago aprobado dejó el pedido confirmado (X3RMQ3R82); con el pago rechazado, el comprador volvió al checkout y pudo elegir otro medio de pago.
3. **Cómo se prueba Creditop:** en modo de prueba no se pide un crédito real. El comprador ve una página nuestra donde aprueba, rechaza o cancela, y el resultado se le informa a Shopify. Los reembolsos de prueba se aprueban solos. Para configurar la app hacen falta un código de sucursal y un token; les ofrecemos credenciales de prueba a los revisores.
4. **Mantenemos lo que pidió Danny:** la app pública con el UID de creditop-3, creditop-4 sin publicar, la app anterior desinstalada y los registros de las dos apps.

Pedimos arrancar la aprobación y publicación de la app pública y que Danny nos diga si falta algo.

## Antes de enviarlo

- Si Danny pide las credenciales para los revisores: hay que tener lista una sucursal de prueba (la conectada hoy en
  `creditop-dev-store` es `e5614c42`) y decidir quién de Creditop las entrega.
