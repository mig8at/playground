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
