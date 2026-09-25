# La base de las herramientas locales

La base sobre la que se construye y se mejora cada herramienta local del playground: cómo se divide la pantalla, cuánto mide cada pieza y cómo se comporta. Es el punto de llegada. Una herramienta nueva arranca de acá, y una existente se acerca a esto cada vez que se la toca. Si una medida o una pieza no está acá, no se inventa en la herramienta: se trae a este documento.

La misma base, dibujada en tamaño real y con sus cotas: [Anatomía del workbench](https://claude.ai/artifact/HAeuwXf3LCoQzYhTarn1Vz). El vocabulario de regiones es el de la [disposición de VS Code](https://code.visualstudio.com/docs/configure/custom-layout) y los componentes siguen a [shadcn/ui](https://ui.shadcn.com/docs/components/button), adaptados a Vue y HTML nativo.

## Regiones

| Pieza | Clase | Qué es | Cuándo existe |
| --- | --- | --- | --- |
| Editor | `editor` | El contenido principal: un documento, un mapa, un recorrido | Siempre. Es la única obligatoria y la única que no se pliega |
| Sidebar | `sidebar` | Navegación: una lista, un árbol, una búsqueda | Cuando hay más de una cosa entre la cual elegir |
| Sidebar secundario | `auxiliarybar` | Detalle o propiedades de lo elegido en el editor | Cuando lo elegido tiene detalle que no cabe en el editor |
| Panel | `panel` | La consola de abajo: salida que se sigue en el tiempo | Sólo si hay salida que seguir |
| Pie | `statusbar` | Estado a la izquierda; a la derecha, el botón de tema y un botón por región plegable | Siempre que haya una región plegable |

Adentro de cada región:

| Pieza | Clase | Regla |
| --- | --- | --- |
| Banda superior | `region-head` | Título a la izquierda, acciones al borde. Todas las columnas arrancan con la misma banda |
| Pestañas | `tabs` | Ocupan el lugar de la banda superior cuando la región muestra de a una cosa entre varias |
| Barra de iconos | `region-actions` › `region-action` | Lo frecuente y de hacer: agregar, colapsar, copiar, cerrar |
| Menú de la región | `RegionMenu` · `bindMenu()` | Lo que se alterna y se toca poco, con tilde y conteo |
| Cuerpo | `region-body` | Lo que scrollea. Scrollea el cuerpo, no la región |
| Vista | `view` · `view-tog` | Vistas apiladas que se reparten el alto. Cerrada cuesta una fila, no cero |
| Encabezado de grupo | `region-head.group` | Separa grupos de una lista y se pega arriba. Nunca más fuerte que la banda |
| Sección plegable | `accordion-item` | Dentro de un cuerpo que ya scrollea; es un `<details>`, no una vista |
| Manija | `rsz` | Redimensiona entre dos regiones. Se ve de 1 px y se agarra de 8 |

No hay titlebar, banner ni activitybar. Una barra a lo ancho le cobra su alto a todas las regiones: lo que tendría va a la banda de la región de la que habla, y el nombre de la herramienta ya lo dice la pestaña del navegador. Un aviso va junto a la operación que avisa.

## Opciones de una región

Además de su banda y su cuerpo, una región puede llevar tres cosas, siempre en este orden de arriba abajo: la banda (con título o con pestañas), una subbanda y el cuerpo, con un sidebar interno a la derecha si hace falta. **Una de cada una, como máximo.**

| Opción | Clase | Sidebar | Editor | Secundario | Consola | Medida |
| --- | --- | --- | --- | --- | --- | --- |
| Pestañas en la banda | `tabs` › `tab` | no: son vistas | documentos abiertos | caras de lo elegido | canales de salida | banda 40 · pestaña 36 |
| Vistas apiladas | `view` | listas distintas | no | grupos de propiedades | no | encabezado 32 |
| Subbanda | `subband` | no | qué documento, su leyenda | no | qué corrida, su filtro | 32 |
| Sidebar interno | `split` › `split-side` | no | no: es el secundario | no | qué repo, qué consulta | 240 · se pliega bajo 600 |
| Maximizar | `.workbench.panel-max` · `bindPanelMaximize` | no | no | no | salida larga | botón 24 · temporal |
| Dos paneles | `panes` › `pane` | no | comparar dos cosas | no | no | mitades · se pliega bajo 720 |
| Acciones de fila | `row` › `row-actions` | sí | en listas | sí | en su sidebar interno | botones 24 · dos |
| Barra de iconos y menú | `region-actions` · `RegionMenu` | sí | sí | sí | sí | botones 24 |

- **Una pestaña que se cierra** lleva su rótulo como botón (`.tab-label`) y una ✕ de 20 (`.tab-close`) que aparece al pasar o en la activa y ocupa su lugar siempre. La que se reemplaza al elegir otra va en itálica (`.tab.preview`).
- **Las pestañas son la banda.** No se agrega una banda arriba: las acciones de la región van al borde derecho de la misma barra (`.tabs > .region-actions`). La activa toma el fondo del cuerpo de su región; una pestaña puede llevar su `.count`.
- **La subbanda dice qué se está viendo.** Existe sólo si el cuerpo cambia según lo elegido. Si hay un filtro puesto, su contador lo delata ahí (`.count.filtered`).
- **El sidebar interno va a la derecha y se pliega solo.** Mide 240 (`--split-side-w`). Si la región no le deja 360 al contenido, desaparece con una consulta de contenedor, sin JavaScript. Lo que muestra también tiene que poder elegirse de otra forma, porque en una consola angosta no está.
- **Maximizar es temporal.** El botón de la banda de la consola (`bindPanelMaximize`, iconos `maximize` y `restore`) le da todo el alto de la columna y tapa el editor. Es la única forma de hacerlo, y por eso no se guarda: se deshace con el mismo botón o con Escape desde la consola. Su manija, marcada `data-rsz="panel"`, no aparece mientras tanto.
- **Dos paneles, para comparar.** `.panes` parte el editor en mitades (`.pane`), cada una con su banda de 40. Si no entran dos de 360, queda el primero y el segundo se pliega solo.
- **Las acciones de fila no mueven la fila.** `.row-actions` flota sobre el borde derecho: aparece al pasar, al enfocar o en la fila elegida, en el lugar del dato de la derecha, y el nombre se corta antes para no pasar por debajo. Dos botones de 24 como máximo; el resto, al menú. En una pantalla táctil están siempre.
- **Una salida se escribe en líneas de log** (`.log-line` y `.log-time`): mono de 12 sobre 20, la hora aparte y apagada, sin separadores entre líneas.

```html
<section class="panel">
  <nav class="tabs">
    <button class="tab on">Corrida</button><button class="tab">SSR <span class="count">3</span></button>
    <div class="region-actions">…</div>
  </nav>
  <div class="subband"><span class="grow"><strong>Solicitud 519245</strong> · local</span><span class="count filtered">9 / 16</span></div>
  <div class="split">
    <div class="split-main"><div class="log-line"><span class="log-time">12:41:03</span><span>identidad · validada</span></div></div>
    <aside class="split-side"><div class="region-head group"><span>Consultas guardadas</span></div>…</aside>
  </div>
</section>
```

## Medidas

Una grilla de 4 y cuatro alturas que se repiten en todas las regiones, para que las líneas de una columna sigan en la de al lado:

| Pieza | Medida | Token |
| --- | --- | --- |
| Banda superior de cada columna | 40 px **con** su línea (`border-box`) | `--region-head-h` |
| Encabezado de vista o de grupo | 32 px | `--view-head-h` |
| Fila de lista, árbol o menú | 28 px | `--row-h` |
| Campo, botón, select | 32 px | `--control-md` |
| Control dentro de una banda | 28 px | `--control-sm` |
| Botón de icono | 24 px, icono de 16 | `--control-xs` · `--icon-size` |
| Pie | 30 px, texto 11 | `--statusbar-h` |
| Margen del texto de una región | 12 px, en la banda y en cada fila | `--gutter` |
| Margen de un documento en el editor | 24 px | `--space-6` |
| Nivel de un árbol | 16 px | `--indent` |
| Anchos por defecto | sidebar 300 · secundario 340 · panel 240 de alto | `--sidebar-w` · `--auxiliarybar-w` · `--panel-h` |
| Mínimos | sidebar y secundario 240 · panel 124 · editor 360 | `--sidebar-min` · `--panel-min` · `--editor-min` |

Un control dentro de una banda mide 28 (24 si es de icono): 4 de aire, 28 y 4 dan los 40. `workbench.css` lo aplica al final del archivo.

## Componentes

Cada componente tiene una medida exacta —alto, padding, gap, letra, peso, interlineado, radio, icono— escrita en [`spec.json`](spec.json), que es la fuente: se cambia ahí primero y después `workbench.css`. `make estilo-componentes` dibuja cada uno con `theme.css` y `workbench.css` y compara lo que pinta el navegador contra esos números, así la base no puede decir una medida y pintar otra. El artifact muestra la misma especificación, con cada componente dibujado con este `workbench.css`.

Los controles comparten una escalera de cuatro tamaños. Un control de un tamaño mide lo mismo, sea botón, botón de icono, campo, alternador o select:

| Tamaño | Alto | Padding | Gap | Letra | Línea | Dónde |
| --- | --- | --- | --- | --- | --- | --- |
| `xs` | 24 | 8 | 4 | 12 | 16 | Adentro de una fila o de una barra de iconos |
| `sm` | 28 | 12 | 8 | 13 | 20 | Adentro de una banda superior |
| `md` | 32 | 12 | 8 | 13 | 20 | Por defecto: el cuerpo de una región, un formulario |
| `lg` | 40 | 16 | 8 | 14 | 20 | Sólo la acción principal de un estado vacío |

Radio 6, peso 500 e icono de 16 en los cuatro. El ancho mínimo es igual al alto. Las medidas cuentan la caja entera, con el borde adentro (`border-box`).

| Estado | Regla |
| --- | --- |
| Al pasar | Fantasma, contorno, icono, alternador y fila: fondo `--hover` (la tinta al 8 %). Primario y destructivo: su color al 90 % |
| Encendido o elegido | `--accent` de fondo y `--accent-foreground` de tinta; la fila elegida suma una barra de 2 a la izquierda en `--primary` |
| Foco | Un solo anillo para todo: `outline` de 2 en `--ring`, separado 2 |
| Deshabilitado | Opacidad .5 y sin puntero |

El texto de un botón es un verbo en infinitivo, con objeto si hace falta («Guardar», «Correr el caso»): de una a tres palabras, mayúscula inicial y sin punto. Un solo botón primario por región; el resto, contorno o fantasma, y en un grupo el primario va primero.

## Tipografía

| Tamaño | Token | Uso |
| --- | --- | --- |
| 11 | `--text-xs` | Pie, conteos, metadatos, píldoras |
| 12 | `--text-sm` | Bandas y encabezados de grupo, pestañas, rótulos de campo |
| 13 | `--text-base` | La interfaz: filas, campos, botones, menús |
| 14 | `--text-body` | La prosa de un documento, a 65 caracteres por renglón |
| 16 | `--text-title` | El título del documento abierto o de un estado vacío; uno por pantalla |

- Dos familias: `--font-sans` para todo el texto y `--font-mono` sólo para datos literales (ids, ramas, rutas, comandos, logs), un tamaño menos que el texto que lo rodea.
- Dos pesos: 400 el texto, 600 los títulos y lo elegido. El 500 vive sólo adentro de los componentes (botón, rótulo, píldora).
- Interlineado 1,4 en la interfaz y 1,6 en la prosa. Números en columna con `tabular-nums`.
- La jerarquía la dan el peso y la tinta, no el tamaño: adentro de una región, a lo sumo dos tamaños.
- Sin mayúsculas sostenidas ni espaciado entre letras: un rótulo va en mayúscula inicial.
- El texto secundario usa `--fg-2` y `--fg-3`, medidos sobre las superficies del tema. No se atenúa una fila con `opacity`.

## Espacios

| Paso | Token | Uso |
| --- | --- | --- |
| 4 | `--space-1` | Aire de un control dentro de una banda; entre una fila y el borde de su región |
| 8 | `--space-2` | Icono y texto; controles vecinos; un rótulo y su campo |
| 12 | `--space-3` | El margen de una región; entre campos de un formulario |
| 16 | `--space-4` | Entre bloques de una sección |
| 24 | `--space-6` | Entre secciones del editor; el margen de un documento |

No hay 20. La única excepción a la escala son los 2 px entre botones de icono vecinos de una barra. Los grupos se separan con `gap`, nunca con márgenes por elemento.

## Iconos

Un solo juego, el de `workbench.css` (`.ui-icon[data-icon]`): glifos dibujados en una grilla de 24, trazo de 1,75, extremos redondeados y sin relleno, pintados con `currentColor`.

- Un solo tamaño, 16 px, adentro de un botón de 24. La zona de toque es el botón.
- `--fg-2` en reposo y `--foreground` al pasar o activo. Con color sólo para un estado, y con texto o forma que diga lo mismo.
- Un icono sin texto lleva `title` y `aria-label`. Icono y texto, sólo en la acción principal de una región.
- Un carácter no es un icono (✕ ⧉ ▸ ⋯ ✓ ⚠ o un emoji): cambia con la fuente y no se centra en el botón. Un icono nuevo se dibuja en la misma grilla y se suma a `workbench.css`; no se mezclan juegos.

```html
<button class="region-action" title="Copiar" aria-label="Copiar">
  <span class="ui-icon" data-icon="copy" aria-hidden="true"></span>
</button>
```

## Forma

| Pieza | Radio | Token |
| --- | --- | --- |
| Regiones, bandas, filas a sangre, tablas, avisos | 0 | — |
| Botón, campo, botón de icono, fila elegida, ítem de menú | 6 | `--radius-control` |
| Lo que flota (menú, popover) | 10: el radio del ítem más el aire que lo rodea, concéntricos | `--radius-float` |
| Píldoras, contadores, puntos de estado | completo | — |

- Una región se separa de la de al lado con un escalón de fondo y **una** línea de 1 px (`--border`), que pone una sola de las dos. Sin marco alrededor de algo que ocupa toda su columna.
- Una caja es para un objeto (un campo, un botón, una imagen), no para envolver contenido.
- Una píldora es relleno o contorno, nunca los dos.
- La fila elegida lleva un fondo suave y una barra de 2 px a la izquierda en el color de acción.
- La sombra es sólo para lo que flota.
- Un color es un token: el tema da los colores y la hoja de cada herramienta, los de sus estados. Un color escrito a mano no sobrevive a un cambio de tema.
- El primario que lleva **texto** —un enlace, el botón principal, el contador filtrado— es `--primary-ink`: el primario del tema mezclado con un 30 % de la tinta. El primario en claro de Darkmatter no llega a 4,5:1 ni como texto sobre blanco ni con texto blanco encima; `--primary-ink` pasa en los dos temas y, como es una derivación, en cualquier tema que se pegue. El primario solo queda para lo que no es texto: una línea, una barra, un punto.

## Comportamiento

**La página no scrollea; cada región sí.** `.workbench` ocupa la ventana y lo que scrollea es el cuerpo de cada región, con su banda fija arriba. No se finge con `max-height` en `vh`.

**Mínimo o nada.** Una región que se redimensiona mide 0 o al menos su mínimo, por cualquier camino: arrastre, teclado, ventana o una medida guardada. Si la ventana no alcanza, `fitRegions` achica las columnas hasta su mínimo, después pliega el sidebar secundario y al final el sidebar; el editor nunca baja de `--editor-min`. La herramienta guarda lo que eligió la persona (medida y abierta o plegada) y **deriva** lo que se pinta: así, lo que se plegó por falta de lugar vuelve solo cuando la ventana crece. `bindResize` pliega por defecto; `collapsible: false` es una excepción que se declara. Una región fija sin manija lo declara con `data-size="fixed"`.

**Plegar es lo mismo que el botón del pie.** El botón se apaga y, al reabrir, la región vuelve con la última medida abierta. Ocultar una región nunca borra su botón del pie. Los anchos se guardan en el navegador de cada persona y no cambian datos de trabajo.

**El tema lo elige la persona.** Un botón en el pie alterna claro y oscuro, antes de los botones de disposición y separado de ellos por 8 (los de disposición van al final porque su orden copia la pantalla: izquierda, abajo, derecha). El icono muestra el tema **actual** —sol claro, luna oscuro— y la etiqueta dice lo que hace el clic: «Cambiar a tema claro». La primera vez sigue al sistema, y mientras la persona no elija acompaña su modo nocturno; lo elegido se guarda en su navegador (`ui.theme`). El tema es la clase `.dark` de `theme.css` en el `<html>`, más `color-scheme` para los controles nativos. Lo que pinta por su cuenta —un iframe, un canvas— escucha el evento `ui-theme`.

```html
<head>
  <script>/* el valor de THEME_BOOT, de workbench.js: aplica el tema antes de pintar */</script>
</head>
…
<button class="region-action" id="theme"><span class="ui-icon" aria-hidden="true"></span></button>
<script type="module">
  import { bindThemeToggle } from './workbench.js'
  bindThemeToggle(document.getElementById('theme'))
</script>
```

⚠ **Una herramienta muestra el botón recién cuando sus colores funcionan en los dos temas.** Los colores de estado de su hoja propia (`--ok`, `--warn`, los carriles, los semáforos) se definen para claro y para oscuro, no se fija `color-scheme: dark` a mano en un control, y `make estilo-contraste` pasa en los dos. Un color pensado para fondo oscuro sobre blanco no se lee.

**El teclado llega a todo.** En una manija enfocada, las flechas ajustan 16 px y la que cruza el mínimo pliega; Shift más flecha, 48 px; Home pliega; End amplía; Enter alterna y reabre en la última medida. El arrastre sigue al puntero y se cancela limpio ante `pointercancel` o si se pierde la captura.

## Menús

La barra de iconos de una región lleva lo frecuente. El resto va al menú de tres puntos (`RegionMenu`): nombres completos, tildes y conteos, y un punto sobre el botón cuando hay opciones activas. **Un filtro sólo puede vivir en el menú si la banda delata que está puesto** (un contador que pasa de `9` a `9 / 16`, o un rótulo «Filtrada»); sin esa señal, el filtro se queda a la vista.

El menú se monta fuera del scroll de la región y se ajusta a la ventana. Se abre con clic, Enter, Espacio o flechas; las flechas, Home y End lo recorren, y Escape lo cierra y devuelve el foco al botón. Las tildes lo dejan abierto para ajustar varias opciones. Un clic afuera, un cambio de foco o el scroll de la región lo cierran.

En Vue se pasan `items` y se maneja `@select`. En HTML, `bindMenu(button, { getItems, onSelect, label })`. Cada opción tiene `id` y `label`, y puede tener `icon`, `disabled`, `count` o `checked`; `{ separator: true }` divide grupos.

## Construir sobre la base

Para una herramienta nueva, y en ese orden para acercar una existente cada vez que se la toca:

1. Sumarla a `make estilo-sync` y `make estilo-check` (en `tools/ui-sync.py` y `tools/style.py`), para que reciba `theme.css`, `workbench.css` y `workbench.js`, y para que el chequeo la vea.
2. La raíz es `.workbench`. Empezar por el `editor` y sumar las demás regiones sólo si tienen algo que mostrar.
3. Cada región arranca con su banda de 40 (`.region-head` o una barra de pestañas) y sigue con un cuerpo que scrollea.
4. Escribir cada medida con su token: `var(--row-h)`, `var(--gutter)`, `var(--text-sm)`.
5. Iconos sólo de `.ui-icon`, a 16, en botones de 24 con `title` y `aria-label`.
6. El pie lleva el estado a la izquierda y, a la derecha, el botón de tema y un botón por región plegable. El tema, con `THEME_BOOT` en el `<head>` y `bindThemeToggle` en el botón, cuando los colores ya funcionan en los dos temas.
7. Las manijas usan `vResize` (o `bindResize` sin Vue), con los mínimos de los tokens y el máximo calculado contra `--editor-min`. Lo que se pinta sale de `fitRegions`:

```js
import { vResize, fitRegions, cssSize } from './workbench.js'

// lo que eligió la persona
const sidebar = ref({ open: true, width: 300 })
const detail = ref({ open: true, width: 340 })
const viewport = ref(innerWidth) // se actualiza en `resize`

// lo que se pinta: primero se pliega el detalle, después el sidebar
const shown = computed(() => {
  const min = cssSize('--sidebar-min', 240)
  const [aux, side] = fitRegions(viewport.value - cssSize('--editor-min', 360), [
    { size: detail.value.open ? detail.value.width : 0, min },
    { size: sidebar.value.open ? sidebar.value.width : 0, min },
  ])
  return { side, aux }
})

const sidebarResize = {
  label: 'Ancho del explorador', sign: 1, defaultValue: 300,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewport.value - shown.value.aux - cssSize('--editor-min', 360),
  get: () => shown.value.side,
  // 0 es plegar: la medida elegida queda como la última abierta
  set: (v) => { if (!v) sidebar.value.open = false; else sidebar.value = { open: true, width: v } },
  reopen: () => sidebar.value.width,
}
```

```html
<div class="rsz" v-resize="sidebarResize"></div>
```

8. Verificar con `make estilo-componentes` que un componente nuevo o cambiado pinta lo que dice `spec.json`, y con los chequeos de abajo.

## Archivos y verificación

- `theme.css`: los tokens de color, tipografía y radio del tema (hoy Darkmatter, de ShadcnThemer). Se reemplaza entero con `make estilo-tema DE=archivo.css`.
- `workbench.css`: las regiones, las medidas, los componentes, el foco y los iconos. Un tema no lo toca.
- `workbench.js`: el comportamiento (manijas con mínimo o nada, `regionSize`, `fitRegions`, `reopenSize`, `cssSize`; la consola maximizada, `bindPanelMaximize`; el tema, `THEME_BOOT`, `bindThemeToggle`, `setTheme`, `applyTheme`; el menú `bindMenu` y la directiva `vResize`). Sus pruebas sin navegador están en `workbench.test.mjs`.
- `spec.json`: la medida exacta de cada componente; la lee `make estilo-componentes` y de ahí sale la sección de componentes del artifact.
- `RegionMenu.vue`: el adaptador Vue del mismo menú.
- `index.html`: el catálogo interactivo, que usa estos mismos archivos (`make estilo-guia`, en http://127.0.0.1:5198).

Se edita acá y se reparte con `make estilo-sync`: cada herramienta tiene su copia para no depender de las otras, y el panel del harness recibe `workbench.js` incrustado en su HTML (no se edita el bloque entre `workbench-shared`).

| Comando | Qué verifica |
| --- | --- |
| `make estilo-check` | Que las copias sean iguales a la fuente, los tokens, el contraste estático y la estructura |
| `make estilo-componentes` | Que cada componente pinte la medida exacta de `spec.json` (sin herramientas encendidas) |
| `make estilo-minimo` | Mínimo o nada: la lógica sin navegador y, con las herramientas encendidas, cuatro anchos de ventana y cada paso del teclado |
| `make estilo-contraste` | El contraste de lo que se pinta, con las herramientas encendidas. `THEME=light` o `THEME=dark` fija el tema de las que tienen botón: una herramienta con botón de tema tiene que pasar en los dos |
| `make estilo-ui` | Teclado, arrastre, persistencia, menús y tres anchos de ventana, con las herramientas encendidas (`SOLO=` elige cuáles) |
