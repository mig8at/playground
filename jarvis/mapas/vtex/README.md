# VTEX · nivel 1: qué tiene el admin y cómo se conecta

La cuenta es `creditop`, la de pruebas. Este documento es el nivel 1 de [`jarvis/GUIA.md`](../../GUIA.md).

Cada afirmación lleva su origen:
- **[visto]**: salió del barrido del 2026-11-07 (`node jarvis/dev/barrido.ts vtex https://creditop.myvtex.com/admin`). Recorrió las 97 pantallas del menú en el Chrome de Miguel, sólo navegando, y las 97 cargaron. El detalle de cada pantalla está en [`secciones.json`](secciones.json): URL, encabezados, iframes y APIs que llamó al cargar.
- **[medido]**: lo probaron las recetas (`jarvis/recetas/README.md`).
- **[supuesto]**: viene del nombre de la pantalla o de lo que se sabe de VTEX, sin comprobar en esta cuenta.

Lo que el barrido NO dice es qué escribe cada botón: eso es el nivel 3.

## Las 9 secciones

| sección | pantallas | para qué es |
|---|---|---|
| **Dashboards** | 2 | Ventas y conversión. Todo es lectura (`/api/analytics/consumption/*`) [visto] |
| **Orders** | 3 | Pedidos (`All Orders`) y pagos: transacciones y conciliación, en `/api/payments/pvt/admin/*` [visto]. Acá se ve si una compra con Creditop quedó aprobada [supuesto, no se recorrió con un pedido] |
| **Catalog** | 13 | Lo que se vende: productos y SKUs, categorías, marcas, colecciones, precios e inventario [visto] |
| **Promotions** | 5 | Promociones, cupones, gift cards, recargos y audiencias de campaña. Las promociones van por `rnb` («rates and benefits») [visto] |
| **Storefront** | 19 | La tienda que ve el comprador: editor del sitio, páginas, estilos, redirecciones, CMS headless y todo lo del buscador (sinónimos, reglas, banners, historial de indexación) [visto] |
| **Shipping** | 6 | Cómo llega el pedido: estrategias y políticas de envío, tablas de flete, puntos de retiro y un simulador de flete (`/api/logistics/pvt/*`) [visto] |
| **Marketplace** | 15 | Vender a otros marketplaces o recibir vendedores: perfil de la tienda, vendedores, ofertas recibidas, mapeo de catálogo y el «bridge» de integraciones [visto]. La cuenta no tiene vendedores ni mapeos («Activate 0 sellers», «There are no mappings») [visto] |
| **Apps** | 10 | Apps instaladas y la tienda de apps, auditoría y la suite de prueba de un proveedor de pago. Livestreaming pide un plan («Please choose a plan») [visto] |
| **Store Settings** | 24 | Configuración de **toda la cuenta**: pagos (proveedores, reglas, billeteras), checkout, autorización de pedidos, mensajes, logística general, condiciones comerciales, precios, políticas comerciales (`Sales channels`), Master Data, buscador y antifraude [visto] |

## Cómo se conecta: lo que un producto necesita para venderse

```
Catalog                                Store Settings
 producto ─ categoría, marca            política comercial (Sales channels: Store.aspx)
   └ SKU ─ imagen, medidas                    ▲ el producto se asocia a una o varias
       ├ precio      (Price List: pricing)    │
       └ stock       (Inventory: logistics) ──┴─ bodega ─ Shipping (política de envío, flete)
                                ▼
                   la tienda lo muestra y el carrito lo vende
                   (Storefront: el índice del buscador)
                                ▼
          Orders: pedido → pago (Store Settings › Providers / Settings: reglas de pago)
```

