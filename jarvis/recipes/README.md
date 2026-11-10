# Recetas de Jarvis

Una **receta** es una tarea completa de una herramienta, con parámetros, que se corre de una vez y sin clics: lo que
en el día a día se hacía navegando el admin pantalla por pantalla. Se corren con:

    make jarvis-recipe APP=<app> RECIPE=<receta> ARGS='…' [JSON=1]

Cada receta va **por la API** de la herramienta cuando la tiene: es más rápida y no se rompe cuando cambia la
pantalla. Lo que sólo existe en el admin va **por pantalla**, con el mapa de esa herramienta
(`jarvis/maps/<app>/map.json`, `make jarvis-map APP=<app>`), que dice dónde está cada campo y botón con un
localizador ya verificado.

Una receta:
- dice qué escribe y dónde, en su cabecera;
- se puede correr dos veces: si lo que crea ya existe (por su referencia), lo completa o lo actualiza en vez de
  duplicarlo;
- imprime los ids y las URLs de lo que dejó (tienda, carrito, admin), y con `--json` un solo objeto para otro
  programa.

## VTEX (cuenta de pruebas `creditop`)

Credenciales: `connectors/.env` (`VTEX_ACCOUNT`, `VTEX_APP_KEY`, `VTEX_APP_TOKEN`), con el lector del harness (`credential`). Cliente: `vtex/api.ts`. Las recetas que sólo usan la API corren en cualquier máquina que tenga ese archivo, también en la nube; las de pantalla y las que usan la sesión (sinónimos) necesitan tu Chrome con Jarvis.

| receta | qué deja | parámetros |
|---|---|---|
| `create-product` | un producto **vendible** en la tienda de pruebas: producto, SKU con medidas, imagen, política comercial, precio, stock y SKU activo. Lo que no se dice sale del molde, la BMX (SKU 9) | `--name` · `--price` · `--stock 10` · `--ref` · `--category 4` · `--brand 2000001` · `--description` · `--hidden` · `--json` |
| `create-product-screen` | lo mismo, pero el **producto se crea por el admin**, en tu Chrome con Jarvis, con los elementos del mapa (nombre, activo, marca, categoría, todas las políticas comerciales, visible, referencia → Save); el SKU, la imagen, el precio y el stock, que el admin reparte en otras pantallas, los pone `create-product --product <id>` | `--name` · `--price` · `--stock 10` · `--brand "Creditop Pruebas"` · `--category "Bicicletas"` · `--json` |
| `collection` | **caso reversible**: crea una colección, la comprueba en el listado y la borra (`--keep` la deja; `--delete <id>`) | `--name` · `--keep` · `--delete` · `--json` |
| `collection-screen` | el mismo caso por el admin (Catalog › Collections), **grabando la red**: de ahí salió la receta por API (`maps/vtex/cases/collection.json`) | `--keep` |
| `synonym` | **caso reversible sin clics**: crea un sinónimo del buscador entre dos términos nuevos, lo comprueba en la lista y lo borra. No hay API con llave: repite las operaciones del admin con **tu sesión**, desde una pestaña del admin en tu Chrome (`graphqlInPage`), leídas de la grabación. ~9 s | `--terms "a,b"` · `--keep` |
| `synonym-screen` | el mismo caso por el admin (Storefront › Synonyms), grabando la red | `--keep` · `--only-delete <término jarvis…>` |
| `coupon` | **caso reversible**: crea un cupón (sin promoción ligada: no descuenta nada) y lo **archiva**, que es la vuelta: en VTEX un cupón no se borra | `--code` · `--keep` · `--archive <código>` · `--json` |
| `coupon-screen` | el mismo caso por el admin (Promotions › Coupons, el menú ⋮ de la fila → Archive), grabando la red | `--keep` · `--only-archive <código jarvis…>` |
| `order` | **sólo lectura · ¿qué pasó con este pedido?** El pedido (estado, total, ítems, motivo si se canceló), su pago en el gateway y el **registro del conector de Creditop** en castellano: cada pedido de autorización, qué contestó Creditop, a qué workspace de la app fue, el link del wizard al que mandó al cliente (para seguirlo con `make ecommerce`), la cancelación y quién la pidió. En hora de Colombia, como el admin. Sin datos del comprador | `<pedido>` (por defecto, el último) · `--last N` · `--json` |
| `creditop-payment` | **sólo lectura · ¿cómo está configurado Creditop como medio de pago?** Quién cobra hoy (la regla activa → su afiliación → el comercio y la sucursal de CreditOp, buscados por el hash en qa y en prod), todas las afiliaciones de Creditop con su versión del conector y su workspace, la versión de la app en cada workspace y avisos (regla a una afiliación «NO USAR», workspace sin la app, hash que no existe, sucursal inactiva). Cruza tres pantallas del admin: Providers, Settings de pagos y My Apps. ~5 s | `--json` |
| `credit-outcome` | **una compra en VTEX llevada al desenlace de crédito por API, en ~1 min**: compra, el caminador por HTTP lleva la solicitud al listado y el simulador de qa la pone en 11 (aprobada), 6 (negada) u 8 (cancelada), o la tienda cancela; después muestra el pedido con `order`. Es `make harness-vtex` con la salida de Jarvis. Medido el 2026-11-07: aprobada en 50 s (VTEX Approved), negada en 33 s (VTEX Cancelled). Sólo qa. ESCRIBE en VTEX y en qa | `--outcome aprobada\|negada\|cancelada\|tienda-cancela` |
| `discount-purchase` | **compra de prueba con descuento pagada con Creditop**: promoción (10 % al SKU de prueba) con su cupón → espera a que el carrito la aplique → compra con el cupón → lee en qa qué total y qué productos recibió CreditOp → cancela el pedido y archiva promoción y cupón. ~25 min, casi todo espera (VTEX tarda ~20 min en aplicar una promoción con cupón); `--prepare` deja la promoción y el cupón y `--code` compra después. ESCRIBE en VTEX y en qa | `--discount 10` · `--sku 10` · `--prepare` · `--code <cupón>` · `--keep` |

