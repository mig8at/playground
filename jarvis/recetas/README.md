# Recetas de Jarvis

Una **receta** es una tarea completa de una herramienta, con parámetros, que se corre de una vez y sin clics: lo que
en el día a día se hacía navegando el admin pantalla por pantalla. Se corren con:

    make jarvis-receta APP=<app> RECETA=<receta> ARGS='…' [JSON=1]

Cada receta va **por la API** de la herramienta cuando la tiene: es más rápida y no se rompe cuando cambia la
pantalla. Lo que sólo existe en el admin va **por pantalla**, con el mapa de esa herramienta
(`jarvis/mapas/<app>/mapa.json`, `make jarvis-mapa APP=<app>`), que dice dónde está cada campo y botón con un
localizador ya verificado.

Una receta:
- dice qué escribe y dónde, en su cabecera;
- se puede correr dos veces: si lo que crea ya existe (por su referencia), lo completa o lo actualiza en vez de
  duplicarlo;
- imprime los ids y las URLs de lo que dejó (tienda, carrito, admin), y con `--json` un solo objeto para otro
  programa.

## VTEX (cuenta de pruebas `creditop`)

Credenciales: `harness/.env.vtex`, con el mismo lector del harness. Cliente: `vtex/api.ts`.

| receta | qué deja | parámetros |
|---|---|---|
| `crear-producto` | un producto **vendible** en la tienda de pruebas: producto, SKU con medidas, imagen, política comercial, precio, stock y SKU activo. Lo que no se dice sale del molde, la BMX (SKU 9) | `--nombre` · `--precio` · `--stock 10` · `--ref` · `--categoria 4` · `--marca 2000001` · `--descripcion` · `--oculto` · `--json` |
| `crear-producto-pantalla` | lo mismo, pero el **producto se crea por el admin**, en tu Chrome con Jarvis, con los elementos del mapa (nombre, activo, marca, categoría, todas las políticas comerciales, visible, referencia → Save); el SKU, la imagen, el precio y el stock, que el admin reparte en otras pantallas, los pone `crear-producto --producto <id>` | `--nombre` · `--precio` · `--stock 10` · `--marca "Creditop Pruebas"` · `--categoria "Bicicletas"` · `--json` |
| `coleccion` | **caso reversible**: crea una colección, la comprueba en el listado y la borra (`--dejar` la deja; `--borrar <id>`) | `--nombre` · `--dejar` · `--borrar` · `--json` |
| `coleccion-pantalla` | el mismo caso por el admin (Catalog › Collections), **grabando la red**: de ahí salió la receta por API (`mapas/vtex/casos/coleccion.json`) | `--dejar` |
| `sinonimo` | **caso reversible sin clics**: crea un sinónimo del buscador entre dos términos nuevos, lo comprueba en la lista y lo borra. No hay API con llave: repite las operaciones del admin con **tu sesión**, desde una pestaña del admin en tu Chrome (`graphqlInPage`), leídas de la grabación. ~9 s | `--terminos "a,b"` · `--dejar` |
| `sinonimo-pantalla` | el mismo caso por el admin (Storefront › Synonyms), grabando la red | `--dejar` · `--solo-borrar <término jarvis…>` |
| `cupon` | **caso reversible**: crea un cupón (sin promoción ligada: no descuenta nada) y lo **archiva**, que es la vuelta: en VTEX un cupón no se borra | `--codigo` · `--dejar` · `--archivar <código>` · `--json` |
| `cupon-pantalla` | el mismo caso por el admin (Promotions › Coupons, el menú ⋮ de la fila → Archive), grabando la red | `--dejar` · `--solo-archivar <código jarvis…>` |
| `pedido` | **sólo lectura · ¿qué pasó con este pedido?** El pedido (estado, total, ítems, motivo si se canceló), su pago en el gateway y el **registro del conector de Creditop** en castellano: cada pedido de autorización, qué contestó Creditop, a qué workspace de la app fue, el link del wizard al que mandó al cliente (para seguirlo con `make ecommerce`), la cancelación y quién la pidió. En hora de Colombia, como el admin. Sin datos del comprador | `<pedido>` (por defecto, el último) · `--ultimos N` · `--json` |
| `pago-creditop` | **sólo lectura · ¿cómo está configurado Creditop como medio de pago?** Quién cobra hoy (la regla activa → su afiliación → el comercio y la sucursal de CreditOp, buscados por el hash en qa y en prod), todas las afiliaciones de Creditop con su versión del conector y su workspace, la versión de la app en cada workspace y avisos (regla a una afiliación «NO USAR», workspace sin la app, hash que no existe, sucursal inactiva). Cruza tres pantallas del admin: Providers, Settings de pagos y My Apps. ~5 s | `--json` |
| `compra-con-descuento` | **compra de prueba con descuento pagada con Creditop**: promoción (10 % al SKU de prueba) con su cupón → espera a que el carrito la aplique → compra con el cupón → lee en qa qué total y qué productos recibió CreditOp → cancela el pedido y archiva promoción y cupón. ~25 min, casi todo espera (VTEX tarda ~20 min en aplicar una promoción con cupón); `--preparar` deja la promoción y el cupón y `--codigo` compra después. ESCRIBE en VTEX y en qa | `--descuento 10` · `--sku 10` · `--preparar` · `--codigo <cupón>` · `--dejar` |

