# tools/ui — el sistema de diseño de las herramientas

Cómo se ven y cómo se dividen las UIs del playground (`harness/panel`, `tablero` y `trazador`),
y por qué. El contrato de uso —regiones, medidas, componentes— es [`README.md`](README.md); acá van las
reglas y las trampas medidas que lo sostienen. Vivió en el `CLAUDE.md` raíz hasta el 2026-09-27: se mudó
para que se lea al tocar estilos, no en cada sesión.

## Las tres UIs comparten UN tema, y es un archivo

⚠ **Eran CUATRO hasta el 2026-09-21**, cuando se apagó la viz del árbol de `context/` (:5193). Las
medidas y los conteos de acá abajo se tomaron con las cuatro y **no se reescriben**: son lo que se
midió ese día. Lo que sí cambió es dónde viven los archivos —hoy tres copias, no cuatro— y eso lo
comprueba `make estilo-check`, que cuenta las que hay y no las que dice este texto.

**Fuente canónica (2026-09-19):** `tools/ui/theme.css`, `tools/ui/workbench.css` y
`tools/ui/workbench.js` y `tools/ui/RegionMenu.vue`. Editar allí y ejecutar `make estilo-sync`; `make estilo-check` detecta
cualquier copia desincronizada. El harness recibe el JS incrustado por el mismo comando, sin reiniciar
su servidor. Catálogo: `make estilo-guia` → http://127.0.0.1:5198; contrato actual en
[`README.md`](README.md).

**Preferencia de Miguel:** sin titlebar ni banners globales. Las acciones pertenecen al toolbar del
editor o de su región. El aviso de ambiente compartido del harness vive dentro del editor. El pie
ofrece alternar las regiones visibles conservando la última medida elegida. Los separadores admiten puntero y teclado con arrastre orgánico.
Las acciones frecuentes usan iconos con tooltip; las secundarias van en el menú de tres puntos de
cada región. El menú compartido admite teclado y marca las opciones activas. Los filtros de consola
indican «Filtrada» aun con el menú cerrado; entorno y canal conservan sus valores a la vista.
Los encabezados de región usan 12px, mayúscula inicial y 40px mínimos; el pie mide 30px. Esto reemplaza
las medidas y el uso de mayúsculas descritos en las notas históricas de abajo.

`context` (:5193), `harness/panel` (:5195), `tablero` (:5191) y `trazador` (:5192) tenían cuatro
paletas escritas a mano, con **cuatro nombres para el mismo concepto** —el texto apagado era `--dim`,
`--mut` y `--mut`; el acento era `--accent`, `--acc` y `--acc`; el rojo era `--fail`, `--bad` y
`--danger`—, así que no había forma de cambiarles el aspecto sin tocar las cuatro. Hoy:

