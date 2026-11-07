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