Ejemplo, medido el 2026-11-07 (producto 10, SKU 10; la simulación del carrito lo da disponible, a $350.000, con
envío y con Creditop):

    make jarvis-receta APP=vtex RECETA=crear-producto ARGS='--nombre "Casco urbano Jarvis" --precio 350000 --stock 20'

Por pantalla, medido el 2026-11-07 (productos 11 y 12, vendibles al primer intento):

    make jarvis-receta APP=vtex RECETA=crear-producto-pantalla ARGS='--nombre "Guantes por pantalla Jarvis" --precio 90000 --stock 30'

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
  - El admin no llama a la API REST: usa GraphQL (`createCollection` y `deleteCollection` de `vtex.catalog-graphql`) como *persisted query*, que lleva sólo el nombre de la operación y un hash, con las variables en base64. La grabadora (`recetas/red.ts`) las guarda decodificadas.
  - Con la llave de la cuenta se va a la API REST que esa app envuelve.
  - **Después de borrar una colección, `GET /api/catalog/pvt/collection/<id>` la sigue devolviendo**, con 200, en los dos hosts. Lo que existe se mira en el listado (`/api/catalog_system/pvt/collection/search`).

## Casos reversibles (nivel 3 de `jarvis/GUIA.md`)

Cada caso se hace primero **por pantalla con la red grabada** (`recetas/red.ts`: `openChrome`, `recordWrites`, `saveCase`), y de esa grabación sale la receta por API, con su vuelta y una comprobación que no depende del camino. Las grabaciones viven en `jarvis/mapas/<app>/casos/`.

**Tres caminos, del más rápido al más visual** (el que se elige depende de la herramienta):
1. **API con la llave de la cuenta** (`vtex/api.ts`): no necesita tu Chrome. Producto, colección, cupón (acá el admin llama directo a la misma API REST).
2. **La llamada del admin con tu sesión** (`red.ts`: `recordedOperation` + `graphqlInPage`): para lo que no tiene API con llave. La operación sale de la grabación; si VTEX la cambia, se vuelve a grabar el caso por pantalla. Sinónimo.
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
- **Una compra con descuento, del lado de CreditOp** (pedido 1674590500448, 2026-11-07): el **total** de la solicitud en qa (`ecommerce_requests.data.total`) llegó con el descuento ($315.005), pero la **lista de productos** llegó con el precio sin descuento ($350.000). Cuál de los dos usa CreditOp para originar el crédito no está verificado en el código.
- **Cancelar un pedido sin aprobar** no genera tarea manual: Creditop lo cancela solo (contesta 200 sin `cancel-manually`). El `cancel-manually` es de los aprobados.
