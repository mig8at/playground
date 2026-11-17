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

### De un flujo a una receta

Un **flujo** (`jarvis/flows/<sitio>/`) es el registro de lo que se hizo UN día, con los datos de ese día. La **receta**
es cómo se hace siempre: con parámetros y comprobando lo que pasa. El paso de uno a otro:

    make jarvis-recipe-from FLOW=jarvis/flows/<sitio>/<id>.json APP=<herramienta> NAME=<receta> [FORCE=1]

(`from-flow.ts`) escribe el **esqueleto** en `recipes/<herramienta>/<receta>.ts`: cada paso con su localizador ya
verificado, lo que se escribió o eligió como parámetro (`--<campo>`, con el valor del flujo por defecto), cada
espera como `waitFor`, un `goto` al inicio si el flujo no abre página, y la cabecera con ESCRIBE o «Sólo lectura»
según si el flujo tocaba algo. Es un punto de partida, no la receta terminada: falta decir qué comprueba (lo que
dice la pantalla al final), qué parte va mejor por API y los ⚠ del día. Nunca pisa una receta sin `FORCE=1`.

La cabecera es la documentación (`bin/jarvis docs <app> apis`): el primer párrafo es el título (empieza con
«SÓLO LECTURA ·», «ESCRIBE ·» o «RECETA ·»), cada `make jarvis-recipe …` es un uso, una línea con ESCRIBE dice qué
escribe y cada ⚠ es un aviso. Un `.ts` sin línea de uso es un **módulo de apoyo** (`api.ts`, `shopify/partners.ts`)
y no sale como receta. El camino se deduce del código: la llave (`api`), `graphqlInPage` (tu sesión) o `openChrome`
/ `bin/jarvis` (la pantalla).

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
  - Una **afiliación** es un comercio de CreditOp: su `appKey` es el hash de la sucursal, el mismo que aparece en el link del wizard (`/ecommerce/<hash>/checkout`). La **regla** (condición de pago) dice cuál cobra: hoy hay una sola, «Creditop», que apunta a «Creditop · producción» (workspace `master`, prod). Las de qa, «Creditop · pruebas» y «Creditop · pruebas Mario», van al workspace `pruebas`, cuya app está en QA (2026-11-12).
  - `isProduction` de la afiliación **no dice en qué ambiente está el comercio**: lo decide la configuración de la app en el workspace de la afiliación. «[NO USAR] Creditop-test (v4)» dice `true` y su hash existe sólo en qa. Por eso la receta busca en los dos.
  - `make harness-vtex CASES=rotativo` cambia la regla por un rato y la devuelve: si un pedido de ese momento fue a otro comercio, es eso.
  - El workspace `develop` se borró el 2026-11-06 (comentario de `harness/pkg/vtex.ts`): los pedidos de antes muestran `develop--creditop` en su registro, y los de después `master--creditop`.
- **Las promociones** (2026-11-07, contra el esquema oficial `vtex/openapi-schemas` «Promotions & Taxes API» y medido):
  - Se crean con `POST /api/rnb/pvt/calculatorconfiguration`. Obligatorios: `type`, `origin` (`marketplace` = la tienda propia), `isActive`, `beginDateUtc` y `percentualShippingDiscountValue`; el tipo de descuento va en `discountType` (`percentual`). Se archivan con `POST /api/rnb/pvt/archive/calculatorConfiguration/<id>` (204). Un cupón se liga a una promoción por el MISMO `utm_source` en los dos.
  - **Tardan en llegar al carrito**: una nueva, ~11 min sin cupón y ~21 min con cupón. Mientras tanto, con el cupón puesto, el checkout dice **«Cupón … expirado»**, que es falso: es la espera. Vencer (`endDateUtc`) corta en el momento; archivar tarda unos minutos (una archivada siguió aplicando). Por eso las de prueba se crean con vencimiento corto.
  - Leer una por id con la llave da «Calculator Configuration not found!» (404) aunque el listado la muestra y el admin la abre (por su proxy).
  - El primer diagnóstico («las promociones creadas por API no aplican») era falso: se esperó 13 min, menos de lo que tardan.