Ejemplo, medido el 2026-11-07 (producto 10, SKU 10; la simulación del carrito lo da disponible, a $350.000, con
envío y con Creditop):

    make jarvis-recipe APP=vtex RECIPE=create-product ARGS='--name "Casco urbano Jarvis" --price 350000 --stock 20'

Por pantalla, medido el 2026-11-07 (productos 11 y 12, vendibles al primer intento):

    make jarvis-recipe APP=vtex RECIPE=create-product-screen ARGS='--name "Guantes por pantalla Jarvis" --price 90000 --stock 30'

Lo que costó y las recetas ya resuelven:
- **Por API un producto nace sin política comercial**, y la tienda no lo vende: la simulación del carrito dice «Ítem
  … no encontrado o no disponible» (ORD027) aunque el SKU esté activo, con precio y con stock. La receta lo asocia a
  las mismas políticas que el molde. Después de asociarla, la tienda tardó unos minutos en enterarse.
- **La API de precios pide exactamente dos** de `basePrice`, `costPrice` y `markup`.
- **`productgetbyrefid` tarda en ver un producto recién creado** (404): se busca el SKU por `refId`, que va directo al
  catálogo.
- **El formulario viejo (`/admin/Site/ProdutoForm.aspx`) ya no abre en el admin nuevo**: un producto se edita en
  `/admin/catalog-products/product/<id>`.
- **El formulario de producto del admin** (dentro del iframe `#raccoon-iframe`):
  - «Save» y «Discard» aparecen recién con cambios: en el mapa van como `condicional`.
  - La marca se filtra escribiendo su nombre, pero la opción queda «no visible» para Playwright: se elige con el teclado (flecha abajo y Enter).
  - La categoría no es un listbox accesible y su buscador sólo encuentra las de primer nivel («Bicicletas 2», nombre e id): se elige por el texto del resultado.
  - «All sales channels» asocia la política comercial en el momento; por API hay que hacerlo aparte.
- **Las colecciones** (2026-11-07):
  - El admin no llama a la API REST: usa GraphQL (`createCollection` y `deleteCollection` de `vtex.catalog-graphql`) como *persisted query*, que lleva sólo el nombre de la operación y un hash, con las variables en base64. La grabadora (`recipes/recorder.ts`) las guarda decodificadas.
  - Con la llave de la cuenta se va a la API REST que esa app envuelve.
  - **Después de borrar una colección, `GET /api/catalog/pvt/collection/<id>` la sigue devolviendo**, con 200, en los dos hosts. Lo que existe se mira en el listado (`/api/catalog_system/pvt/collection/search`).

## Casos reversibles (nivel 3 de `jarvis/GUIDE.md`)

Cada caso se hace primero **por pantalla con la red grabada** (`recipes/recorder.ts`: `openChrome`, `recordWrites`, `saveCase`), y de esa grabación sale la receta por API, con su vuelta y una comprobación que no depende del camino. Las grabaciones viven en `jarvis/maps/<app>/cases/`.

