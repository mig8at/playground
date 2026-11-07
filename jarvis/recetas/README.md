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

Ejemplo, medido el 2026-11-07 (producto 10, SKU 10; la simulación del carrito lo da disponible, a $350.000, con
envío y con Creditop):

    make jarvis-receta APP=vtex RECETA=crear-producto ARGS='--nombre "Casco urbano Jarvis" --precio 350000 --stock 20'

Lo que costó y la receta ya resuelve:
- **Por API un producto nace sin política comercial**, y la tienda no lo vende: la simulación del carrito dice «Ítem
  … no encontrado o no disponible» (ORD027) aunque el SKU esté activo, con precio y con stock. La receta lo asocia a
  las mismas políticas que el molde. Después de asociarla, la tienda tardó unos minutos en enterarse.
- **La API de precios pide exactamente dos** de `basePrice`, `costPrice` y `markup`.
- **`productgetbyrefid` tarda en ver un producto recién creado** (404): se busca el SKU por `refId`, que va directo al
  catálogo.
- **El formulario viejo (`/admin/Site/ProdutoForm.aspx`) ya no abre en el admin nuevo**: un producto se edita en
  `/admin/catalog-products/product/<id>`.
