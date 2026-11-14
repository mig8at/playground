# Shopify · nivel 1: qué tiene el admin y cómo entra Creditop

Tienda de pruebas: `creditop-dev-store`. **`tienda-creditop` es la de producción («Transferencia a clientes») y no se
toca:** el barrido la excluye con `--prefix`. Es el nivel 1 de [`jarvis/GUIDE.md`](../../GUIDE.md).

Cada afirmación lleva su origen:
- **[visto]**: los dos barridos del 2026-11-07, en el Chrome de Miguel, sólo navegando. Recorrieron 34 pantallas del menú principal ([`sections.json`](sections.json)) y las 22 de Configuración ([`settings.json`](settings.json)). Para repetirlos:
  - `node jarvis/dev/sweep.ts shopify https://admin.shopify.com/store/creditop-dev-store --menu nav --prefix https://admin.shopify.com/store/creditop-dev-store`
  - `… /settings --menu 'ul[class*="_withSearchField"]' --prefix …/settings --out settings`
- **[código]**: la app de Creditop para Shopify, `github/shopify`, rama `develop` en `c99ad39` (2026-11-04).
- **[docs]**: la documentación oficial de shopify.dev: Payments apps, Payments Apps API y Admin GraphQL API.
- **[supuesto]**: no comprobado.

⚠ La sesión de Shopify que quedó en el Chrome de Miguel es la de **Juan Rodriguez** (juan@creditop.com). Lo que se haga desde ahí queda a su nombre. El barrido sólo mira.

## Las secciones

| sección | pantallas | para qué es |
|---|---|---|
| **Pedidos** | 4 | Pedidos, borradores, etiquetas de envío y pedidos abandonados [visto]. Acá se ve en qué quedó el pago de una compra con Creditop. En el inicio aparecían «Capturar pagos 4» y «Preparar pedidos 20» [visto] |
| **Productos** | 6 | Productos, inventario, colecciones, órdenes de compra, transferencias y tarjetas de regalo [visto] |
| **Clientes** | 3 | Clientes, segmentos y empresas (B2B) [visto] |
| **Marketing** | 4 | Crecimiento, atribución, Autopilot y campañas [visto] |
| **Descuentos** | 1 | Los descuentos y sus códigos (`DiscountNodes`, `DiscountCodeCountQuery`) [visto] |
| **Contenido** | 4 | Metaobjetos, archivos, menús y artículos del blog [visto] |
| **Mercados** | 2 | Mercados (país, moneda, envío) y catálogos [visto] |
| **Finanzas** | 4 | Finanzas, Bill Pay, Shopify Credit y los pagos de Shopify Payments [visto] |
| **Informes** | 3 | Informes y estadísticas, informes y la vista en tiempo real [visto] |
| **Configuración** | 22 | La tienda entera; abajo, lo que importa para Creditop [visto] |

En el menú también están los canales («Tienda online», «Agéntico») y las apps instaladas, entre ellas **CREDITOP-ECOMMERCE-PAYMENTS** [visto]. Esas pantallas se abren con un `appLoadId` que cambia cada vez, y en el segundo barrido no aparecieron.

### Configuración: lo que toca a Creditop

- **Pagos** (`settings/payments`): los medios de pago de la tienda (`PaymentProviders`) y el **método de captura del pago** (automática o manual) [visto]. Acá el comercio **activa** a Creditop después de instalar la app [docs].
- **Pago** (`settings/checkout`): la pantalla de pago y sus reglas (`CheckoutSettingsIndex`, `InstalledCheckoutRules`) [visto].
- **Apps** (`settings/apps`): las apps instaladas (`AppList`) [visto].
- Organización, usuarios, pagos y facturación de partner son de la **organización** CREDITOP, no de la tienda [visto].

## Cómo entra Creditop: una app de pagos «offsite»