- **Una compra con descuento, del lado de CreditOp** (pedido 1674590500448, 2026-11-07): el **total** de la solicitud en qa (`ecommerce_requests.data.total`) llegó con el descuento ($315.005), pero la **lista de productos** llegó con el precio sin descuento ($350.000). **CreditOp usa el total, no los productos** (2026-11-07, medido y verificado): la compra con cupón llevada a 11 (`credit-outcome --code … --sku 10`, solicitud 504732) quedó con `amount` y `original_amount` = $315.005, el total con el descuento. En `main` de legacy-backend la solicitud nace del `total` del pedido (`OnboardingController`, `UserRequestService`), al elegir entidad se exige que `original_amount` sea ese total (`rejectAmountOutsideTheOrder`), y la columna `products` sólo se guarda y se reenvía: ningún cálculo la suma. El flujo payment-link no existe en legacy-application.
- **Cancelar un pedido sin aprobar** no genera tarea manual: Creditop lo cancela solo (contesta 200 sin `cancel-manually`). El `cancel-manually` es de los aprobados.

## AI Studio (Gemini por la web, con tu cuenta: preguntar, voz y transcripción)

Sin llave de API: maneja la interfaz de AI Studio en tu Chrome, con tu sesión de Google, y usa el uso gratuito de la web
(que acepta textos enormes) en vez de la cuota de una llave. Por consola funciona como una API: entra texto, sale la
respuesta en Markdown.

| receta | qué hace | parámetros |
|---|---|---|
| `ask` | **una pregunta a Gemini por la web**: chat nuevo (temporal: no queda en el History) → el modelo, si se pide → el texto → Run → la respuesta con «Copy as markdown» interceptado (tu portapapeles no se toca). También `bin/aistudio`, que lee los archivos desde donde lo corrés. Medido el 2026-11-17 con Gemini 4 Hydrogen: una pregunta corta en 4,6 s; 1,2 MB de código en 11,5 s y 2 MB en 17,9 s, encontrando en los dos una frase escondida en el medio y cerca del final | `--prompt` · `--file` (va antes de la pregunta) · stdin · `--model <id>` (gemini-3.8-flash por defecto, como Wally; gemini-4-hydrogen para lo difícil) · `--out` · `--keep` · `--timeout 600` · `--json` |
| `speak` | **texto a voz** (Generate speech, Gemini 3.8 Flash TTS): «Create new dialog» → la voz (se busca por nombre en Speaker settings y se comprueba «Current voice») → el texto → Run → un WAV mono de 24 kHz. `bin/aistudio speak`. Medido el 2026-11-17: 5,2 s de audio en 4,1 s y 8 s de audio en 7,7 s; lo generado lo transcribió bien Whisper, en esta máquina | `--text` · `--file` · stdin · `--out <archivo.wav>` · `--voice <nombre>` (Enzo, Koda, Bodi…; sin ella, la que esté puesta) · `--model` · `--json` |
| `transcribe` | **audio a texto** (Gemini 3.5 Transcribe): «Upload» con el archivo → «Transcribe» → la transcripción en Markdown. `bin/aistudio transcribe <audio>`. Medido el 2026-11-17: audios de 2 a 9 s en ~5 s; el de `speak` volvió palabra por palabra. ⚠ El audio SUBE A GOOGLE: queda en tu Drive y, según el aviso de AI Studio, puede usarse para mejorar sus productos | `<audio>` · `--out` · `--plain` (sin marcas de tiempo ni quién habla) · `--smart` · `--vocabulary "a, b"` (implica `--plain`) · `--json` |
| `image` | **una imagen** (Nano Banana 2 Lite, sin «Paid»): el pedido en un chat temporal → Run → la imagen más grande del último turno, guardada con la extensión del formato que llega. `bin/aistudio image`. ⚠ **SIN PROBAR**: el primer intento (2026-11-17) contestó «Permiso denegado»; falta confirmar cómo se guarda la imagen con una generación real | `--prompt` · `--out` · `--aspect 1:1` · `--only-images` · `--model` · `--json` |

- **Un texto grande no va en un solo `fill`**: con 1,2 MB el puente de Chrome cortó la conexión y la pestaña quedó
  colgada, y ninguna conexión nueva andaba hasta reiniciar Chrome (con 280 mil caracteres había andado). La receta lo
  manda en pedazos de 200 mil caracteres a una variable de la página y lo pone en el campo al final.
- **La página exige Trusted Types**: un `waitForFunction` con el código como texto falla («Evaluating a string as
  JavaScript violates…»). Van como función.
- **El texto de la tarjeta de un modelo viene pegado** («Hydrogengemini-4-hydrogenAn…»): el modelo se elige por el
  elemento que tiene el id exacto. El elegido queda también para la próxima vez que abras AI Studio.
