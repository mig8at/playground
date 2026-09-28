---
name: tablero-ui
description: Tocar la INTERFAZ del tablero (Vue en tablero/src, :5191): qué región es qué (sidebar con acordeón de estados, editor con pestañas en previsualización, consola de ramas abajo, pestañas Jira/Pendientes/Artifacts a la derecha), la gramática visual, el avance de estado en la fila, las rutas con hash, las preferencias en localStorage, la caché de arranque, y el nombrado en inglés del código (make tablero-naming). Usala antes de cambiar App.vue, ui-state.js o cualquier vista del tablero.
---

# tablero · la interfaz

Cómo está armada la UI del tablero y por qué. Lo que rige a todas las herramientas —tema, regiones,
separadores— está en `tools/ui/CLAUDE.md`; esto es lo propio del tablero. Vivía en `tablero/CLAUDE.md`
hasta el 2026-09-27.

## Dónde está cada cosa en pantalla

El tablero es un **workbench** (ver `tools/ui/CLAUDE.md`, §«Y cómo se DIVIDE la pantalla»), no una
página que scrollea:

| Región | Qué tiene |
|---|---|
| `sidebar` | su título (`Mis tareas`, el conteo, **⊟** y **⋯**), el buscador, y debajo **un acordeón con una vista por estado** — *En curso · Bloqueadas · En pruebas · Por empezar · Terminadas* — más *Traer de Jira* al final. Cada fila Jira lleva al borde el icono para **avanzar al paso siguiente**, como acción de fila de la base: aparece al pasar, al enfocar o en la fila elegida, en el lugar del «2 pend.». Arranca abierta sólo **En curso** y después recuerda qué grupos dejaste abiertos; los cerrados cuestan una fila y muestran su conteo igual. El **⋯** lleva los filtros (con tilde y conteo), «locales», «ver todas» y el ancho del sprint |
| `editor` | **una barra con las tareas abiertas** (como los archivos en VS Code) y debajo, de la enfocada, una cabecera con estado, sprint, puntos y Jira, seguida por la cronología curada de `task-context/`: **Hoy**, **Ayer** y las fechas reales anteriores, cada una un encabezado que se pega arriba mientras se lee y se pliega con un clic. Después queda el documento como consulta. Sin ninguna abierta manda **la vista abierta del acordeón** izquierdo: el sprint (los 4 indicadores + Mi jornada) o el import de Jira |
| `panel` | la consola de ramas de la tarea enfocada, en la forma de la base: banda con refrescar, **maximizar** y cerrar; subbanda con el repo elegido y la leyenda; la tabla; y el sidebar interno de 240 a la derecha con **sólo los repos trabajados en esa tarea** (con la consola por debajo de 600 se pliega y el repo se elige con el select de la subbanda). Está abierta por defecto y **Ramas** queda visible en el pie cuando se cierra. Lee `data/cache/ramas.json`, no corre Git al renderizar y se puede redimensionar; sin ramas se reduce a una franja informativa |
| `statusbar` | sprint, cuánto le queda y cuántas tareas hay a la vista, el estado de Jira y el de **canon** («canon al día», o de cuándo es la copia si canon no contesta; un clic revalida). El server mantiene la copia local de canon al día mientras está arriba (`cmd/web/canon_status.go`, contra el ETag del export). A la derecha el **botón de tema** (claro u oscuro, de la base) y los de disposición |
| `auxiliarybar` | un riel horizontal de **pestañas** con *Jira · Pendientes* y, cuando existen, *Artifacts* y *Canon*. **Canon** lee la copia local (`tablero/canon`, vía `/api/canon/topic`): los temas que declara la tarea con sus secciones, y la sección abierta; un enlace `canon:` de un bloque o de la prosa de canon abre ahí (Cmd/Ctrl-clic va a la web). Sólo aparece si la tarea declara temas o se abrió una sección. Una sola ocupa todo el cuerpo; Jira abre primero y muestra el issue completo sin marco de tarjeta. No repite una ficha de Detalle. Sólo aparece con una tarea abierta; el control del pie lo apaga y lo recupera |

En ventanas de hasta 1050 px las vistas derechas arrancan plegadas para conservar el ancho de lectura.
El control del pie lo abre de forma temporal; esa decisión no cambia la preferencia de las ventanas
grandes.

⚠ **La gramática visual es una sola en todas las regiones.** Filas y repos activos usan una
superficie suave con radio corto; las dos barras de pestañas comparten el mismo estado seleccionado;
los controles de disposición forman un grupo compacto. Los bordes separan regiones y filas de datos,
pero no envuelven otra vez cada elemento. Un conteo se muestra una sola vez junto a su nombre.

⚠ **No hay titlebar, a propósito.** Decía «Tablero · Sprint N · registro de tiempo y hallazgos» y
gastaba 77px de alto en repetir lo que ya dicen la pestaña del navegador y el statusbar. Su única
acción —«sólo este sprint»— vive en el **⋯** del sidebar, que es donde van las cosas que se alternan y
se tocan poco.

