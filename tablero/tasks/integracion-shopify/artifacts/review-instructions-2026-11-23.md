# Instrucciones para la revisión de pagos de Shopify — borrador del 2026-11-23

Para pegar en el formulario de envío a revisión (Partner Dashboard → la app pública 447249776641 → Distribution). Sale de
las pruebas en producción del 2026-11-20 (aprobar, rechazar) y del 2026-11-23 (cancelar, reembolso desde el admin), en la
pila de la tarea. Lo que va entre corchetes se llena antes de enviar.

Antes de enviar, confirmar con una captura:
- el nombre exacto del interruptor del modo de prueba en Configuración → Pagos → Creditop (abajo dice «Enable test mode»);
- que la sucursal dedicada pase «Conectar sucursal» en una tienda limpia (el token se valida contra Creditop al guardar).

---

## Testing instructions (English, to paste)

**About Creditop**

Creditop is a buy-now-pay-later (BNPL) payments app for Colombia (COP). At checkout the buyer chooses Creditop, applies for
credit online with Creditop, and returns to the store with the order paid if the credit is approved.

In **test mode** no credit application is made and no money moves. Instead of our credit application, the buyer sees a
Creditop test page where the reviewer chooses the outcome. Everything below can be tested without applying for real credit.

Note: the app's screens are in Spanish (our merchants are in Colombia). The labels you will see are quoted below.

**Test credentials**

- Branch code (Código de la sucursal): `[BRANCH CODE]`
- Branch token (Token de la sucursal): `[TOKEN]`

These belong to a test branch dedicated to this review. They do not create real credits.

**1. Install and configure Creditop**

1. Install the app on a development store using the installation link: `[INSTALL LINK]`. Approve the requested permissions.
2. The app opens in the Shopify admin (Apps → Creditop) on the page «Vende a crédito en tu tienda».
3. Under «Tu sucursal de Creditop», enter the branch code in «Código de la sucursal» and the token in «Token de la sucursal»,
   then click «Conectar sucursal». The page shows «Conectada a la sucursal …» when the token is accepted.
4. Go to **Settings → Payments** and activate **Creditop**.
5. In Creditop's payment settings, turn on **test mode** («Enable test mode»). Test orders show the banner "Test order".

**2. Approve (order paid)**

1. In the online store, add any product to the cart and go to checkout.
2. Fill in contact and shipping details, choose **Creditop** as the payment method and click **Pay now**.
3. You are redirected to the Creditop test page («Modo de prueba · Simula el resultado del crédito»), which shows the store,
   amount and a reference.
4. Click **«Aprobar crédito»** (Approve credit).
5. Expected result: you return to Shopify's thank-you page ("Your order is confirmed"). In the admin, the order is **Paid**.

**3. Decline**

1. Repeat steps 1–3 of Approve.
2. Click **«Rechazar crédito»** (Decline credit).
3. Expected result: you return to checkout with a payment error message, and you can choose another payment method or try
   again. No order is created.

**4. Cancel**

1. Repeat steps 1–3 of Approve.
2. Click **«Cancelar y volver a la tienda»** (Cancel and return to the store).
3. Expected result: you return to checkout with the message that the payment was cancelled, and you can choose another
   payment method or try again. No order is created.

**5. Refund**

1. Open an order paid with Creditop in test mode (from step 2) in **Orders**.
2. Click **Refund**, select the items or amount, and confirm the refund to Creditop.
3. Expected result: the timeline shows the refund as pending and then "Refunded … to Creditop". The order is **Refunded**.
   In test mode refunds are approved automatically by the app.

**How it works (for reference)**

- Creditop is an offsite payments extension. Payment and refund sessions reach our server over mTLS.
- The result of each payment (approve, decline, cancel) and each refund is reported to Shopify through the Payments Apps
  API (`paymentSessionResolve`, `paymentSessionReject`, `refundSessionResolve`).
- Outside test mode, the buyer goes to Creditop's credit application instead of the test page, and the session is resolved
  or rejected when the credit decision is made.

**Contact**

`[Name, email]`

---

## En español (para revisarlo)

1. **Instalar y configurar:** instalar con el enlace, abrir la app en el admin, cargar el código y el token de la sucursal
   de prueba («Conectar sucursal»), activar Creditop en Configuración → Pagos y prender el modo de prueba.
2. **Aprobar:** comprar con Creditop → página de prueba → «Aprobar crédito» → página de gracias; el pedido queda Pagado.
3. **Rechazar:** «Rechazar crédito» → vuelve al checkout con un error de pago; puede pagar de otra forma.
4. **Cancelar:** «Cancelar y volver a la tienda» → vuelve al checkout con el aviso de pago cancelado.
5. **Reembolso:** desde el pedido pagado, «Reembolsar» → la cronología pasa de pendiente a «reembolsado a Creditop»; el
   pedido queda Reembolsado. En modo de prueba la app aprueba el reembolso sola.

Se aclara que las pantallas de la app están en español y que en modo de prueba no se pide crédito ni se mueve dinero.

## Lo que falta llenar

- `[BRANCH CODE]` y `[TOKEN]`: la sucursal de prueba dedicada (pendiente de Miguel / Producto).
- `[INSTALL LINK]`: el enlace de instalación de la app pública (sale de Partner Dashboard → Distribution).
- `[Name, email]`: el contacto para los revisores.
