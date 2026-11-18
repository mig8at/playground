# pruebas: escribir páginas web (HTML, CSS, JS) en la carpeta de pruebas, probarlas y corregirlas

Es lo ÚNICO donde podés escribir: `pruebas/<proyecto>/…`. Páginas estáticas, sin servidor ni dependencias.

## Escribir un archivo: un bloque `archivo` con su ruta (va ENTERO)

```archivo pruebas/mi-proyecto/index.html
<!doctype html>
…
```

## Cambiar uno que ya existe: un bloque `parche` (sólo lo que cambia)

```parche pruebas/mi-proyecto/estilo.css
<<<<<<< BUSCAR
.boton { background: #a33; }
=======
.boton { background: #2a7; }
>>>>>>> REEMPLAZAR
```

- Lo de BUSCAR va TAL COMO ESTÁ en el archivo y tiene que aparecer UNA sola vez (sumale renglones de alrededor si se
  repite). Se aplican todos los cambios del bloque o ninguno; si uno falla, la salida dice cuál.
- Rutas: hasta 4 carpetas en minúsculas; tipos html, css, js, mjs, json, svg, md, txt; hasta 400 mil caracteres.
- No escribas tres acentos graves seguidos dentro de un archivo: cierran el bloque.

## Leer y probar

| comando | para qué |
|---|---|
| `listar pruebas` · `listar pruebas/proyecto` | qué archivos hay, con su tamaño |
| `leer pruebas/proyecto/archivo` | un archivo como está en el disco (antes de parchar algo que no tenés fresco) |
| `probar pruebas/proyecto` | abre la página en un navegador y dice lo que no ves: errores, recursos que no cargaron, encabezados, botones, si se desborda en escritorio y teléfono, y qué criterios pasan |

```comando
listar pruebas
probar pruebas/mi-proyecto
```

## Los criterios (obligatorio si el proyecto tiene una página)

`pruebas/<proyecto>/criterios.json`: UN criterio por cada cosa pedida, con los pasos que lo comprueban usando la página.

```archivo pruebas/mi-proyecto/criterios.json
[
  { "criterio": "El formulario vacío muestra el aviso del nombre",
    "pasos": [ { "tocar": "Enviar" }, { "ver": "Escribí tu nombre" } ] },
  { "criterio": "Completo, confirma en la misma página",
    "pasos": [ { "escribir": { "en": "Nombre", "texto": "Ana" } },
               { "elegir": { "en": "Servicio", "opcion": "Lavado — $30.000" } },
               { "tocar": "Enviar" }, { "ver": "Turno confirmado" }, { "no_ver": "Escribí tu nombre" } ] }
]
```

- Pasos: `tocar` (texto de un botón o enlace) · `escribir` (`en`: la etiqueta del campo; una fecha va `2026-12-01`) ·
  `elegir` (`opcion`: el texto EXACTO) · `marcar` · `ver` · `no_ver`. Cada criterio arranca con la página recién
  cargada y termina en un `ver` o `no_ver`. `"pagina": "otra.html"` lo corre sobre otra página.
- Escribilos por lo que te PIDIERON. Si uno falla, lo normal es arreglar la página; el criterio sólo si estaba mal escrito.
- No podés cerrar si escribiste después del último `probar` o si el último dejó algo en rojo.

## Las reglas de la página

- **Autocontenida**: se sirve aislada y no puede pedir nada de afuera (ni CDNs, ni fuentes de Google, ni `fetch`).
  Fuentes del sistema, SVG a mano, imágenes como SVG o `data:`.
- Los formularios no se envían: se manejan con JavaScript en la página. Sin `localStorage` ni cookies.
- Rutas relativas entre tus archivos. `lang="es"`, viewport, un solo `h1`, que no se desborde en 390 px.
- No ves la página: «sin errores» no es «se ve bien». Eso lo dice Miguel con el botón «Ver».