⚠ **Avanzar de estado vive en la fila de la tarea.** El icono consulta las transiciones permitidas por
Jira y ofrece sólo el paso siguiente del flujo normal, no bloqueos, invalidaciones ni retrocesos. El
clic derecho conserva el mismo acceso como atajo de teclado/ratón; una tarea terminada no muestra el
icono porque no tiene un avance normal.

⚠ **A la derecha hay pestañas y a la izquierda un acordeón**, porque responden a usos distintos: a la
izquierda las vistas son cinco ESTADOS de una lista y querés ver varios a la vez; a la derecha son
caras de UNA tarea, que se leen de a una. El riel conserva siempre los conteos y deja todo el alto
para Jira, Pendientes, Artifacts o la vista activa, sin apilar seis encabezados.

⚠ **El editor usa la cabecera para los datos breves y el cuerpo para el trabajo de la tarea.** Ahí se
apilan los avances por fecha, las decisiones, las referencias y el documento histórico. Las vistas de
consulta que requieren acción viven al costado; las ramas abajo, donde la tabla puede cruzar el editor
y el sidebar derecho sin convertirse en otra pestaña lateral.

⚠ **Los dos sidebars se arrastran, y el tope NO es un número fijo**: se calcula contra la ventana y el
ancho de la otra columna para que el editor nunca baje de 320px. Medido — con las vistas en 463 sobre
una ventana de 927 el editor quedaba en 164, o sea el documento en veinte caracteres de ancho. Los
anchos se guardan y se vuelven a acotar al abrir, porque la ventana pudo achicarse desde la última vez.

⚠ **No hay una ficha duplicada al costado.** Sprint, puntos, tiempo, Jira y contexto local viven bajo
el título y siguen visibles mientras cambia la vista auxiliar. **El editor de la tarea no tiene botón
de cerrar**: lo tiene su pestaña, que es donde uno lo busca; `Esc` hace lo mismo.

⚠ **Se abren VARIAS tareas a la vez, y la pieza que hace que eso sirva es la pestaña en PREVISTA.**
Un clic en el árbol abre la tarea en previsualización —en itálica— y el siguiente clic **la reemplaza**
en vez de sumar otra: recorrer 35 tareas deja UNA pestaña, no 35. Se fija con doble clic en la fila o
con un clic en su propia pestaña. Cerrar la activa enfoca la vecina, no vuelve al sprint; cerrar todas
sí. Si algún día se saca el modo previsualización «para simplificar», en diez minutos hay veinte
pestañas y ninguna se encuentra — es la mitad del patrón, no un adorno.

⚠ **Los cinco estados se nombran en UN solo lugar**: `TASK_GROUPS`, en `ui-state.js`. `FILTROS` sólo
declara el ORDEN, que es distinto a propósito — el filtro se lee como un flujo (sin empezar →
terminada) y el acordeón por atención (lo que está en vuelo primero). Tenían dos juegos de etiquetas
para los mismos ids y no molestaba mientras vivían lejos; desde que el menú ⋯ y las vistas comparten
una columna de 300px, el menú decía «iniciada 2» pegado a una vista que decía «En curso 2».

⚠ **El contador del encabezado es la única señal de que hay un filtro puesto**, ahora que las
casillas viven en el `⋯`. Pasa de `9` a `9 / 16` y se pone ámbar. Si algún día se agrega un filtro que
el contador no refleje, ese filtro **no puede ir al menú**: tiene que quedar a la vista.

⚠ **Y al entrar NO hay ninguna tarea seleccionada, a propósito.** Antes sí —quedaba la que estaba en
curso— porque `active` sólo decía «sobre cuál se registra el tiempo». Ahora `active` es **lo que
muestra el editor**, así que autoseleccionar significaba entrar directo a una tarea y no ver nunca el
sprint. Las pestañas **fijadas** sí vuelven al recargar (la prevista no), pero **ninguna queda
enfocada**: sólo la URL enfoca una tarea. Sin hash, el editor muestra el sprint con la barra de
pestañas arriba.

## La consola de ramas, como interfaz

Declaración mínima: `ramas: patron-de-la-rama` en el frontmatter, sólo cuando exista; varios patrones
se separan por coma. Actualizá la medición con `make tareas-ramas N=<id>` desde la raíz del playground.
Repositorio, rama, PR, ambientes y fecha de medición vienen del snapshot. No mantengas una segunda
tabla de estados en Markdown ni presentes una medición antigua como una comprobación de hoy. Si el
trabajo no tiene rama propia, no inventes un patrón para llenar la consola.

Los ocho contenedores locales no declaran una lista histórica de ramas: agrupan mejoras sucesivas y
una rama vieja deja de representar su estado. Si una mejora activa necesita seguimiento de entrega,
se anota dentro de su frente mientras exista; una tarea de producto en `work` sí mantiene `ramas:`.