- Mientras genera, el botón Run dice «Stop», pero **que vuelva a «Run» no alcanza**: entre los «Thoughts» y la
  respuesta hay un instante sin «Stop», y una pregunta de Miguel se leyó a medias («Timeout 5000ms» esperando la copia,
  2026-11-17). La receta espera además a que el texto quede quieto 1,5 s; si «Copy as markdown» igual no entrega, saca
  la respuesta del texto de la página (`format: "text"` en `--json`) y lo avisa.
- No anda con otra sesión de Jarvis manejando Chrome (`openChrome` lo niega): cerrala antes.
- **Google corta la CUENTA, no el modelo**: tras ~40 consultas de prueba en una hora (2026-11-17), el chat contestó
  «Permiso denegado. Verifica los permisos de tu cuenta y la configuración del proyecto» con Hydrogen, la voz un 403,
  la imagen lo mismo, y Flash Lite contestó a las 9:48 y a las 9:49 ya no. Es para usarla de a una, no en tandas. El
  error sale en rojo dentro del turno (`.model-error`) o en el aviso de abajo (`mat-snack-bar-container`): las recetas
  lo cortan ahí con su texto y dejan **una pausa de 1 a 5 min, al azar, para toda la cuenta** (`*` en
  `~/.cache/my-tools/aistudio-pausa.json`); mientras dure, `bin/aistudio` sale con 3 sin abrir AI Studio (`--force`
  la saltea) y Wally no deja preguntar.
- **El aviso de multimedia lo acepta la persona**: si aparece, la receta trae la pestaña al frente, avisa y espera 5
  min a que toque «Acknowledge»; no lo toca nunca.
- **AI Studio recuerda el último modelo del chat**: después de `transcribe`, un chat nuevo abría la pantalla de
  transcripción, sin campo para preguntar. Por eso `ask` pasa SIEMPRE el modelo en la URL (`new_chat?model=<id>`), y
  queda ése para cuando abras AI Studio a mano.
- **Lo multimedia pide un consentimiento la primera vez** («Start creating with media in Google AI Studio»: lo subido
  puede usarse para mejorar productos de Google, y queda en tu Drive). Ya aceptado, AI Studio igual lo arma un instante
  y lo cierra solo: sólo cuenta si sigue a la vista 2 s.
- **La voz se reproduce mientras se genera, por Web Audio, en pedacitos de 40-120 ms**: `speak` la silencia (una
  ganancia en 0 antes de los parlantes; suspender el contexto rompe el reproductor) y junta los pedacitos en orden. El
  botón «Download» de la página no baja nada con la pestaña manejada.
- **La transcripción: el vocabulario propio no se combina** con las marcas de tiempo por palabra ni con quién habla
  («custom_vocabulary is incompatible with word timestamps / with diarization»); el campo es de etiquetas (un término +
  Enter). Un WAV a 16 kHz hecho con la voz de macOS se transcribió cortado («Hola, esta es una de», 2 de 9 s), dos veces;
  el mismo audio a 24 kHz salió entero. Sin causa medida: si una transcripción sale cortada, probar otra frecuencia.

## Shopify (tienda de pruebas `creditop-dev-store`)

Credenciales: la app «Jarvis · Admin API (pruebas)» del Dev Dashboard (organización CREDITOP), instalada sólo en
`creditop-dev-store`, con `SHOPIFY_CLIENT_ID` y `SHOPIFY_CLIENT_SECRET` en `connectors/.env`: el token se pide con
ellos y dura 24 h. Cliente: `shopify/api.ts`, que se niega a apuntar a `tienda-creditop`, la de producción.