- **`theme.css` es el archivo que se cambia, y es el MISMO en las tres** (`harness/panel` ·
  `tablero/src` · `trazador/src`). La fuente vigente es el tema Darkmatter de
  [ShadcnThemer](https://shadcnthemer.com/themes/278e858e-7c4c-4407-a4bc-2d48faadc5c8): al cambiar
  de tema se reemplaza el bloque de tokens y luego se ejecuta `make estilo-sync`. No lleva reglas
  propias de ninguna herramienta.
- **`make estilo-check`** es lo que hace que eso sea cierto y no una intención. Ocho chequeos, y cada
  uno nació de un error medido: md5 de los dos archivos compartidos · `in oklch` prohibido · contraste
  de las reglas que fijan color y fondo · variables usadas y nunca declaradas · el contrato de scroll ·
  **color literal adentro de una regla** · **reglas y media queries vacías** · qué región usa cada
  herramienta. Corrélo después de tocar estilos; sale ≠0 si algo está mal.
- ⚠ **Y el chequeo de contraste tiene un TECHO que hay que conocer: sólo ve reglas que fijan color Y
  fondo en la misma regla** —11 a 37 por herramienta—. Todo el resto del texto hereda el color de un
  ancestro y el fondo de otro, y eso no se resuelve leyendo CSS. Para eso está **`tools/contrast.js`**:
  recorre el DOM, resuelve el fondo efectivo subiendo por los ancestros y mide cada nodo con texto
  propio (también se puede pegar en la consola, con la herramienta abierta). La primera corrida sobre
  las cuatro encontró 22 nodos abajo del umbral —10 casos distintos— que el estático no veía: dos <!-- lint:ok -->
  quedado con la piel POR DEFECTO del navegador (#efefef sobre fondo oscuro), una manija de arrastre en
  **1,38:1** pintada con un token de borde, y tres textos con `opacity` apilada encima de la rampa.
  **Está cableado: `make estilo-contraste`** lo corre en las cuatro con el Chromium del harness. ⚠ NO
  levanta servidores —los puertos son tuyos— así que audita lo que esté corriendo y lo que no sale
  `SIN VERIFICAR` con exit 2, nunca en verde. Probado al revés con un `#555` inventado: sale ✗ y con 1.
  ⚠ Y tres trampas que costaron una corrida cada una: **Vite escucha sólo en IPv6**, así que sondear
  `127.0.0.1` da «no hay nada» sobre un servidor sano; **`networkidle` no llega nunca** en el panel,
  que pollea; y **las tareas del tablero llegan después del HTML**, así que con 600ms de espera el
  barrido medía una app vacía y decía ✓.
  ⚠ Dos trampas medidas al construirlo: **Chrome deja `oklch()` sin resolver en el computed style**
  (parsear esos números como RGB da 1,00 en todo — hay que pintar el color en un canvas y leer el
  píxel), y **`opacity` se apila sobre el color** sin que el chequeo estático lo vea, porque la regla
  sola es correcta. ⚠ Y se apila también la de los **ancestros**: hasta el 2026-09-23 la auditoría
  aplicaba sólo la del nodo, y la fecha de un hallazgo del tablero —ítem en `.85` × su línea en `.6`—
  salía verde estando en 3,53:1. Hoy multiplica la cadena entera; al estrenarlo, el panel del harness
  pasó de 7 a 21 nodos bajo AA.
- **La tinta compacta usa la rampa de `workbench.css`, no `--muted-foreground`:** los temas cambian su
  contraste relativo. `--fg-2` (74%) y `--fg-3` (70%) se derivan de `--foreground`; cualquier
  combinación explícita de tinta y superficie se verifica con `make estilo-check`. `--accent` es una
  superficie, así que su texto siempre usa `--accent-foreground`.
- Cada herramienta tiene, al lado, **su propia hoja con el PUENTE**: sus nombres viejos apuntando a
  los tokens (`--bg: var(--background)`, `--mut: …`) y lo que sólo significa algo ahí —el estado de una
  etapa, el carril de un ramal, el semáforo de un scorecard—. **Ese color semántico NO va en `theme.css`
  a propósito**: el export de un tema no lo trae, así que pegar uno nuevo encima lo borraría.
- Las tres apps de Vite además tienen **Tailwind v4** enchufado (`@tailwindcss/vite`), con los tokens
  ya mapeados a utilidades por el `@theme inline` del tema. ⚠ Las utilidades van en `@layer
  utilities` y **el CSS sin capa —todo lo que ya existe— les gana**: sirven para markup nuevo, y para
  migrar un bloque hay que borrarle la regla, no competirle. El panel del harness **no** tiene
  Tailwind: no tiene bundler (`npm run dev` es `node panel/server.ts`), así que consume el mismo
  `theme.css` por `<link>` y listo.

⚠ **Tres trampas medidas el 2026-09-18, las tres silenciosas** (ninguna hace fallar nada):

1. **Un tinte se mezcla `in oklab`, NUNCA `in oklch`.** Los neutros de tweakcn son `oklch(L 0 0)`:
   croma 0 y **hue 0, que es el rojo**. `oklch` es polar, así que `color-mix` interpola ese hue y
   arrastra el matiz — `color-mix(in oklch, #4ade80 20%, var(--card))` da **#4d3530**, un marrón
   rojizo, donde `in oklab` da **#2d4132**. Pasa con los cuatro colores. `make estilo-check` lo frena.
2. **Una variable sin declarar hace que el navegador tire la declaración ENTERA, sin decir nada.**
   `scorecards/` del tablero venía de otra paleta y usaba diez nombres que nadie declaraba: 60
   declaraciones muertas, o sea una vista sin superficies, sin bordes y sin semáforo. Se ve como un
   diseño feo, no como un error.
3. **`--accent` en shadcn es una SUPERFICIE** (#404040, con su `--accent-foreground`), no un color de
   texto. `trazador` y `context` lo usaban como el azul de los enlaces: aliasarlo dejaba texto #404040
   sobre fondo #1a1a1a. Ese uso se llama `--info` ahora.

## Y cómo se DIVIDE la pantalla: los nombres son los de VS Code

Hermano de lo anterior, y el mismo mecanismo: **`workbench.css`, idéntico en las cuatro**, al lado de
`theme.css`. El tema dice de qué COLOR es cada cosa; el taller dice QUÉ COSA ES. Son dos ejes y por eso
son dos archivos — un tema se reemplaza entero y el taller no, porque ahí hay decisiones (cuánto mide
un sidebar, qué scrollea) que ningún export de tweakcn trae.

Las regiones: `titlebar` · `banner` · `activitybar` · `sidebar` · `editor` · `panel` (la consola de
abajo) · `auxiliarybar` (el sidebar secundario) · `statusbar`, y adentro de cada una `region-head` y
`region-body`.

- ⚠ **Una región existe cuando tiene contenido propio Y scroll propio.** Es lo que separa un
  vocabulario de una ceremonia: un `activitybar` vacío porque «está en la lista» es peor que no
  tenerlo. Hoy: el panel del harness y el tablero son workbenches completos —el tablero con el
  sidebar en acordeón y sin activitybar, porque con UN solo contenedor de vistas esa columna no cambia
  nada— · `context` usa dos
  (`sidebar` el árbol, `editor` el detalle) · el trazador dos (`editor` el mapa, `auxiliarybar` los
  logs). `make estilo-check` lo lista, así que se ve de un vistazo quién adoptó qué.
- ⛔ **NINGUNA usa `titlebar`, y eso es el resultado de medirlo cuatro veces.** Una barra a lo ancho de
  la ventana le cobra su alto a TODAS las regiones, incluidas las que no usan nada de lo que hay ahí —
  y casi siempre lo que hay ahí le pertenece a UNA. Lo que se hizo en las cuatro es lo mismo: **su
  contenido baja a la barra de la región de la que habla**, y lo que quedaba —el nombre de la
  herramienta— se va, porque eso lo dice la pestaña del navegador. Medido, en px de alto ganados:

      tablero    titlebar 77  →  el editor y los dos sidebars se lo reparten
      context    titlebar 44  →  el buscador baja al ÁRBOL (es lo único que filtra); el detalle +43
      trazador   titlebar 60  →  el buscador baja al MAPA; el panel de logs +60, el mapa igual
      harness    titlebar 52  →  perillas y correr bajan al RECORRIDO; los dos sidebars +52 c/u

  El patrón que se repite en las cuatro: **la región que usaba la barra no gana ni pierde** (paga lo
  mismo, ahora en su propia cabecera) **y las demás ganan el alto entero**. El nombre sigue en
  `workbench.css` porque es el vocabulario de VS Code y una herramienta futura puede necesitarlo; que hoy
  no lo use nadie **no es un olvido**.
- **Una región puede tener VARIAS VISTAS apiladas** (`.view`), como el sidebar primario de VS Code:
  el árbol arriba y OUTLINE/TIMELINE colapsadas abajo. ⚠ **Una vista cerrada cuesta UNA FILA, no
  cero** — es la misma regla que el canal deshabilitado del panel del harness: verla apagada dice que
  existe y que ahora no corresponde; esconderla hace creer que no existe. Y ⚠ **no todo lo que se
  pliega es un `.view`**: esto es para vistas que se reparten el alto de una región de alto fijo. Para
  secciones dentro de un cuerpo que scrollea, el elemento correcto es `<details>`, que no necesita JS
  (el panel del harness ya tiene ocho así).
- **Las manijas de redimensionar comparten el ASPECTO pero no dónde van** (`.rsz` en `workbench.css`):
  una línea de 1px se ve pero no se agarra, así que la zona de agarre es más ancha y sólo se pinta al
  pasar por encima. Dónde va la pone cada herramienta —el panel del harness las tiene como pistas de
  su grid, el trazador en capa sobre el mapa, el tablero pegadas al borde de cada sidebar. ⚠ Y el tope
  de un arrastre **no puede ser un número fijo**: se calcula contra la ventana y el ancho de la otra
  columna, o la región del medio se queda sin ancho usable.
- **Un grupo dentro de una vista lleva el MISMO encabezado** (`.region-head.group`), y no uno más
  grande: un grupo que se ve más fuerte que la vista que lo contiene invierte la jerarquía. Lo que los
  distingue no es el tamaño sino el comportamiento — el de la región está fijo y el del grupo scrollea
  con la lista, pero **se pega arriba**, así que mientras recorrés un grupo largo siempre sabés en
  cuál estás. Por eso cada región declara su superficie (`--region-bg`): un hijo pegajoso tiene que
  pintarse opaco con el color de DONDE ESTÁ, no con uno fijo.
- **El encabezado de una región lleva barra de acciones y menú `⋯`**, como el Explorer de VS Code, y
  la división es lo que lo hace funcionar: en la **barra** lo que se HACE y es frecuente (iconos
  siempre a la vista); en el **menú** lo que se ALTERNA y se toca poco, con su tilde y su conteo.
  ⚠ Y un botón de la barra es un **icono de 24×24** (`.region-action`): un texto adentro se parte en
  dos renglones y se sale de la región — «⧉ copiar traza» quedó como «copi / traz» tapado por el panel
  de al lado. Lo que dice el botón lo dice su `title`.
  ⚠ Y hay **una condición para mandar un filtro al menú: el encabezado tiene que delatar que está
  puesto.** Un filtro escondido que nadie ve se olvida encendido, y después lo que falta se lee como
  «no existe». En el tablero eso lo dice el contador, que pasa de `9` a `9 / 16` en ámbar; sin esa
  señal, el filtro se queda a la vista. Primer uso: las seis casillas de estado del tablero, que eran
  tres renglones de pastillas antes de la primera tarea.
- ⚠ **Adoptar una región es SOLTARLE a la herramienta lo que la regla compartida ya dice**, no
  agregarle una clase encima. En `context` fue soltar el `background` del árbol: ahora lo pone
  `--sidebar` (#1f1f1f), un escalón por detrás del `--card` (#202020) del detalle, y las dos columnas
  dejan de ser la misma superficie. En `tablero` fue dejar que el encabezado tome la banda —fondo y
  borde abajo— que lo separa del contenido. Las desviaciones se DECLARAN en la hoja de cada una: en
  `context` las dos columnas son tarjetas dentro de una página, no regiones a sangre, así que se
  quedan con su borde y su radio.
- ⚠ **Y un nombre que no cambia nada es un nombre que alguien va a borrar.** Se probó etiquetar el
  mapa del trazador como `.editor`: su regla propia ya decía todo lo que la compartida diría, y lo
  único que sumaba era un `display:flex` que no tenía. Se sacó.
- **El contrato de scroll**: `.workbench` ocupa la ventana y **cada región scrollea sola; la página
  nunca scrollea**. Es opt-in, y `make estilo-check` lo verifica — incluido el atajo prohibido de
  fingirlo con `max-height: 82vh`, que el día que el header crezca una línea miente.
- El panel del harness es la **implementación de referencia**: el vocabulario se extrajo de ahí, no se
  inventó. Ya tenía el grid, las medidas en tokens y hasta los nombres (`.titlebar`, `.statusbar`).
  Se desvía en una cosa, declarada: mete sus tres columnas del medio en un `.shell` propio para poder
  redimensionarlas.
- ⚠ **Y una regla que costó dos intentos: una cabecera que junta varias cosas ENVUELVE, no desborda.**
  Adentro de una región, el ancho ya no es el de la ventana — depende de cuánto midan los sidebars de
  al lado, que se arrastran. La fila del recorrido del harness pide 823px: a 1512 entra en un renglón
  y a 1440 «Preparar + Lanzar» terminaba **17px debajo del sidebar vecino**, sin que nada fallara. Va
  `flex-wrap: wrap` **más `height: auto`**: `.region-head` fija `height: 32px`, y un `min-height`
  encima da una caja FIJA —no una que crece—, así que el segundo renglón queda afuera igual.

⚠ **Y la colisión que hubo que resolver primero, que es el mismo error de `--accent`:** en VS Code
`panel` es **la consola de abajo**, y en las cuatro herramientas `--panel` era un **color** (la
superficie de card) mientras `.panel` era un cajón. Tres significados para un nombre. Hoy el color es
`--card` (que ya venía del tema), los cajones son `.drawer`, y `panel` significa una sola cosa.

## Y con qué se separa una cosa de otra: SIETE reglas, las siete aplicadas en las cuatro

El tema dice el color y el taller dice qué región es cada cosa. Falta la tercera pregunta, que es la
que deja restos del diseño anterior: **¿con qué se separa un bloque del de al lado?** Antes se
contestaba con una caja —fondo propio + borde de 1px + radio— y eso es lo que se barrió el 2026-09-19.
La vara es medible y se toma en el navegador, no leyendo CSS: *¿cuántos elementos pintan un borde de
**3 o 4 lados** y miden más que una píldora?* Antes: 21 en `context`, 24 en el documento del tablero,
uno por cada `.card` del harness. Hoy: **cero contenedores** en las cuatro — lo que queda son inputs,
selects, iframes, imágenes y píldoras, que son objetos, no contenedores.

1. **Una región no lleva marco.** Lo que la separa es el escalón de fondo más UNA línea. Un borde
   alrededor de algo que ocupa toda su columna no separa nada. ⚠ Y cuidado con la costura doble: si la
   región de la izquierda pone `border-right` y la de la derecha `border-left`, hay 2px donde va 1 —
   medido en el trazador, el mapa pintaba en 546–547 y el panel en 547–548.
2. **Una sección dentro de una región se separa por su ENCABEZADO**, que sale **a sangre** (`margin: 0
   -<padding>`) y se lee como una banda de lado a lado. Con aire a los costados vuelve a leerse como
   otra tarjeta. Lo usan el panel del trazador y las vistas del tablero.
3. **Un callout es una barra de color a la izquierda y un tinte, CUADRADO.** Ni marco completo —no
   dice nada que el tinte no diga— ni `border-radius: 0 r r 0`, que redondea justo el lado que no
   tiene nada y deja la barra recta peleando con una curva a 2px.
4. **Una tabla son líneas por FILA, no una grilla de celdas.** El marco por celda pesa más que los
   datos; las columnas las alinea el texto. (Y el encabezado se distingue en gris, no con fondo.)
5. **Una píldora es relleno O contorno, nunca los dos.** Fondo teñido + borde teñido del mismo color
   es un anillo que la engorda sin agregar información. Encendida = relleno, apagada = contorno: la
   pareja default/outline de shadcn, que además dice el estado con la FORMA.
6. ⛔ **El cromo muerto se BORRA, no se anula** —y una regla que quedó VACÍA es su forma más visible,
   por eso la caza el chequeo 7. El caso del harness: `.card` tenía fondo, borde, radio
   y 20px de padding, y **tres bloques más abajo se los quitaban uno por uno**. Ninguno de los cuatro
   `.card` de la pantalla dibujaba su caja — pero el que agregue el quinto en un lugar nuevo se lleva
   la caja vieja sin pedirla. El anulador conserva lo que AGREGA y pierde lo que niega.
7. **Un color literal no sobrevive a un cambio de tema.** `#d8a657`, `#0a0c10`, `#fbbf24`, `#fff`: un
   export de tweakcn pegado encima los deja intactos, y así se destiñe una UI de a un detalle por vez.
   Lo que SÍ lleva un literal es la **declaración de un token** (`--ok: #22c55e`) y la sombra de un
   popover, que es negra en cualquier tema. Los demás se declaran: los `response_type` y los productos
   del harness son tokens desde hoy, igual que los carriles del trazador. **Cableado** en el chequeo 6.
   ⚠ Y al pasarlos a token, **el token tiene que existir en ESA herramienta**: puse `var(--fail)` en el
   harness por costumbre del trazador y ahí se llama `--danger`; el navegador habría tirado la
   declaración entera sin decir nada. Lo cazó `make estilo-check`.

⚠ **Lo que NO se toca: el cromo de un OBJETO.** Un input, un select, un botón, un iframe con contenido
ajeno y la miniatura de un screenshot sí llevan su marco y su radio — son cosas, no cajas alrededor de
cosas. La pregunta que discrimina: *¿esto ENVUELVE contenido de la app, o es una pieza en sí misma?*