La consola inferior agrupa la medición de la tarea enfocada: la tabla ocupa el área principal y el
selector derecho contiene únicamente los repos que aparecen en sus ramas. Al cambiar de tarea cambia
la consola. Si no existe `ramas:` o todavía no se midió, muestra un estado vacío; nunca rellena el
hueco con todos los repos del workspace. **Ramas no aparece entre las pestañas derechas.** Las columnas
Rama y PR permanecen fijas al desplazar ambientes, la cabecera explica los tres estados y la fecha se
lee de forma relativa con el instante exacto al pasar el cursor.

Cada tarea tiene una ruta copiable: `#/tareas/context` para los contenedores locales y
`#/tareas/core-543` para Jira. La pestaña derecha va como parámetro —`#/tareas/core-543?vista=pendientes`
o `?vista=artifacts`—, y Jira, que es el default, no se escribe: por eso un enlace viejo sin parámetros
sigue abriendo. Sin tarea, «Traer de Jira» abierta es `#/importar` y el sprint es la URL sin hash.
Cambiar de tarea o de vista del editor **entra al historial**; cambiar de pestaña **lo reemplaza**. La
ruta abre las locales aunque el filtro «locales» estuviera apagado y se restaura al recargar y con
atrás/adelante; una que no se puede cumplir (una tarea que ya no existe, una vista inventada) abre el
estado inicial y deja la URL limpia, pero recién en la última pasada, porque una local llega después
que Jira. Se usa hash routing para no depender de un fallback del servidor estático.

Lo demás son **preferencias** y van a `localStorage` con el prefijo `tablero:` (la regla es la de
`tools/ui/README.md` §«Qué se guarda y dónde»): los anchos y la visibilidad de las regiones, el filtro
`show-locals`, los grupos abiertos del acordeón (`open-groups`) y las pestañas fijadas (`open-tabs`,
sus slugs en orden; las que ya no existen se descartan al volver).

La recarga sigue el patrón **cache-first + stale-while-revalidate**: `tablero:bootstrap:v1` conserva
durante siete días el último sprint, sus tareas y la ventana de cuatro sprints. Se pinta y restaura la
ruta en el primer frame; después Jira se consulta por `fetch` en paralelo y reemplaza la caché. Un
estado viejo nunca se presenta como sincronizado: el pie dice `actualizando Jira…` o `Jira sin
actualizar`. Efforts, capas locales, pulso y ramas también se piden en paralelo y no bloquean Jira.
La caché del navegador es sólo de arranque; las fuentes siguen siendo Jira y los archivos locales.

## El código del tablero se nombra en inglés

Identificadores, archivos, carpetas y claves JSON del código del tablero van en inglés; los
comentarios, las tareas de `tasks/` (incluido su frontmatter) y los mensajes de consola siguen en
español. Se quedan como nombres propios `tablero`, `trazador`, `cuadrilla`, los targets de `make` y la
etiqueta del agente del pulso. Los estilos también van en inglés —archivos, clases y tokens—: los dos
archivos del sistema de diseño que comparten las herramientas son `theme.css` y `workbench.css`, con
fuente en `tools/ui/` (hasta el 2026-09-24 se llamaban `tema.css` y `taller.css`). Las claves JSON pasaron a inglés el 2026-09-23 (fase 4b, con el contrato
subido a `tablero.task.v2`, y ese mismo día a `v3` al entrar la pila); quedan en español sólo las que son el contrato de OTRO —la respuesta de
canon, la API de cuadrilla, Jira, el frontmatter— y cada una está aceptada con su alcance en
`tools/naming-allow.txt` (`json: <ruta>[:<tipo>] <claves>`), no como palabra suelta.

**`make tablero-naming` lo verifica** y sale 1 ante un nombre nuevo que no es inglés. Revisa los
identificadores declarados en Go, Vue/JS y Python, las claves JSON que emite el server (etiquetas y
mapas literales, por AST) y los nombres de archivo y carpeta, y dice cuántos leyó de cada fuente: una
fuente vacía es un error, no un verde. `make tablero-naming-test` fija su lógica, incluido un nombre
español inventado en cada lenguaje y una clave aceptada en un lugar que no queda aceptada en otro.

⚠ **La vara del inglés es la stdlib de Go y de Python, no el diccionario del sistema**, que trae inglés
arcaico y deja pasar `aviso`, `leer` o `tema`. Lo legítimo que la vara no conoce va a
`tools/naming-allow.txt`, en su categoría. La pregunta antes de agregar una línea es una sola: ¿es
inglés o un nombre propio? Si es español, se renombra: `tools/rename/` tiene los renombradores de Go
(sobre el type checker), Vue/JS y Python, que rechazan todo rename que sombree, y las comparaciones
viejo-contra-nuevo (`ab-cli.sh`, `ab-web.sh`, `ab-py.sh`, `ab-make.sh`) que prueban que nada visible
cambió. ⚠ Y su límite conocido: un falso amigo (`taller`, `once`, `red`) pasa igual que el inglés.