| receta | qué deja | parámetros |
|---|---|---|
| `store` | **sólo lectura**: la tienda, sus últimos productos y sus últimos pedidos con la pasarela y el estado de pago | `--last 10` · `--json` |
| `credit-outcome` | **una compra en Shopify pagada con Creditop, llevada al desenlace de crédito por API, en ~1,5 min**: el checkout en tu Chrome (la BMX, el comprador sintético, Creditop, «Pay now») → Shopify manda al wizard de qa → el caminador por HTTP desde ese link (`walk-wizard.ts --entry-url`) → el simulador de qa en 11, 6 u 8 → lo que la app de Creditop aplicó en Shopify (`resolved`/`rejected`) y el pedido. Medido el 2026-11-07: aprobada en 88 s (pedido #1026 «Pagado»), negada en 79 s (`rejected`). Usa la app desplegada en dev (`shopify-app.dev.creditop.com`, la versión publicada) y necesita la contraseña de la tienda puesta en tu Chrome. Con la app de dev, la negada y la cancelada se miden por el aviso de qa en Loki (la app lo aceptó con 200), porque sus logs no están en Loki y un rechazo no crea pedido; `--outcome volver` toca «Volver a la tienda» a mitad del wizard (medido el 2026-11-09: pedido #1033 PENDING). Cada aprobada o «volver» descuenta una BMX del inventario: con 0, el checkout cae en «stock-problems» ESCRIBE en Shopify y en qa | `--outcome aprobada\|negada\|cancelada\|volver` · `--variant <id>` |
| `payments-app-status` | **sólo lectura · ¿en qué estado están las apps de CreditOp en Shopify?** Por cada app de la organización Partner (4296643): distribución (personalizada, pública o sin elegir) y, si es de pagos, su estado (Development, Hidden, Generally Available). Por pantalla, en el Partner Dashboard con la sesión de tu Chrome. Medido el 2026-11-13: 3 apps | `--app <id>` · `--json` |
| `payments-app-setup` | **sólo lectura · la guía de la app PÚBLICA de pagos y en qué paso está**: 1 creada con la CLI (el `.toml` de producción tiene `client_id`) · 2 distribución pública · 3 permisos de pagos y deploy (Partners la muestra como app de pagos: la versión que deja la CLI al crearla no cuenta) · 4 llaves en el secreto de producción (lo hace infra; no se comprueba) · 5 revisión (Hidden o Generally Available). Dice el siguiente paso con su comando | `--repo <carpeta>` · `--config shopify.app.production.toml` · `--app 447249776641` · `--json` |
| `partner-support-chat` | **abre el chat de Shopify Support para partners y deja el mensaje escrito, SIN enviarlo**: Ayuda → «Chat with a human» → «Chat» (entra a la fila: un asesor se une en minutos) → «Type a message». La pestaña queda abierta: la persona toca Send y sigue la conversación. Así se abrió el ticket 72090155 (2026-11-13). Sólo `--dry` probado | `--message "…"` \| `--file <texto>` · `--dry` · `--json` |

- **Shopify protege los pedidos y los borradores** («protected customer data»): la Admin API los negaba («not approved to access the Order object»). Se destrabó el 2026-11-07 eligiendo la **distribución personalizada** de la app en el Partner Dashboard (sólo `creditop-dev-store`; no se puede deshacer): con eso, según Shopify, una app personalizada tiene acceso a esos datos sin pedirlo aparte. Entrar al Partner Dashboard pidió una verificación anti-bots, que hizo Miguel.
- **Un pago rechazado no deja pedido**: el checkout vuelve a ofrecer pagar. Cómo terminó lo dice el registro de la app (`creditop.webhook.applied`, `next: 'rejected'`), no la lista de pedidos.
- En el checkout de la tienda, Creditop aparece al lado del «Test Payment Gateway».
- **qa no siempre le avisa a la tienda** (2026-11-07): en 1 de 5 compras de Shopify la solicitud quedó en 11 y el pedido de la tienda con `processed = 0` en `ecommerce_requests`, sin que la app recibiera el aviso y sin rastro en los logs. `credit-outcome` espera un minuto y, si no llega, lo dice con ese dato. Sin causa medida.
- **Partner Dashboard no tiene API para esto**: `shopify/partners.ts` lee la página de Distribución de cada app (en español o inglés, según la cuenta). La sesión es la del Chrome de la persona; hoy, la de Juan, dueño de la cuenta Partner.
- **Una app de pagos con distribución personalizada nunca va a revisión** y queda en Development (sólo modo de prueba); la distribución no se cambia después. La de los comercios es una copia pública (`payments-app-setup`).

## Gmail (la cuenta de tu Chrome)

| receta | qué deja | parámetros |
|---|---|---|
| `thread-capture` | **sólo lectura · un hilo entero en capturas numeradas**, para dejar evidencia en los artifacts de una tarea: abre el hilo, despliega los mensajes colapsados (su comienzo lo da `bin/pg gmail thread <id> --json`: el «Expandir todo» de Gmail no es accesible) y saca `shot --full`. Medido el 2026-11-13: 10 páginas | `--thread <id o URL>` · `--out <carpeta>` · `--name <base>` · `--json` |