Shopify no deja que un medio de pago se integre por su cuenta. Tiene que ser una **app de pagos** de un partner
aprobado, en uno de cinco tipos (tarjeta, tarjeta propia, alternativa, **offsite**, redimibles) [docs]. La de Creditop
es una extensión `payments_extension` llamada **CREDITOP-OFFSITE**. Se muestra como «Creditop» y declara el método
«generalfinancing»: es financiación, no tarjeta [código].

```
checkout ─▶ Shopify llama a payments/session de la app (payment_session_url)
               └─ la app le pide a CreditOp la URL del pedido (payment-link) y Shopify lleva al comprador al wizard
wizard  ─▶ el comprador vuelve por payments/return/<sesión> (pendPayment: el pago queda pendiente)
CreditOp ─▶ avisa a la app por webhooks/creditop (firmado): la app le PREGUNTA el resultado a CreditOp y lo aplica
               en Shopify con paymentSessionResolve o paymentSessionReject
reembolso ─▶ Shopify llama a payments/refund (refund_session_url): refundSessionResolve o refundSessionReject
```

Origen de cada parte:
- Las rutas, las mutaciones que llama cada una y el webhook firmado: [código].
- El orden del recorrido: [supuesto] por los nombres y los comentarios de las rutas; no se corrió.
- El comentario de la extensión dice que **el reembolso todavía no está implementado** [código].

**Las APIs que hay, y con qué se entra a cada una:**

| API | para qué | dónde | autenticación |
|---|---|---|---|
| **Payments Apps API** | que la app termine cada sesión de pago, reembolso, captura o anulación, y se marque lista (`paymentsAppConfigure`) | `https://<tienda>/payments_apps/api/<versión>/graphql.json` [docs] | token de la app, `X-Shopify-Access-Token`; sólo partners de pagos aprobados [docs] |
| **Admin GraphQL API** | pedidos, productos, clientes, descuentos… | `https://<tienda>.myshopify.com/admin/api/<versión>/graphql.json` [docs] | token de una app instalada con los scopes que pida [docs] |
| la del admin | lo que usa la pantalla | `admin.shopify.com/api/operations/<hash>/<Operación>/shopify/<tienda>` [visto] | la sesión de quien está en el navegador [visto] |

- Cada llamada a la API cuesta puntos, y una consulta que supera el máximo falla con `MAX_COST_EXCEEDED` [docs].
- Los errores suelen venir con HTTP 200 y van en `errors` o en `userErrors` [docs].
- La app de Creditop pide sólo `write_payment_gateways` y `write_payment_sessions` [código]: con su token **no** se leen pedidos ni productos por la Admin API.

**Lo que esto significa para automatizar** (a diferencia de VTEX, donde una llave de la cuenta abre casi todo):
- **No hay una llave de la tienda en my-tools** [visto: no está en `connectors/`]. Para leer o crear pedidos o productos por API hace falta una app propia de la tienda de pruebas con scopes de Admin API, y crearla es un cambio de la cuenta: pide el OK de Miguel. Mientras tanto, lo de Shopify va **por pantalla**, o con la sesión de la persona en su Chrome, como los sinónimos de VTEX.
- La API del admin es GraphQL con **consultas guardadas por hash** [visto], igual que en VTEX. Para que un caso grabado sirva de receta, alcanza con su nombre de operación y su hash.

## Para los niveles siguientes

- **Casos reversibles para empezar** [supuesto, para elegir]:
  - un producto de prueba: crearlo y archivarlo;
  - un código de descuento: crearlo y desactivarlo;
  - una colección: crearla y borrarla;
  - un borrador de pedido: crearlo y borrarlo.

  Todos en `creditop-dev-store`, por pantalla y grabando la red.
- **Lo que de verdad importa para Creditop:** una compra en la tienda de pruebas pagada con Creditop, y ver cómo quedan el pedido y la sesión de pago, como `credit-outcome` en VTEX. Pide antes saber si la app está instalada y activa en `creditop-dev-store` y contra qué ambiente de CreditOp apunta. La tarea #103 `integracion-shopify` tiene ese trabajo.
