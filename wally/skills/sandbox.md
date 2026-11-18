# sandbox: escribir páginas web (HTML, CSS, JS) en la carpeta de pruebas, probarlas y corregirlas

Es lo ÚNICO donde podés escribir: `sandbox/<proyecto>/…`. Páginas estáticas, sin servidor ni dependencias.

## Escribir un archivo: un bloque `file` con su ruta (va ENTERO)

```file sandbox/mi-proyecto/index.html
<!doctype html>
…
```

## Cambiar uno que ya existe: un bloque `patch` (sólo lo que cambia)

```patch sandbox/mi-proyecto/estilo.css
<<<<<<< SEARCH
.boton { background: #a33; }
=======
.boton { background: #2a7; }
>>>>>>> REPLACE
```

- Lo de SEARCH va TAL COMO ESTÁ en el archivo y tiene que aparecer UNA sola vez (sumale renglones de alrededor si se
  repite). Se aplican todos los cambios del bloque o ninguno; si uno falla, la salida dice cuál.
- Rutas: hasta 4 carpetas en minúsculas; tipos html, css, js, mjs, json, svg, md, txt; hasta 400 mil caracteres.
- No escribas tres acentos graves seguidos dentro de un archivo: cierran el bloque.

## Leer y probar

| comando | para qué |
|---|---|
| `list sandbox` · `list sandbox/proyecto` | qué archivos hay, con su tamaño |
| `read sandbox/proyecto/archivo` | un archivo como está en el disco (antes de parchar algo que no tenés fresco) |
| `check sandbox/proyecto` | abre la página en un navegador y dice lo que no ves: errores, recursos que no cargaron, encabezados, botones, si se desborda en escritorio y teléfono, y qué criterios pasan |

```command
list sandbox
check sandbox/mi-proyecto
```

## La consola

`console sandbox/proyecto <comando>` corre un comando de terminal dentro de un contenedor aislado, parado en la carpeta
del proyecto (sin red; sólo ve el proyecto): para mirar o buscar en lo que escribiste.

```command
console sandbox/mi-proyecto ls -la
console sandbox/mi-proyecto grep -n "addEventListener" app.js
```

## Los criterios (obligatorio si el proyecto tiene una página)

`sandbox/<proyecto>/criteria.json`: UN criterio por cada cosa pedida, con los pasos que lo comprueban usando la página.

```file sandbox/mi-proyecto/criteria.json
[
  { "name": "El formulario vacío muestra el aviso del nombre",
    "steps": [ { "click": "Enviar" }, { "see": "Escribí tu nombre" } ] },
  { "name": "Completo, confirma en la misma página",
    "steps": [ { "type": { "field": "Nombre", "text": "Ana" } },
               { "select": { "field": "Servicio", "option": "Lavado — $30.000" } },
               { "click": "Enviar" }, { "see": "Turno confirmado" }, { "not_see": "Escribí tu nombre" } ] }
]
```

- Pasos: `click` (texto de un botón o enlace) · `type` (`field`: la etiqueta del campo; `text`: lo que se escribe;
  una fecha va `2026-12-01`) · `select` (`field` y `option`: el texto EXACTO) · `check` (una casilla) · `see` ·
  `not_see`. Cada criterio arranca con la página recién cargada y termina en un `see` o `not_see`. `"page": "otra.html"` lo corre sobre otra página.
- Escribilos por lo que te PIDIERON. Si uno falla, lo normal es arreglar la página; el criterio sólo si estaba mal escrito.
- No podés cerrar si escribiste después del último `check` o si el último dejó algo en rojo.

## Las reglas de la página

- **Autocontenida**: se sirve aislada y no puede pedir nada de afuera (ni CDNs, ni fuentes de Google, ni `fetch`).
  Fuentes del sistema, SVG a mano, imágenes como SVG o `data:`.
- Los formularios no se envían: se manejan con JavaScript en la página. Sin `localStorage` ni cookies.
- Rutas relativas entre tus archivos. `lang="es"`, viewport, un solo `h1`, que no se desborde en 390 px.
- No ves la página: «sin errores» no es «se ve bien». Eso lo dice Miguel con el botón «Ver».