- **Para que la tienda venda un producto, tienen que estar todas las piezas** [medido]: producto, SKU activo, precio, stock y **la política comercial**. Por API un producto nace sin política comercial, y entonces el carrito responde ORD027 aunque las demás piezas estén.
- **El admin reparte esas piezas en pantallas distintas** [visto]. El producto se edita en `Products and SKUs`, el precio en `Price List` (una app aparte, `pricing`) y el stock en `Inventory Management`. La política comercial se elige en el formulario del producto y se define en `Store Settings › Sales channels`.
- **La tienda tarda en enterarse** [medido]: después de asociar la política comercial pasaron unos minutos. `Storefront › Indexing History` es la pantalla de ese índice [visto: muestra «Products in store» y «Average indexing time»].
- **Cómo cobra Creditop**: es un proveedor de pago (`Store Settings › Providers`, la API `/_v/api/affiliation`) con una regla de pago (`Store Settings › Settings`, en `pci-gateway#/rules`) [visto]. Cómo se escribe esa regla no se miró [supuesto]. ⚠ Esa parte es de toda la cuenta y necesita el OK de Miguel.

## Cuatro generaciones de pantallas

Por la URL, el iframe y las APIs, el admin junta pantallas de cuatro épocas [visto]. Saberlo dice cómo automatizar cada una.

| generación | cómo se reconoce | ejemplos | automatizar |
|---|---|---|---|
| **ASP.NET viejo** | `/admin/Site/<Nombre>.aspx`, dentro de un iframe de `creditop.vtexcommercestable.com.br`, nombres en portugués (`Marca`, `Fornecedor`, `Vale`, `SkuCondicaoComercial`) | Categories, Brands, Gift Cards, Sales channels, Settings (ConfigForm) | Formularios clásicos. Al cargar no llaman APIs: el servidor arma la página |
| **Apps de una página con hash** | `/admin/<app>#/<ruta>`, iframe `/admin/iframe/<app>/`, con su versión en la ruta de sus textos (`/pricing-vault-ui/v1.27.13/`) | pricing, logistics, rnb, pci-gateway, checkout, message-center, bridge, portal | Llaman las APIs REST de la plataforma directo (`/api/pricing/*`, `/api/logistics/pvt/*`, `/api/payments/pvt/*`): son las mismas que usan las recetas |
| **Admin IO** | `/admin/<ruta>` sin hash, GraphQL en `/_v/private/graphql/v1` con su operación (`inventoryProducts`, `collections`, `getSynonyms`…) | Inventory, Collections, Orders, Search, Sellers, Apps | Las operaciones GraphQL se ven en `secciones.json`. Su forma exacta sale en el nivel 3 |
| **Micro-frontends** | iframe de `<app>.admin.vtex.com` y APIs en `/api/proxy/…` sobre ese host | Products and SKUs (`catalog-facelift`, `#raccoon-iframe`), Promotions, Shipping strategy, Fraud Prevention, Planner | El proxy envuelve la API de la plataforma (`/api/proxy/catalog/pvt/…` ↔ `/api/catalog/pvt/…`). Por API se va directo a la de la plataforma |

**Master Data** es aparte [visto]: abre `creditop.vtexcrm.com.br`, una aplicación propia en portugués («Produtos», «Contas», «Lojas»).

## Lo que aparece en todas las pantallas

Es el armazón, no es de ninguna pantalla [visto]. El barrido lo saca de cada pantalla y lo lista en `armazon`:
- la sesión (`POST /api/sessions`);
- el monitoreo (`/monitoring`);
- el chat de **VTEX Copilot**, un iframe de `copilot-chat-ui.vercel.app` con su barra (`TopbarData`);
- cada pantalla precarga a sus hermanas de sección (`GET /admin/<hermana>`).

## Para los niveles siguientes

- **Ya tiene receta**: crear un producto vendible, por API y por pantalla (`Catalog › Products and SKUs` + `Price List` + `Inventory`).
- **Casos reversibles que salen de este mapa** [supuesto, para elegir]:
  - colección: crear y borrar;
  - cupón: crear y desactivar;
  - promoción: crear y desactivar;
  - redirección: crear y borrar;
  - sinónimo: crear y borrar;
  - producto: ocultar y mostrar;
  - stock: subir y bajar;
  - precio: cambiar y volver.
- **Con cuidado, es de toda la cuenta**: lo de `Store Settings` (pagos, checkout, políticas comerciales, logística general) y `Shipping` (políticas de envío). Se mira, y antes de escribir se pide el OK de Miguel.
- **Volver a barrer** cuando VTEX cambie el menú. El barrido no escribe nada:

      node jarvis/dev/barrido.ts vtex https://creditop.myvtex.com/admin [--solo 'texto']