**Tres caminos, del más rápido al más visual** (el que se elige depende de la herramienta):
1. **API con la llave de la cuenta** (`vtex/api.ts`): no necesita tu Chrome. Producto, colección, cupón (acá el admin llama directo a la misma API REST).
2. **La llamada del admin con tu sesión** (`recorder.ts`: `recordedOperation` + `graphqlInPage`): para lo que no tiene API con llave. La operación sale de la grabación; si VTEX la cambia, se vuelve a grabar el caso por pantalla. Sinónimo.
3. **Por pantalla**, con los localizadores del mapa o del caso: para ver o enseñar cómo se hace, y la que graba.

- **Los sinónimos** (2026-11-07):
  - El tacho de una fila aparece recién con el mouse encima y no es un botón (un ícono con `tabindex`): el análisis de Jarvis no lo ve. Abrir la fila lleva a «Edit», que no borra.
  - VTEX avisa que un sinónimo borrado no se puede volver a crear con los mismos términos ([known issue](https://help.vtex.com/en/known-issues/intelligent-search-synonyms-does-not-recreate-deleted-synonyms)): cada corrida usa términos nuevos.
- **Los cupones** (2026-11-07):
  - VTEX guarda el código en minúsculas.
  - **La lectura de un cupón queda en caché**: leído antes de archivarlo, sigue diciendo `isArchived: false` por minutos, aunque el archivo ya entró. La receta comprueba la creación con la respuesta del POST y lee recién después de archivar.
- **La grabadora no guarda datos de la persona**: la barra del admin (`TopbarData`) y la analítica traen el perfil (nombre y correo). Se filtran, y un correo que se cuele se reemplaza por `<correo>`.
- **Los pedidos y su pago** (2026-11-07, contrastado con el admin en dos pedidos):
  - El registro de la transacción (`/api/payments/pvt/transactions/<id>/interactions`) es lo que el admin muestra en el detalle de Transactions, y es donde está lo que contestó Creditop: primero `undefined` con el `paymentUrl` del wizard, y `approved` cuando la solicitud se aprueba.
  - Si Creditop no avisa, VTEX vuelve a preguntar cada 60 min, hasta 6 veces («Authorization Rules»).
  - **El workspace de la app de Creditop que atiende cambia por pedido**: el del 5 de noviembre fue a `develop--creditop`, el del 7 a `master--creditop`. Mirarlo antes de concluir qué versión del conector respondió.
  - **Creditop no cancela sola**: a la cancelación contesta `cancel-manually`, y VTEX abre una tarea manual para una persona.
  - Las horas del registro vienen en UTC sin la «Z»; el admin las muestra en hora local.
- **La configuración de pago de Creditop** (2026-11-07, contrastada con Providers y Payment Conditions del admin):
  - Una **afiliación** es un comercio de CreditOp: su `appKey` es el hash de la sucursal, el mismo que aparece en el link del wizard (`/ecommerce/<hash>/checkout`). La **regla** (condición de pago) dice cuál cobra: hoy hay una sola, «Creditop qa».
  - `isProduction` de la afiliación **no dice en qué ambiente está el comercio**: «Creditop-test» dice `true` y su hash existe sólo en qa. Por eso la receta busca en los dos.
  - `make harness-vtex CASES=rotativo` cambia la regla por un rato y la devuelve: si un pedido de ese momento fue a otro comercio, es eso.
  - El workspace `develop` se borró el 2026-11-06 (comentario de `harness/pkg/vtex.ts`): los pedidos de antes muestran `develop--creditop` en su registro, y los de después `master--creditop`.
- **Las promociones** (2026-11-07, contra el esquema oficial `vtex/openapi-schemas` «Promotions & Taxes API» y medido):
  - Se crean con `POST /api/rnb/pvt/calculatorconfiguration`. Obligatorios: `type`, `origin` (`marketplace` = la tienda propia), `isActive`, `beginDateUtc` y `percentualShippingDiscountValue`; el tipo de descuento va en `discountType` (`percentual`). Se archivan con `POST /api/rnb/pvt/archive/calculatorConfiguration/<id>` (204). Un cupón se liga a una promoción por el MISMO `utm_source` en los dos.
  - **Tardan en llegar al carrito**: una nueva, ~11 min sin cupón y ~21 min con cupón. Mientras tanto, con el cupón puesto, el checkout dice **«Cupón … expirado»**, que es falso: es la espera. Vencer (`endDateUtc`) corta en el momento; archivar tarda unos minutos (una archivada siguió aplicando). Por eso las de prueba se crean con vencimiento corto.
  - Leer una por id con la llave da «Calculator Configuration not found!» (404) aunque el listado la muestra y el admin la abre (por su proxy).
  - El primer diagnóstico («las promociones creadas por API no aplican») era falso: se esperó 13 min, menos de lo que tardan.
- **Una compra con descuento, del lado de CreditOp** (pedido 1674590500448, 2026-11-07): el **total** de la solicitud en qa (`ecommerce_requests.data.total`) llegó con el descuento ($315.005), pero la **lista de productos** llegó con el precio sin descuento ($350.000). **CreditOp usa el total, no los productos** (2026-11-07, medido y verificado): la compra con cupón llevada a 11 (`credit-outcome --code … --sku 10`, solicitud 504732) quedó con `amount` y `original_amount` = $315.005, el total con el descuento. En `main` de legacy-backend la solicitud nace del `total` del pedido (`OnboardingController`, `UserRequestService`), al elegir entidad se exige que `original_amount` sea ese total (`rejectAmountOutsideTheOrder`), y la columna `products` sólo se guarda y se reenvía: ningún cálculo la suma. El flujo payment-link no existe en legacy-application.
- **Cancelar un pedido sin aprobar** no genera tarea manual: Creditop lo cancela solo (contesta 200 sin `cancel-manually`). El `cancel-manually` es de los aprobados.

## Shopify (tienda de pruebas `creditop-dev-store`)

Credenciales: la app «Jarvis · Admin API (pruebas)» del Dev Dashboard (organización CREDITOP), instalada sólo en
`creditop-dev-store`, con `SHOPIFY_CLIENT_ID` y `SHOPIFY_CLIENT_SECRET` en `connectors/.env`: el token se pide con
ellos y dura 24 h. Cliente: `shopify/api.ts`, que se niega a apuntar a `tienda-creditop`, la de producción.

| receta | qué deja | parámetros |
|---|---|---|
| `store` | **sólo lectura**: la tienda, sus últimos productos y sus últimos pedidos con la pasarela y el estado de pago | `--last 10` · `--json` |
| `credit-outcome` | **una compra en Shopify pagada con Creditop, llevada al desenlace de crédito por API, en ~1,5 min**: el checkout en tu Chrome (la BMX, el comprador sintético, Creditop, «Pay now») → Shopify manda al wizard de qa → el caminador por HTTP desde ese link (`walk-wizard.ts --entry-url`) → el simulador de qa en 11, 6 u 8 → lo que la app de Creditop aplicó en Shopify (`resolved`/`rejected`) y el pedido. Medido el 2026-11-07: aprobada en 88 s (pedido #1026 «Pagado»), negada en 79 s (`rejected`). Usa la app desplegada en dev (`shopify-app.dev.creditop.com`, la versión publicada) y necesita la contraseña de la tienda puesta en tu Chrome. Con la app de dev, la negada y la cancelada se miden por el aviso de qa en Loki (la app lo aceptó con 200), porque sus logs no están en Loki y un rechazo no crea pedido; `--outcome volver` toca «Volver a la tienda» a mitad del wizard (medido el 2026-11-09: pedido #1033 PENDING). Cada aprobada o «volver» descuenta una BMX del inventario: con 0, el checkout cae en «stock-problems» ESCRIBE en Shopify y en qa | `--outcome aprobada\|negada\|cancelada\|volver` · `--variant <id>` |

- **Shopify protege los pedidos y los borradores** («protected customer data»): la Admin API los negaba («not approved to access the Order object»). Se destrabó el 2026-11-07 eligiendo la **distribución personalizada** de la app en el Partner Dashboard (sólo `creditop-dev-store`; no se puede deshacer): con eso, según Shopify, una app personalizada tiene acceso a esos datos sin pedirlo aparte. Entrar al Partner Dashboard pidió una verificación anti-bots, que hizo Miguel.
- **Un pago rechazado no deja pedido**: el checkout vuelve a ofrecer pagar. Cómo terminó lo dice el registro de la app (`creditop.webhook.applied`, `next: 'rejected'`), no la lista de pedidos.
- En el checkout de la tienda, Creditop aparece al lado del «Test Payment Gateway».
- **qa no siempre le avisa a la tienda** (2026-11-07): en 1 de 5 compras de Shopify la solicitud quedó en 11 y el pedido de la tienda con `processed = 0` en `ecommerce_requests`, sin que la app recibiera el aviso y sin rastro en los logs. `credit-outcome` espera un minuto y, si no llega, lo dice con ese dato. Sin causa medida.
