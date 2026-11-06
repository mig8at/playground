# creditop.tienda-simple

Tema mínimo para la tienda de pruebas `creditop.myvtex.com`: elegir una bicicleta, carrito y pago. Existe para
probar el checkout de CreditOp; el checkout no es parte del tema (VTEX lo sirve aparte) y este tema no lo toca.

- `store/blocks/home.jsonc`: título y grilla de la categoría 2 (Bicicletas).
- `store/blocks/search.jsonc`: categorías y búsqueda, la misma grilla.
- `store/blocks/product.jsonc`: tarjeta de la grilla y página del producto.
- `store/blocks/header.jsonc`, `footer.jsonc`: logo + carrito; una línea de pie.
- `styles/css/`: los pocos estilos propios.
- `checkout-ui-custom/checkout6-custom.css`: el logo de CreditOp en el encabezado del checkout (la configuración
  del checkout en el admin está bloqueada por facturas; este builder la evita y viaja con el tema).

## Probarlo sin tocar la tienda

    vtex login creditop
    vtex use pruebatema           # un workspace de desarrollo (sólo minúsculas y números), aislado de master
    vtex link                     # se ve en https://pruebatema--creditop.myvtex.com (pide login del admin)

En `pruebatema` se desinstaló el tema anterior (`creditop.store-theme`): con los dos, el anterior gana la página de
inicio. En `master` sigue instalado.

## Lo que costó

- El inicio usa `header.full`, no `header`: con sólo `header`, VTEX pone su encabezado por defecto (buscador, login).
- La galería va dentro de `search-content`; directa en el layout, la consulta trae los productos y no se pinta ninguno.
- Con Intelligent Search, la categoría de `customQuery` va por su slug (`bicicletas`), no por su id.

## Ponerlo en la tienda (cuando se apruebe)

    vtex release patch stable && vtex publish
    vtex use master && vtex install creditop.tienda-simple@0.x
    # y desinstalar el tema anterior si sigue instalado
